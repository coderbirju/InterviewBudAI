/**
 * The problem-statement cache (ADR 0015 D1): `<dataDir>/problem-cache/<id>.json`,
 * one file per CATALOG id, holding only the SANITIZED statement (never raw
 * HTML), the kept snippets and the user's pasted text.
 *
 * - `problemCachePath` runs after the catalog lookup, accepts only
 *   `^lc-[0-9]+$` ids and checks the joined path stays inside the folder.
 * - The folder is 0700, files 0600, written atomically (temp + rename), and
 *   gets a `.gitignore` of `*` so a git-tracked data folder never commits
 *   LeetCode text by accident.
 * - Caps are UTF-8 bytes. The writer refuses anything the reader would
 *   refuse (> {@link CACHE_FILE_MAX_BYTES}), so the app never writes a file
 *   it would not read back.
 * - A cache file is untrusted on read: size, JSON, exact shape, per-field
 *   caps and `isStatementTree()`; anything else reads as "not cached".
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isStatementTree, utf8ByteLength } from './statement-tree.js';
import type { StatementNode } from './statement-tree.js';
import { LEETCODE_FIELD_MAX_BYTES, SLUG_PATTERN } from './leetcode.js';

export const PROBLEM_CACHE_DIR = 'problem-cache';
/** Whole cache file (the read cap, also checked before every write). */
export const CACHE_FILE_MAX_BYTES = 512 * 1024;
/** Pasted statement text. */
export const PASTED_TEXT_MAX_BYTES = 64 * 1024;
/** Only catalog ids are cached. */
export const CACHE_ID_PATTERN = /^lc-[0-9]+$/;
/** Longest stored title (characters). */
const TITLE_MAX = 300;

/** The stored record (`schema: 1`). */
export interface ProblemCacheEntry {
  readonly schema: 1;
  readonly id: string;
  readonly titleSlug: string;
  readonly title: string;
  readonly isPaidOnly: boolean;
  /** When LeetCode was last asked; null for a paste-only record. */
  readonly fetchedAt: string | null;
  readonly blocks: StatementNode[] | null;
  readonly truncated: boolean;
  readonly exampleTestcases: string | null;
  readonly snippets: {
    readonly python: string | null;
    readonly go: string | null;
  };
  readonly pastedText: string | null;
}

const ENTRY_KEYS = [
  'schema',
  'id',
  'titleSlug',
  'title',
  'isPaidOnly',
  'fetchedAt',
  'blocks',
  'truncated',
  'exampleTestcases',
  'snippets',
  'pastedText',
] as const;

/**
 * `<dataDir>/problem-cache/<id>.json` for a catalog id. Throws on any id that
 * is not `^lc-[0-9]+$`, or if the result would leave the cache folder.
 */
export function problemCachePath(dataDir: string, id: string): string {
  if (!CACHE_ID_PATTERN.test(id)) {
    throw new RangeError('invalid problem cache id');
  }
  const dir = path.resolve(dataDir, PROBLEM_CACHE_DIR);
  const file = path.resolve(dir, `${id}.json`);
  const rel = path.relative(dir, file);
  if (
    rel === '' ||
    rel.startsWith('..') ||
    path.isAbsolute(rel) ||
    rel.includes(path.sep)
  ) {
    throw new RangeError('problem cache path escapes its folder');
  }
  return file;
}

function nullableCapped(value: unknown, maxBytes: number): boolean {
  return (
    value === null ||
    (typeof value === 'string' && utf8ByteLength(value) <= maxBytes)
  );
}

function isIsoTimestamp(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    !Number.isNaN(Date.parse(value))
  );
}

/** Validate an untrusted parsed value as the entry for `expectedId`. */
export function parseProblemCacheEntry(
  value: unknown,
  expectedId: string,
): ProblemCacheEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (
    keys.length !== ENTRY_KEYS.length ||
    !ENTRY_KEYS.every((k) => keys.includes(k))
  ) {
    return null;
  }
  if (v.schema !== 1 || v.id !== expectedId) return null;
  if (typeof v.titleSlug !== 'string' || !SLUG_PATTERN.test(v.titleSlug)) {
    return null;
  }
  if (typeof v.title !== 'string' || v.title.length > TITLE_MAX) return null;
  if (typeof v.isPaidOnly !== 'boolean') return null;
  if (typeof v.truncated !== 'boolean') return null;
  if (v.fetchedAt !== null && !isIsoTimestamp(v.fetchedAt)) return null;
  if (v.blocks !== null && !isStatementTree(v.blocks)) return null;
  if (!nullableCapped(v.exampleTestcases, LEETCODE_FIELD_MAX_BYTES)) {
    return null;
  }
  if (!nullableCapped(v.pastedText, PASTED_TEXT_MAX_BYTES)) return null;
  const s = v.snippets;
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return null;
  const snippets = s as Record<string, unknown>;
  const snippetKeys = Object.keys(snippets);
  if (
    snippetKeys.length !== 2 ||
    !snippetKeys.includes('python') ||
    !snippetKeys.includes('go') ||
    !nullableCapped(snippets.python, LEETCODE_FIELD_MAX_BYTES) ||
    !nullableCapped(snippets.go, LEETCODE_FIELD_MAX_BYTES)
  ) {
    return null;
  }
  return value as ProblemCacheEntry;
}

/**
 * Read the cache entry for a catalog id. Missing, too large, not a regular
 * file, unparseable or the wrong shape → null ("not cached").
 */
export async function readProblemCache(
  dataDir: string,
  id: string,
): Promise<ProblemCacheEntry | null> {
  const file = problemCachePath(dataDir, id);
  let handle: fs.FileHandle | undefined;
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.size > CACHE_FILE_MAX_BYTES) return null;
    handle = await fs.open(file, 'r');
    // Read one byte past the cap, in case the file grew after the lstat.
    const buffer = Buffer.alloc(CACHE_FILE_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > CACHE_FILE_MAX_BYTES) return null;
    const parsed: unknown = JSON.parse(
      buffer.subarray(0, bytesRead).toString('utf8'),
    );
    return parseProblemCacheEntry(parsed, id);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** The serialized form, or null when it is over the read cap. */
export function serializeProblemCacheEntry(
  entry: ProblemCacheEntry,
): string | null {
  const text = JSON.stringify(entry, null, 2) + '\n';
  return Buffer.byteLength(text, 'utf8') <= CACHE_FILE_MAX_BYTES ? text : null;
}

/** Why a write did not happen. */
export type CacheWriteResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'too_large' | 'read_only' | 'error';
    };

function errnoCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null
    ? ((err as { code?: unknown }).code as string | undefined)
    : undefined;
}

const READ_ONLY_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

/**
 * Write the entry atomically. Creates `problem-cache/` (0700) and its
 * `.gitignore` inside an EXISTING data folder; never creates the data folder.
 * Never throws.
 */
export async function writeProblemCache(
  dataDir: string,
  entry: ProblemCacheEntry,
): Promise<CacheWriteResult> {
  const file = problemCachePath(dataDir, entry.id);
  const content = serializeProblemCacheEntry(entry);
  if (content === null) return { ok: false, reason: 'too_large' };
  const dir = path.dirname(file);
  try {
    const info = await fs.stat(dataDir);
    if (!info.isDirectory()) return { ok: false, reason: 'error' };
    await fs.mkdir(dir, { mode: 0o700 });
  } catch (err) {
    const code = errnoCode(err);
    if (code !== 'EEXIST') {
      return {
        ok: false,
        reason:
          code !== undefined && READ_ONLY_CODES.has(code)
            ? 'read_only'
            : 'error',
      };
    }
  }
  const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`;
  try {
    const dirInfo = await fs.lstat(dir);
    if (!dirInfo.isDirectory()) return { ok: false, reason: 'error' };
    // `wx`: an existing .gitignore (the user's own) is left as it is.
    await fs
      .writeFile(path.join(dir, '.gitignore'), '*\n', {
        mode: 0o600,
        flag: 'wx',
      })
      .catch((err: unknown) => {
        if (errnoCode(err) !== 'EEXIST') throw err;
      });
    await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, file);
    return { ok: true };
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    const code = errnoCode(err);
    return {
      ok: false,
      reason:
        code !== undefined && READ_ONLY_CODES.has(code) ? 'read_only' : 'error',
    };
  }
}

/**
 * Per-process queue for cache read-modify-writes, so a paste and a fetch
 * finishing together cannot lose each other's field.
 */
let cacheWrites: Promise<unknown> = Promise.resolve();

export function serializedCacheWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = cacheWrites.then(task, task);
  cacheWrites = run.catch(() => undefined);
  return run;
}
