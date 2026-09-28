/**
 * Custom problems (ADR 0010 D1–D3): the pure rules and the
 * LocalFileStorageAdapter store. Temp dirs only; no network.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileStorageAdapter } from './local-file-adapter.js';
import {
  CUSTOM_PROBLEM_LIMITS,
  generateCustomProblemId,
  isCustomProblemId,
  normalizeCustomStatement,
  normalizeCustomTitle,
  normalizeCustomTopics,
  normalizeCustomUrl,
  parseCustomProblem,
} from './custom-problems.js';
import type { CustomProblem } from './index.js';

function problem(overrides: Partial<CustomProblem> = {}): CustomProblem {
  return {
    id: 'u-my-problem-abc123',
    title: 'My problem',
    url: 'https://example.com/p',
    statement: 'Given a list, do a thing.',
    difficulty: 'medium',
    topics: ['arrays'],
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

let dir: string;
let adapter: LocalFileStorageAdapter;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ibai-custom-'));
  adapter = new LocalFileStorageAdapter(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeRaw(name: string, value: unknown): Promise<void> {
  await mkdir(join(dir, 'problems'), { recursive: true });
  await writeFile(
    join(dir, 'problems', name),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

describe('custom problem rules', () => {
  it('ids: u- prefix, lowercase slug runs, ≤ 64 chars', () => {
    expect(isCustomProblemId('u-two-sum-abc123')).toBe(true);
    for (const bad of [
      'lc-1',
      'u-',
      'u--x',
      'u-x-',
      'u-X',
      'u-a/b',
      'u-a\\b',
      'u-..',
      '../u-a',
      'u-a.json',
      `u-${'a'.repeat(63)}`,
      42,
    ]) {
      expect(isCustomProblemId(bad)).toBe(false);
    }
  });

  it('generates slug + six crypto base36 chars, path-safe', () => {
    const seq = [1, 2, 3, 34, 35, 0];
    let i = 0;
    const id = generateCustomProblemId(
      'Two Sum: II (Book #3)!',
      () => seq[i++]!,
    );
    expect(id).toBe('u-two-sum-ii-book-3-123yz0');
    expect(isCustomProblemId(id)).toBe(true);
    expect(generateCustomProblemId('!!!', () => 0)).toBe('u-problem-000000');
    expect(generateCustomProblemId('日本語', () => 0)).toBe('u-problem-000000');
    const long = generateCustomProblemId('a'.repeat(39) + ' bcd', () => 0);
    expect(long).toBe(`u-${'a'.repeat(39)}-000000`);
    // Real randomness: well-formed and (practically) never equal.
    const a = generateCustomProblemId('x');
    const b = generateCustomProblemId('x');
    expect(isCustomProblemId(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('titles: controls (incl. newlines) stripped, trimmed, 1–200', () => {
    expect(normalizeCustomTitle('  a\nb\r\tc\u0000 ')).toBe('a b c');
    expect(normalizeCustomTitle('Ring\nbuffer')).toBe('Ring buffer');
    expect(normalizeCustomTitle('Ring \r\n  buffer\u0007!')).toBe(
      'Ring buffer!',
    );
    expect(normalizeCustomTitle('a\u0000b')).toBe('ab');
    expect(normalizeCustomTitle('   ')).toBeNull();
    expect(normalizeCustomTitle('x'.repeat(200))).toHaveLength(200);
    expect(normalizeCustomTitle('x'.repeat(201))).toBeNull();
    expect(normalizeCustomTitle(3)).toBeNull();
  });

  it('statements keep tabs/newlines, strip other controls, ≤ 2000', () => {
    expect(normalizeCustomStatement('a\r\n\tb\u0007')).toBe('a\n\tb');
    expect(normalizeCustomStatement('x'.repeat(2000))).toHaveLength(2000);
    expect(normalizeCustomStatement('x'.repeat(2001))).toBeNull();
  });

  it('urls: http(s) only, ≤ 2048, no controls', () => {
    expect(normalizeCustomUrl('https://example.com/a')).toBe(
      'https://example.com/a',
    );
    expect(normalizeCustomUrl('http://x.test')).toBe('http://x.test/');
    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'ftp://x.test',
      'not a url',
      'https://x.test/\nfoo',
      `https://x.test/${'a'.repeat(CUSTOM_PROBLEM_LIMITS.urlMax)}`,
    ]) {
      expect(normalizeCustomUrl(bad)).toBeNull();
    }
  });

  it('topics: mapped, de-duplicated, 1–3', () => {
    expect(normalizeCustomTopics(['arrays', 'arrays', 'heap'])).toEqual([
      'arrays',
      'heap',
    ]);
    expect(normalizeCustomTopics([])).toBeNull();
    expect(normalizeCustomTopics(['a', 'b', 'c', 'd'])).toBeNull();
    expect(normalizeCustomTopics(['../x', 'Arrays'])).toBeNull();
    const only = (t: string): string | null => (t === 'heap' ? t : null);
    expect(normalizeCustomTopics(['heap', 'nope'], only)).toEqual(['heap']);
  });

  it('parse: required fields skip the record, bad optional fields drop', () => {
    expect(parseCustomProblem(problem())).toEqual(problem());
    expect(
      parseCustomProblem({ ...problem(), url: 'javascript:alert(1)' }),
    ).toEqual((({ url: _u, ...rest }) => rest)(problem()));
    expect(
      parseCustomProblem({ ...problem(), statement: 'x'.repeat(2001) })
        ?.statement,
    ).toBeUndefined();
    expect(
      parseCustomProblem({ ...problem(), answer: 'the solution' }),
    ).not.toHaveProperty('answer');
    for (const broken of [
      { ...problem(), id: 'lc-1' },
      { ...problem(), title: '' },
      { ...problem(), difficulty: 'insane' },
      { ...problem(), topics: [] },
      { ...problem(), createdAt: 'yesterday' },
      null,
      [],
    ]) {
      expect(parseCustomProblem(broken)).toBeNull();
    }
    expect(parseCustomProblem(problem(), { expectedId: 'u-other' })).toBeNull();
  });
});

describe('LocalFileStorageAdapter intuition-note presence / delete', () => {
  it('hasIntuitionNote sees any entry (even unparsable); deleteIntuitionNote removes it', async () => {
    const id = 'u-noted-abc123';
    expect(await adapter.hasIntuitionNote(id)).toBe(false);
    await mkdir(join(dir, 'notes'), { recursive: true });
    await writeFile(join(dir, 'notes', `${id}.md`), '');
    expect(await adapter.readIntuitionNote(id)).toBeNull();
    expect(await adapter.hasIntuitionNote(id)).toBe(true);
    await adapter.deleteIntuitionNote(id);
    expect(await adapter.hasIntuitionNote(id)).toBe(false);
    await adapter.deleteIntuitionNote(id); // missing → no-op
  });

  it('deletes a symlinked note as a link, never its target; traversal ids stay in notes/', async () => {
    const target = join(dir, 'outside.txt');
    await writeFile(target, 'keep');
    await mkdir(join(dir, 'notes'), { recursive: true });
    await symlink(target, join(dir, 'notes', 'u-link-abc123.md'));
    expect(await adapter.hasIntuitionNote('u-link-abc123')).toBe(true);
    await adapter.deleteIntuitionNote('u-link-abc123');
    expect(await readFile(target, 'utf-8')).toBe('keep');
    expect(await readdir(join(dir, 'notes'))).toEqual([]);

    await adapter.deleteIntuitionNote('../outside');
    await adapter.deleteIntuitionNote('../../outside.txt');
    expect(await readFile(target, 'utf-8')).toBe('keep');
    expect(await adapter.hasIntuitionNote('../outside')).toBe(false);
  });
});

describe('LocalFileStorageAdapter customTopic option', () => {
  it('filters topics with the injected rule BEFORE the 1–3 count, on read and write', async () => {
    const known = new Set(['arrays', 'heap', 'graphs', 'trees']);
    const scoped = new LocalFileStorageAdapter(dir, {
      customTopic: (t) => (known.has(t) ? (t as never) : null),
    });
    const p = problem({
      topics: ['arrays', 'bogus', 'heap', 'graphs'] as never,
    });
    await writeRaw(`${p.id}.json`, p);
    // Default rule: 4 slugs > 3 → skipped.
    expect(await adapter.listCustomProblems()).toEqual([]);
    // Injected rule: bogus dropped first → 3 → listed.
    expect((await scoped.readCustomProblem(p.id))?.topics).toEqual([
      'arrays',
      'heap',
      'graphs',
    ]);
    expect(await scoped.listCustomProblems()).toHaveLength(1);
    await writeRaw(`${p.id}.json`, {
      ...p,
      topics: ['arrays', 'heap', 'graphs', 'trees'],
    });
    expect(await scoped.listCustomProblems()).toEqual([]);
    await expect(
      scoped.createCustomProblem(
        problem({ id: 'u-x-abc123', topics: ['bogus'] as never }),
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe('LocalFileStorageAdapter custom problems', () => {
  it('round-trips create → read → list → write → delete', async () => {
    const p = problem();
    await adapter.createCustomProblem(p);
    expect(await adapter.readCustomProblem(p.id)).toEqual(p);
    expect(await adapter.listCustomProblems()).toEqual([p]);

    const text = await readFile(join(dir, 'problems', `${p.id}.json`), 'utf-8');
    expect(text).toBe(JSON.stringify(p, null, 2) + '\n');

    const edited = {
      ...p,
      title: 'Renamed',
      updatedAt: '2026-09-28T00:00:00.000Z',
    };
    await adapter.writeCustomProblem(edited);
    expect(await adapter.readCustomProblem(p.id)).toEqual(edited);

    await adapter.deleteCustomProblem(p.id);
    expect(await adapter.readCustomProblem(p.id)).toBeNull();
    await adapter.deleteCustomProblem(p.id); // missing → no-op
    // No temp files are left behind.
    expect(await readdir(join(dir, 'problems'))).toEqual([]);
  });

  it('creates the problems dir owner-only', async () => {
    await adapter.createCustomProblem(problem());
    const mode = (await stat(join(dir, 'problems'))).mode & 0o777;
    if (process.platform !== 'win32') expect(mode).toBe(0o700);
  });

  it('create never overwrites an existing id', async () => {
    await adapter.createCustomProblem(problem());
    await expect(
      adapter.createCustomProblem(problem({ title: 'Other' })),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect((await adapter.readCustomProblem(problem().id))?.title).toBe(
      'My problem',
    );
  });

  it('write requires an existing problem; invalid records are refused', async () => {
    await expect(adapter.writeCustomProblem(problem())).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      adapter.createCustomProblem(problem({ id: '../evil' })),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      adapter.createCustomProblem(problem({ title: '' })),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('lists by createdAt then id, skipping invalid and foreign files', async () => {
    const late = problem({
      id: 'u-b-000001',
      createdAt: '2026-09-27T12:00:00.000Z',
    });
    const early2 = problem({
      id: 'u-z-000001',
      createdAt: '2026-09-27T09:00:00.000Z',
    });
    const early1 = problem({
      id: 'u-a-000001',
      createdAt: '2026-09-27T09:00:00.000Z',
    });
    for (const p of [late, early2, early1])
      await adapter.createCustomProblem(p);
    await writeRaw('u-broken-000001.json', '{ not json');
    await writeRaw('u-mismatch-000001.json', problem({ id: 'u-other-000001' }));
    await writeRaw('notes.txt', 'hello');
    await writeRaw('lc-1.json', problem({ id: 'lc-1' }));
    await writeRaw(
      'u-tmp-000001.json.tmp-abc',
      problem({ id: 'u-tmp-000001' }),
    );
    expect((await adapter.listCustomProblems()).map((p) => p.id)).toEqual([
      'u-a-000001',
      'u-z-000001',
      'u-b-000001',
    ]);
  });

  it('validates hand-edited files on read like a write', async () => {
    await writeRaw(
      'u-edited-000001.json',
      problem({
        id: 'u-edited-000001',
        url: 'javascript:alert(1)',
        title: 'a\nb',
      }),
    );
    const read = await adapter.readCustomProblem('u-edited-000001');
    expect(read?.url).toBeUndefined();
    expect(read?.title).toBe('a b');
    // The file itself is never rewritten by a read.
    const raw = JSON.parse(
      await readFile(join(dir, 'problems', 'u-edited-000001.json'), 'utf-8'),
    ) as CustomProblem;
    expect(raw.url).toBe('javascript:alert(1)');
  });

  it('rejects traversal ids on every method', async () => {
    await writeFile(join(dir, 'secret.json'), JSON.stringify(problem()));
    for (const id of [
      '../secret',
      '..%2Fsecret',
      'u-../../secret',
      '/etc/passwd',
      'u-a/../../secret',
    ]) {
      expect(await adapter.readCustomProblem(id)).toBeNull();
      await adapter.deleteCustomProblem(id);
    }
    expect(await readFile(join(dir, 'secret.json'), 'utf-8')).toContain(
      'My problem',
    );
  });

  it('a missing store lists empty and reads null', async () => {
    expect(await adapter.listCustomProblems()).toEqual([]);
    expect(await adapter.readCustomProblem('u-x-000000')).toBeNull();
  });

  it('does not follow a symlinked problem file out of the dir on write', async () => {
    if (process.platform === 'win32') return;
    const outside = join(dir, 'outside.json');
    await writeFile(outside, 'keep');
    await mkdir(join(dir, 'problems'), { recursive: true });
    await symlink(outside, join(dir, 'problems', `${problem().id}.json`));
    // Create refuses (the name exists); write replaces the LINK, not its target.
    await expect(adapter.createCustomProblem(problem())).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await adapter.writeCustomProblem(problem());
    expect(await readFile(outside, 'utf-8')).toBe('keep');
  });
});
