import { describe, it, expect } from 'vitest';
import { createCatalogSource } from '@ibai/curriculum';
import { parseCsv } from './csv.js';
import {
  extractComplexities,
  mapNotionRecords,
  parseVisitedDate,
  trimUnicode,
} from './notion.js';
import { createCatalogMatcher, leetcodeSlug, normalizeTitle } from './match.js';
import {
  analyzeImport,
  buildImportedNote,
  buildPreview,
  computePreviewHash,
  hasImportedBlock,
  IMPORT_LIMITS,
  parseDecisions,
  parseImportFiles,
  planCommit,
} from './plan.js';
import type { ImportAnalysis, ImportFile } from './plan.js';

/*
 * Every CSV row below is SYNTHETIC test data written for these tests — never a
 * copy of anyone's real notes (charter §6.1).
 */

const CATALOG = createCatalogSource();
const MATCHER = createCatalogMatcher(CATALOG.list());

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

describe('parseCsv (RFC 4180 subset)', () => {
  it('parses a header and records with line numbers', () => {
    const res = parseCsv('a,b\n1,2\n3,4\n');
    expect(res).toEqual({
      ok: true,
      header: ['a', 'b'],
      records: [
        { line: 2, cells: ['1', '2'] },
        { line: 3, cells: ['3', '4'] },
      ],
    });
  });

  it('strips a UTF-8 BOM and handles CRLF', () => {
    const res = parseCsv('\uFEFFa,b\r\n1,2\r\n');
    expect(res.ok && res.header).toEqual(['a', 'b']);
    expect(res.ok && res.records).toEqual([{ line: 2, cells: ['1', '2'] }]);
  });

  it('keeps quoted multiline cells (CRLF → LF) and escaped quotes', () => {
    const res = parseCsv('a,b\r\n"line 1\r\nline ""2""",x\r\nnext,y');
    expect(res.ok && res.records).toEqual([
      { line: 2, cells: ['line 1\nline "2"', 'x'] },
      { line: 4, cells: ['next', 'y'] },
    ]);
  });

  it('quoted commas stay in the cell; empty cells survive', () => {
    const res = parseCsv('a,b,c\n"x, y",,"z"');
    expect(res.ok && res.records[0]?.cells).toEqual(['x, y', '', 'z']);
  });

  it('pads short rows; rejects rows wider than the header', () => {
    const short = parseCsv('a,b,c\n1');
    expect(short.ok && short.records[0]?.cells).toEqual(['1', '', '']);
    const wide = parseCsv('a,b\n1,2,3');
    expect(wide.ok).toBe(false);
    expect(!wide.ok && wide.error).toMatch(/line 2 has 3 cells/);
  });

  it('rejects an unterminated quote', () => {
    const res = parseCsv('a,b\n"open,1\n2,3');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/unterminated quoted cell .* line 2/);
  });

  it('strips NUL and C0 controls but keeps tabs', () => {
    const res = parseCsv('a\n"x\u0000y\u0007\tz"');
    expect(res.ok && res.records[0]?.cells).toEqual(['xy\tz']);
  });

  it('an empty file is an error', () => {
    expect(parseCsv('').ok).toBe(false);
  });
});

describe('Notion mapping', () => {
  it('Problem/Intuition shape (either column order) maps the same fields', () => {
    const a = mapCsv(
      'Problem,Intuition,Last Visited on,Notes,URL\n' +
        'Longest Substring Without Repeating Characters,Use a hash map. TC: O(n),"March 5, 2024",Watch duplicates,https://leetcode.com/problems/longest-substring-without-repeating-characters/\n',
    );
    const b = mapCsv(
      'Problem,Intuition,Notes,Last Visited on,URL\n' +
        'Longest Substring Without Repeating Characters,Use a hash map. TC: O(n),Watch duplicates,"March 5, 2024",https://leetcode.com/problems/longest-substring-without-repeating-characters/\n',
    );
    const rowA = a.rows[0];
    expect(rowA).toMatchObject({
      title: 'Longest Substring Without Repeating Characters',
      body: 'Use a hash map. TC: O(n)',
      notes: 'Watch duplicates',
      url: 'https://leetcode.com/problems/longest-substring-without-repeating-characters/',
      lastVisited: '2024-03-05T00:00:00.000Z',
      timeComplexity: 'O(n)',
      content: 'Use a hash map. TC: O(n)\n\n## Notes\n\nWatch duplicates',
    });
    expect(b.rows[0]).toEqual(rowA);
  });

  it('first-column-titled shape: title = column 0, body = Property, "  Last Visited" trimmed', () => {
    const res = mapCsv(
      '\uFEFFArrays - 1D,Property,Notes,"  Last Visited",URL\n' +
        '3. Longest Substring Without Repeating Characters,Synthetic property text,A synthetic note,2024-01-02,\n',
    );
    expect(res.rows[0]).toMatchObject({
      title: '3. Longest Substring Without Repeating Characters',
      body: 'Synthetic property text',
      notes: 'A synthetic note',
      lastVisited: '2024-01-02T00:00:00.000Z',
      url: '',
    });
  });

  it('headers match case-insensitively; other text columns become ## sections in order', () => {
    const res = mapCsv(
      'problem,Tags,INTUITION,Extra Thoughts\n' +
        'Longest Substring Without Repeating Characters,array,body text,more\n',
    );
    expect(res.rows[0]?.content).toBe(
      'body text\n\n## Tags\n\narray\n\n## Extra Thoughts\n\nmore',
    );
  });

  it('Reference / Solution approach columns are ordinary ## sections (ADR 0014 D1)', () => {
    const res = mapCsv(
      'Problem,Intuition,Reference approach,Solution approach,Reference\n' +
        'X,intu,ref one,sol two,ref three\n',
    );
    const row = res.rows[0]!;
    expect(row.content).toBe(
      'intu\n\n## Reference approach\n\nref one\n\n## Solution approach\n\nsol two\n\n## Reference\n\nref three',
    );
    expect(row).not.toHaveProperty('referenceApproach');
    expect(row).not.toHaveProperty('referenceColumn');
  });

  it('Intuition wins over Property (Property becomes a section)', () => {
    const res = mapCsv('Problem,Property,Intuition\nX,prop,intu\n');
    expect(res.rows[0]?.body).toBe('intu');
    expect(res.rows[0]?.content).toBe('intu\n\n## Property\n\nprop');
  });

  it('trims NBSP / Unicode whitespace from headers and cells', () => {
    const res = mapCsv(
      '\u00A0Problem\u00A0,URL\n\u00A0 Longest Substring Without Repeating Characters\u00A0,\n',
    );
    expect(res.rows[0]?.title).toBe(
      'Longest Substring Without Repeating Characters',
    );
    expect(trimUnicode('\uFEFF\u00A0 x \u200B')).toBe('x');
  });

  it('skips and counts blank rows (all cells empty after trim)', () => {
    const res = mapCsv(
      'Problem,Notes\n,\n\u00A0, \nLongest Substring Without Repeating Characters,x\n\n',
    );
    expect(res.rows).toHaveLength(1);
    expect(res.blankRows).toBe(3);
  });
});

describe('parseVisitedDate', () => {
  it.each([
    ['2024-03-05', '2024-03-05T00:00:00.000Z'],
    ['2024/3/5', '2024-03-05T00:00:00.000Z'],
    ['March 5, 2024', '2024-03-05T00:00:00.000Z'],
    ['Sep 9, 2023 10:15 PM', '2023-09-09T22:15:00.000Z'],
    ['January 1, 2024 12:05 AM', '2024-01-01T00:05:00.000Z'],
    ['2024-03-05T10:00:00Z', '2024-03-05T10:00:00.000Z'],
    ['2024-03-05T10:00:00+02:00', '2024-03-05T08:00:00.000Z'],
  ])('%s → %s', (raw, iso) => {
    expect(parseVisitedDate(raw)).toEqual({ kind: 'ok', iso });
  });

  it('does not guess NN/NN/YYYY; rejects junk and impossible dates', () => {
    expect(parseVisitedDate('03/04/2024').kind).toBe('ambiguous');
    expect(parseVisitedDate('yesterday').kind).toBe('invalid');
    expect(parseVisitedDate('2024-02-30').kind).toBe('invalid');
    expect(parseVisitedDate('  ').kind).toBe('empty');
  });

  it('an ambiguous date warns and falls back to import time (null)', () => {
    const res = mapCsv(
      'Problem,Last Visited\nLongest Substring Without Repeating Characters,03/04/2024\n',
    );
    expect(res.rows[0]?.lastVisited).toBeNull();
    expect(res.rows[0]?.warnings[0]).toMatch(/ambiguous date/);
  });
});

describe('extractComplexities', () => {
  it.each([
    ['TC: O(n), Space: O(1)', 'O(n)', 'O(1)'],
    ['TC O(n)', 'O(n)', undefined],
    ['Space - O(n log n)', undefined, 'O(n log n)'],
    ['Time: O(n log(n)) and SC = O(k)', 'O(n log(n))', 'O(k)'],
    ['time complexity: O(2^n) space complexity O(n)', 'O(2^n)', 'O(n)'],
    ['mid-text: we get TC:O(n*m) overall', 'O(n*m)', undefined],
  ])('%s', (text, time, space) => {
    const res = extractComplexities(text);
    expect(res.timeComplexity).toBe(time);
    expect(res.spaceComplexity).toBe(space);
  });

  it('first match per kind wins; unbalanced and over-long are ignored', () => {
    expect(extractComplexities('TC: O(n) later TC: O(1)').timeComplexity).toBe(
      'O(n)',
    );
    expect(
      extractComplexities('TC: O(n log(n)').timeComplexity,
    ).toBeUndefined();
    expect(
      extractComplexities(`TC: O(${'n'.repeat(120)})`).timeComplexity,
    ).toBeUndefined();
    expect(extractComplexities('Namespace: O(1) ATC: O(1)')).toEqual({});
  });
});

describe('catalog matching', () => {
  it('extracts slugs ignoring /description/, /editorial/, /solutions/…, query, hash', () => {
    expect(
      leetcodeSlug(
        'https://leetcode.com/problems/longest-substring-without-repeating-characters/editorial/',
      ),
    ).toBe('longest-substring-without-repeating-characters');
    expect(
      leetcodeSlug(
        'https://www.leetcode.com/problems/Longest-Substring-Without-Repeating-Characters/description/?x=1#y',
      ),
    ).toBe('longest-substring-without-repeating-characters');
    expect(
      leetcodeSlug(
        'leetcode.com/problems/longest-substring-without-repeating-characters/solutions/123/abc',
      ),
    ).toBe('longest-substring-without-repeating-characters');
    expect(
      leetcodeSlug(
        'https://evil.example/problems/longest-substring-without-repeating-characters/',
      ),
    ).toBeNull();
    expect(leetcodeSlug('javascript:alert(1)')).toBeNull();
  });

  it('matches by URL cell, then a URL in the title, then NNN., then title', () => {
    expect(
      MATCHER.match(
        'whatever',
        'https://leetcode.com/problems/longest-substring-without-repeating-characters/editorial/',
      ),
    ).toEqual({
      problemId: 'lc-3',
      title: 'Longest Substring Without Repeating Characters',
      by: 'url',
    });
    expect(
      MATCHER.match(
        'see https://leetcode.com/problems/longest-substring-without-repeating-characters/description/',
        '',
      ),
    ).toMatchObject({ problemId: 'lc-3', by: 'url' });
    expect(MATCHER.match('3. Something else', '')).toMatchObject({
      problemId: 'lc-3',
      by: 'number',
    });
    expect(
      MATCHER.match('longest substring, without repeating characters!', ''),
    ).toMatchObject({
      problemId: 'lc-3',
      by: 'title',
    });
    expect(MATCHER.match('Not A Real Problem Title', '')).toBeNull();
  });

  it('a blank title still tries the URL cell', () => {
    expect(
      MATCHER.match(
        '',
        'https://leetcode.com/problems/longest-substring-without-repeating-characters/',
      ),
    ).toMatchObject({ problemId: 'lc-3', by: 'url' });
    expect(MATCHER.match('', '')).toBeNull();
  });

  it('normalizeTitle strips NNN., punctuation, case and extra spaces', () => {
    expect(normalizeTitle('  15.  3Sum — (Medium)! ')).toBe('3sum medium');
  });
});

const SYN_A =
  'Problem,Intuition,Last Visited on,Notes,URL\n' +
  'Longest Substring Without Repeating Characters,Hash complements. TC: O(n) SC: O(n),"March 5, 2024",Edge: same index,https://leetcode.com/problems/longest-substring-without-repeating-characters/\n' +
  ',,,,\n' +
  'My Custom Puzzle,Something,,,\n';
// Same rows, columns swapped (Notion's X_all.csv).
const SYN_A_ALL =
  'Problem,Intuition,Notes,Last Visited on,URL\n' +
  'Longest Substring Without Repeating Characters,Hash complements. TC: O(n) SC: O(n),Edge: same index,"March 5, 2024",https://leetcode.com/problems/longest-substring-without-repeating-characters/\n' +
  'My Custom Puzzle,Something,,,\n';

describe('analyzeImport + preview', () => {
  it('de-dupes an _all.csv pair with swapped columns; reports blank + unmatched', () => {
    const analysis = analyze([
      { name: 'Arrays.csv', text: SYN_A },
      { name: 'Arrays_all.csv', text: SYN_A_ALL },
    ]);
    expect(analysis.duplicatesCollapsed).toBe(2);
    expect(analysis.blankRows).toBe(1);
    const preview = buildPreview(analysis, '/d', 'done', new Set());
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({
      key: '0:2',
      file: 'Arrays.csv',
      line: 2,
      match: { problemId: 'lc-3', by: 'url' },
      existing: 'none',
      chosen: true,
      fields: {
        status: 'done',
        lastUpdated: '2024-03-05T00:00:00.000Z',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(n)',
      },
    });
    expect(preview.unmatched).toEqual([
      {
        key: '0:4',
        file: 'Arrays.csv',
        line: 4,
        title: 'My Custom Puzzle',
        url: '',
      },
    ]);
    expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinct rows for one problem: most recent is chosen and both are flagged', () => {
    const analysis = analyze([
      {
        name: 'x.csv',
        text:
          'Problem,Intuition,Last Visited\n' +
          'Longest Substring Without Repeating Characters,older idea,2023-01-01\n' +
          'Longest Substring Without Repeating Characters,newer idea,2024-01-01\n',
      },
    ]);
    const preview = buildPreview(analysis, '/d', 'done', new Set());
    expect(preview.rows.map((r) => r.chosen)).toEqual([false, true]);
    expect(preview.rows[0]?.warnings[0]).toMatch(
      /2 different rows match Longest Substring Without Repeating Characters/,
    );
    const plan = planCommit(analysis, new Set(), new Map());
    expect(plan.ok && plan.operations[0]?.row.mapped.body).toBe('newer idea');
    const picked = planCommit(
      analysis,
      new Set(),
      new Map([['lc-3', { action: 'create', rowKey: '0:2' }]]),
    );
    expect(picked.ok && picked.operations[0]?.row.mapped.body).toBe(
      'older idea',
    );
  });

  it('the hash covers dataDir, defaultStatus, file text and the note-exists flag', () => {
    const analysis = analyze([{ name: 'a.csv', text: SYN_A }]);
    const base = computePreviewHash(analysis, '/d', 'done', new Set());
    expect(computePreviewHash(analysis, '/d', 'done', new Set())).toBe(base);
    expect(computePreviewHash(analysis, '/e', 'done', new Set())).not.toBe(
      base,
    );
    expect(
      computePreviewHash(analysis, '/d', 'to_revisit', new Set()),
    ).not.toBe(base);
    expect(
      computePreviewHash(analysis, '/d', 'done', new Set(['lc-3'])),
    ).not.toBe(base);
    const edited = analyze([
      { name: 'a.csv', text: SYN_A.replace('Edge', 'edge') },
    ]);
    expect(computePreviewHash(edited, '/d', 'done', new Set())).not.toBe(base);
  });

  it('a file with a parse error is reported and contributes nothing', () => {
    const analysis = analyze([
      { name: 'bad.csv', text: 'Problem\n"unterminated' },
      {
        name: 'ok.csv',
        text: 'Problem\nLongest Substring Without Repeating Characters\n',
      },
    ]);
    expect(analysis.errors).toEqual([
      { file: 'bad.csv', error: expect.stringMatching(/unterminated/) },
    ]);
    expect(analysis.candidates).toHaveLength(1);
  });

  it('limits: files, total bytes, rows, columns, cell size → rejected whole', () => {
    const tooMany = parseImportFiles(
      Array.from({ length: IMPORT_LIMITS.maxFiles + 1 }, () => ({
        name: 'a.csv',
        text: 'Problem\n',
      })),
    );
    expect(tooMany).toMatchObject({ ok: false, status: 413 });
    expect(
      parseImportFiles([
        { name: 'a', text: 'x'.repeat(IMPORT_LIMITS.maxTotalBytes + 1) },
      ]),
    ).toMatchObject({ ok: false, status: 413 });
    expect(parseImportFiles([{ name: 1, text: '' }])).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(parseImportFiles([])).toMatchObject({ ok: false, status: 400 });

    const rows = 'Problem\n' + 'x\n'.repeat(IMPORT_LIMITS.maxRows + 1);
    expect(
      analyzeImport([{ name: 'r.csv', text: rows }], MATCHER),
    ).toMatchObject({
      ok: false,
      status: 413,
    });
    const cols =
      Array.from(
        { length: IMPORT_LIMITS.maxColumns + 1 },
        (_, i) => `c${i}`,
      ).join(',') + '\n';
    expect(
      analyzeImport([{ name: 'c.csv', text: cols }], MATCHER),
    ).toMatchObject({
      ok: false,
      status: 413,
    });
    const cell = `Problem\n${'y'.repeat(IMPORT_LIMITS.maxCellBytes + 1)}\n`;
    expect(
      analyzeImport([{ name: 'b.csv', text: cell }], MATCHER),
    ).toMatchObject({
      ok: false,
      status: 413,
    });
  });
});

describe('planCommit + buildImportedNote', () => {
  const analysis = analyze([{ name: 'a.csv', text: SYN_A }]);
  const NOW = new Date('2026-09-25T12:00:00.000Z');

  it('defaults: create when new, skip on conflict', () => {
    const fresh = planCommit(analysis, new Set(), new Map());
    expect(fresh.ok && fresh.operations.map((o) => o.action)).toEqual([
      'create',
    ]);
    const conflict = planCommit(analysis, new Set(['lc-3']), new Map());
    expect(conflict.ok && conflict.operations.map((o) => o.action)).toEqual([
      'skip',
    ]);
  });

  it('rejects ids the preview did not produce and actions that do not fit', () => {
    expect(
      planCommit(
        analysis,
        new Set(),
        new Map([['lc-2', { action: 'create' }]]),
      ),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      planCommit(
        analysis,
        new Set(['lc-3']),
        new Map([['lc-3', { action: 'create' }]]),
      ),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      planCommit(analysis, new Set(), new Map([['lc-3', { action: 'merge' }]])),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      planCommit(
        analysis,
        new Set(),
        new Map([['lc-3', { action: 'create', rowKey: '0:4' }]]),
      ),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it('parseDecisions validates untrusted input', () => {
    expect(parseDecisions({ 'lc-3': { action: 'nuke' } }).ok).toBe(false);
    expect(parseDecisions({ 'lc-3': { action: 'skip', status: 'x' } }).ok).toBe(
      false,
    );
    expect(parseDecisions([]).ok).toBe(false);
    const ok = parseDecisions({
      'lc-3': { action: 'merge', status: 'to_revisit' },
    });
    expect(ok.ok && ok.decisions.get('lc-3')).toEqual({
      action: 'merge',
      status: 'to_revisit',
    });
  });

  const opFor = (
    action: 'create' | 'overwrite' | 'merge',
    status?: 'to_revisit',
  ) => {
    const plan = planCommit(
      analysis,
      action === 'create' ? new Set() : new Set(['lc-3']),
      new Map([['lc-3', { action, ...(status && { status }) }]]),
    );
    if (!plan.ok) throw new Error(plan.error);
    return plan.operations[0]!;
  };
  const EXISTING = {
    problemId: 'lc-3',
    content: 'My existing words',
    lastUpdated: '2025-01-01T00:00:00.000Z',
    attempts: 3,
    status: 'did_not_understand' as const,
    completed: false,
    spaceComplexity: 'O(1)',
  };

  it('create uses the default status and the imported date', () => {
    expect(buildImportedNote(opFor('create'), null, 'done', NOW)).toEqual({
      problemId: 'lc-3',
      content:
        'Hash complements. TC: O(n) SC: O(n)\n\n## Notes\n\nEdge: same index',
      lastUpdated: '2024-03-05T00:00:00.000Z',
      status: 'done',
      completed: true,
      timeComplexity: 'O(n)',
      spaceComplexity: 'O(n)',
    });
  });

  it('overwrite replaces body/complexities/status/date but keeps attempts', () => {
    const note = buildImportedNote(opFor('overwrite'), EXISTING, 'done', NOW);
    expect(note).toMatchObject({
      attempts: 3,
      status: 'done',
      lastUpdated: '2024-03-05T00:00:00.000Z',
      spaceComplexity: 'O(n)',
    });
    expect(note.content).not.toContain('My existing words');
  });

  it('merge appends under ## Imported <date>, keeps status, fills only empty complexities, later date', () => {
    const note = buildImportedNote(opFor('merge'), EXISTING, 'done', NOW);
    expect(note.content).toBe(
      'My existing words\n\n## Imported 2026-09-25\n\nHash complements. TC: O(n) SC: O(n)\n\n## Notes\n\nEdge: same index',
    );
    expect(note).toMatchObject({
      status: 'did_not_understand',
      completed: false,
      timeComplexity: 'O(n)',
      spaceComplexity: 'O(1)',
      lastUpdated: '2025-01-01T00:00:00.000Z',
      attempts: 3,
    });
    const picked = buildImportedNote(
      opFor('merge', 'to_revisit'),
      EXISTING,
      'done',
      NOW,
    );
    expect(picked.status).toBe('to_revisit');
  });
});

describe('ReDoS regressions (linear-time on untrusted text)', () => {
  const MIB = 1024 * 1024;
  const timed = (fn: () => unknown): number => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };

  it.each([
    ['Time + 1 MiB spaces', `Time${' '.repeat(MIB)}`],
    ['Time + 1 MiB tabs', `Time${'\t'.repeat(MIB)}x`],
    ['Space complexity + 1 MiB spaces', `Space complexity${' '.repeat(MIB)}:`],
    ['TC: + 1 MiB spaces', `TC:${' '.repeat(MIB)}`],
    ['many labels', 'Time '.repeat(MIB / 5)],
    ['O( never closed', `TC: O(${'('.repeat(MIB)}`],
  ])('extractComplexities: %s < 200 ms', (_name, text) => {
    expect(timed(() => extractComplexities(text))).toBeLessThan(200);
  });

  it('trimUnicode on long inner whitespace runs < 200 ms', () => {
    const text = `a${' '.repeat(MIB)}b`;
    expect(timed(() => trimUnicode(text))).toBeLessThan(200);
    expect(trimUnicode(` \u00A0${text}\uFEFF `)).toBe(text);
  });

  it('matcher / title normalization on 1 MiB of whitespace < 200 ms', () => {
    const text = `12${' '.repeat(MIB)}x`;
    expect(timed(() => MATCHER.match(text, text))).toBeLessThan(200);
  });
});

describe('complexity text is preserved verbatim', () => {
  it('keeps quotes and backslashes as written', () => {
    expect(extractComplexities('TC: O("n" \\log n)').timeComplexity).toBe(
      'O("n" \\log n)',
    );
  });

  it('a newline inside O(...) stops the scan', () => {
    expect(extractComplexities('TC: O(n\n)').timeComplexity).toBeUndefined();
  });
});

describe('idempotent merge', () => {
  const analysis = analyze([{ name: 'a.csv', text: SYN_A }]);
  const plan = planCommit(
    analysis,
    new Set(['lc-3']),
    new Map([['lc-3', { action: 'merge' }]]),
  );
  if (!plan.ok) throw new Error(plan.error);
  const op = plan.operations[0]!;
  const base = {
    problemId: 'lc-3',
    content: 'Mine',
    lastUpdated: '2025-01-01T00:00:00.000Z',
    status: 'to_revisit' as const,
  };

  it('re-merging the same CSV does not append the block twice', () => {
    const once = buildImportedNote(
      op,
      base,
      'done',
      new Date('2026-01-01T00:00:00Z'),
    );
    const twice = buildImportedNote(
      op,
      once,
      'done',
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(twice.content).toBe(once.content);
    expect(once.content.match(/## Imported/g)).toHaveLength(1);
  });

  it('a note equal to the imported body (earlier create) is not appended to', () => {
    const created = { ...base, content: op.row.mapped.content };
    expect(buildImportedNote(op, created, 'done', new Date()).content).toBe(
      created.content,
    );
  });

  it('hasImportedBlock only matches a whole ## Imported section', () => {
    const block = 'B\n\n## Notes\n\nN';
    expect(
      hasImportedBlock(`x\n\n## Imported 2026-01-01\n\n${block}`, block),
    ).toBe(true);
    expect(
      hasImportedBlock(
        `## Imported 2026-01-01\n\n${block}\n\n## Imported 2026-02-01\n\nother`,
        block,
      ),
    ).toBe(true);
    expect(
      hasImportedBlock(
        `x\n\n## Imported 2026-01-01\n\n${block} and more`,
        block,
      ),
    ).toBe(false);
    expect(
      hasImportedBlock(`x ## Imported 2026-01-01\n\n${block}`, block),
    ).toBe(false);
    expect(hasImportedBlock(block, block)).toBe(false);
  });

  it('a different imported body is still appended', () => {
    const other = 'Mine\n\n## Imported 2026-01-01\n\nolder import';
    const note = buildImportedNote(
      op,
      { ...base, content: other },
      'done',
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(
      note.content.startsWith(`${other}\n\n## Imported 2026-03-01\n\n`),
    ).toBe(true);
  });
});
