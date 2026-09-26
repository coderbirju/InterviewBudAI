/**
 * `POST /api/import/csv/preview` and `POST /api/import/csv/commit`
 * (ADR 0009 D2/D3). The Host / Origin / JSON content-type prechecks and the
 * 1 MiB body cap already ran in the handler, as for every mutating `/api`
 * route.
 *
 * Stateless: commit re-parses and re-matches the same files and compares a
 * recomputed `previewHash` (409 on mismatch — nothing written). Problem ids
 * come only from server-side catalog matching; the client picks an action and
 * a status per id the preview produced. Before any write the data dir is
 * snapshotted (D3); if that fails nothing is written. Writes go only through
 * the storage adapter's `writeIntuitionNote`.
 */

import type { NoteStatus, StorageAdapter } from '@ibai/storage';
import { isNoteStatus } from '@ibai/storage';
import type { CurriculumSource } from '@ibai/curriculum';
import type { HandlerResponse } from '../handler.js';
import { createBackup } from './backup.js';
import { createCatalogMatcher } from './match.js';
import {
  analyzeImport,
  buildImportedNote,
  buildPreview,
  computePreviewHash,
  matchedProblemIds,
  parseDecisions,
  parseImportFiles,
  planCommit,
} from './plan.js';
import type { ImportAnalysis, ImportPreview } from './plan.js';

export const IMPORT_PREVIEW_PATH = '/api/import/csv/preview';
export const IMPORT_COMMIT_PATH = '/api/import/csv/commit';

/** What the import routes need from the API layer. */
export interface ImportRouteDeps {
  readonly catalog: CurriculumSource;
  /** Active data dir (server state). */
  readonly dataDir: string;
  /** Storage for `dataDir`, or null when the folder does not exist. */
  readonly storage: StorageAdapter | null;
  readonly now?: () => Date;
  /** Snapshot hook (defaults to {@link createBackup}); injectable for tests. */
  readonly backup?: (dataDir: string, now: Date) => Promise<string>;
}

/** `POST /api/import/csv/commit` response. */
export interface ImportCommitResult {
  readonly created: number;
  readonly overwritten: number;
  readonly merged: number;
  readonly skipped: number;
  readonly unmatched: number;
  readonly failed: readonly {
    readonly problemId: string;
    readonly error: string;
  }[];
  /** Absolute path of the pre-import snapshot. */
  readonly backup: string;
}

function json(status: number, payload: unknown): HandlerResponse {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  };
}

type Parsed =
  | {
      readonly ok: true;
      readonly body: Record<string, unknown>;
      readonly analysis: ImportAnalysis;
      readonly defaultStatus: NoteStatus;
    }
  | { readonly ok: false; readonly response: HandlerResponse };

/** Parse the shared `{ files, defaultStatus? }` part and analyze the files. */
function parseAndAnalyze(
  raw: string | undefined,
  catalog: CurriculumSource,
): Parsed {
  let body: unknown;
  try {
    body = JSON.parse(raw ?? '');
  } catch {
    return { ok: false, response: json(400, { error: 'invalid JSON body' }) };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, response: json(400, { error: 'invalid JSON body' }) };
  }
  const input = body as Record<string, unknown>;
  const { defaultStatus = 'done' } = input;
  if (!isNoteStatus(defaultStatus)) {
    return {
      ok: false,
      response: json(400, { error: 'invalid defaultStatus' }),
    };
  }
  const files = parseImportFiles(input.files);
  if (!files.ok) {
    return { ok: false, response: json(files.status, { error: files.error }) };
  }
  const analyzed = analyzeImport(
    files.files,
    createCatalogMatcher(catalog.list()),
  );
  if (!analyzed.ok) {
    return {
      ok: false,
      response: json(analyzed.status, { error: analyzed.error }),
    };
  }
  return {
    ok: true,
    body: input,
    analysis: analyzed.analysis,
    defaultStatus,
  };
}

/** Which matched problems already have a note (read through the adapter). */
async function existingNotes(
  ids: readonly string[],
  storage: StorageAdapter | null,
): Promise<Set<string>> {
  const existing = new Set<string>();
  if (!storage?.readIntuitionNote) return existing;
  for (const id of ids) {
    if ((await storage.readIntuitionNote(id)) !== null) existing.add(id);
  }
  return existing;
}

/** Handle an `/api/import/csv/*` request (null → not an import route). */
export async function handleImportRoute(
  method: string,
  pathname: string,
  deps: ImportRouteDeps,
  rawBody: string | undefined,
): Promise<HandlerResponse | null> {
  if (pathname !== IMPORT_PREVIEW_PATH && pathname !== IMPORT_COMMIT_PATH) {
    return null;
  }
  if (method !== 'POST') {
    return json(405, { error: 'method not allowed' });
  }
  const parsed = parseAndAnalyze(rawBody, deps.catalog);
  if (!parsed.ok) return parsed.response;
  const { analysis, defaultStatus, body } = parsed;
  const existing = await existingNotes(
    matchedProblemIds(analysis),
    deps.storage,
  );

  if (pathname === IMPORT_PREVIEW_PATH) {
    const preview: ImportPreview = buildPreview(
      analysis,
      deps.dataDir,
      defaultStatus,
      existing,
    );
    return json(200, preview);
  }

  // ----- commit -----
  const storage = deps.storage;
  if (!storage?.writeIntuitionNote || !storage.readIntuitionNote) {
    return json(400, {
      error:
        'the data folder does not exist yet: choose or create it on this page first',
    });
  }
  if (typeof body.previewHash !== 'string') {
    return json(400, { error: 'missing previewHash: run the preview first' });
  }
  const hash = computePreviewHash(
    analysis,
    deps.dataDir,
    defaultStatus,
    existing,
  );
  if (hash !== body.previewHash) {
    return json(409, {
      error:
        'your notes or the data folder changed since the preview: re-run preview',
    });
  }
  const decisions = parseDecisions(body.decisions);
  if (!decisions.ok) {
    return json(decisions.status, { error: decisions.error });
  }
  const plan = planCommit(analysis, existing, decisions.decisions);
  if (!plan.ok) return json(plan.status, { error: plan.error });

  const now = (deps.now ?? (() => new Date()))();
  let backup: string;
  try {
    backup = await (deps.backup ?? createBackup)(deps.dataDir, now);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return json(500, {
      error: `could not back up the data folder, so nothing was imported: ${reason}`,
    });
  }

  let created = 0;
  let overwritten = 0;
  let merged = 0;
  let skipped = 0;
  const failed: { problemId: string; error: string }[] = [];
  for (const op of plan.operations) {
    if (op.action === 'skip') {
      skipped++;
      continue;
    }
    try {
      const current =
        op.action === 'create'
          ? null
          : await storage.readIntuitionNote(op.problemId);
      await storage.writeIntuitionNote(
        buildImportedNote(op, current, defaultStatus, now),
      );
      if (op.action === 'create') created++;
      else if (op.action === 'overwrite') overwritten++;
      else merged++;
    } catch (err) {
      failed.push({
        problemId: op.problemId,
        error: err instanceof Error ? err.message : 'write failed',
      });
    }
  }
  const result: ImportCommitResult = {
    created,
    overwritten,
    merged,
    skipped,
    unmatched: analysis.candidates.filter((c) => c.match === null).length,
    failed,
    backup,
  };
  return json(200, result);
}
