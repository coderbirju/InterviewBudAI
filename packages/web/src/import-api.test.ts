import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { createCoachHandler } from './handler.js';
import type { HandlerRequest, HandlerResponse } from './handler.js';
import { handleApiRoute } from './api.js';
import { MAX_BODY_BYTES } from './security.js';
import { BACKUP_RETENTION, createBackup } from './import/backup.js';
import type { ImportPreview } from './import/plan.js';
import type { ImportCommitResult } from './import/routes.js';

/*
 * ADR 0009 D2/D3: POST /api/import/csv/preview + /commit and pre-import
 * backups. Every CSV here is SYNTHETIC (charter §6.1); every test uses a temp
 * data dir and a temp home — nothing real is touched.
 */

const PORT = 4173;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const CATALOG = createCatalogSource();

// lc-3 and lc-11 are in the shipped catalog; the third row matches nothing.
const CSV =
  'Problem,Intuition,Last Visited on,Notes,URL\n' +
  'Longest Substring Without Repeating Characters,"Sliding window.\nTC: O(n), Space: O(k)","March 5, 2024",Shrink on repeat,https://leetcode.com/problems/longest-substring-without-repeating-characters/editorial/\n' +
  '11. Container With Most Water,Two pointers <script>alert(1)</script>,2024-01-02,,\n' +
  'A Problem Not In The Catalog,whatever,,,\n' +
  ',,,,\n';

let root: string;
let home: string;
let dataDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-import-test-'));
  home = path.join(root, 'home');
  dataDir = path.join(root, 'data');
  fs.mkdirSync(home);
  fs.mkdirSync(dataDir);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

type Handler = (req: HandlerRequest) => Promise<HandlerResponse>;

function makeHandler(
  makeStorage: (dir: string) => LocalFileStorageAdapter = (dir) =>
    new LocalFileStorageAdapter(dir),
): Handler {
  const inner = createCoachHandler({
    storage: makeStorage(dataDir),
    catalog: CATALOG,
    createStorage: makeStorage,
    dataDir,
    dataDirSource: 'default',
    homeDir: home,
    env: {},
    argv: [],
    port: PORT,
    warn: () => undefined,
  });
  return (req) =>
    inner({ ...req, headers: { host: HOST, origin: ORIGIN, ...req.headers } });
}

function post(
  handler: Handler,
  url: string,
  payload: unknown,
): Promise<HandlerResponse> {
  return handler({
    method: 'POST',
    url,
    body: JSON.stringify(payload),
    contentType: 'application/json',
  });
}

async function preview(
  handler: Handler,
  files = [{ name: 'Arrays.csv', text: CSV }],
  defaultStatus?: string,
): Promise<ImportPreview> {
  const res = await post(handler, '/api/import/csv/preview', {
    files,
    ...(defaultStatus !== undefined && { defaultStatus }),
  });
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as ImportPreview;
}

function notesOnDisk(): string[] {
  const dir = path.join(dataDir, 'notes');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function backups(): string[] {
  const dir = path.join(dataDir, '.backups');
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((n) => n !== '.gitignore')
        .sort()
    : [];
}

async function seedNote(id: string, content: string): Promise<void> {
  await new LocalFileStorageAdapter(dataDir).writeIntuitionNote({
    problemId: id,
    content,
    lastUpdated: '2025-06-01T00:00:00.000Z',
    status: 'to_revisit',
    completed: false,
  });
}

describe('POST /api/import/csv/preview', () => {
  it('parses, matches and reports without writing anything', async () => {
    const handler = makeHandler();
    const body = await preview(handler);
    expect(
      body.rows.map((r) => [r.match?.problemId ?? null, r.match?.by]),
    ).toEqual([
      ['lc-3', 'url'],
      ['lc-11', 'number'],
      [null, undefined],
    ]);
    expect(body.rows[0]).toMatchObject({
      existing: 'none',
      fields: {
        status: 'done',
        lastUpdated: '2024-03-05T00:00:00.000Z',
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(k)',
      },
    });
    expect(body.unmatched).toHaveLength(1);
    expect(body.blankRows).toBe(1);
    expect(body.duplicatesCollapsed).toBe(0);
    expect(body.errors).toEqual([]);
    expect(notesOnDisk()).toEqual([]);
    expect(backups()).toEqual([]);
  });

  it('flags an existing note as a conflict', async () => {
    await seedNote('lc-3', 'mine');
    const body = await preview(makeHandler());
    expect(body.rows[0]?.existing).toBe('note');
    expect(body.rows[1]?.existing).toBe('none');
  });

  it('validates the body: bad JSON, missing files, bad defaultStatus → 400; GET → 405', async () => {
    const handler = makeHandler();
    const bad = await handler({
      method: 'POST',
      url: '/api/import/csv/preview',
      body: '{',
      contentType: 'application/json',
    });
    expect(bad.status).toBe(400);
    expect((await post(handler, '/api/import/csv/preview', {})).status).toBe(
      400,
    );
    expect(
      (
        await post(handler, '/api/import/csv/preview', {
          files: [{ name: 'a.csv', text: CSV }],
          defaultStatus: 'bogus',
        })
      ).status,
    ).toBe(400);
    const get = await handler({
      method: 'GET',
      url: '/api/import/csv/preview',
    });
    expect(get.status).toBe(405);
  });

  it('same /api prechecks: cross-site → 403, text/plain → 415, oversized → 413', async () => {
    const handler = makeHandler();
    const payload = JSON.stringify({ files: [{ name: 'a.csv', text: CSV }] });
    for (const url of ['/api/import/csv/preview', '/api/import/csv/commit']) {
      const cross = await handler({
        method: 'POST',
        url,
        body: payload,
        contentType: 'application/json',
        headers: { origin: 'https://evil.example' },
      });
      expect(cross.status).toBe(403);
      const plain = await handler({
        method: 'POST',
        url,
        body: payload,
        contentType: 'text/plain',
      });
      expect(plain.status).toBe(415);
      const big = await handler({
        method: 'POST',
        url,
        body: JSON.stringify({
          files: [{ name: 'a.csv', text: 'x'.repeat(MAX_BODY_BYTES) }],
        }),
        contentType: 'application/json',
      });
      expect(big.status).toBe(413);
    }
    expect(notesOnDisk()).toEqual([]);
  });
});

describe('preview on a ~1 MiB pathological body', () => {
  it('completes quickly (no regex backtracking blow-up)', async () => {
    const pad = ' '.repeat(60 * 1024);
    const row = `Two Sum,"Time${pad}x","${pad}y",TC:${pad}\n`;
    let text = 'Problem,Intuition,Notes,Extra\n';
    while (Buffer.byteLength(text + row) < MAX_BODY_BYTES - 2048) text += row;
    expect(Buffer.byteLength(text)).toBeGreaterThan(900 * 1024);
    const handler = makeHandler();
    const t0 = performance.now();
    const res = await post(handler, '/api/import/csv/preview', {
      files: [{ name: 'evil.csv', text }],
    });
    const elapsed = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('POST /api/import/csv/commit', () => {
  it('happy path: backup, then notes in the exact on-disk format the adapter reads back', async () => {
    const handler = makeHandler();
    const files = [{ name: 'Arrays.csv', text: CSV }];
    const p = await preview(handler, files);
    const res = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
      defaultStatus: 'done',
      decisions: { 'lc-11': { action: 'create', status: 'to_revisit' } },
    });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body) as ImportCommitResult;
    expect(result).toMatchObject({
      created: 2,
      overwritten: 0,
      merged: 0,
      skipped: 0,
      unmatched: 1,
      failed: [],
    });
    expect(path.dirname(result.backup)).toBe(path.join(dataDir, '.backups'));
    expect(path.basename(result.backup)).toMatch(/^\d{8}T\d{6}Z$/);
    expect(
      fs.readFileSync(path.join(dataDir, '.backups', '.gitignore'), 'utf8'),
    ).toBe('*\n');
    expect(notesOnDisk()).toEqual(['lc-11.md', 'lc-3.md']);

    expect(
      fs.readFileSync(path.join(dataDir, 'notes', 'lc-3.md'), 'utf8'),
    ).toBe(
      '---\n' +
        'id: lc-3\n' +
        'lastUpdated: 2024-03-05T00:00:00.000Z\n' +
        'status: done\n' +
        'completed: true\n' +
        'timeComplexity: "O(n)"\n' +
        'spaceComplexity: "O(k)"\n' +
        '---\n' +
        'Sliding window.\nTC: O(n), Space: O(k)\n\n## Notes\n\nShrink on repeat\n',
    );
    const storage = new LocalFileStorageAdapter(dataDir);
    expect(await storage.readIntuitionNote('lc-3')).toEqual({
      problemId: 'lc-3',
      content:
        'Sliding window.\nTC: O(n), Space: O(k)\n\n## Notes\n\nShrink on repeat',
      lastUpdated: '2024-03-05T00:00:00.000Z',
      status: 'done',
      completed: true,
      timeComplexity: 'O(n)',
      spaceComplexity: 'O(k)',
    });
    // Raw markdown source is stored as-is (never evaluated/rendered here).
    expect(await storage.readIntuitionNote('lc-11')).toMatchObject({
      content: 'Two pointers <script>alert(1)</script>',
      status: 'to_revisit',
    });

    // The catalog reflects the imported statuses.
    const catalog = JSON.parse(
      (await handler({ method: 'GET', url: '/api/catalog' })).body,
    ) as { totals: { byStatus: Record<string, number> } };
    expect(catalog.totals.byStatus.done).toBe(1);
    expect(catalog.totals.byStatus.to_revisit).toBe(1);
  });

  it('conflicts: default skip leaves the note untouched', async () => {
    await seedNote('lc-3', 'my own words');
    const before = fs.readFileSync(
      path.join(dataDir, 'notes', 'lc-3.md'),
      'utf8',
    );
    const handler = makeHandler();
    const files = [{ name: 'a.csv', text: CSV }];
    const p = await preview(handler, files);
    const res = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
    });
    expect(JSON.parse(res.body)).toMatchObject({ created: 1, skipped: 1 });
    expect(
      fs.readFileSync(path.join(dataDir, 'notes', 'lc-3.md'), 'utf8'),
    ).toBe(before);
  });

  it('conflicts: overwrite replaces, merge appends under ## Imported and keeps status', async () => {
    await seedNote('lc-3', 'my own words');
    await seedNote('lc-11', 'container thoughts');
    const handler = makeHandler();
    const files = [{ name: 'a.csv', text: CSV }];
    const p = await preview(handler, files);
    const res = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
      decisions: {
        'lc-3': { action: 'overwrite' },
        'lc-11': { action: 'merge' },
      },
    });
    expect(JSON.parse(res.body)).toMatchObject({ overwritten: 1, merged: 1 });
    const storage = new LocalFileStorageAdapter(dataDir);
    const over = await storage.readIntuitionNote('lc-3');
    expect(over?.content).not.toContain('my own words');
    expect(over?.status).toBe('done');
    const merged = await storage.readIntuitionNote('lc-11');
    expect(merged?.content).toMatch(
      /^container thoughts\n\n## Imported \d{4}-\d{2}-\d{2}\n\nTwo pointers <script>alert\(1\)<\/script>$/,
    );
    expect(merged?.status).toBe('to_revisit');
    expect(merged?.lastUpdated).toBe('2025-06-01T00:00:00.000Z');
    // The backup holds the pre-import notes.
    const [snap] = backups();
    expect(
      fs.readFileSync(
        path.join(dataDir, '.backups', snap!, 'notes', 'lc-3.md'),
        'utf8',
      ),
    ).toContain('my own words');
  });

  it('a merge that changes nothing is skipped (reason unchanged) and the file is not rewritten', async () => {
    // Same body as the CSV row, older lastUpdated than its Last Visited.
    await new LocalFileStorageAdapter(dataDir).writeIntuitionNote({
      problemId: 'lc-11',
      content: 'Two pointers <script>alert(1)</script>',
      lastUpdated: '2023-01-01T00:00:00.000Z',
      status: 'to_revisit',
      completed: false,
    });
    const file = path.join(dataDir, 'notes', 'lc-11.md');
    const before = fs.readFileSync(file, 'utf8');
    const handler = makeHandler();
    const files = [{ name: 'a.csv', text: CSV }];
    const p = await preview(handler, files);
    const res = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
      decisions: { 'lc-11': { action: 'merge' }, 'lc-3': { action: 'skip' } },
    });
    const result = JSON.parse(res.body) as ImportCommitResult;
    expect(result).toMatchObject({ merged: 0, skipped: 2, created: 0 });
    expect(result.skippedDetails).toEqual([
      { problemId: 'lc-3', reason: 'decision' },
      { problemId: 'lc-11', reason: 'unchanged' },
    ]);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('re-importing with merge after a merge is an idempotent skip', async () => {
    await seedNote('lc-11', 'container thoughts');
    const handler = makeHandler();
    const files = [{ name: 'a.csv', text: CSV }];
    const commit = async () => {
      const p = await preview(handler, files);
      return JSON.parse(
        (
          await post(handler, '/api/import/csv/commit', {
            files,
            previewHash: p.previewHash,
            decisions: { 'lc-11': { action: 'merge' } },
          })
        ).body,
      ) as ImportCommitResult;
    };
    expect(await commit()).toMatchObject({ merged: 1 });
    const file = path.join(dataDir, 'notes', 'lc-11.md');
    const after = fs.readFileSync(file, 'utf8');
    const again = await commit();
    expect(again).toMatchObject({ merged: 0 });
    expect(again.skippedDetails).toContainEqual({
      problemId: 'lc-11',
      reason: 'unchanged',
    });
    expect(fs.readFileSync(file, 'utf8')).toBe(after);
  });

  it('imported complexity text with quotes/backslashes is stored verbatim', async () => {
    const csv =
      'Problem,Intuition\n' +
      '"3. Longest Substring Without Repeating Characters","Window. TC: O(""n"" \\log n), SC: O(k\\)"\n';
    const handler = makeHandler();
    const files = [{ name: 'q.csv', text: csv }];
    const p = await preview(handler, files);
    expect(p.rows[0]?.fields).toMatchObject({
      timeComplexity: 'O("n" \\log n)',
      spaceComplexity: 'O(k\\)',
    });
    await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
    });
    const got = JSON.parse(
      (await handler({ method: 'GET', url: '/api/notes/lc-3' })).body,
    ) as { timeComplexity: string; spaceComplexity: string };
    expect(got.timeComplexity).toBe('O("n" \\log n)');
    expect(got.spaceComplexity).toBe('O(k\\)');
    // Re-merging the same CSV changes nothing.
    const p2 = await preview(handler, files);
    const res = JSON.parse(
      (
        await post(handler, '/api/import/csv/commit', {
          files,
          previewHash: p2.previewHash,
          decisions: { 'lc-3': { action: 'merge' } },
        })
      ).body,
    ) as ImportCommitResult;
    expect(res.skippedDetails).toEqual([
      { problemId: 'lc-3', reason: 'unchanged' },
    ]);
  });

  it('a note that appeared after the preview → 409, nothing written, no backup', async () => {
    const handler = makeHandler();
    const files = [{ name: 'a.csv', text: CSV }];
    const p = await preview(handler, files);
    await seedNote('lc-3', 'written in another tab');
    const res = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
    });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/re-run preview/);
    expect(notesOnDisk()).toEqual(['lc-3.md']);
    expect(
      await new LocalFileStorageAdapter(dataDir).readIntuitionNote('lc-3'),
    ).toMatchObject({ content: 'written in another tab' });
    expect(backups()).toEqual([]);
  });

  it('edited files, another defaultStatus or a missing hash → 409 / 400, no writes', async () => {
    const handler = makeHandler();
    const files = [{ name: 'a.csv', text: CSV }];
    const p = await preview(handler, files);
    const edited = await post(handler, '/api/import/csv/commit', {
      files: [{ name: 'a.csv', text: CSV.replace('Shrink', 'Grow') }],
      previewHash: p.previewHash,
    });
    expect(edited.status).toBe(409);
    const status = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
      defaultStatus: 'to_revisit',
    });
    expect(status.status).toBe(409);
    const missing = await post(handler, '/api/import/csv/commit', { files });
    expect(missing.status).toBe(400);
    expect(notesOnDisk()).toEqual([]);
  });

  it('client-supplied ids the preview did not match are rejected (400)', async () => {
    const handler = makeHandler();
    const files = [{ name: 'a.csv', text: CSV }];
    const p = await preview(handler, files);
    const res = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
      decisions: { '../../etc/passwd': { action: 'create' } },
    });
    expect(res.status).toBe(400);
    expect(notesOnDisk()).toEqual([]);
  });

  it('a failed backup aborts the import (500, no notes written)', async () => {
    fs.writeFileSync(path.join(dataDir, '.backups'), 'not a directory');
    const handler = makeHandler();
    const files = [{ name: 'a.csv', text: CSV }];
    const p = await preview(handler, files);
    const res = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
    });
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/nothing was imported/);
    expect(notesOnDisk()).toEqual([]);
  });

  it('a symlinked .backups is refused (500, no writes, target untouched)', async () => {
    const elsewhere = path.join(root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(dataDir, '.backups'));
    const handler = makeHandler();
    const files = [{ name: 'a.csv', text: CSV }];
    const p = await preview(handler, files);
    const res = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
    });
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/symlink/);
    expect(notesOnDisk()).toEqual([]);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('a symlinked .backups/.gitignore is refused (its target is not written)', async () => {
    fs.mkdirSync(path.join(dataDir, '.backups'));
    const victim = path.join(root, 'victim.txt');
    fs.writeFileSync(victim, 'keep');
    fs.symlinkSync(victim, path.join(dataDir, '.backups', '.gitignore'));
    await expect(createBackup(dataDir, new Date())).rejects.toThrow(/symlink/);
    expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
  });

  it('a missing data folder → 400 on commit', async () => {
    const handler = makeHandler();
    fs.rmSync(dataDir, { recursive: true });
    const files = [{ name: 'a.csv', text: CSV }];
    const p = await preview(handler, files);
    const res = await post(handler, '/api/import/csv/commit', {
      files,
      previewHash: p.previewHash,
    });
    expect(res.status).toBe(400);
    expect(fs.existsSync(dataDir)).toBe(false);
  });

  it('uses the injected clock for the merge heading (handleApiRoute)', async () => {
    await seedNote('lc-3', 'mine');
    const deps = {
      catalog: CATALOG,
      storage: new LocalFileStorageAdapter(dataDir),
      dataDir,
      now: () => new Date('2026-09-25T08:09:10.000Z'),
    };
    const files = [{ name: 'a.csv', text: CSV }];
    const p = JSON.parse(
      (
        await handleApiRoute(
          'POST',
          '/api/import/csv/preview',
          deps,
          JSON.stringify({ files }),
        )
      ).body,
    ) as ImportPreview;
    const res = await handleApiRoute(
      'POST',
      '/api/import/csv/commit',
      deps,
      JSON.stringify({
        files,
        previewHash: p.previewHash,
        decisions: { 'lc-3': { action: 'merge' } },
      }),
    );
    const result = JSON.parse(res.body) as ImportCommitResult;
    expect(path.basename(result.backup)).toBe('20260925T080910Z');
    const note = await new LocalFileStorageAdapter(dataDir).readIntuitionNote(
      'lc-3',
    );
    expect(note?.content).toContain('## Imported 2026-09-25');
  });
});

describe('CSV "Add as custom problem" (ADR 0010 D4)', () => {
  const CUSTOM_CSV =
    'Problem,Intuition,Last Visited on,URL\n' +
    'Book Puzzle 7,Use a <b>stack</b>,2024-02-03,https://example.com/p/7\n' +
    'Whiteboard Question,Greedy,,javascript:alert(1)\n' +
    '11. Container With Most Water,Two pointers,,\n';
  const files = [{ name: 'Custom.csv', text: CUSTOM_CSV }];

  function problemsOnDisk(): string[] {
    const dir = path.join(dataDir, 'problems');
    return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  }

  function commit(
    handler: Handler,
    previewHash: string,
    decisions: unknown,
  ): Promise<HandlerResponse> {
    return post(handler, '/api/import/csv/commit', {
      files,
      previewHash,
      defaultStatus: 'done',
      decisions,
    });
  }

  it('preview → commit creates the problem (row title/url, chosen difficulty/topics), then its note', async () => {
    const handler = makeHandler();
    const p = await preview(handler, files);
    expect(p.unmatched.map((u) => [u.key, u.title])).toEqual([
      ['0:2', 'Book Puzzle 7'],
      ['0:3', 'Whiteboard Question'],
    ]);
    const res = await commit(handler, p.previewHash, {
      '0:2': {
        action: 'add-custom',
        difficulty: 'hard',
        topics: ['stack', 'arrays'],
        status: 'to_revisit',
      },
      '0:3': { action: 'add-custom', difficulty: 'easy', topics: ['greedy'] },
      'lc-11': { action: 'skip' },
    });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body) as ImportCommitResult;
    expect(result).toMatchObject({ created: 2, skipped: 1, unmatched: 0 });
    expect(result.failed).toEqual([]);
    expect(result.customCreated.map((c) => [c.rowKey, c.title])).toEqual([
      ['0:2', 'Book Puzzle 7'],
      ['0:3', 'Whiteboard Question'],
    ]);
    expect(backups()).toHaveLength(1);

    const storage = new LocalFileStorageAdapter(dataDir);
    const [first, second] = result.customCreated;
    expect(first?.problemId).toMatch(/^u-book-puzzle-7-[a-z0-9]{6}$/);
    expect(await storage.readCustomProblem(first!.problemId)).toMatchObject({
      title: 'Book Puzzle 7',
      url: 'https://example.com/p/7',
      difficulty: 'hard',
      topics: ['stack', 'arrays'],
    });
    // A non-http(s) url cell is dropped, never stored.
    expect(
      (await storage.readCustomProblem(second!.problemId))?.url,
    ).toBeUndefined();
    expect(await storage.readIntuitionNote(first!.problemId)).toMatchObject({
      content: 'Use a <b>stack</b>',
      status: 'to_revisit',
      lastUpdated: '2024-02-03T00:00:00.000Z',
    });
    expect((await storage.readIntuitionNote(second!.problemId))?.status).toBe(
      'done',
    );

    // The new problems are in the catalog, flagged custom.
    const catalog = JSON.parse(
      (await handler({ method: 'GET', url: '/api/catalog' })).body,
    ) as {
      topics: { topic: string; problems: { id: string; custom?: true }[] }[];
    };
    const greedy = catalog.topics.find((t) => t.topic === 'greedy');
    expect(
      greedy?.problems.find((q) => q.id === second!.problemId),
    ).toMatchObject({ custom: true });
  });

  it('unmatched rows without a decision are still not written', async () => {
    const handler = makeHandler();
    const p = await preview(handler, files);
    const res = await commit(handler, p.previewHash, {});
    const result = JSON.parse(res.body) as ImportCommitResult;
    expect(result).toMatchObject({ created: 1, unmatched: 2 });
    expect(result.customCreated).toEqual([]);
    expect(problemsOnDisk()).toEqual([]);
  });

  it('previewHash covers unmatched rows: an edited unmatched row → 409, nothing written', async () => {
    const handler = makeHandler();
    const p = await preview(handler, files);
    const edited = CUSTOM_CSV.replace('Use a <b>stack</b>', 'Use a queue');
    const res = await post(handler, '/api/import/csv/commit', {
      files: [{ name: 'Custom.csv', text: edited }],
      previewHash: p.previewHash,
      defaultStatus: 'done',
      decisions: {
        '0:2': { action: 'add-custom', difficulty: 'hard', topics: ['stack'] },
      },
    });
    expect(res.status).toBe(409);
    expect(problemsOnDisk()).toEqual([]);
    expect(notesOnDisk()).toEqual([]);
    expect(backups()).toEqual([]);
  });

  it('a row that starts matching a new custom problem after the preview → 409', async () => {
    const handler = makeHandler();
    const p = await preview(handler, files);
    const created = await post(handler, '/api/problems', {
      title: 'Book Puzzle 7',
      difficulty: 'easy',
      topics: ['arrays'],
    });
    expect(created.status).toBe(201);
    const res = await commit(handler, p.previewHash, {
      '0:2': { action: 'add-custom', difficulty: 'hard', topics: ['stack'] },
    });
    expect(res.status).toBe(409);
    expect(problemsOnDisk()).toHaveLength(1);
    expect(backups()).toEqual([]);
  });

  it('bad add-custom decisions → 400 before any backup or write', async () => {
    const handler = makeHandler();
    const p = await preview(handler, files);
    const bad: unknown[] = [
      { '0:2': { action: 'add-custom', topics: ['stack'] } },
      { '0:2': { action: 'add-custom', difficulty: 'hard' } },
      { '0:2': { action: 'add-custom', difficulty: 'hard', topics: [] } },
      {
        '0:2': {
          action: 'add-custom',
          difficulty: 'hard',
          topics: ['arrays', 'stack', 'heap', 'trees'],
        },
      },
      {
        '0:2': { action: 'add-custom', difficulty: 'hard', topics: ['nope'] },
      },
      // A matched problem id or a made-up row key cannot be added as custom.
      {
        'lc-11': {
          action: 'add-custom',
          difficulty: 'hard',
          topics: ['stack'],
        },
      },
      {
        '9:9': { action: 'add-custom', difficulty: 'hard', topics: ['stack'] },
      },
      { 'lc-11': { action: 'create', difficulty: 'hard' } },
    ];
    for (const decisions of bad) {
      const res = await commit(handler, p.previewHash, decisions);
      expect(res.status, JSON.stringify(decisions)).toBe(400);
    }
    expect(problemsOnDisk()).toEqual([]);
    expect(notesOnDisk()).toEqual([]);
    expect(backups()).toEqual([]);
  });

  it('per-row failures (duplicate within the commit, over-long title) go to failed[]; other rows still import', async () => {
    const csv =
      'Problem,Intuition\n' +
      'Twin Puzzle,first\n' +
      'Twin  Puzzle!,second\n' +
      `${'x'.repeat(201)},too long\n`;
    const twinFiles = [{ name: 'Twins.csv', text: csv }];
    const handler = makeHandler();
    const p = await preview(handler, twinFiles);
    expect(p.unmatched).toHaveLength(3);
    const decide = {
      action: 'add-custom',
      difficulty: 'medium',
      topics: ['arrays'],
    };
    const res = await post(handler, '/api/import/csv/commit', {
      files: twinFiles,
      previewHash: p.previewHash,
      decisions: { '0:2': decide, '0:3': decide, '0:4': decide },
    });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body) as ImportCommitResult;
    expect(result.created).toBe(1);
    expect(result.customCreated.map((c) => c.rowKey)).toEqual(['0:2']);
    expect(result.failed).toEqual([
      {
        problemId: '',
        rowKey: '0:3',
        error: expect.stringContaining('similar title') as string,
      },
      {
        problemId: '',
        rowKey: '0:4',
        error: expect.stringContaining('1–200') as string,
      },
    ]);
    expect(problemsOnDisk()).toHaveLength(1);
    expect(notesOnDisk()).toHaveLength(1);
  });

  it('a non-http(s) url cell (javascript:) → the problem is created without a url', async () => {
    const handler = makeHandler();
    const p = await preview(handler, files);
    const res = await commit(handler, p.previewHash, {
      '0:3': { action: 'add-custom', difficulty: 'easy', topics: ['greedy'] },
    });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body) as ImportCommitResult;
    expect(result.failed).toEqual([]);
    expect(result.customCreated).toHaveLength(1);
    const id = result.customCreated[0]!.problemId;
    const stored = await new LocalFileStorageAdapter(dataDir).readCustomProblem(
      id,
    );
    expect(stored).toMatchObject({ title: 'Whiteboard Question' });
    expect(stored).not.toHaveProperty('url');
    const raw = fs.readFileSync(
      path.join(dataDir, 'problems', `${id}.json`),
      'utf8',
    );
    expect(raw).not.toContain('javascript');
  });

  it('problem created but its note write fails → in customCreated AND failed[] with its id', async () => {
    class NoteFails extends LocalFileStorageAdapter {
      override async writeIntuitionNote(
        ...args: Parameters<LocalFileStorageAdapter['writeIntuitionNote']>
      ): ReturnType<LocalFileStorageAdapter['writeIntuitionNote']> {
        if (args[0].problemId.startsWith('u-')) {
          throw new Error('EACCES: permission denied');
        }
        return super.writeIntuitionNote(...args);
      }
    }
    const handler = makeHandler((dir) => new NoteFails(dir));
    const p = await preview(handler, files);
    const res = await commit(handler, p.previewHash, {
      '0:2': { action: 'add-custom', difficulty: 'hard', topics: ['stack'] },
    });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body) as ImportCommitResult;
    expect(result.created).toBe(1); // lc-11 only; the custom note did not land
    expect(result.customCreated).toHaveLength(1);
    const made = result.customCreated[0]!;
    expect(made).toMatchObject({ rowKey: '0:2', title: 'Book Puzzle 7' });
    expect(result.failed).toEqual([
      {
        problemId: made.problemId,
        rowKey: '0:2',
        error: 'EACCES: permission denied',
      },
    ]);
    expect(result.unmatched).toBe(1); // 0:3 had no decision
    expect(problemsOnDisk()).toEqual([`${made.problemId}.json`]);
    expect(notesOnDisk().some((n) => n.startsWith(made.problemId))).toBe(false);
  });

  it('the 1,000 custom-problem cap fails the row, not the import', async () => {
    const dir = path.join(dataDir, 'problems');
    fs.mkdirSync(dir);
    for (let i = 0; i < 1000; i++) {
      const id = `u-seed-${i.toString(36).padStart(6, '0')}`;
      fs.writeFileSync(
        path.join(dir, `${id}.json`),
        JSON.stringify({
          id,
          title: `Seed ${i}`,
          difficulty: 'easy',
          topics: ['arrays'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      );
    }
    const handler = makeHandler();
    const p = await preview(handler, files);
    const res = await commit(handler, p.previewHash, {
      '0:2': { action: 'add-custom', difficulty: 'hard', topics: ['stack'] },
    });
    const result = JSON.parse(res.body) as ImportCommitResult;
    expect(result.created).toBe(1); // lc-11 still imported
    expect(result.failed).toEqual([
      {
        problemId: '',
        rowKey: '0:2',
        error: expect.stringContaining('at most 1000') as string,
      },
    ]);
    expect(problemsOnDisk()).toHaveLength(1000);
  });
});

describe('createBackup (ADR 0009 D3)', () => {
  it('copies everything except .backups, skips symlinks, dirs 0700', async () => {
    fs.mkdirSync(path.join(dataDir, 'notes'));
    fs.writeFileSync(path.join(dataDir, 'notes', 'lc-3.md'), 'x');
    fs.writeFileSync(path.join(dataDir, 'competency.json'), '{}');
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(dataDir, 'link.txt'));
    const first = await createBackup(dataDir, new Date('2026-01-01T00:00:00Z'));
    const second = await createBackup(
      dataDir,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(path.basename(first)).toBe('20260101T000000Z');
    expect(path.basename(second)).toBe('20260101T000000Z-2');
    expect(fs.readdirSync(second).sort()).toEqual(['competency.json', 'notes']);
    expect(fs.readFileSync(path.join(second, 'notes', 'lc-3.md'), 'utf8')).toBe(
      'x',
    );
    if (process.platform !== 'win32') {
      expect(fs.statSync(second).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(second, 'notes')).mode & 0o777).toBe(0o700);
    }
  });

  it(`keeps the last ${BACKUP_RETENTION}, pruning only timestamp-named entries`, async () => {
    fs.mkdirSync(path.join(dataDir, '.backups'));
    fs.mkdirSync(path.join(dataDir, '.backups', 'keep-me'));
    for (let i = 0; i < 7; i++) {
      await createBackup(dataDir, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    }
    expect(backups()).toEqual([
      '20260101T000002Z',
      '20260101T000003Z',
      '20260101T000004Z',
      '20260101T000005Z',
      '20260101T000006Z',
      'keep-me',
    ]);
  });
});
