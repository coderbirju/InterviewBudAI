import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalFileStorageAdapter,
  PRACTICE_EVENTS_MAX,
  PRACTICE_SEEN_MAX,
  PRACTICE_SIGNALS_FILE,
  addPracticeEvent,
  parsePracticeSignals,
  sanitizePracticeEvent,
} from './index.js';
import type { IsoTimestamp, PracticeEvent } from './index.js';

function event(over: Partial<PracticeEvent> = {}): PracticeEvent {
  return {
    problemId: 'lc-1',
    topics: ['arrays'],
    assessment: 'partial',
    readyToCode: false,
    miss: 'complexity',
    status: 'none',
    first: false,
    at: '2026-10-01T12:00:00.000Z' as IsoTimestamp,
    ...over,
  };
}

describe('practice signals — pure rules (ADR 0013 D3)', () => {
  it('sanitizes an event: unknown keys, bad codes, miss on on_track', () => {
    const raw = {
      ...event({ assessment: 'on_track', readyToCode: true }),
      note: 'text must never be kept',
    };
    const clean = sanitizePracticeEvent(raw)!;
    expect(clean).not.toHaveProperty('note');
    expect(clean).not.toHaveProperty('miss');
    expect(clean.readyToCode).toBe(true);
    expect(
      sanitizePracticeEvent({ ...event(), miss: 'nope' }),
    ).not.toHaveProperty('miss');
    expect(
      sanitizePracticeEvent({
        ...event(),
        assessment: 'partial',
        readyToCode: true,
      })!.readyToCode,
    ).toBe(false);
    expect(
      sanitizePracticeEvent({ ...event(), assessment: 'great' }),
    ).toBeNull();
    expect(sanitizePracticeEvent({ ...event(), status: 'x' })).toBeNull();
    expect(sanitizePracticeEvent({ ...event(), at: 'never' })).toBeNull();
    expect(sanitizePracticeEvent({ ...event(), problemId: '' })).toBeNull();
    expect(
      sanitizePracticeEvent({
        ...event(),
        topics: ['a', 'a', 'b', 'c', 'd', 'e', 'f', 1],
      })!.topics,
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('decides `first` from seen, ignoring the caller value', () => {
    const a = addPracticeEvent(null, event({ first: false }));
    expect(a.events[0]!.first).toBe(true);
    const b = addPracticeEvent(a, event({ first: true }));
    expect(b.events[1]!.first).toBe(false);
    expect(b.seen).toEqual(['lc-1']);
  });

  it('keeps the newest 500 events, while seen keeps firstCheck after roll-off', () => {
    let s = addPracticeEvent(null, event({ problemId: 'old' }));
    for (let i = 0; i < PRACTICE_EVENTS_MAX; i++) {
      s = addPracticeEvent(s, event({ problemId: `p-${i % 7}` }));
    }
    expect(s.events).toHaveLength(PRACTICE_EVENTS_MAX);
    expect(s.events.some((e) => e.problemId === 'old')).toBe(false);
    s = addPracticeEvent(s, event({ problemId: 'old' }));
    expect(s.events[s.events.length - 1]!.first).toBe(false);
  });

  it('caps seen at 5000, dropping the least recently checked', () => {
    let s = addPracticeEvent(null, event({ problemId: 'p-0' }));
    s = {
      ...s,
      seen: Array.from({ length: PRACTICE_SEEN_MAX }, (_, i) => `p-${i}`),
    };
    // Re-check p-0 → most recent; a new problem then drops p-1.
    s = addPracticeEvent(s, event({ problemId: 'p-0' }));
    s = addPracticeEvent(s, event({ problemId: 'new' }));
    expect(s.seen).toHaveLength(PRACTICE_SEEN_MAX);
    expect(s.seen).not.toContain('p-1');
    expect(s.seen).toContain('p-0');
    expect(s.seen[s.seen.length - 1]).toBe('new');
  });

  it('parse: wrong JSON or top-level shape is corrupt; bad events are skipped', () => {
    expect(parsePracticeSignals('{')).toBe('corrupt');
    expect(parsePracticeSignals('[]')).toBe('corrupt');
    expect(parsePracticeSignals('{"version":2,"events":[],"seen":[]}')).toBe(
      'corrupt',
    );
    expect(parsePracticeSignals('{"version":1,"events":{},"seen":[]}')).toBe(
      'corrupt',
    );
    const parsed = parsePracticeSignals(
      JSON.stringify({
        version: 1,
        updatedAt: 'x',
        events: [event(), { bad: true }, 7],
        seen: ['lc-1', 3, 'lc-1', 'lc-2'],
      }),
    );
    expect(parsed).not.toBe('corrupt');
    if (parsed === 'corrupt') return;
    expect(parsed.events).toHaveLength(1);
    expect(parsed.seen).toEqual(['lc-1', 'lc-2']);
    expect(parsed.updatedAt).toBe(event().at);
  });
});

describe('LocalFileStorageAdapter practice signals (ADR 0013 D3)', () => {
  let dir: string;
  let adapter: LocalFileStorageAdapter;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ibai-practice-'));
    adapter = new LocalFileStorageAdapter(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('missing file reads as null; append round-trips; no text is stored', async () => {
    expect(await adapter.readPracticeSignals()).toBeNull();
    const out = await adapter.appendPracticeEvent(event());
    expect(out.events[0]!.first).toBe(true);
    const read = await adapter.readPracticeSignals();
    expect(read).toEqual(out);
    const text = await readFile(join(dir, PRACTICE_SIGNALS_FILE), 'utf-8');
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      'events',
      'seen',
      'updatedAt',
      'version',
    ]);
    // No temp file left behind.
    expect((await readdir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  it('concurrent appends and a reset are serialised by one queue', async () => {
    const results = await Promise.all([
      adapter.appendPracticeEvent(event({ problemId: 'a' })),
      adapter.appendPracticeEvent(event({ problemId: 'b' })),
      adapter.resetPracticeSignals(),
      adapter.appendPracticeEvent(event({ problemId: 'a' })),
    ]);
    expect(results[1]!.events).toHaveLength(2);
    const after = await adapter.readPracticeSignals();
    // The reset ran between: the third append starts a fresh log, first again.
    expect(after!.events).toHaveLength(1);
    expect(after!.events[0]!.first).toBe(true);
    expect(after!.seen).toEqual(['a']);
  });

  it('a second adapter on the same dir shares the queue', async () => {
    const other = new LocalFileStorageAdapter(dir);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? adapter : other).appendPracticeEvent(
          event({ problemId: `p-${i}` }),
        ),
      ),
    );
    expect((await adapter.readPracticeSignals())!.events).toHaveLength(10);
  });

  it('a corrupt file reads as empty and is renamed aside on the next append', async () => {
    const file = join(dir, PRACTICE_SIGNALS_FILE);
    await writeFile(file, 'not json', 'utf-8');
    expect(await adapter.readPracticeSignals()).toBeNull();
    const out = await adapter.appendPracticeEvent(event());
    expect(out.events).toHaveLength(1);
    const names = await readdir(dir);
    const corrupt = names.filter((n) =>
      n.startsWith(`${PRACTICE_SIGNALS_FILE}.corrupt-`),
    );
    expect(corrupt).toHaveLength(1);
    expect(await readFile(join(dir, corrupt[0]!), 'utf-8')).toBe('not json');
    // Reset removes only the practice file, never the corrupt copy.
    await adapter.resetPracticeSignals();
    const left = await readdir(dir);
    expect(left).toContain(corrupt[0]);
    expect(left).not.toContain(PRACTICE_SIGNALS_FILE);
    // Reset of a missing file is a no-op.
    await expect(adapter.resetPracticeSignals()).resolves.toBeUndefined();
  });

  it('rejects an invalid event without writing', async () => {
    await expect(
      adapter.appendPracticeEvent({ ...event(), assessment: 'x' } as never),
    ).rejects.toBeInstanceOf(RangeError);
    expect(await adapter.readPracticeSignals()).toBeNull();
  });
});
