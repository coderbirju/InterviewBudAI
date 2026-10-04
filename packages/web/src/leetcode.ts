/**
 * The one optional, user-triggered LeetCode request (ADR 0015 D1).
 *
 * One GraphQL POST to a fixed URL, for one problem, with the slug taken from
 * the CATALOG entry (never from the browser). Node's `fetch` only, no new
 * dependency. Limits: 10 s timeout, no redirects, no cookies or auth, a
 * 1 MiB streamed size cap, JSON only, a shape check, one fetch in flight per
 * process and at most 10 fetches per 10 minutes (sliding window).
 *
 * Tests inject `fetchImpl`; nothing here may run against the real network in
 * CI.
 */

/** The only URL ever requested (a constant, never built from input). */
export const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';
/** Whole request deadline, body read included. */
export const LEETCODE_TIMEOUT_MS = 10_000;
/** Largest accepted response body (bytes, read as a stream). */
export const LEETCODE_MAX_RESPONSE_BYTES = 1024 * 1024;
/** Sliding rate window and the fetches allowed in it. */
export const LEETCODE_RATE_WINDOW_MS = 10 * 60_000;
export const LEETCODE_RATE_MAX = 10;
/** Suggested wait while another fetch is in flight. */
export const LEETCODE_IN_FLIGHT_RETRY_MS = 1000;
/** Largest kept snippet / example-testcases value (UTF-8 bytes). */
export const LEETCODE_FIELD_MAX_BYTES = 16 * 1024;

/** A catalog slug: lowercase letters, digits and dashes. */
export const SLUG_PATTERN = /^[a-z0-9-]{1,100}$/;

/** The fixed query (ADR 0015 D1). */
export const LEETCODE_QUESTION_QUERY = `query ibaiQuestion($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId title titleSlug isPaidOnly difficulty
    exampleTestcases content codeSnippets { langSlug code }
  }
}`;

/** The `User-Agent` sent with the request. */
export function leetCodeUserAgent(version: string): string {
  return `InterviewBudAI/${version} (+https://github.com/coderbirju/InterviewBudAI; personal use, user-triggered)`;
}

/**
 * The slug of a catalog link `https://leetcode.com/problems/<slug>/`, or null
 * when the link does not have exactly that form.
 */
export function slugFromCatalogUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'leetcode.com' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return null;
  }
  const match = /^\/problems\/([^/]+)\/?$/.exec(parsed.pathname);
  const slug = match?.[1];
  return slug !== undefined && SLUG_PATTERN.test(slug) ? slug : null;
}

/** The validated part of LeetCode's `question` we use. */
export interface LeetCodeQuestion {
  readonly isPaidOnly: boolean;
  /** Raw HTML (untrusted; sanitize before storing), or null. */
  readonly content: string | null;
  /** Null when absent or longer than {@link LEETCODE_FIELD_MAX_BYTES}. */
  readonly exampleTestcases: string | null;
  readonly snippets: {
    readonly python: string | null;
    readonly go: string | null;
  };
}

/** The outcome of one request. Error text is ours, never LeetCode's. */
export type LeetCodeFetchResult =
  | { readonly kind: 'ok'; readonly question: LeetCodeQuestion }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'timeout' };

export interface LeetCodeFetchOptions {
  readonly fetchImpl: typeof fetch;
  /** App version for the User-Agent. */
  readonly version: string;
  /** Deadline (default {@link LEETCODE_TIMEOUT_MS}; tests shorten it). */
  readonly timeoutMs?: number;
}

function capped(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return Buffer.byteLength(value, 'utf8') <= LEETCODE_FIELD_MAX_BYTES
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check the GraphQL reply shape. `undefined` = bad shape; `null` = LeetCode
 * has no such slug (`question: null`).
 */
export function parseQuestionReply(
  value: unknown,
): LeetCodeQuestion | null | undefined {
  if (!isRecord(value) || !isRecord(value.data)) return undefined;
  const q = value.data.question;
  if (q === null) return null;
  if (!isRecord(q)) return undefined;
  if (typeof q.isPaidOnly !== 'boolean') return undefined;
  if (q.content !== null && typeof q.content !== 'string') return undefined;
  if (
    q.exampleTestcases !== null &&
    q.exampleTestcases !== undefined &&
    typeof q.exampleTestcases !== 'string'
  ) {
    return undefined;
  }
  const snippets: { python: string | null; go: string | null } = {
    python: null,
    go: null,
  };
  if (q.codeSnippets !== null && q.codeSnippets !== undefined) {
    if (!Array.isArray(q.codeSnippets)) return undefined;
    for (const s of q.codeSnippets) {
      if (
        !isRecord(s) ||
        typeof s.langSlug !== 'string' ||
        typeof s.code !== 'string'
      ) {
        return undefined;
      }
      // Only Python 3 and Go are kept (`python` is Python 2: not used).
      if (s.langSlug === 'python3') snippets.python = capped(s.code);
      if (s.langSlug === 'golang') snippets.go = capped(s.code);
    }
  }
  return {
    isPaidOnly: q.isPaidOnly,
    content: q.content,
    exampleTestcases: capped(q.exampleTestcases),
    snippets,
  };
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

/** Read at most `limit` bytes of the body; null past the cap (read aborted). */
async function readCapped(
  res: Response,
  limit: number,
): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    void res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (res.body === null) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Make the one request for `slug` (already validated against
 * {@link SLUG_PATTERN}). Never throws; never returns LeetCode's own text as
 * an error.
 */
export async function fetchLeetCodeQuestion(
  slug: string,
  opts: LeetCodeFetchOptions,
): Promise<LeetCodeFetchResult> {
  if (!SLUG_PATTERN.test(slug)) return { kind: 'failed' };
  const signal = AbortSignal.timeout(opts.timeoutMs ?? LEETCODE_TIMEOUT_MS);
  try {
    const res = await opts.fetchImpl(LEETCODE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': leetCodeUserAgent(opts.version),
      },
      body: JSON.stringify({
        operationName: 'ibaiQuestion',
        query: LEETCODE_QUESTION_QUERY,
        variables: { titleSlug: slug },
      }),
      redirect: 'error',
      credentials: 'omit',
      signal,
    });
    if (res.status !== 200) {
      void res.body?.cancel().catch(() => undefined);
      return { kind: 'failed' };
    }
    const type = (res.headers.get('content-type') ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase();
    if (type !== 'application/json') {
      void res.body?.cancel().catch(() => undefined);
      return { kind: 'failed' };
    }
    const text = await readCapped(res, LEETCODE_MAX_RESPONSE_BYTES);
    if (text === null) return { kind: 'failed' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: 'failed' };
    }
    const question = parseQuestionReply(parsed);
    if (question === undefined) return { kind: 'failed' };
    if (question === null) return { kind: 'not_found' };
    return { kind: 'ok', question };
  } catch (error) {
    if (signal.aborted || isTimeout(error)) return { kind: 'timeout' };
    return { kind: 'failed' };
  }
}

// ---------------------------------------------------------------------------
// Per-process limit: one in flight, ≤ 10 starts per sliding 10 minutes
// ---------------------------------------------------------------------------

export type LeetCodeStart =
  | { readonly ok: true; readonly done: () => void }
  | { readonly ok: false; readonly retryAfterMs: number };

export interface LeetCodeLimiter {
  tryStart(): LeetCodeStart;
}

export function createLeetCodeLimiter(
  opts: {
    readonly clock?: () => number;
    readonly windowMs?: number;
    readonly max?: number;
  } = {},
): LeetCodeLimiter {
  const clock = opts.clock ?? Date.now;
  const windowMs = opts.windowMs ?? LEETCODE_RATE_WINDOW_MS;
  const max = opts.max ?? LEETCODE_RATE_MAX;
  const starts: number[] = [];
  let inFlight = false;
  return {
    tryStart(): LeetCodeStart {
      const now = clock();
      while (starts.length > 0 && now - starts[0]! >= windowMs) starts.shift();
      if (inFlight) {
        return { ok: false, retryAfterMs: LEETCODE_IN_FLIGHT_RETRY_MS };
      }
      if (starts.length >= max) {
        return {
          ok: false,
          retryAfterMs: Math.max(1, starts[0]! + windowMs - now),
        };
      }
      starts.push(now);
      inFlight = true;
      let released = false;
      return {
        ok: true,
        done: () => {
          if (!released) {
            released = true;
            inFlight = false;
          }
        },
      };
    },
  };
}
