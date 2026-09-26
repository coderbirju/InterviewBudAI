/**
 * The CSV import engine (ADR 0009 D2): parse → map → match → de-duplicate →
 * preview (+ `previewHash`) → commit plan → note building. Pure and
 * deterministic; the only I/O (which notes already exist, writes, backups)
 * is done by the caller (`routes.ts`).
 */

import { createHash } from 'node:crypto';
import type { IntuitionNote, IsoTimestamp, NoteStatus } from '@ibai/storage';
import { isNoteStatus, resolveNoteStatus } from '@ibai/storage';
import { parseCsv } from './csv.js';
import { mapNotionRecords } from './notion.js';
import type { MappedRow } from './notion.js';
import { normalizeTitle } from './match.js';
import type { CatalogMatch, CatalogMatcher } from './match.js';

/** A file sent by the client. `name` is display-only, never a path. */
export interface ImportFile {
  readonly name: string;
  readonly text: string;
}

/** Limits (ADR 0009 D2). Over-limit → the whole request is rejected. */
export const IMPORT_LIMITS = {
  maxFiles: 64,
  maxRows: 5000,
  maxColumns: 64,
  maxCellBytes: 64 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxNameLength: 255,
} as const;

/** Max characters of a body shown in the preview. */
export const BODY_PREVIEW_LENGTH = 200;

/** A row that survived de-duplication. */
export interface Candidate {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly title: string;
  readonly url: string;
  readonly match: CatalogMatch | null;
  readonly mapped: MappedRow;
}

/** Output of {@link analyzeImport} (no knowledge of the data dir yet). */
export interface ImportAnalysis {
  readonly files: readonly ImportFile[];
  readonly candidates: readonly Candidate[];
  readonly blankRows: number;
  readonly duplicatesCollapsed: number;
  readonly errors: readonly { readonly file: string; readonly error: string }[];
}

/** A request-level rejection (no partial import). */
export interface ImportRejection {
  readonly ok: false;
  readonly status: 400 | 413;
  readonly error: string;
}

/** Collapse whitespace for fingerprints. */
function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Validate the untrusted `files` value from a request body.
 */
export function parseImportFiles(
  value: unknown,
): { ok: true; files: ImportFile[] } | ImportRejection {
  if (!Array.isArray(value) || value.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'expected "files": a non-empty array of { name, text }',
    };
  }
  if (value.length > IMPORT_LIMITS.maxFiles) {
    return {
      ok: false,
      status: 413,
      error: `too many files: ${value.length} (the limit is ${IMPORT_LIMITS.maxFiles})`,
    };
  }
  const files: ImportFile[] = [];
  let total = 0;
  for (const f of value) {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) {
      return {
        ok: false,
        status: 400,
        error: 'each file must be { name, text }',
      };
    }
    const { name, text } = f as Record<string, unknown>;
    if (typeof name !== 'string' || typeof text !== 'string') {
      return {
        ok: false,
        status: 400,
        error: 'each file must have a string "name" and "text"',
      };
    }
    total += Buffer.byteLength(text, 'utf8');
    files.push({ name: name.slice(0, IMPORT_LIMITS.maxNameLength), text });
  }
  if (total > IMPORT_LIMITS.maxTotalBytes) {
    return {
      ok: false,
      status: 413,
      error: `the files total ${total} bytes (the limit is ${IMPORT_LIMITS.maxTotalBytes})`,
    };
  }
  return { ok: true, files };
}

/** More non-empty extra columns wins; ties keep the earlier row. */
function richer(a: Candidate, b: Candidate): Candidate {
  return b.mapped.sections.length > a.mapped.sections.length ? b : a;
}

/**
 * Parse, map, match and de-duplicate every file. Per-file parse errors are
 * reported (nothing from that file is used); limit violations reject the
 * whole request.
 */
export function analyzeImport(
  files: readonly ImportFile[],
  matcher: CatalogMatcher,
): { ok: true; analysis: ImportAnalysis } | ImportRejection {
  const errors: { file: string; error: string }[] = [];
  const all: Candidate[] = [];
  let blankRows = 0;
  let totalRows = 0;

  for (const [fileIndex, file] of files.entries()) {
    const parsed = parseCsv(file.text);
    if (!parsed.ok) {
      errors.push({ file: file.name, error: parsed.error });
      continue;
    }
    if (parsed.header.length > IMPORT_LIMITS.maxColumns) {
      return {
        ok: false,
        status: 413,
        error: `${file.name}: ${parsed.header.length} columns (the limit is ${IMPORT_LIMITS.maxColumns})`,
      };
    }
    totalRows += parsed.records.length;
    if (totalRows > IMPORT_LIMITS.maxRows) {
      return {
        ok: false,
        status: 413,
        error: `too many rows (the limit is ${IMPORT_LIMITS.maxRows} across all files)`,
      };
    }
    for (const record of [
      { line: 1, cells: parsed.header },
      ...parsed.records,
    ]) {
      for (const cell of record.cells) {
        if (Buffer.byteLength(cell, 'utf8') > IMPORT_LIMITS.maxCellBytes) {
          return {
            ok: false,
            status: 413,
            error: `${file.name}: a cell on line ${record.line} is larger than ${IMPORT_LIMITS.maxCellBytes} bytes`,
          };
        }
      }
    }
    const mapped = mapNotionRecords(parsed.header, parsed.records);
    blankRows += mapped.blankRows;
    for (const row of mapped.rows) {
      all.push({
        key: `${fileIndex}:${row.line}`,
        file: file.name,
        line: row.line,
        title: row.title,
        url: row.url,
        match: matcher.match(row.title, row.url),
        mapped: row,
      });
    }
  }

  // De-duplicate by MAPPED fields (never cell positions): X.csv and X_all.csv
  // hold the same rows with different column orders.
  const byFingerprint = new Map<string, number>();
  const kept: Candidate[] = [];
  let duplicatesCollapsed = 0;
  for (const c of all) {
    const normTitle = normalizeTitle(c.title);
    const fp = JSON.stringify([
      c.match?.problemId ?? `title:${normTitle}`,
      normTitle,
      squash(c.mapped.body),
      squash(c.mapped.notes),
      c.mapped.lastVisited,
    ]);
    const at = byFingerprint.get(fp);
    if (at === undefined) {
      byFingerprint.set(fp, kept.length);
      kept.push(c);
    } else {
      duplicatesCollapsed++;
      kept[at] = richer(kept[at] as Candidate, c);
    }
  }

  return {
    ok: true,
    analysis: {
      files,
      candidates: kept,
      blankRows,
      duplicatesCollapsed,
      errors,
    },
  };
}

/** Problem ids the analysis matched (so the caller can check which exist). */
export function matchedProblemIds(analysis: ImportAnalysis): string[] {
  const ids = new Set<string>();
  for (const c of analysis.candidates) {
    if (c.match) ids.add(c.match.problemId);
  }
  return [...ids];
}

/** A preview row (ADR 0009 D2 shape, plus the additive `chosen`). */
export interface PreviewRow {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly title: string;
  readonly match: CatalogMatch | null;
  readonly existing: 'none' | 'note';
  /** True for the row imported for its problem (one per problem). */
  readonly chosen: boolean;
  readonly fields: {
    readonly status: NoteStatus;
    /** ISO date from `Last Visited`, or null (→ import time). */
    readonly lastUpdated: string | null;
    readonly timeComplexity?: string;
    readonly spaceComplexity?: string;
    readonly bodyPreview: string;
  };
  readonly warnings: readonly string[];
}

/** An unmatched row (listed, never written). */
export interface UnmatchedRow {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly title: string;
  readonly url: string;
}

/** `POST /api/import/csv/preview` response. */
export interface ImportPreview {
  readonly previewHash: string;
  readonly defaultStatus: NoteStatus;
  readonly rows: readonly PreviewRow[];
  readonly unmatched: readonly UnmatchedRow[];
  readonly duplicatesCollapsed: number;
  readonly blankRows: number;
  readonly errors: readonly { readonly file: string; readonly error: string }[];
}

/** Default row per problem: the most recent `Last Visited` (null oldest; ties → first). */
function defaultChoices(candidates: readonly Candidate[]): Map<string, string> {
  const chosen = new Map<string, Candidate>();
  for (const c of candidates) {
    if (!c.match) continue;
    const current = chosen.get(c.match.problemId);
    if (
      current === undefined ||
      (c.mapped.lastVisited ?? '') > (current.mapped.lastVisited ?? '')
    ) {
      chosen.set(c.match.problemId, c);
    }
  }
  return new Map([...chosen].map(([id, c]) => [id, c.key]));
}

/**
 * SHA-256 over the data dir, `defaultStatus`, every file's name + exact text,
 * and every resolved row's problem id, mapped fields and "note exists" flag.
 */
export function computePreviewHash(
  analysis: ImportAnalysis,
  dataDir: string,
  defaultStatus: NoteStatus,
  existing: ReadonlySet<string>,
): string {
  const payload = JSON.stringify({
    v: 1,
    dataDir,
    defaultStatus,
    files: analysis.files.map((f) => [f.name, f.text]),
    rows: analysis.candidates
      .filter((c) => c.match !== null)
      .map((c) => {
        const id = (c.match as CatalogMatch).problemId;
        return [
          c.key,
          id,
          c.title,
          c.mapped.body,
          c.mapped.notes,
          c.mapped.content,
          c.mapped.lastVisited,
          c.mapped.timeComplexity ?? null,
          c.mapped.spaceComplexity ?? null,
          existing.has(id),
        ];
      }),
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Build the preview (no writes). */
export function buildPreview(
  analysis: ImportAnalysis,
  dataDir: string,
  defaultStatus: NoteStatus,
  existing: ReadonlySet<string>,
): ImportPreview {
  const choices = defaultChoices(analysis.candidates);
  const perProblem = new Map<string, number>();
  for (const c of analysis.candidates) {
    if (c.match) {
      const id = c.match.problemId;
      perProblem.set(id, (perProblem.get(id) ?? 0) + 1);
    }
  }
  const rows: PreviewRow[] = [];
  const unmatched: UnmatchedRow[] = [];
  for (const c of analysis.candidates) {
    const warnings = [...c.mapped.warnings];
    const id = c.match?.problemId;
    if (id === undefined) {
      unmatched.push({
        key: c.key,
        file: c.file,
        line: c.line,
        title: c.title,
        url: c.url,
      });
    } else if ((perProblem.get(id) ?? 0) > 1) {
      warnings.push(
        `${perProblem.get(id)} different rows match ${c.match?.title}; only one is imported (default: the most recent Last Visited)`,
      );
    }
    rows.push({
      key: c.key,
      file: c.file,
      line: c.line,
      title: c.title,
      match: c.match,
      existing: id !== undefined && existing.has(id) ? 'note' : 'none',
      chosen: id !== undefined && choices.get(id) === c.key,
      fields: {
        status: defaultStatus,
        lastUpdated: c.mapped.lastVisited,
        ...(c.mapped.timeComplexity !== undefined && {
          timeComplexity: c.mapped.timeComplexity,
        }),
        ...(c.mapped.spaceComplexity !== undefined && {
          spaceComplexity: c.mapped.spaceComplexity,
        }),
        bodyPreview: c.mapped.content.slice(0, BODY_PREVIEW_LENGTH),
      },
      warnings,
    });
  }
  return {
    previewHash: computePreviewHash(analysis, dataDir, defaultStatus, existing),
    defaultStatus,
    rows,
    unmatched,
    duplicatesCollapsed: analysis.duplicatesCollapsed,
    blankRows: analysis.blankRows,
    errors: analysis.errors,
  };
}

/** A per-problem decision from the client. */
export type ImportAction = 'create' | 'skip' | 'overwrite' | 'merge';

export interface ImportDecision {
  readonly action: ImportAction;
  readonly status?: NoteStatus;
  /** Which of several rows matching this problem to import (a preview `key`). */
  readonly rowKey?: string;
}

/** One resolved write (or skip). */
export interface ImportOperation {
  readonly problemId: string;
  readonly action: ImportAction;
  /** Per-problem status the user picked (undefined → default / keep). */
  readonly status?: NoteStatus;
  readonly row: Candidate;
}

const ACTIONS: ReadonlySet<string> = new Set([
  'create',
  'skip',
  'overwrite',
  'merge',
]);

/** Validate the untrusted `decisions` value. */
export function parseDecisions(
  value: unknown,
): { ok: true; decisions: Map<string, ImportDecision> } | ImportRejection {
  const decisions = new Map<string, ImportDecision>();
  if (value === undefined) return { ok: true, decisions };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      status: 400,
      error: '"decisions" must be an object keyed by problem id',
    };
  }
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, status: 400, error: `invalid decision for ${id}` };
    }
    const { action, status, rowKey } = raw as Record<string, unknown>;
    if (typeof action !== 'string' || !ACTIONS.has(action)) {
      return { ok: false, status: 400, error: `invalid action for ${id}` };
    }
    if (status !== undefined && !isNoteStatus(status)) {
      return { ok: false, status: 400, error: `invalid status for ${id}` };
    }
    if (rowKey !== undefined && typeof rowKey !== 'string') {
      return { ok: false, status: 400, error: `invalid rowKey for ${id}` };
    }
    decisions.set(id, {
      action: action as ImportAction,
      ...(status !== undefined && { status: status as NoteStatus }),
      ...(rowKey !== undefined && { rowKey: rowKey as string }),
    });
  }
  return { ok: true, decisions };
}

/**
 * Resolve decisions against the (re-computed) analysis: one operation per
 * matched problem. Defaults: `create` for a new note, `skip` for a conflict.
 * Ids the preview did not produce, or actions that do not fit the note's
 * state, are rejected (400).
 */
export function planCommit(
  analysis: ImportAnalysis,
  existing: ReadonlySet<string>,
  decisions: ReadonlyMap<string, ImportDecision>,
): { ok: true; operations: ImportOperation[] } | ImportRejection {
  const choices = defaultChoices(analysis.candidates);
  const rowsById = new Map<string, Candidate[]>();
  for (const c of analysis.candidates) {
    if (!c.match) continue;
    const list = rowsById.get(c.match.problemId) ?? [];
    list.push(c);
    rowsById.set(c.match.problemId, list);
  }
  for (const id of decisions.keys()) {
    if (!rowsById.has(id)) {
      return {
        ok: false,
        status: 400,
        error: `decision for ${id}, which the preview did not match`,
      };
    }
  }
  const operations: ImportOperation[] = [];
  for (const [id, rows] of rowsById) {
    const exists = existing.has(id);
    const decision = decisions.get(id);
    const action: ImportAction =
      decision?.action ?? (exists ? 'skip' : 'create');
    if (exists && action === 'create') {
      return {
        ok: false,
        status: 400,
        error: `${id} already has a note: choose skip, overwrite or merge`,
      };
    }
    if (!exists && (action === 'overwrite' || action === 'merge')) {
      return {
        ok: false,
        status: 400,
        error: `${id} has no note to ${action}: choose create or skip`,
      };
    }
    const wantedKey = decision?.rowKey ?? choices.get(id);
    const row = rows.find((r) => r.key === wantedKey);
    if (row === undefined) {
      return {
        ok: false,
        status: 400,
        error: `rowKey for ${id} is not one of its rows`,
      };
    }
    operations.push({
      problemId: id,
      action,
      ...(decision?.status !== undefined && { status: decision.status }),
      row,
    });
  }
  return { ok: true, operations };
}

/** The later of two ISO timestamps (unparsable values lose). */
function later(a: string, b: string): string {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return tb > ta ? b : a;
}

const IMPORTED_HEADING = '## Imported ';
const IMPORTED_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `content` already holds `block` as an earlier merge left it — a
 * `## Imported <YYYY-MM-DD>` section whose text is exactly `block` (ending at
 * the next `## Imported` section or the end) — so re-importing the same CSV
 * with `merge` is idempotent. Plain index scans; no regex over the body.
 */
export function hasImportedBlock(content: string, block: string): boolean {
  for (
    let at = content.indexOf(IMPORTED_HEADING);
    at >= 0;
    at = content.indexOf(IMPORTED_HEADING, at + 1)
  ) {
    if (at > 0 && content[at - 1] !== '\n') continue;
    const dayStart = at + IMPORTED_HEADING.length;
    if (!IMPORTED_DAY.test(content.slice(dayStart, dayStart + 10))) continue;
    const bodyStart = dayStart + 10;
    if (content.slice(bodyStart, bodyStart + 2) !== '\n\n') continue;
    if (!content.startsWith(block, bodyStart + 2)) continue;
    const rest = content.slice(bodyStart + 2 + block.length);
    if (rest === '' || rest.startsWith(`\n\n${IMPORTED_HEADING}`)) return true;
  }
  return false;
}

/**
 * Build the note to write for an operation (`create` / `overwrite` /
 * `merge`). `existing` is the current note (required for merge/overwrite).
 */
export function buildImportedNote(
  op: ImportOperation,
  existing: IntuitionNote | null,
  defaultStatus: NoteStatus,
  now: Date,
): IntuitionNote {
  const row = op.row.mapped;
  const nowIso = now.toISOString();
  const importedDate = row.lastVisited ?? nowIso;
  if (op.action === 'merge' && existing !== null) {
    const status = op.status ?? resolveNoteStatus(existing);
    const day = nowIso.slice(0, 10);
    const content =
      row.content === '' ||
      existing.content === row.content ||
      hasImportedBlock(existing.content, row.content)
        ? existing.content
        : existing.content === ''
          ? `## Imported ${day}\n\n${row.content}`
          : `${existing.content}\n\n## Imported ${day}\n\n${row.content}`;
    const timeComplexity = existing.timeComplexity || row.timeComplexity;
    const spaceComplexity = existing.spaceComplexity || row.spaceComplexity;
    return {
      problemId: op.problemId,
      content,
      lastUpdated: later(existing.lastUpdated, importedDate) as IsoTimestamp,
      ...(existing.attempts !== undefined && { attempts: existing.attempts }),
      status,
      completed: status === 'done',
      ...(timeComplexity ? { timeComplexity } : {}),
      ...(spaceComplexity ? { spaceComplexity } : {}),
    };
  }
  const status = op.status ?? defaultStatus;
  return {
    problemId: op.problemId,
    content: row.content,
    lastUpdated: importedDate as IsoTimestamp,
    ...(existing?.attempts !== undefined && { attempts: existing.attempts }),
    status,
    completed: status === 'done',
    ...(row.timeComplexity !== undefined && {
      timeComplexity: row.timeComplexity,
    }),
    ...(row.spaceComplexity !== undefined && {
      spaceComplexity: row.spaceComplexity,
    }),
  };
}
