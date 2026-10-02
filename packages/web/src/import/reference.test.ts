import { describe, it, expect } from 'vitest';
import { createCatalogSource } from '@ibai/curriculum';
import { parseCsv } from './csv.js';
import { mapNotionRecords } from './notion.js';
import { createCatalogMatcher } from './match.js';
import {
  analyzeImport,
  buildImportedNote,
  buildPreview,
  computePreviewHash,
  mergeChangesNothing,
  mergeReference,
  planCommit,
} from './plan.js';
import type { ImportAnalysis, ImportFile } from './plan.js';

/*
 * ADR 0013 D4 — the CSV `reference` column role. Every CSV row below is
 * SYNTHETIC test data (charter §6.1).
 */

const MATCHER = createCatalogMatcher(createCatalogSource().list());
const MARKER = '<!-- ibai:reference-approach -->';
const URL3 =
  'https://leetcode.com/problems/longest-substring-without-repeating-characters/';

function mapCsv(text: string): ReturnType<typeof mapNotionRecords> {
  const parsed = parseCsv(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return mapNotionRecords(parsed.header, parsed.records);
}
function analyze(files: ImportFile[]): ImportAnalysis {
  const res = analyzeImport(files, MATCHER);
  if (!res.ok) throw new Error(res.error);
  return res.analysis;
}
const csvWith = (header: string, cell: string): string =>
  `Problem,Intuition,URL,${header}\n` +
  `Longest Substring Without Repeating Characters,Window idea,${URL3},"${cell}"\n`;

describe('CSV Reference approach column (ADR 0013 D4)', () => {
  it('maps only Reference approach / Solution approach / Reference (case/space-insensitive)', () => {
    for (const header of [
      'Reference approach',
      '  SOLUTION   approach ',
      'reference',
    ]) {
      const row = mapCsv(csvWith(header, 'my own write-up')).rows[0]!;
      expect(row.referenceApproach).toBe('my own write-up');
      expect(row.referenceColumn).toBe(header.trim());
      expect(row.content).toBe('Window idea');
    }
    for (const header of ['Solution', 'Approach', 'References']) {
      const row = mapCsv(csvWith(header, 'code here')).rows[0]!;
      expect(row.referenceApproach).toBeUndefined();
      expect(row.referenceColumn).toBeUndefined();
      expect(row.content).toBe(`Window idea\n\n## ${header}\n\ncode here`);
    }
  });

  it('first match wins by priority; the other stays a body section', () => {
    const row = mapCsv('Problem,Reference,Reference approach\nX,second,first\n')
      .rows[0]!;
    expect(row.referenceApproach).toBe('first');
    expect(row.referenceColumn).toBe('Reference approach');
    expect(row.content).toBe('## Reference\n\nsecond');
  });

  it('a URL-only cell is not mapped: it stays a section, with a warning', () => {
    const row = mapCsv(
      csvWith('Reference approach', '  https://example.com/sol  '),
    ).rows[0]!;
    expect(row.referenceApproach).toBeUndefined();
    expect(row.content).toBe(
      'Window idea\n\n## Reference approach\n\nhttps://example.com/sol',
    );
    expect(row.warnings.join(' ')).toMatch(/only a link/);
    // A URL with words around it is a real reference.
    expect(
      mapCsv(csvWith('Reference', 'see https://x.y and two passes')).rows[0]!
        .referenceApproach,
    ).toBe('see https://x.y and two passes');
  });

  it('marker lines are stripped from the reference and the body, with warnings', () => {
    const row = mapCsv(
      `Problem,Intuition,Reference\nX,"a\n${MARKER}\nb","r\n${MARKER}"\n`,
    ).rows[0]!;
    expect(row.content).toBe('a\nb');
    expect(row.referenceApproach).toBe('r');
    expect(row.warnings).toHaveLength(2);
  });

  it('preview shows the first 200 chars and the mapped column; the hash covers it', () => {
    const analysis = analyze([
      { name: 'a.csv', text: csvWith('Solution approach', 'r'.repeat(300)) },
    ]);
    const preview = buildPreview(analysis, '/d', 'done', new Set());
    expect(preview.rows[0]!.fields.referenceApproach).toBe('r'.repeat(200));
    expect(preview.rows[0]!.fields.referenceColumn).toBe('Solution approach');
    const other = analyze([
      { name: 'a.csv', text: csvWith('Solution approach', 'other') },
    ]);
    expect(computePreviewHash(other, '/d', 'done', new Set())).not.toBe(
      preview.previewHash,
    );
  });
});

describe('CSV Reference approach commit semantics (ADR 0013 D4)', () => {
  const NOW = new Date('2026-10-01T00:00:00.000Z');
  const opFor = (text: string, action: 'create' | 'overwrite' | 'merge') => {
    const plan = planCommit(
      analyze([{ name: 'a.csv', text }]),
      action === 'create' ? new Set() : new Set(['lc-3']),
      new Map([['lc-3', { action }]]),
    );
    if (!plan.ok) throw new Error(plan.error);
    return plan.operations[0]!;
  };
  const withRef = csvWith('Reference approach', 'row ref');
  const noRef = `Problem,Intuition,URL\nLongest Substring Without Repeating Characters,Window idea,${URL3}\n`;
  const existing = (referenceApproach?: string) => ({
    problemId: 'lc-3',
    content: 'Mine',
    lastUpdated: '2025-01-01T00:00:00.000Z',
    status: 'to_revisit' as const,
    ...(referenceApproach !== undefined && { referenceApproach }),
  });

  it('create takes the row reference', () => {
    expect(
      buildImportedNote(opFor(withRef, 'create'), null, 'done', NOW)
        .referenceApproach,
    ).toBe('row ref');
  });

  it('overwrite takes the row reference, and CLEARS it when the row has none', () => {
    expect(
      buildImportedNote(
        opFor(withRef, 'overwrite'),
        existing('old'),
        'done',
        NOW,
      ).referenceApproach,
    ).toBe('row ref');
    const cleared = buildImportedNote(
      opFor(noRef, 'overwrite'),
      existing('old'),
      'done',
      NOW,
    );
    expect(cleared.referenceApproach).toBeUndefined();
  });

  it('merge keeps, takes, or appends — never loses either side', () => {
    const merge = (row: string, ex?: string) =>
      buildImportedNote(opFor(row, 'merge'), existing(ex), 'done', NOW)
        .referenceApproach;
    expect(merge(noRef, 'old')).toBe('old');
    expect(merge(withRef)).toBe('row ref');
    expect(merge(withRef, 'row ref')).toBe('row ref');
    expect(merge(withRef, 'see: row ref, then more')).toBe(
      'see: row ref, then more',
    );
    expect(merge(withRef, 'old')).toBe('old\n\nrow ref');
    expect(mergeReference(undefined, undefined)).toBeUndefined();
  });

  it('mergeChangesNothing compares the reference (a re-merge stays idempotent)', () => {
    const op = opFor(withRef, 'merge');
    const once = buildImportedNote(op, existing(), 'done', NOW);
    const twice = buildImportedNote(op, once, 'done', NOW);
    expect(mergeChangesNothing(once, twice)).toBe(true);
    expect(
      mergeChangesNothing(once, { ...once, referenceApproach: 'new' }),
    ).toBe(false);
    expect(
      mergeChangesNothing(
        { ...once, referenceApproach: undefined },
        { ...once, referenceApproach: '' },
      ),
    ).toBe(true);
  });
});
