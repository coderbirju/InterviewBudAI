/**
 * Notion-export column mapping (ADR 0009 D2). Pure: turns a parsed CSV
 * (header + records) into mapped rows — title, URL, body, notes, extra text
 * sections, the `Last Visited` date and best-effort complexities.
 *
 * Headers and cells are trimmed of Unicode whitespace (incl. NBSP and BOM);
 * known headers match case-insensitively in any column order.
 */

import type { CsvRecord } from './csv.js';

/** A mapped CSV row (before catalog matching). */
export interface MappedRow {
  /** 1-based physical line the record starts on. */
  readonly line: number;
  /** Title cell (may contain a URL; may be empty). */
  readonly title: string;
  /** `URL` cell ('' when absent). */
  readonly url: string;
  /** Body column (`Intuition`, else `Property`) as-is ('' when absent). */
  readonly body: string;
  /** `Notes` cell ('' when absent). */
  readonly notes: string;
  /** Other non-empty text columns, in column order. */
  readonly sections: readonly {
    readonly header: string;
    readonly text: string;
  }[];
  /** Parsed `Last Visited` as ISO 8601, or null (→ import time). */
  readonly lastVisited: string | null;
  /** The composed note body (body + `## Notes` + `## <Header>` sections). */
  readonly content: string;
  readonly timeComplexity?: string;
  readonly spaceComplexity?: string;
  readonly warnings: readonly string[];
}

/** Result of mapping one file. */
export interface MappedFile {
  readonly rows: readonly MappedRow[];
  /** Records whose every cell was empty after trimming. */
  readonly blankRows: number;
}

/** One Unicode whitespace character, including NBSP, BOM and zero-width space. */
const SPACE_CHAR = /^[\s\uFEFF\u200B]$/;

/**
 * Trim Unicode whitespace (incl. NBSP `U+00A0` and BOM) from both ends.
 * A linear index scan — NOT `/[\s…]+$/`, which backtracks quadratically on
 * long inner whitespace runs (untrusted cells are up to 64 KiB).
 */
export function trimUnicode(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && SPACE_CHAR.test(value[start] as string)) start++;
  while (end > start && SPACE_CHAR.test(value[end - 1] as string)) end--;
  return value.slice(start, end);
}

/** Normalize a header for matching: trimmed, lowercased, inner space collapsed. */
function headerKey(header: string): string {
  return trimUnicode(header)
    .replace(/[\s\uFEFF\u200B]+/g, ' ')
    .toLowerCase();
}

/** Column roles resolved from a header row. */
interface ColumnPlan {
  readonly title: number;
  readonly url: number | null;
  readonly body: number | null;
  readonly notes: number | null;
  readonly lastVisited: number | null;
  readonly headers: readonly string[];
}

function indexOfKey(
  keys: readonly string[],
  ...wanted: string[]
): number | null {
  for (const w of wanted) {
    const i = keys.indexOf(w);
    if (i >= 0) return i;
  }
  return null;
}

/** Resolve which column plays which role (title = `Problem`, else column 0). */
export function planColumns(header: readonly string[]): ColumnPlan {
  const keys = header.map(headerKey);
  const problem = indexOfKey(keys, 'problem');
  return {
    title: problem ?? 0,
    url: indexOfKey(keys, 'url'),
    body: indexOfKey(keys, 'intuition') ?? indexOfKey(keys, 'property'),
    notes: indexOfKey(keys, 'notes'),
    lastVisited: indexOfKey(keys, 'last visited on', 'last visited'),
    headers: header.map(trimUnicode),
  };
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Build a UTC ISO string if the parts form a real calendar date/time. */
function utcIso(
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
): string | null {
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  ) {
    return null;
  }
  return date.toISOString();
}

/** Outcome of {@link parseVisitedDate}. */
export type VisitedDate =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ok'; readonly iso: string }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'invalid' };

/**
 * Parse a `Last Visited` cell. Accepts ISO 8601, Notion's `Month D, YYYY`
 * (optionally `h:mm AM/PM`), `YYYY-MM-DD` and `YYYY/MM/DD`. Dates without a
 * zone are read as UTC. Numeric `NN/NN/YYYY` is ambiguous and never guessed.
 */
export function parseVisitedDate(raw: string): VisitedDate {
  const s = trimUnicode(raw);
  if (s === '') return { kind: 'empty' };

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) {
    const iso = utcIso(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso ? { kind: 'ok', iso } : { kind: 'invalid' };
  }

  m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      s,
    );
  if (m) {
    const ms = Date.parse(m[7] === undefined ? `${s}Z` : s);
    if (Number.isNaN(ms)) return { kind: 'invalid' };
    return { kind: 'ok', iso: new Date(ms).toISOString() };
  }

  m =
    /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?$/.exec(
      s,
    );
  if (m) {
    const month = MONTHS[(m[1] as string).toLowerCase()];
    if (month === undefined) return { kind: 'invalid' };
    let hour = m[4] === undefined ? 0 : Number(m[4]);
    const minute = m[5] === undefined ? 0 : Number(m[5]);
    const meridiem = m[6]?.toLowerCase();
    if (meridiem !== undefined) {
      if (hour < 1 || hour > 12) return { kind: 'invalid' };
      if (meridiem === 'am' && hour === 12) hour = 0;
      if (meridiem === 'pm' && hour !== 12) hour += 12;
    }
    const iso = utcIso(Number(m[3]), month, Number(m[2]), hour, minute);
    return iso ? { kind: 'ok', iso } : { kind: 'invalid' };
  }

  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(s)) return { kind: 'ambiguous' };
  return { kind: 'invalid' };
}

/** Max length of an extracted complexity expression. */
export const MAX_COMPLEXITY_LENGTH = 100;

// Linear form: `\s*(?:[:=-]\s*)?` has one way to consume a whitespace run
// (`\s*[:=-]?\s*` has n and backtracked quadratically — ReDoS on
// `"Time" + 1 MiB of spaces`).
const COMPLEXITY_LABEL =
  /\b(TC|SC|Time(?:\s+complexity)?|Space(?:\s+complexity)?)\s*(?:[:=-]\s*)?O\(/gi;

/**
 * Best-effort complexity tokenizer over the whole text (not line-anchored):
 * `(TC|Time|SC|Space)\s*[:=\-]?\s*O(...)` with the `O(` expression read to
 * its balanced `)`. First match per kind wins; > 100 chars, unbalanced, or a
 * newline inside `O(...)` → ignored. The expression is kept verbatim
 * (quotes and backslashes included; storage escapes them).
 */
export function extractComplexities(text: string): {
  timeComplexity?: string;
  spaceComplexity?: string;
} {
  let time: string | undefined;
  let space: string | undefined;
  COMPLEXITY_LABEL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMPLEXITY_LABEL.exec(text)) !== null) {
    const openParen = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = openParen; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      } else if (ch === '\n' || ch === '\r') {
        break;
      }
      if (i - openParen + 2 > MAX_COMPLEXITY_LENGTH) break;
    }
    if (end < 0) continue;
    const expr = text.slice(openParen - 1, end + 1);
    if (expr.length > MAX_COMPLEXITY_LENGTH) continue;
    const label = (m[1] as string).toLowerCase();
    const isTime = label === 'tc' || label.startsWith('time');
    if (isTime && time === undefined) time = expr;
    if (!isTime && space === undefined) space = expr;
    if (time !== undefined && space !== undefined) break;
  }
  return {
    ...(time !== undefined && { timeComplexity: time }),
    ...(space !== undefined && { spaceComplexity: space }),
  };
}

/** Compose the note body: body, then `## Notes`, then `## <Header>` sections. */
function composeContent(
  body: string,
  notes: string,
  sections: readonly { header: string; text: string }[],
): string {
  const parts: string[] = [];
  if (body !== '') parts.push(body);
  if (notes !== '') parts.push(`## Notes\n\n${notes}`);
  for (const s of sections) parts.push(`## ${s.header}\n\n${s.text}`);
  return parts.join('\n\n');
}

/** Map parsed records of one file to rows (blank records skipped + counted). */
export function mapNotionRecords(
  header: readonly string[],
  records: readonly CsvRecord[],
): MappedFile {
  const plan = planColumns(header);
  const known = new Set<number>(
    [plan.title, plan.url, plan.body, plan.notes, plan.lastVisited].filter(
      (i): i is number => i !== null,
    ),
  );
  const rows: MappedRow[] = [];
  let blankRows = 0;
  for (const record of records) {
    const cells = record.cells.map(trimUnicode);
    if (cells.every((c) => c === '')) {
      blankRows++;
      continue;
    }
    const at = (i: number | null): string => (i === null ? '' : cells[i] ?? '');
    const warnings: string[] = [];
    const sections: { header: string; text: string }[] = [];
    cells.forEach((text, i) => {
      if (known.has(i) || text === '') return;
      sections.push({ header: plan.headers[i] || `Column ${i + 1}`, text });
    });
    const body = at(plan.body);
    const notes = at(plan.notes);
    const visited = parseVisitedDate(at(plan.lastVisited));
    let lastVisited: string | null = null;
    if (visited.kind === 'ok') lastVisited = visited.iso;
    else if (visited.kind === 'ambiguous')
      warnings.push(
        `ambiguous date "${at(plan.lastVisited)}" (day/month order unknown) — the import time is used`,
      );
    else if (visited.kind === 'invalid')
      warnings.push(
        `unrecognised date "${at(plan.lastVisited)}" — the import time is used`,
      );
    const content = composeContent(body, notes, sections);
    const complexities = extractComplexities(
      [body, notes].filter((t) => t !== '').join('\n'),
    );
    rows.push({
      line: record.line,
      title: at(plan.title),
      url: at(plan.url),
      body,
      notes,
      sections,
      lastVisited,
      content,
      ...complexities,
      warnings,
    });
  }
  return { rows, blankRows };
}
