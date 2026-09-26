/**
 * A small, pure RFC 4180 CSV parser (ADR 0009 D2 — no new dependency).
 *
 * Supported subset: comma delimiter, `"` quoting, `""` escapes, quoted
 * multiline cells, CRLF / LF / lone-CR line endings (all normalized to LF),
 * and an optional UTF-8 BOM. NUL and other C0 controls except `\t` and `\n`
 * are stripped. The input is untrusted: nothing is evaluated.
 *
 * File-level errors (the whole file is rejected, nothing from it is imported):
 * an unterminated quoted cell, or a record with more cells than the header.
 * Records with fewer cells are padded with empty strings. A trailing empty
 * line is not a record.
 */

/** One parsed record, with the 1-based physical line it starts on. */
export interface CsvRecord {
  readonly line: number;
  readonly cells: readonly string[];
}

/** Result of {@link parseCsv}. */
export type CsvParseResult =
  | {
      readonly ok: true;
      readonly header: readonly string[];
      readonly records: readonly CsvRecord[];
    }
  | { readonly ok: false; readonly error: string };

/**
 * Normalize untrusted text before parsing: strip a leading BOM, turn CRLF and
 * lone CR into LF, and drop C0 controls other than `\t` / `\n` (and DEL).
 */
export function normalizeCsvText(text: string): string {
  const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
  return (
    withoutBom
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  );
}

/**
 * Parse CSV text into a header row and data records. Pure; never throws.
 */
export function parseCsv(text: string): CsvParseResult {
  const src = normalizeCsvText(text);
  const rows: { line: number; cells: string[] }[] = [];

  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let quoteStartLine = 1;
  // True once the current record has any content (so an empty final line
  // is not reported as a record).
  let recordStarted = false;

  const endRecord = (): void => {
    cells.push(cell);
    rows.push({ line: recordLine, cells });
    cells = [];
    cell = '';
    recordStarted = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.length === 0) {
      // A quote opens a quoted cell only at the start of a field; elsewhere
      // it is literal (lenient on sloppy exports).
      inQuotes = true;
      quoteStartLine = line;
      recordStarted = true;
      continue;
    }
    if (ch === ',') {
      cells.push(cell);
      cell = '';
      recordStarted = true;
      continue;
    }
    if (ch === '\n') {
      if (recordStarted || cell.length > 0) {
        endRecord();
      } else {
        // An empty physical line: an empty record (skipped later as blank).
        rows.push({ line: recordLine, cells: [''] });
      }
      line++;
      recordLine = line;
      continue;
    }
    cell += ch;
    recordStarted = true;
  }

  if (inQuotes) {
    return {
      ok: false,
      error: `unterminated quoted cell starting on line ${quoteStartLine}`,
    };
  }
  if (recordStarted || cell.length > 0) {
    endRecord();
  }

  const [headerRow, ...dataRows] = rows;
  if (headerRow === undefined) {
    return { ok: false, error: 'the file is empty (no header row)' };
  }
  const width = headerRow.cells.length;
  const records: CsvRecord[] = [];
  for (const row of dataRows) {
    if (row.cells.length > width) {
      return {
        ok: false,
        error: `line ${row.line} has ${row.cells.length} cells but the header has ${width}`,
      };
    }
    const padded = row.cells.slice();
    while (padded.length < width) padded.push('');
    records.push({ line: row.line, cells: padded });
  }
  return { ok: true, header: headerRow.cells, records };
}
