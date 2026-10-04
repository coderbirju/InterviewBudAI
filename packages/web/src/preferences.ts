/**
 * User preferences (ADR 0015 D4 + the D1 fetch setting), stored in
 * `<dataDir>/preferences.json`: `{ "language": "python", "leetcodeFetch": true }`.
 *
 * Both keys are optional. The file is untrusted on read (≤ 64 KiB, a JSON
 * object); an unknown or bad value falls back to its default with one
 * warning. Unknown keys are kept on write. Writes are atomic, mode 0600.
 *
 * `IBAI_LEETCODE_FETCH` (`off`/`0`/`false` or `on`/`1`/`true`) pins the fetch
 * setting; any other non-empty value is ignored with one boot warning.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const PREFERENCES_FILE = 'preferences.json';
export const PREFERENCES_MAX_BYTES = 64 * 1024;
export const LEETCODE_FETCH_ENV = 'IBAI_LEETCODE_FETCH';

export type CodeLanguage = 'python' | 'go';
export const DEFAULT_LANGUAGE: CodeLanguage = 'python';
export const DEFAULT_LEETCODE_FETCH = true;

export function isCodeLanguage(value: unknown): value is CodeLanguage {
  return value === 'python' || value === 'go';
}

/** What `IBAI_LEETCODE_FETCH` says. */
export interface LeetCodeFetchEnv {
  /** Set when the env pins the setting. */
  readonly pinned?: boolean;
  /** One-line warning for an unrecognised value (never echoes it). */
  readonly warning?: string;
}

/** Parse `IBAI_LEETCODE_FETCH` (unset or blank → not pinned). */
export function resolveLeetCodeFetchEnv(
  env: NodeJS.ProcessEnv,
): LeetCodeFetchEnv & { readonly enabled?: boolean } {
  const raw = env[LEETCODE_FETCH_ENV];
  if (raw === undefined) return {};
  const value = raw.trim().toLowerCase();
  if (value === '') return {};
  if (value === 'off' || value === '0' || value === 'false') {
    return { pinned: true, enabled: false };
  }
  if (value === 'on' || value === '1' || value === 'true') {
    return { pinned: true, enabled: true };
  }
  return {
    warning: `ignoring ${LEETCODE_FETCH_ENV} (use on/off, 1/0 or true/false); the Settings toggle decides`,
  };
}

/** The validated preferences plus the raw object (to keep unknown keys). */
export interface StoredPreferences {
  readonly language: CodeLanguage;
  /** The stored fetch choice, or undefined when unset/invalid. */
  readonly leetcodeFetch: boolean | undefined;
  readonly raw: Record<string, unknown>;
}

/** The `GET /api/preferences` reply. */
export interface ApiPreferences {
  readonly language: CodeLanguage;
  readonly leetcodeFetch: {
    readonly enabled: boolean;
    readonly pinned: boolean;
  };
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null
    ? ((err as { code?: unknown }).code as string | undefined)
    : undefined;
}

/**
 * A per-handler preferences store: reads and writes `preferences.json` in
 * the given data folder and warns once per distinct problem.
 */
export interface PreferencesStore {
  read(dataDir: string): Promise<StoredPreferences>;
  /** The effective fetch setting (env pin first, then the file, then on). */
  fetchSetting(
    dataDir: string,
  ): Promise<{ readonly enabled: boolean; readonly pinned: boolean }>;
  view(dataDir: string): Promise<ApiPreferences>;
  /** Merge and write atomically. Throws the fs error on failure. */
  write(
    dataDir: string,
    patch: { language?: CodeLanguage; leetcodeFetch?: boolean },
  ): Promise<void>;
  readonly env: LeetCodeFetchEnv & { readonly enabled?: boolean };
}

export function createPreferencesStore(opts: {
  readonly env: NodeJS.ProcessEnv;
  readonly warn?: (line: string) => void;
}): PreferencesStore {
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  const warned = new Set<string>();
  const warnOnce = (line: string): void => {
    if (warned.has(line)) return;
    warned.add(line);
    warn(`Warning: ${line}`);
  };
  const envSetting = resolveLeetCodeFetchEnv(opts.env);

  const readRaw = async (
    dataDir: string,
  ): Promise<Record<string, unknown> | null> => {
    const file = path.join(dataDir, PREFERENCES_FILE);
    let handle: fs.FileHandle | undefined;
    try {
      const info = await fs.lstat(file);
      if (!info.isFile() || info.size > PREFERENCES_MAX_BYTES) {
        warnOnce(`ignoring ${file} (not a file of at most 64 KiB)`);
        return null;
      }
      handle = await fs.open(file, 'r');
      const buffer = Buffer.alloc(PREFERENCES_MAX_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > PREFERENCES_MAX_BYTES) {
        warnOnce(`ignoring ${file} (not a file of at most 64 KiB)`);
        return null;
      }
      const parsed: unknown = JSON.parse(
        buffer.subarray(0, bytesRead).toString('utf8'),
      );
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        warnOnce(`ignoring ${file} (not a JSON object)`);
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') return null;
      warnOnce(`ignoring ${file} (unreadable or not valid JSON)`);
      return null;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  };

  const read = async (dataDir: string): Promise<StoredPreferences> => {
    const raw = (await readRaw(dataDir)) ?? {};
    let language: CodeLanguage = DEFAULT_LANGUAGE;
    if (raw.language !== undefined) {
      if (isCodeLanguage(raw.language)) language = raw.language;
      else warnOnce(`ignoring an unknown "language" in ${PREFERENCES_FILE}`);
    }
    let leetcodeFetch: boolean | undefined;
    if (raw.leetcodeFetch !== undefined) {
      if (typeof raw.leetcodeFetch === 'boolean') {
        leetcodeFetch = raw.leetcodeFetch;
      } else {
        warnOnce(
          `ignoring a non-boolean "leetcodeFetch" in ${PREFERENCES_FILE}`,
        );
      }
    }
    return { language, leetcodeFetch, raw };
  };

  /** The env pin wins; otherwise the stored choice, default on. */
  const effectiveFetch = (
    stored: StoredPreferences,
  ): { enabled: boolean; pinned: boolean } =>
    envSetting.enabled !== undefined
      ? { enabled: envSetting.enabled, pinned: true }
      : {
          enabled: stored.leetcodeFetch ?? DEFAULT_LEETCODE_FETCH,
          pinned: false,
        };

  return {
    env: envSetting,
    read,
    async fetchSetting(dataDir) {
      return effectiveFetch(await read(dataDir));
    },
    async view(dataDir) {
      const stored = await read(dataDir);
      return {
        language: stored.language,
        leetcodeFetch: effectiveFetch(stored),
      };
    },
    async write(dataDir, patch) {
      const raw = (await readRaw(dataDir)) ?? {};
      const next: Record<string, unknown> = { ...raw };
      if (patch.language !== undefined) next.language = patch.language;
      if (patch.leetcodeFetch !== undefined) {
        next.leetcodeFetch = patch.leetcodeFetch;
      }
      const content = JSON.stringify(next, null, 2) + '\n';
      if (Buffer.byteLength(content, 'utf8') > PREFERENCES_MAX_BYTES) {
        // Only possible when unknown keys fill the file: keep ours only.
        throw Object.assign(new Error('preferences file too large'), {
          code: 'EFBIG',
        });
      }
      const file = path.join(dataDir, PREFERENCES_FILE);
      const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`;
      try {
        await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(tmp, file);
      } catch (err) {
        await fs.unlink(tmp).catch(() => undefined);
        throw err;
      }
    },
  };
}
