/**
 * Problem statement + preferences routes (ADR 0015 D1/D4, "API"):
 *
 *   GET  /api/problems/:id/statement        — cache only, never calls LeetCode
 *   POST /api/problems/:id/statement/fetch  { refresh? } — the one request
 *   PUT  /api/problems/:id/statement        { text } — save / clear a paste
 *   GET  /api/preferences
 *   PUT  /api/preferences                   { language?, leetcodeFetch? }
 *
 * The Host / Origin / JSON content-type prechecks and the 1 MiB body cap
 * already ran in the handler. The network call is a POST because a GET skips
 * the same-origin check (any site could make the user's machine fetch). `:id`
 * is checked against the merged source first; only catalog ids are fetched
 * or cached, and the slug always comes from the catalog entry's `url`.
 */

import type { CurriculumSource } from '@ibai/curriculum';
import type { StorageAdapter } from '@ibai/storage';
import type { HandlerResponse } from './handler.js';
import { loadProblemSource } from './problems.js';
import type { ProblemView } from './problems.js';
import {
  CACHE_ID_PATTERN,
  PASTED_TEXT_MAX_BYTES,
  readProblemCache,
  serializedCacheWrite,
  writeProblemCache,
} from './problem-cache.js';
import type { CacheWriteResult, ProblemCacheEntry } from './problem-cache.js';
import {
  createLeetCodeLimiter,
  fetchLeetCodeQuestion,
  slugFromCatalogUrl,
} from './leetcode.js';
import type { LeetCodeLimiter } from './leetcode.js';
import { sanitizeStatementHtml } from './statement-sanitize.js';
import type { StatementNode } from './statement-tree.js';
import {
  LEETCODE_FETCH_ENV,
  createPreferencesStore,
  isCodeLanguage,
} from './preferences.js';
import type { CodeLanguage, PreferencesStore } from './preferences.js';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export type StatementState =
  | 'ready'
  | 'not-cached'
  | 'disabled'
  | 'premium'
  | 'unavailable';

export interface ApiProblemStatement {
  readonly id: string;
  readonly title: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly url: string | null;
  readonly custom: boolean;
  readonly state: StatementState;
  readonly source: 'leetcode' | 'pasted' | 'custom' | null;
  readonly blocks: StatementNode[] | null;
  readonly text: string | null;
  readonly exampleTestcases: string | null;
  readonly snippets: {
    readonly python: string | null;
    readonly go: string | null;
  };
  readonly fetchedAt: string | null;
  readonly truncated: boolean;
  readonly cached: boolean;
  readonly fetch: { readonly enabled: boolean; readonly pinned: boolean };
}

/** Fixed error texts (LeetCode's reply is never echoed). */
export const STATEMENT_ERRORS = {
  fetch_disabled: 'Fetching is turned off in Settings.',
  not_found: 'LeetCode has no problem at this link.',
  rate_limited: 'Too many LeetCode requests. Try again shortly.',
  fetch_failed: 'LeetCode could not be reached.',
  fetch_timeout: 'LeetCode did not answer in time.',
} as const;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

/** Per-process services (the handler makes one set). */
export interface StatementServices {
  readonly preferences: PreferencesStore;
  readonly limiter: LeetCodeLimiter;
  /** Injected in tests (no real network); default: global fetch at call time. */
  readonly fetchImpl?: typeof fetch;
  /** App version for the User-Agent. */
  readonly version: string;
  /** LeetCode deadline override (tests). */
  readonly timeoutMs?: number;
}

export interface StatementRouteDeps {
  readonly catalog: CurriculumSource;
  readonly dataDir: string;
  /** Storage for `dataDir`, or null when the folder does not exist. */
  readonly storage: StorageAdapter | null;
  readonly services: StatementServices;
  readonly now?: () => Date;
  /** ADR 0009 D4: the format version when the folder is read-only, else null. */
  readonly readOnlyFormat?: () => number | null;
}

let defaultServices: StatementServices | undefined;

/** Fallback for callers that inject none (the handler always does). */
export function defaultStatementServices(): StatementServices {
  defaultServices ??= {
    preferences: createPreferencesStore({ env: process.env }),
    limiter: createLeetCodeLimiter(),
    version: 'unknown',
  };
  return defaultServices;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(status: number, payload: unknown): HandlerResponse {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  };
}

const STATEMENT_PATH = /^\/api\/problems\/([^/]+)\/statement(\/fetch)?$/;
export const PREFERENCES_PATH = '/api/preferences';

/** Is this a path these routes own? */
export function isStatementRoute(pathname: string): boolean {
  return pathname === PREFERENCES_PATH || STATEMENT_PATH.test(pathname);
}

/** Parse a JSON object body with only `allowed` keys (`allowEmpty`: none → {}). */
function parseBody(
  raw: string | undefined,
  allowed: readonly string[],
  allowEmpty: boolean,
): Record<string, unknown> | HandlerResponse {
  if (allowEmpty && (raw === undefined || raw.trim() === '')) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '');
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return json(400, { error: 'invalid JSON body' });
  }
  const input = parsed as Record<string, unknown>;
  const unknown = Object.keys(input).find((k) => !allowed.includes(k));
  if (unknown !== undefined) {
    return json(400, { error: `unknown field: ${unknown}` });
  }
  return input;
}

function isResponse(
  value: Record<string, unknown> | HandlerResponse,
): value is HandlerResponse {
  return typeof value.status === 'number' && typeof value.body === 'string';
}

const NO_SNIPPETS = { python: null, go: null } as const;

/** "Which text is shown" (ADR 0015 D1): a paste wins, snippets are kept. */
export function catalogStatement(
  problem: ProblemView,
  entry: ProblemCacheEntry | null,
  fetch: { readonly enabled: boolean; readonly pinned: boolean },
  cached: boolean,
): ApiProblemStatement {
  let state: StatementState = 'ready';
  let source: ApiProblemStatement['source'] = null;
  let blocks: StatementNode[] | null = null;
  let text: string | null = null;
  let truncated = false;
  if (entry !== null && entry.pastedText !== null) {
    source = 'pasted';
    text = entry.pastedText;
  } else if (entry !== null && entry.blocks !== null) {
    source = 'leetcode';
    blocks = entry.blocks;
    truncated = entry.truncated;
  } else if (entry !== null && entry.isPaidOnly) {
    state = 'premium';
  } else if (entry !== null && entry.fetchedAt !== null) {
    // Fetched, but LeetCode had no such problem.
    state = 'unavailable';
  } else {
    state = fetch.enabled ? 'not-cached' : 'disabled';
  }
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    url: problem.url ?? null,
    custom: false,
    state,
    source,
    blocks,
    text,
    exampleTestcases: entry?.exampleTestcases ?? null,
    snippets: entry?.snippets ?? NO_SNIPPETS,
    fetchedAt: entry?.fetchedAt ?? null,
    truncated,
    cached,
    fetch,
  };
}

function customStatement(
  problem: ProblemView,
  fetch: { readonly enabled: boolean; readonly pinned: boolean },
): ApiProblemStatement {
  const text = problem.statement ?? null;
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    url: problem.url ?? null,
    custom: true,
    state: text !== null ? 'ready' : 'unavailable',
    source: text !== null ? 'custom' : null,
    blocks: null,
    text,
    exampleTestcases: null,
    snippets: NO_SNIPPETS,
    fetchedAt: null,
    truncated: false,
    cached: false,
    fetch,
  };
}

// eslint-disable-next-line no-control-regex
const C0_CONTROLS = /[\u0000-\u0008\u000b-\u001f]/g;

/** CRLF → LF, C0 controls except `\t` `\n` removed, trimmed. */
export function normalizePastedText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(C0_CONTROLS, '').trim();
}

function readOnlyResponse(format: number | null): HandlerResponse {
  return json(409, {
    error:
      format !== null
        ? `This folder is read-only (format v${format}).`
        : 'The data folder is read-only.',
    code: 'read_only',
  });
}

function writeFailure(
  result: CacheWriteResult & { ok: false },
): HandlerResponse {
  if (result.reason === 'read_only') return readOnlyResponse(null);
  if (result.reason === 'too_large') {
    return json(413, {
      error: 'The statement is too large to save.',
      code: 'too_large',
    });
  }
  return json(500, { error: 'Could not save the statement.' });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Handle a statement / preferences request (null → not ours). */
export async function handleStatementRoute(
  method: string,
  pathname: string,
  deps: StatementRouteDeps,
  rawBody: string | undefined,
): Promise<HandlerResponse | null> {
  if (pathname === PREFERENCES_PATH) {
    return handlePreferences(method, deps, rawBody);
  }
  const match = STATEMENT_PATH.exec(pathname);
  if (match === null) return null;
  const isFetch = match[2] !== undefined;
  if (isFetch ? method !== 'POST' : method !== 'GET' && method !== 'PUT') {
    return json(405, { error: 'method not allowed' });
  }
  let id: string;
  try {
    id = decodeURIComponent(match[1]!);
  } catch {
    return json(404, { error: 'unknown problem' });
  }
  const problem = (await loadProblemSource(deps.catalog, deps.storage)).getById(
    id,
  );
  if (problem === undefined) {
    return json(404, { error: 'unknown problem', problemId: id });
  }
  const { preferences } = deps.services;
  const fetch = await preferences.fetchSetting(deps.dataDir);
  // Only catalog ids reach the cache (custom `u-` ids never do).
  const isCatalog =
    problem.custom !== true && deps.catalog.getById(id) !== undefined;
  const cacheable = isCatalog && CACHE_ID_PATTERN.test(id);

  if (method === 'GET') {
    if (!isCatalog) return json(200, customStatement(problem, fetch));
    const entry = cacheable ? await readProblemCache(deps.dataDir, id) : null;
    return json(200, catalogStatement(problem, entry, fetch, entry !== null));
  }

  if (method === 'PUT') {
    return pasteStatement(problem, isCatalog, cacheable, fetch, deps, rawBody);
  }

  // ----- POST …/fetch -----
  const body = parseBody(rawBody, ['refresh'], true);
  if (isResponse(body)) return body;
  if (body.refresh !== undefined && typeof body.refresh !== 'boolean') {
    return json(400, { error: 'refresh must be a boolean' });
  }
  if (!isCatalog) {
    return json(400, {
      error: 'Custom problems are not fetched from LeetCode.',
    });
  }
  if (!fetch.enabled) {
    return json(403, {
      error: STATEMENT_ERRORS.fetch_disabled,
      code: 'fetch_disabled',
    });
  }
  const current = cacheable ? await readProblemCache(deps.dataDir, id) : null;
  if (current !== null && current.fetchedAt !== null && body.refresh !== true) {
    return json(200, catalogStatement(problem, current, fetch, true));
  }
  const slug = slugFromCatalogUrl(problem.url);
  if (slug === null) {
    return json(502, {
      error: STATEMENT_ERRORS.fetch_failed,
      code: 'fetch_failed',
    });
  }
  const start = deps.services.limiter.tryStart();
  if (!start.ok) {
    return json(429, {
      error: STATEMENT_ERRORS.rate_limited,
      code: 'rate_limited',
      retryAfterMs: start.retryAfterMs,
    });
  }
  // The in-flight slot is held until the cache write has finished.
  try {
    const result = await fetchLeetCodeQuestion(slug, {
      fetchImpl: deps.services.fetchImpl ?? globalThis.fetch,
      version: deps.services.version,
      ...(deps.services.timeoutMs !== undefined && {
        timeoutMs: deps.services.timeoutMs,
      }),
    });
    if (result.kind === 'timeout') {
      return json(504, {
        error: STATEMENT_ERRORS.fetch_timeout,
        code: 'fetch_timeout',
      });
    }
    if (result.kind === 'failed') {
      return json(502, {
        error: STATEMENT_ERRORS.fetch_failed,
        code: 'fetch_failed',
      });
    }
    let fetched: Omit<ProblemCacheEntry, 'pastedText'>;
    const fetchedAt = (deps.now ?? (() => new Date()))().toISOString();
    const common = {
      schema: 1 as const,
      id,
      titleSlug: slug,
      title: problem.title,
      fetchedAt,
    };
    if (result.kind === 'not_found') {
      // Cached like premium, so a later GET says `unavailable` (no re-ask).
      fetched = {
        ...common,
        isPaidOnly: false,
        blocks: null,
        truncated: false,
        exampleTestcases: null,
        snippets: NO_SNIPPETS,
      };
    } else if (result.question.isPaidOnly) {
      fetched = {
        ...common,
        isPaidOnly: true,
        blocks: null,
        truncated: false,
        exampleTestcases: null,
        snippets: NO_SNIPPETS,
      };
    } else if (result.question.content === null) {
      // Not premium yet no content: an unexpected shape.
      return json(502, {
        error: STATEMENT_ERRORS.fetch_failed,
        code: 'fetch_failed',
      });
    } else {
      const sanitized = sanitizeStatementHtml(result.question.content);
      fetched = {
        ...common,
        isPaidOnly: false,
        blocks: sanitized.blocks,
        truncated: sanitized.truncated,
        exampleTestcases: result.question.exampleTestcases,
        snippets: result.question.snippets,
      };
    }

    const saved = await serializedCacheWrite(async () => {
      // Re-read inside the queue so a paste saved meanwhile is kept.
      const latest = cacheable
        ? await readProblemCache(deps.dataDir, id)
        : null;
      const entry: ProblemCacheEntry = {
        ...fetched,
        pastedText: latest?.pastedText ?? null,
      };
      if (!cacheable || (deps.readOnlyFormat?.() ?? null) !== null) {
        return { entry, cached: false };
      }
      const write = await writeProblemCache(deps.dataDir, entry);
      return { entry, cached: write.ok };
    });

    if (result.kind === 'not_found') {
      return json(404, {
        error: STATEMENT_ERRORS.not_found,
        code: 'not_found',
      });
    }
    return json(
      200,
      catalogStatement(problem, saved.entry, fetch, saved.cached),
    );
  } finally {
    start.done();
  }
}

async function pasteStatement(
  problem: ProblemView,
  isCatalog: boolean,
  cacheable: boolean,
  fetch: { readonly enabled: boolean; readonly pinned: boolean },
  deps: StatementRouteDeps,
  rawBody: string | undefined,
): Promise<HandlerResponse> {
  const body = parseBody(rawBody, ['text'], false);
  if (isResponse(body)) return body;
  if (typeof body.text !== 'string') {
    return json(400, { error: 'text must be a string' });
  }
  if (!isCatalog) {
    return json(400, { error: "Edit the custom problem's statement." });
  }
  const text = normalizePastedText(body.text);
  if (Buffer.byteLength(text, 'utf8') > PASTED_TEXT_MAX_BYTES) {
    return json(413, {
      error: `The pasted text must be at most ${PASTED_TEXT_MAX_BYTES / 1024} KiB.`,
      code: 'too_large',
    });
  }
  if (deps.storage === null) {
    return json(400, { error: 'no database configured' });
  }
  const format = deps.readOnlyFormat?.() ?? null;
  if (format !== null) return readOnlyResponse(format);
  const slug = slugFromCatalogUrl(problem.url);
  if (!cacheable || slug === null) {
    return json(500, {
      error: 'This problem cannot store a pasted statement.',
    });
  }
  const outcome = await serializedCacheWrite(async () => {
    const current = await readProblemCache(deps.dataDir, problem.id);
    const entry: ProblemCacheEntry = current
      ? { ...current, pastedText: text === '' ? null : text }
      : {
          schema: 1,
          id: problem.id,
          titleSlug: slug,
          title: problem.title,
          isPaidOnly: false,
          fetchedAt: null,
          blocks: null,
          truncated: false,
          exampleTestcases: null,
          snippets: NO_SNIPPETS,
          pastedText: text === '' ? null : text,
        };
    return { entry, write: await writeProblemCache(deps.dataDir, entry) };
  });
  if (!outcome.write.ok) return writeFailure(outcome.write);
  return json(200, catalogStatement(problem, outcome.entry, fetch, true));
}

async function handlePreferences(
  method: string,
  deps: StatementRouteDeps,
  rawBody: string | undefined,
): Promise<HandlerResponse> {
  const { preferences } = deps.services;
  if (method === 'GET') {
    return json(200, await preferences.view(deps.dataDir));
  }
  if (method !== 'PUT') return json(405, { error: 'method not allowed' });
  const body = parseBody(rawBody, ['language', 'leetcodeFetch'], false);
  if (isResponse(body)) return body;
  const patch: { language?: CodeLanguage; leetcodeFetch?: boolean } = {};
  if (body.language !== undefined) {
    if (!isCodeLanguage(body.language)) {
      return json(400, { error: 'language must be "python" or "go"' });
    }
    patch.language = body.language;
  }
  if (body.leetcodeFetch !== undefined) {
    if (typeof body.leetcodeFetch !== 'boolean') {
      return json(400, { error: 'leetcodeFetch must be a boolean' });
    }
    if (preferences.env.enabled !== undefined) {
      return json(400, {
        error: `Set by ${LEETCODE_FETCH_ENV}`,
        code: 'pinned',
      });
    }
    patch.leetcodeFetch = body.leetcodeFetch;
  }
  if (deps.storage === null) {
    return json(400, { error: 'no database configured' });
  }
  const format = deps.readOnlyFormat?.() ?? null;
  if (format !== null) return readOnlyResponse(format);
  if (Object.keys(patch).length > 0) {
    try {
      await serializedCacheWrite(() => preferences.write(deps.dataDir, patch));
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        return readOnlyResponse(null);
      }
      return json(500, { error: 'Could not save preferences.' });
    }
  }
  return json(200, await preferences.view(deps.dataDir));
}
