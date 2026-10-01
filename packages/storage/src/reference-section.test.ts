/**
 * ADR 0013 D4 — the Reference approach section: the shared split/join and
 * the local-file adapter round-trip (temp dirs, no network).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileStorageAdapter } from './local-file-adapter.js';
import {
  REFERENCE_MARKER,
  containsReferenceMarker,
  joinReferenceSection,
  splitReferenceSection,
  stripReferenceMarkers,
} from './index.js';

describe('reference section scan is linear-time on untrusted text', () => {
  it('1 MiB of inner spaces/tabs/CRs < 200 ms', () => {
    const text = `a${' \t\r'.repeat(350_000)}b\n${REFERENCE_MARKER}`;
    const start = performance.now();
    containsReferenceMarker(text);
    splitReferenceSection(text);
    stripReferenceMarkers(text);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('splitReferenceSection / joinReferenceSection', () => {
  it('no marker → body unchanged, no reference', () => {
    expect(splitReferenceSection('a\n\n## Reference approach\nkept')).toEqual({
      content: 'a\n\n## Reference approach\nkept',
    });
    expect(joinReferenceSection('a', undefined)).toBe('a');
    expect(joinReferenceSection('a', '  \n ')).toBe('a');
  });

  it('writes the exact ADR layout and round-trips', () => {
    const body = joinReferenceSection('my note', 'line 1\nline 2');
    expect(body).toBe(
      `my note\n\n${REFERENCE_MARKER}\n## Reference approach\n\nline 1\nline 2`,
    );
    expect(splitReferenceSection(body)).toEqual({
      content: 'my note',
      referenceApproach: 'line 1\nline 2',
    });
  });

  it('empty content round-trips', () => {
    const body = joinReferenceSection('', 'ref');
    expect(splitReferenceSection(body)).toEqual({
      content: '',
      referenceApproach: 'ref',
    });
  });

  it('tolerates CRLF and trailing spaces/tabs on the marker line', () => {
    const body = `note\r\n\r\n${REFERENCE_MARKER} \t\r\n## Reference approach\r\n\r\nref text\r\n`;
    const split = splitReferenceSection(body);
    expect(split.content).toBe('note\r');
    // The reference's trailing `\r`s are trimmed on read.
    expect(split.referenceApproach).toBe('ref text');
    expect(
      splitReferenceSection(`n\r\n${REFERENCE_MARKER}\r\nline 1\r\nline 2\r`)
        .referenceApproach,
    ).toBe('line 1\nline 2');
  });

  it('uses the LAST marker; the heading is optional', () => {
    const body = `a\n${REFERENCE_MARKER}\nb\n\n${REFERENCE_MARKER}\nonly ref`;
    expect(splitReferenceSection(body)).toEqual({
      content: `a\n${REFERENCE_MARKER}\nb`,
      referenceApproach: 'only ref',
    });
  });

  it('a marker with an empty section → no reference', () => {
    expect(
      splitReferenceSection(
        `a\n\n${REFERENCE_MARKER}\n## Reference approach\n\n`,
      ),
    ).toEqual({
      content: 'a',
    });
  });

  it('content holding a marker still round-trips (empty section written)', () => {
    const content = `x\n${REFERENCE_MARKER}\ny`;
    expect(splitReferenceSection(joinReferenceSection(content))).toEqual({
      content,
    });
    expect(splitReferenceSection(joinReferenceSection(content, 'r'))).toEqual({
      content,
      referenceApproach: 'r',
    });
  });

  it('a marker line in the reference is a RangeError', () => {
    expect(() => joinReferenceSection('a', `x\n${REFERENCE_MARKER}`)).toThrow(
      RangeError,
    );
  });

  it('containsReferenceMarker / stripReferenceMarkers', () => {
    expect(containsReferenceMarker(`a\n${REFERENCE_MARKER}\r`)).toBe(true);
    expect(containsReferenceMarker(`a ${REFERENCE_MARKER}`)).toBe(false);
    expect(stripReferenceMarkers(`a\n${REFERENCE_MARKER}\nb`)).toBe('a\nb');
  });
});

describe('LocalFileStorageAdapter — referenceApproach (ADR 0013 D4)', () => {
  let dir: string;
  let adapter: LocalFileStorageAdapter;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ibai-ref-'));
    adapter = new LocalFileStorageAdapter(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips; content never includes the section', async () => {
    await adapter.writeIntuitionNote({
      problemId: 'lc-1',
      content: 'hash the complement',
      lastUpdated: '2026-10-01T00:00:00.000Z',
      status: 'done',
      referenceApproach: 'one pass, store index by value',
    });
    const raw = await readFile(join(dir, 'notes', 'lc-1.md'), 'utf-8');
    expect(raw).toContain(`\n${REFERENCE_MARKER}\n## Reference approach\n\n`);
    const note = await adapter.readIntuitionNote('lc-1');
    expect(note?.content).toBe('hash the complement');
    expect(note?.referenceApproach).toBe('one pass, store index by value');
    expect(note?.status).toBe('done');
  });

  it('an old note without the marker reads unchanged (undefined)', async () => {
    await mkdir(join(dir, 'notes'), { recursive: true });
    await writeFile(
      join(dir, 'notes', 'lc-2.md'),
      '---\nid: lc-2\nlastUpdated: 2026-01-01T00:00:00.000Z\n---\nbody\n\n## Reference approach\nfrom csv\n',
    );
    const note = await adapter.readIntuitionNote('lc-2');
    expect(note?.content).toBe('body\n\n## Reference approach\nfrom csv');
    expect(note?.referenceApproach).toBeUndefined();
    expect(note && 'referenceApproach' in note).toBe(false);
  });

  it('reads a CRLF-edited marker', async () => {
    await mkdir(join(dir, 'notes'), { recursive: true });
    await writeFile(
      join(dir, 'notes', 'lc-3.md'),
      `---\nid: lc-3\nlastUpdated: 2026-01-01T00:00:00.000Z\n---\nbody\r\n${REFERENCE_MARKER}\r\nref\n`,
    );
    const note = await adapter.readIntuitionNote('lc-3');
    expect(note?.content).toBe('body\r');
    expect(note?.referenceApproach).toBe('ref');
  });

  it('a note without a reference writes no section', async () => {
    await adapter.writeIntuitionNote({
      problemId: 'lc-4',
      content: 'plain',
      lastUpdated: '2026-10-01T00:00:00.000Z',
    });
    const raw = await readFile(join(dir, 'notes', 'lc-4.md'), 'utf-8');
    expect(raw).not.toContain(REFERENCE_MARKER);
  });
});
