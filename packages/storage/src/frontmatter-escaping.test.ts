/**
 * Frontmatter string escaping in LocalFileStorageAdapter (timeComplexity,
 * spaceComplexity): round-trip, stability across repeated saves, and
 * back-compat with files written by older versions (ADR 0009 D4).
 *
 * Temp dirs only; values are synthetic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileStorageAdapter } from './local-file-adapter.js';
import type { IntuitionNote } from './index.js';

let tempDir: string;
let adapter: LocalFileStorageAdapter;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ibai-fm-escape-'));
  adapter = new LocalFileStorageAdapter(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function note(time: string, space: string): IntuitionNote {
  return {
    problemId: 'lc-1',
    content: 'body',
    lastUpdated: '2026-09-25T00:00:00.000Z',
    timeComplexity: time,
    spaceComplexity: space,
  };
}

async function roundTrip(time: string, space = time) {
  await adapter.writeIntuitionNote(note(time, space));
  return adapter.readIntuitionNote('lc-1');
}

async function writeRaw(frontmatterLines: string): Promise<void> {
  await mkdir(join(tempDir, 'notes'), { recursive: true });
  await writeFile(
    join(tempDir, 'notes', 'lc-1.md'),
    `---\nid: lc-1\nlastUpdated: 2026-01-01T00:00:00.000Z\n${frontmatterLines}\n---\nbody\n`,
    'utf-8',
  );
}

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Heavy on the characters that matter to the encoding.
const ALPHABET = [
  '"',
  '"',
  '\\',
  '\\',
  '\\',
  ':',
  '#',
  "'",
  ' ',
  ' ',
  'O',
  '(',
  ')',
  'n',
  'g',
  '-',
  '\t',
  'é',
  'Θ',
  '😀',
  ' ',
];

function randomValue(rand: () => number): string {
  const len = Math.floor(rand() * 16);
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  }
  return s;
}

/** The pre-fix writer/reader, to produce legacy files faithfully. */
function oldWrite(v: string): string {
  return `"${v.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}
function oldRead(stored: string): string {
  return stored.startsWith('"') && stored.endsWith('"') && stored.length >= 2
    ? stored.slice(1, -1)
    : stored;
}

describe('frontmatter string escaping: round-trip', () => {
  it.each([
    ['plain', 'O(n log n)'],
    ['double quotes', 'O(n) "amortized"'],
    ['only a quote', '"'],
    ['backslash', 'O(n \\log n)'],
    ['backslash before quote', 'a\\"b'],
    ['trailing backslash', 'O(n)\\'],
    ['trailing backslashes', 'O(n)\\\\\\'],
    ['colon and hash', 'TC: O(n) # worst case'],
    ['single quotes', "O(n') it's"],
    ['unicode', 'Θ(n²) — 😀'],
    ['leading/trailing spaces', '  O(1)  '],
    ['looks quoted', '"O(n)"'],
    ['frontmatter fence', '---'],
  ])('%s', async (_label, value) => {
    const got = await roundTrip(value);
    expect(got?.timeComplexity).toBe(value);
    expect(got?.spaceComplexity).toBe(value);
  });

  it('property: 500 random values round-trip exactly', async () => {
    const rand = prng(0x1bad5eed);
    for (let i = 0; i < 500; i++) {
      const time = randomValue(rand);
      const space = randomValue(rand);
      const got = await roundTrip(time, space);
      // '' reads back as "not set" (unchanged behavior).
      expect(got?.timeComplexity, JSON.stringify(time)).toBe(
        time === '' ? undefined : time,
      );
      expect(got?.spaceComplexity, JSON.stringify(space)).toBe(
        space === '' ? undefined : space,
      );
      expect(got?.content).toBe('body');
    }
  });

  it('property: repeated save/load is stable (no backslash accumulation)', async () => {
    const rand = prng(42);
    for (let i = 0; i < 100; i++) {
      const value = `x${randomValue(rand)}`;
      await adapter.writeIntuitionNote(note(value, value));
      const firstFile = await readFile(
        join(tempDir, 'notes', 'lc-1.md'),
        'utf-8',
      );
      let current = await adapter.readIntuitionNote('lc-1');
      for (let k = 0; k < 5; k++) {
        await adapter.writeIntuitionNote(current as IntuitionNote);
        current = await adapter.readIntuitionNote('lc-1');
      }
      expect(current?.timeComplexity, JSON.stringify(value)).toBe(value);
      expect(await readFile(join(tempDir, 'notes', 'lc-1.md'), 'utf-8')).toBe(
        firstFile,
      );
    }
  });

  it('values without a quote or trailing backslash are written as before', async () => {
    await adapter.writeIntuitionNote(note('O(n \\log n)', "O(1) it's: #1"));
    const file = await readFile(join(tempDir, 'notes', 'lc-1.md'), 'utf-8');
    expect(file).toContain('timeComplexity: "O(n \\log n)"\n');
    expect(file).toContain(`spaceComplexity: "O(1) it's: #1"\n`);
  });

  it('rejects CR/LF instead of silently changing the value', async () => {
    await expect(
      adapter.writeIntuitionNote(note('O(n)\nO(1)', 'O(1)')),
    ).rejects.toThrow(RangeError);
    await expect(
      adapter.writeIntuitionNote(note('O(1)', 'O(n)\r')),
    ).rejects.toThrow(RangeError);
  });
});

describe('frontmatter string escaping: files from older versions', () => {
  it('reads unquoted and plain quoted values as before', async () => {
    await writeRaw('timeComplexity: O(n)\nspaceComplexity: "O(1)"');
    const got = await adapter.readIntuitionNote('lc-1');
    expect(got?.timeComplexity).toBe('O(n)');
    expect(got?.spaceComplexity).toBe('O(1)');
  });

  it('keeps literal backslashes the old writer stored unescaped', async () => {
    await writeRaw(
      'timeComplexity: "O(n \\times m)"\nspaceComplexity: "O(1)\\"',
    );
    const got = await adapter.readIntuitionNote('lc-1');
    expect(got?.timeComplexity).toBe('O(n \\times m)');
    expect(got?.spaceComplexity).toBe('O(1)\\');
  });

  it('normalizes accumulated \\" from repeated old saves to the intended value', async () => {
    // Intended: O("n") — saved 1, 2 and 4 times by the old code.
    await writeRaw(
      'timeComplexity: "O(\\"n\\")"\nspaceComplexity: "O(\\\\"n\\\\")"',
    );
    let got = await adapter.readIntuitionNote('lc-1');
    expect(got?.timeComplexity).toBe('O("n")');
    expect(got?.spaceComplexity).toBe('O("n")');
    await writeRaw('timeComplexity: "a\\\\\\\\"b"');
    got = await adapter.readIntuitionNote('lc-1');
    expect(got?.timeComplexity).toBe('a"b');
  });

  it('simulated old save cycles: even counts normalize fully, odd counts leave a stable residue', async () => {
    const intended = 'O(n) "amortized"';
    for (let saves = 1; saves <= 6; saves++) {
      let stored = oldWrite(intended);
      for (let k = 1; k < saves; k++) stored = oldWrite(oldRead(stored));
      await writeRaw(`timeComplexity: ${stored}`);
      const got = await adapter.readIntuitionNote('lc-1');
      if (saves === 1 || saves % 2 === 0) {
        expect(got?.timeComplexity, `${saves} saves`).toBe(intended);
      } else {
        // 3, 5, … old saves are indistinguishable from an intended `\"`
        // (documented); what is read is stable from then on.
        const residue = got?.timeComplexity as string;
        await adapter.writeIntuitionNote(got as IntuitionNote);
        const again = await adapter.readIntuitionNote('lc-1');
        expect(again?.timeComplexity).toBe(residue);
      }
    }
  });

  it('a normalized legacy value is rewritten canonically on the next save', async () => {
    await writeRaw('timeComplexity: "O(\\\\"n\\\\")"');
    const got = await adapter.readIntuitionNote('lc-1');
    await adapter.writeIntuitionNote(got as IntuitionNote);
    const file = await readFile(join(tempDir, 'notes', 'lc-1.md'), 'utf-8');
    expect(file).toContain('timeComplexity: "O(\\"n\\")"\n');
    expect((await adapter.readIntuitionNote('lc-1'))?.timeComplexity).toBe(
      'O("n")',
    );
  });

  it('status is decoded the same way (quoted or not)', async () => {
    await writeRaw('status: "done"');
    expect((await adapter.readIntuitionNote('lc-1'))?.status).toBe('done');
    await writeRaw('status: to_revisit');
    expect((await adapter.readIntuitionNote('lc-1'))?.status).toBe(
      'to_revisit',
    );
  });
});
