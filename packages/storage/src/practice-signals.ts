/**
 * `practice-signals.json` — the "Check my intuition" practice log (ADR 0013
 * D3). A bounded event log of STRUCTURED outcomes plus the set of problems
 * ever checked; it never holds note, reference or feedback text.
 *
 * - The file is UNTRUSTED on read: malformed events are skipped, unknown miss
 *   codes dropped. A file that does not parse, or has the wrong top-level
 *   shape, reads as empty and is renamed aside (`.corrupt-<ts>`, never
 *   deleted) by the next append.
 * - Append and reset share ONE per-process write queue per file, so they can
 *   never interleave. Writes go to a temp file, then rename over the target.
 */

import { readFile, rename, unlink, writeFile, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type {
  CoachAssessment,
  IsoTimestamp,
  PracticeEvent,
  PracticeSignals,
} from './index.js';
import {
  PRACTICE_EVENTS_MAX,
  PRACTICE_SEEN_MAX,
  isNoteStatus,
} from './index.js';
import { isMissCode } from './competency.js';

/** The file name inside the data dir. */
export const PRACTICE_SIGNALS_FILE = 'practice-signals.json';

const ASSESSMENTS: ReadonlySet<string> = new Set<CoachAssessment>([
  'on_track',
  'partial',
  'off_track',
]);

/** True for one of the three coach assessments. */
export function isCoachAssessment(value: unknown): value is CoachAssessment {
  return typeof value === 'string' && ASSESSMENTS.has(value);
}

const MAX_ID_LENGTH = 200;
const MAX_TOPICS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoish(value: unknown): value is IsoTimestamp {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    !Number.isNaN(Date.parse(value))
  );
}

/**
 * Validate one untrusted event. Returns a clean copy (unknown keys dropped,
 * topics de-duplicated and capped, an unknown or `on_track` miss dropped) or
 * `null` when a required field is missing or wrong. Pure.
 */
export function sanitizePracticeEvent(raw: unknown): PracticeEvent | null {
  if (!isRecord(raw)) return null;
  const {
    problemId,
    topics,
    assessment,
    readyToCode,
    miss,
    status,
    first,
    at,
  } = raw;
  if (
    typeof problemId !== 'string' ||
    problemId.length === 0 ||
    problemId.length > MAX_ID_LENGTH ||
    !isCoachAssessment(assessment) ||
    typeof readyToCode !== 'boolean' ||
    !isNoteStatus(status) ||
    typeof first !== 'boolean' ||
    !isIsoish(at) ||
    !Array.isArray(topics)
  ) {
    return null;
  }
  const cleanTopics: string[] = [];
  for (const t of topics) {
    if (
      typeof t === 'string' &&
      t.length > 0 &&
      t.length <= MAX_ID_LENGTH &&
      !cleanTopics.includes(t)
    ) {
      cleanTopics.push(t);
    }
    if (cleanTopics.length >= MAX_TOPICS) break;
  }
  const keepMiss = isMissCode(miss) && assessment !== 'on_track';
  return {
    problemId,
    topics: cleanTopics,
    assessment,
    readyToCode: assessment === 'on_track' && readyToCode,
    ...(keepMiss ? { miss } : {}),
    status,
    first,
    at,
  };
}

/** The `seen` list cleaned: strings only, unique (last wins), capped. */
function sanitizeSeen(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  const index = new Set<string>();
  for (let i = raw.length - 1; i >= 0; i--) {
    const id = raw[i];
    if (
      typeof id === 'string' &&
      id.length > 0 &&
      id.length <= MAX_ID_LENGTH &&
      !index.has(id)
    ) {
      index.add(id);
      out.push(id);
    }
  }
  return out.reverse().slice(-PRACTICE_SEEN_MAX);
}

/**
 * Parse untrusted file text. `'corrupt'` when it is not JSON or the top level
 * is not `{ version: 1, events: [], seen: [] }`; otherwise a clean dataset
 * (bad events skipped, the event log capped to the newest 500). Pure.
 */
export function parsePracticeSignals(
  text: string,
): PracticeSignals | 'corrupt' {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'corrupt';
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.events) ||
    !Array.isArray(parsed.seen)
  ) {
    return 'corrupt';
  }
  const events: PracticeEvent[] = [];
  for (const raw of parsed.events) {
    const event = sanitizePracticeEvent(raw);
    if (event !== null) events.push(event);
  }
  const trimmed = events.slice(-PRACTICE_EVENTS_MAX);
  return {
    version: 1,
    updatedAt: isIsoish(parsed.updatedAt)
      ? parsed.updatedAt
      : trimmed[trimmed.length - 1]?.at ??
        (new Date(0).toISOString() as IsoTimestamp),
    events: trimmed,
    seen: sanitizeSeen(parsed.seen),
  };
}

/**
 * Add one event to a dataset (pure). `first` is decided HERE from `seen`
 * (the caller's value is ignored); the problem moves to the end of `seen`
 * (most recent), which is capped by dropping the least recently checked.
 */
export function addPracticeEvent(
  current: PracticeSignals | null,
  event: PracticeEvent,
): PracticeSignals {
  const seen = (current?.seen ?? []).filter((id) => id !== event.problemId);
  const first = seen.length === (current?.seen ?? []).length;
  seen.push(event.problemId);
  const stored: PracticeEvent = { ...event, first };
  const events = [...(current?.events ?? []), stored].slice(
    -PRACTICE_EVENTS_MAX,
  );
  return {
    version: 1,
    updatedAt: event.at,
    events,
    seen: seen.slice(-PRACTICE_SEEN_MAX),
  };
}

// ---------------------------------------------------------------------------
// File I/O (one write queue per file, per process)
// ---------------------------------------------------------------------------

const queues = new Map<string, Promise<unknown>>();

/** Run `task` after every earlier queued task for `key` settles. */
function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** File text, or `null` when the file does not exist. */
async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/** Tolerant read: missing, unreadable or corrupt ⇒ `null`. Never throws. */
export async function readPracticeSignalsFile(
  filePath: string,
): Promise<PracticeSignals | null> {
  try {
    const text = await readTextOrNull(filePath);
    if (text === null) return null;
    const parsed = parsePracticeSignals(text);
    return parsed === 'corrupt' ? null : parsed;
  } catch {
    return null;
  }
}

/** A free `<file>.corrupt-<YYYYMMDDTHHMMSSZ>[-N]` name. */
async function corruptName(filePath: string, now: Date): Promise<string> {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
  for (let n = 1; ; n++) {
    const candidate = `${filePath}.corrupt-${stamp}${n === 1 ? '' : `-${n}`}`;
    try {
      await lstat(candidate);
    } catch (err) {
      if (isEnoent(err)) return candidate;
      throw err;
    }
  }
}

/** Write via a temp file in the same dir, then rename over the target. */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, content, { encoding: 'utf-8', mode: 0o600 });
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Queued read-modify-write append (see `StorageAdapter.appendPracticeEvent`). */
export function appendPracticeEventFile(
  filePath: string,
  event: PracticeEvent,
): Promise<PracticeSignals> {
  const clean = sanitizePracticeEvent(event);
  if (clean === null) {
    return Promise.reject(new RangeError('invalid practice event'));
  }
  return enqueue(filePath, async () => {
    const text = await readTextOrNull(filePath);
    let current: PracticeSignals | null = null;
    if (text !== null) {
      const parsed = parsePracticeSignals(text);
      if (parsed === 'corrupt') {
        // Keep the bad file for the user; start a fresh log.
        await rename(filePath, await corruptName(filePath, new Date()));
      } else {
        current = parsed;
      }
    }
    const next = addPracticeEvent(current, clean);
    await atomicWrite(filePath, JSON.stringify(next, null, 2) + '\n');
    return next;
  });
}

/** Queued delete of the practice log only. Missing ⇒ no-op. */
export function resetPracticeSignalsFile(
  filePath: string,
  beforeDelete?: () => Promise<void>,
): Promise<void> {
  return enqueue(filePath, async () => {
    // Inside the queue: no append can land between the backup and the delete.
    if (beforeDelete !== undefined) await beforeDelete();
    try {
      await unlink(filePath);
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  });
}
