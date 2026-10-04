/**
 * ADR 0015 PR A: the statement routes, the LeetCode fetch, the problem
 * cache and the preferences API — over a temp data folder with a FAKE
 * fetch. Nothing here may reach the real network: `globalThis.fetch` is
 * replaced with a throwing spy for every test and checked afterwards.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import type { CustomProblem, IsoTimestamp } from '@ibai/storage';
import { handleApiRoute } from './api.js';
import type { ApiDeps } from './api.js';
import { createCoachHandler } from './handler.js';
import type { HandlerRequest } from './handler.js';
import { startServer } from './server.js';
import {
  LEETCODE_GRAPHQL_URL,
  LEETCODE_MAX_RESPONSE_BYTES,
  LEETCODE_QUESTION_QUERY,
  LEETCODE_RATE_MAX,
  LEETCODE_RATE_WINDOW_MS,
  createLeetCodeLimiter,
  leetCodeUserAgent,
  slugFromCatalogUrl,
} from './leetcode.js';
import {
  CACHE_FILE_MAX_BYTES,
  PROBLEM_CACHE_DIR,
  problemCachePath,
  readProblemCache,
  serializeProblemCacheEntry,
  writeProblemCache,
} from './problem-cache.js';
import type { ProblemCacheEntry } from './problem-cache.js';
import {
  PREFERENCES_FILE,
  createPreferencesStore,
  resolveLeetCodeFetchEnv,
} from './preferences.js';
import type {
  ApiProblemStatement,
  StatementServices,
} from './statement-routes.js';
import { isStatementTree } from './statement-tree.js';
import type { StatementNode } from './statement-tree.js';

const CATALOG = createCatalogSource();
const NOW = new Date('2026-10-04T12:00:00.000Z');
/** lc-3: a free catalog problem; lc-253: premium; lc-4: "unknown slug". */
const FREE = CATALOG.getById('lc-3')!;
const PREMIUM = CATALOG.getById('lc-253')!;
const GONE = CATALOG.getById('lc-4')!;
const CUSTOM_ID = 'u-my-own-problem';
const VERSION = '9.9.9-test';
const PORT = 4173;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
/** A marker in LeetCode replies that must never be echoed in an error. */
const LEAK = 'LEETCODE-SAYS-SECRET';

const FIXTURE_DIR = fileURLToPath(
  new URL('../web-ui/src/test/fixtures/statement/', import.meta.url),
);

/** A synthetic statement (written for this test, not LeetCode's text, §6.2). */
const SYNTHETIC_HTML =
  '<p>You get a string <code>s</code>. Return the length of its longest run of distinct letters.</p>\n<p>&nbsp;</p>\n<p><strong class="example">Example 1:</strong></p>\n<pre>\n<strong>Input:</strong> s = "abca"\n<strong>Output:</strong> 3\n</pre>\n<p><strong>Constraints:</strong></p>\n<ul>\n\t<li><code>0 &lt;= s.length &lt;= 10<sup>4</sup></code></li>\n</ul><script>alert(1)</script><img src="https://x/y.png" alt="diagram">';
const SYNTHETIC_PY =
  'class Solution:\n    def longestRun(self, s: str) -> int:\n        ';
const SYNTHETIC_GO = 'func longestRun(s string) int {\n    \n}';

let tmpDir: string;
let clock: number;
let globalFetch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-statement-test-'));
  clock = 1_000_000;
  // Safety net: any accidental real request fails the test.
  globalFetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.reject(new Error('real network call in a test')),
    );
});
afterEach(() => {
  expect(globalFetch).not.toHaveBeenCalled();
  globalFetch.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fake LeetCode
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: Record<string, unknown>;
}

type Reply =
  | Response
  | Error
  | { readonly hang: true }
  | ((call: FakeCall) => Promise<Response>);

function jsonReply(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

function questionReply(overrides: Record<string, unknown> = {}): Response {
  return jsonReply({
    data: {
      question: {
        questionFrontendId: '3',
        title: 'Ignored title',
        titleSlug: FREE.url.split('/')[4],
        isPaidOnly: false,
        difficulty: 'Medium',
        exampleTestcases: '"abca"\n"bbbb"',
        content: SYNTHETIC_HTML,
        codeSnippets: [
          { langSlug: 'cpp', code: 'class Solution {};' },
          { langSlug: 'python', code: 'python2 is not kept' },
          { langSlug: 'python3', code: SYNTHETIC_PY },
          { langSlug: 'golang', code: SYNTHETIC_GO },
        ],
        ...overrides,
      },
    },
  });
}

const PREMIUM_REPLY = (): Response =>
  questionReply({ isPaidOnly: true, content: null, codeSnippets: null });
const NOT_FOUND_REPLY = (): Response => jsonReply({ data: { question: null } });

function fakeFetch(replies: Reply[] = [questionReply()]): {
  fetchImpl: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const queue = [...replies];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call: FakeCall = {
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    };
    calls.push(call);
    // The last reply repeats (cloned); earlier ones are used once, as is.
    const last = queue.length <= 1;
    const next = last ? queue[0]! : queue.shift()!;
    if (next instanceof Error) throw next;
    if (next instanceof Response) return last ? next.clone() : next;
    if (typeof next === 'function') return next(call);
    // Hang until the caller's signal fires (the timeout path).
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => reject(signal.reason));
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function services(
  fetchImpl: typeof fetch,
  extra: Partial<StatementServices> & { env?: NodeJS.ProcessEnv } = {},
  warn: (line: string) => void = () => undefined,
): StatementServices {
  const { env, ...rest } = extra;
  return {
    preferences: createPreferencesStore({ env: env ?? {}, warn }),
    limiter: createLeetCodeLimiter({ clock: () => clock }),
    fetchImpl,
    version: VERSION,
    ...rest,
  };
}

function deps(
  statementServices: StatementServices,
  extra: Partial<ApiDeps> = {},
): ApiDeps {
  return {
    catalog: CATALOG,
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    storage: new LocalFileStorageAdapter(tmpDir),
    dataDir: tmpDir,
    now: () => NOW,
    statementServices,
    ...extra,
  };
}

async function call(
  d: ApiDeps,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handleApiRoute(
    method,
    url,
    d,
    body === undefined
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body),
  );
  return {
    status: res.status,
    body: JSON.parse(res.body) as Record<string, unknown>,
  };
}

const statementUrl = (id: string) =>
  `/api/problems/${encodeURIComponent(id)}/statement`;
const fetchUrl = (id: string) => `${statementUrl(id)}/fetch`;

const getStatement = async (d: ApiDeps, id = FREE.id) => {
  const res = await call(d, 'GET', statementUrl(id));
  expect(res.status).toBe(200);
  return res.body as unknown as ApiProblemStatement;
};

const cacheFile = (id: string) =>
  path.join(tmpDir, PROBLEM_CACHE_DIR, `${id}.json`);

async function addCustomProblem(statement?: string): Promise<void> {
  const at = NOW.toISOString() as IsoTimestamp;
  const problem: CustomProblem = {
    id: CUSTOM_ID,
    title: 'My own problem',
    ...(statement !== undefined && { statement }),
    difficulty: 'easy',
    topics: ['arrays'],
    createdAt: at,
    updatedAt: at,
  };
  await new LocalFileStorageAdapter(tmpDir).createCustomProblem(problem);
}

function readFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

// ---------------------------------------------------------------------------
// leetcode.ts
// ---------------------------------------------------------------------------

describe('leetcode.ts', () => {
  it('takes the slug from a catalog link only', () => {
    expect(slugFromCatalogUrl('https://leetcode.com/problems/two-sum/')).toBe(
      'two-sum',
    );
    expect(slugFromCatalogUrl('https://leetcode.com/problems/two-sum')).toBe(
      'two-sum',
    );
    for (const bad of [
      undefined,
      'not a url',
      'http://leetcode.com/problems/two-sum/',
      'https://evil.com/problems/two-sum/',
      'https://leetcode.com.evil.com/problems/two-sum/',
      'https://user:pw@leetcode.com/problems/two-sum/',
      'https://leetcode.com:8443/problems/two-sum/',
      'https://leetcode.com/problems/Two_Sum/',
      'https://leetcode.com/problems/a/b/',
      'https://leetcode.com/problems/%2e%2e/',
      `https://leetcode.com/problems/${'a'.repeat(101)}/`,
    ]) {
      expect(slugFromCatalogUrl(bad)).toBeNull();
    }
  });

  it('every catalog entry has a valid slug and an lc-<n> id', () => {
    for (const p of CATALOG.list()) {
      expect(slugFromCatalogUrl(p.url)).not.toBeNull();
      expect(p.id).toMatch(/^lc-[0-9]+$/);
    }
  });

  it('the limiter allows one in flight and 10 per sliding 10 minutes', () => {
    let now = 0;
    const limiter = createLeetCodeLimiter({ clock: () => now });
    const first = limiter.tryStart();
    expect(first.ok).toBe(true);
    expect(limiter.tryStart()).toEqual({ ok: false, retryAfterMs: 1000 });
    if (first.ok) first.done();
    for (let i = 1; i < LEETCODE_RATE_MAX; i++) {
      now += 1000;
      const s = limiter.tryStart();
      expect(s.ok).toBe(true);
      if (s.ok) s.done();
    }
    now += 1000;
    const refused = limiter.tryStart();
    expect(refused).toEqual({
      ok: false,
      retryAfterMs: LEETCODE_RATE_WINDOW_MS - now,
    });
    now = LEETCODE_RATE_WINDOW_MS; // the first start leaves the window
    expect(limiter.tryStart().ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET / POST statement
// ---------------------------------------------------------------------------

describe('GET /api/problems/:id/statement', () => {
  it('reads the cache only: not-cached, and never calls LeetCode', async () => {
    const fake = fakeFetch();
    const s = await getStatement(deps(services(fake.fetchImpl)));
    expect(s).toMatchObject({
      id: FREE.id,
      title: FREE.title,
      difficulty: FREE.difficulty,
      url: FREE.url,
      custom: false,
      state: 'not-cached',
      source: null,
      blocks: null,
      cached: false,
      fetch: { enabled: true, pinned: false },
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('unknown and traversal ids → 404, before any cache access', async () => {
    const d = deps(services(fakeFetch().fetchImpl));
    for (const id of ['lc-999999', '../../etc/passwd', '..', 'lc-1/../x']) {
      for (const [method, url, body] of [
        ['GET', statementUrl(id), undefined],
        ['POST', fetchUrl(id), {}],
        ['PUT', statementUrl(id), { text: 'x' }],
      ] as const) {
        expect((await call(d, method, url, body)).status).toBe(404);
      }
    }
    // Raw (undecoded) traversal never matches the statement route shape.
    expect([404, 405]).toContain(
      (await call(d, 'GET', '/api/problems/../../x/statement')).status,
    );
    expect(fs.existsSync(path.join(tmpDir, PROBLEM_CACHE_DIR))).toBe(false);
  });

  it('wrong methods → 405', async () => {
    const d = deps(services(fakeFetch().fetchImpl));
    expect((await call(d, 'POST', statementUrl(FREE.id), {})).status).toBe(405);
    expect((await call(d, 'DELETE', statementUrl(FREE.id))).status).toBe(405);
    expect((await call(d, 'GET', fetchUrl(FREE.id))).status).toBe(405);
    expect((await call(d, 'PUT', fetchUrl(FREE.id), {})).status).toBe(405);
  });
});

describe('POST /api/problems/:id/statement/fetch', () => {
  it('one POST to the fixed URL with the catalog slug, the UA, no redirects or credentials', async () => {
    const fake = fakeFetch();
    const d = deps(services(fake.fetchImpl));
    const res = await call(d, 'POST', fetchUrl(FREE.id), {});
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
    const [c] = fake.calls;
    expect(c!.url).toBe(LEETCODE_GRAPHQL_URL);
    expect(c!.init.method).toBe('POST');
    expect(c!.init.redirect).toBe('error');
    expect(c!.init.credentials).toBe('omit');
    expect(c!.init.signal).toBeInstanceOf(AbortSignal);
    expect(c!.init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': leetCodeUserAgent(VERSION),
    });
    expect(leetCodeUserAgent(VERSION)).toBe(
      `InterviewBudAI/${VERSION} (+https://github.com/coderbirju/InterviewBudAI; personal use, user-triggered)`,
    );
    expect(c!.body).toEqual({
      operationName: 'ibaiQuestion',
      query: LEETCODE_QUESTION_QUERY,
      variables: { titleSlug: slugFromCatalogUrl(FREE.url) },
    });
  });

  it('ready: sanitized blocks, python3/golang snippets only, cached 0600 in a 0700 folder with a .gitignore', async () => {
    const fake = fakeFetch();
    const d = deps(services(fake.fetchImpl));
    const res = await call(d, 'POST', fetchUrl(FREE.id), {});
    const s = res.body as unknown as ApiProblemStatement;
    expect(s).toMatchObject({
      state: 'ready',
      source: 'leetcode',
      text: null,
      exampleTestcases: '"abca"\n"bbbb"',
      snippets: { python: SYNTHETIC_PY, go: SYNTHETIC_GO },
      fetchedAt: NOW.toISOString(),
      truncated: false,
      cached: true,
    });
    expect(isStatementTree(s.blocks)).toBe(true);
    const raw = fs.readFileSync(cacheFile(FREE.id), 'utf8');
    // The sanitized form only: no tag, no attribute, no script text.
    expect(raw).not.toMatch(/<\/?[a-z]+[\s>/]|alert|class=|https:\/\/x/);
    expect(raw).toContain('[image: diagram]');
    expect(raw).not.toContain('python2');
    const dir = path.join(tmpDir, PROBLEM_CACHE_DIR);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('*\n');
    if (process.platform !== 'win32') {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(cacheFile(FREE.id)).mode & 0o777).toBe(0o600);
    }
    expect(fs.readdirSync(dir).sort()).toEqual([
      '.gitignore',
      `${FREE.id}.json`,
    ]);

    // GET reads it back; a second POST is a cache hit (no request).
    expect(await getStatement(d)).toEqual({ ...s, cached: true });
    const again = await call(d, 'POST', fetchUrl(FREE.id), {});
    expect(again.body).toEqual(s);
    expect(fake.calls).toHaveLength(1);
    // refresh: true asks again.
    expect(
      (await call(d, 'POST', fetchUrl(FREE.id), { refresh: true })).status,
    ).toBe(200);
    expect(fake.calls).toHaveLength(2);
  });

  it('premium: 200 premium, cached, not asked again', async () => {
    const fake = fakeFetch([PREMIUM_REPLY()]);
    const d = deps(services(fake.fetchImpl));
    const res = await call(d, 'POST', fetchUrl(PREMIUM.id), {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      state: 'premium',
      source: null,
      blocks: null,
      snippets: { python: null, go: null },
      cached: true,
    });
    expect((await getStatement(d, PREMIUM.id)).state).toBe('premium');
    await call(d, 'POST', fetchUrl(PREMIUM.id), {});
    expect(fake.calls).toHaveLength(1);
  });

  it('unknown slug (question: null): 404 not_found, cached so a later GET is unavailable', async () => {
    const fake = fakeFetch([NOT_FOUND_REPLY()]);
    const d = deps(services(fake.fetchImpl));
    const res = await call(d, 'POST', fetchUrl(GONE.id), {});
    expect(res).toEqual({
      status: 404,
      body: {
        error: 'LeetCode has no problem at this link.',
        code: 'not_found',
      },
    });
    const entry = await readProblemCache(tmpDir, GONE.id);
    expect(entry).toMatchObject({
      isPaidOnly: false,
      blocks: null,
      fetchedAt: NOW.toISOString(),
    });
    const s = await getStatement(d, GONE.id);
    expect(s).toMatchObject({
      state: 'unavailable',
      source: null,
      cached: true,
    });
    // A cache hit: no second request.
    const again = await call(d, 'POST', fetchUrl(GONE.id), {});
    expect(again.status).toBe(200);
    expect(again.body.state).toBe('unavailable');
    expect(fake.calls).toHaveLength(1);
  });

  it('502 fetch_failed for network errors, redirects, non-200, non-JSON, bad JSON, bad shape and oversize; LeetCode text is never echoed', async () => {
    const big = 'x'.repeat(LEETCODE_MAX_RESPONSE_BYTES + 10);
    const failures: Reply[] = [
      new TypeError('fetch failed ' + LEAK),
      new TypeError('unexpected redirect'),
      jsonReply({ error: LEAK }, { status: 500 }),
      jsonReply({ data: { question: null } }, { status: 302 }),
      new Response(`<html>${LEAK}</html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
      new Response(`{not json ${LEAK}`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      jsonReply({ errors: [{ message: LEAK }] }),
      jsonReply({ data: { question: { isPaidOnly: 'no', content: LEAK } } }),
      jsonReply({ data: { question: { isPaidOnly: false, content: 5 } } }),
      jsonReply({
        data: {
          question: {
            isPaidOnly: false,
            content: 'x',
            codeSnippets: [{ langSlug: 1 }],
          },
        },
      }),
      jsonReply({ data: { question: { isPaidOnly: false, content: null } } }),
      // Streamed body over the cap (no Content-Length).
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(big));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
      // Declared length over the cap.
      new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(LEETCODE_MAX_RESPONSE_BYTES + 1),
        },
      }),
    ];
    for (const reply of failures) {
      clock += LEETCODE_RATE_WINDOW_MS; // never rate limited here
      const fake = fakeFetch([reply]);
      const d = deps(services(fake.fetchImpl));
      const res = await call(d, 'POST', fetchUrl(FREE.id), {});
      expect(res).toEqual({
        status: 502,
        body: { error: 'LeetCode could not be reached.', code: 'fetch_failed' },
      });
      expect(fake.calls).toHaveLength(1);
      expect(fs.existsSync(cacheFile(FREE.id))).toBe(false);
    }
  });

  it('a pull-based endless body is cancelled at the 1 MiB cap (502)', async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const endless = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const fake = fakeFetch([async () => endless()]);
    const d = deps(services(fake.fetchImpl));
    const res = await call(d, 'POST', fetchUrl(FREE.id), {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('fetch_failed');
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelled).toBe(true);
    // Reading stops just past the cap (plus the stream's small read-ahead).
    expect(pulls * chunk.byteLength).toBeLessThan(
      LEETCODE_MAX_RESPONSE_BYTES + 8 * chunk.byteLength,
    );
  });

  it('a body that stalls after the headers times out (504)', async () => {
    const fake = fakeFetch([
      async (c) => {
        const signal = c.init.signal!;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"data":'));
              signal.addEventListener('abort', () =>
                controller.error(signal.reason),
              );
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    ]);
    const d = deps(services(fake.fetchImpl, { timeoutMs: 30 }));
    const started = Date.now();
    const res = await call(d, 'POST', fetchUrl(FREE.id), {});
    expect(res).toEqual({
      status: 504,
      body: {
        error: 'LeetCode did not answer in time.',
        code: 'fetch_timeout',
      },
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('504 fetch_timeout when LeetCode does not answer in time', async () => {
    const fake = fakeFetch([{ hang: true }]);
    const d = deps(services(fake.fetchImpl, { timeoutMs: 20 }));
    const res = await call(d, 'POST', fetchUrl(FREE.id), {});
    expect(res).toEqual({
      status: 504,
      body: {
        error: 'LeetCode did not answer in time.',
        code: 'fetch_timeout',
      },
    });
    // The limiter was released: the next fetch may start.
    clock += 1;
    const ok = fakeFetch();
    const d2 = deps({
      ...d.statementServices!,
      fetchImpl: ok.fetchImpl,
      timeoutMs: undefined,
    });
    expect((await call(d2, 'POST', fetchUrl(FREE.id), {})).status).toBe(200);
  });

  it('429 rate_limited with retryAfterMs: while one fetch is in flight, and past 10 per 10 minutes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fake = fakeFetch([
      async () => {
        await gate;
        return questionReply();
      },
      questionReply(),
    ]);
    const d = deps(services(fake.fetchImpl));
    const first = call(d, 'POST', fetchUrl(FREE.id), {});
    await new Promise((r) => setTimeout(r, 5));
    const second = await call(d, 'POST', fetchUrl(PREMIUM.id), {});
    expect(second).toEqual({
      status: 429,
      body: {
        error: 'Too many LeetCode requests. Try again shortly.',
        code: 'rate_limited',
        retryAfterMs: 1000,
      },
    });
    release();
    expect((await first).status).toBe(200);

    for (let i = 1; i < LEETCODE_RATE_MAX; i++) {
      clock += 1000;
      expect(
        (await call(d, 'POST', fetchUrl(FREE.id), { refresh: true })).status,
      ).toBe(200);
    }
    clock += 1000;
    const limited = await call(d, 'POST', fetchUrl(FREE.id), { refresh: true });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('rate_limited');
    expect(limited.body.retryAfterMs).toBeGreaterThan(0);
    // Cache hits never count and are never refused.
    expect((await call(d, 'POST', fetchUrl(FREE.id), {})).status).toBe(200);
    expect(fake.calls).toHaveLength(LEETCODE_RATE_MAX);
    clock += LEETCODE_RATE_WINDOW_MS;
    expect(
      (await call(d, 'POST', fetchUrl(FREE.id), { refresh: true })).status,
    ).toBe(200);
  });

  it('403 fetch_disabled (setting off or env pin): no request at all; the cache still shows', async () => {
    const fake = fakeFetch();
    const d = deps(services(fake.fetchImpl));
    expect((await call(d, 'POST', fetchUrl(FREE.id), {})).status).toBe(200);
    expect(
      (await call(d, 'PUT', '/api/preferences', { leetcodeFetch: false }))
        .status,
    ).toBe(200);
    const off = await call(d, 'POST', fetchUrl(FREE.id), { refresh: true });
    expect(off).toEqual({
      status: 403,
      body: {
        error: 'Fetching is turned off in Settings.',
        code: 'fetch_disabled',
      },
    });
    expect((await getStatement(d)).state).toBe('ready');
    expect((await getStatement(d, PREMIUM.id)).state).toBe('disabled');

    const pinned = deps(
      services(fake.fetchImpl, { env: { IBAI_LEETCODE_FETCH: 'off' } }),
    );
    expect((await call(pinned, 'POST', fetchUrl(PREMIUM.id), {})).status).toBe(
      403,
    );
    expect(fake.calls).toHaveLength(1);
  });

  it('body: unknown fields and a non-boolean refresh → 400', async () => {
    const fake = fakeFetch();
    const d = deps(services(fake.fetchImpl));
    expect(
      (await call(d, 'POST', fetchUrl(FREE.id), { refresh: 'yes' })).status,
    ).toBe(400);
    expect(
      (await call(d, 'POST', fetchUrl(FREE.id), { slug: 'evil' })).status,
    ).toBe(400);
    expect((await call(d, 'POST', fetchUrl(FREE.id), '[1]')).status).toBe(400);
    expect(fake.calls).toHaveLength(0);
    // An empty body is `{}`.
    expect((await call(d, 'POST', fetchUrl(FREE.id))).status).toBe(200);
  });

  it('read-only folder or no folder: the statement is returned, cached: false, nothing written', async () => {
    const fake = fakeFetch();
    const ro = deps(services(fake.fetchImpl), { readOnlyFormat: () => 3 });
    const res = await call(ro, 'POST', fetchUrl(FREE.id), {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'ready', cached: false });
    expect(fs.existsSync(path.join(tmpDir, PROBLEM_CACHE_DIR))).toBe(false);

    const missing = path.join(tmpDir, 'missing');
    const none = deps(services(fake.fetchImpl), { dataDir: missing });
    const res2 = await call(none, 'POST', fetchUrl(FREE.id), {});
    expect(res2.body).toMatchObject({ state: 'ready', cached: false });
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('a snippet or example over 16 KiB is stored as null (not cut)', async () => {
    const huge = 'é'.repeat(8 * 1024 + 1); // 16 KiB + 2 bytes
    const fake = fakeFetch([
      questionReply({
        exampleTestcases: huge,
        codeSnippets: [
          { langSlug: 'python3', code: huge },
          { langSlug: 'golang', code: SYNTHETIC_GO },
        ],
      }),
    ]);
    const d = deps(services(fake.fetchImpl));
    const res = await call(d, 'POST', fetchUrl(FREE.id), {});
    expect(res.body).toMatchObject({
      exampleTestcases: null,
      snippets: { python: null, go: SYNTHETIC_GO },
    });
  });
});

// ---------------------------------------------------------------------------
// Custom problems
// ---------------------------------------------------------------------------

describe('custom problems', () => {
  it('return their own statement; never fetched, pasted or cached', async () => {
    await addCustomProblem('Find the thing.\nIn O(n).');
    const fake = fakeFetch();
    const d = deps(services(fake.fetchImpl));
    const s = await getStatement(d, CUSTOM_ID);
    expect(s).toEqual({
      id: CUSTOM_ID,
      title: 'My own problem',
      difficulty: 'easy',
      url: null,
      custom: true,
      state: 'ready',
      source: 'custom',
      blocks: null,
      text: 'Find the thing.\nIn O(n).',
      exampleTestcases: null,
      snippets: { python: null, go: null },
      fetchedAt: null,
      truncated: false,
      cached: false,
      fetch: { enabled: true, pinned: false },
    });
    expect((await call(d, 'POST', fetchUrl(CUSTOM_ID), {})).status).toBe(400);
    const put = await call(d, 'PUT', statementUrl(CUSTOM_ID), { text: 'x' });
    expect(put).toEqual({
      status: 400,
      body: { error: "Edit the custom problem's statement." },
    });
    expect(fake.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, PROBLEM_CACHE_DIR))).toBe(false);
  });

  it('a custom problem without a statement is unavailable', async () => {
    await addCustomProblem();
    const s = await getStatement(
      deps(services(fakeFetch().fetchImpl)),
      CUSTOM_ID,
    );
    expect(s).toMatchObject({ state: 'unavailable', source: null, text: null });
  });
});

// ---------------------------------------------------------------------------
// PUT statement (paste)
// ---------------------------------------------------------------------------

describe('PUT /api/problems/:id/statement (paste)', () => {
  it('the paste wins over a fetched statement and keeps its snippets; empty text clears it', async () => {
    const fake = fakeFetch();
    const d = deps(services(fake.fetchImpl));
    const fetched = (await call(d, 'POST', fetchUrl(FREE.id), {})).body;
    const put = await call(d, 'PUT', statementUrl(FREE.id), {
      text: '  My copy\r\nline 2\u0000  ',
    });
    expect(put.status).toBe(200);
    const expected = {
      ...fetched,
      source: 'pasted',
      blocks: null,
      text: 'My copy\nline 2',
      truncated: false,
      cached: true,
    };
    expect(put.body).toEqual(expected);
    expect(await getStatement(d)).toEqual(expected);
    const cleared = await call(d, 'PUT', statementUrl(FREE.id), {
      text: '   ',
    });
    expect(cleared.body).toEqual(fetched);
    expect(fake.calls).toHaveLength(1);
  });

  it('a paste before any fetch: ready/pasted; a later fetch keeps it and adds the snippets', async () => {
    const fake = fakeFetch([PREMIUM_REPLY()]);
    const d = deps(services(fake.fetchImpl));
    const put = await call(d, 'PUT', statementUrl(PREMIUM.id), {
      text: 'pasted',
    });
    expect(put.body).toMatchObject({
      state: 'ready',
      source: 'pasted',
      fetchedAt: null,
    });
    // fetchedAt null ⇒ not a cache hit: the fetch runs, the paste survives.
    const after = await call(d, 'POST', fetchUrl(PREMIUM.id), {});
    expect(after.body).toMatchObject({
      state: 'ready',
      source: 'pasted',
      text: 'pasted',
    });
    expect(fake.calls).toHaveLength(1);
    // Clearing the paste reveals the premium state.
    const cleared = await call(d, 'PUT', statementUrl(PREMIUM.id), {
      text: '',
    });
    expect(cleared.body).toMatchObject({ state: 'premium' });
  });

  it('caps and validation: > 64 KiB → 413; bad bodies → 400; read-only → 409; no folder → 400', async () => {
    const d = deps(services(fakeFetch().fetchImpl));
    const tooBig = 'é'.repeat(32 * 1024 + 1);
    expect(
      (await call(d, 'PUT', statementUrl(FREE.id), { text: tooBig })).status,
    ).toBe(413);
    // Exactly 64 KiB after trimming is fine.
    const fits = '  ' + 'a'.repeat(64 * 1024) + '  ';
    expect(
      (await call(d, 'PUT', statementUrl(FREE.id), { text: fits })).status,
    ).toBe(200);
    expect((await call(d, 'PUT', statementUrl(FREE.id), {})).status).toBe(400);
    expect(
      (await call(d, 'PUT', statementUrl(FREE.id), { text: 5 })).status,
    ).toBe(400);
    expect(
      (await call(d, 'PUT', statementUrl(FREE.id), { text: 'a', x: 1 })).status,
    ).toBe(400);
    expect((await call(d, 'PUT', statementUrl(FREE.id), 'nope')).status).toBe(
      400,
    );
    const ro = deps(services(fakeFetch().fetchImpl), {
      readOnlyFormat: () => 2,
    });
    expect(await call(ro, 'PUT', statementUrl(FREE.id), { text: 'a' })).toEqual(
      {
        status: 409,
        body: {
          error: 'This folder is read-only (format v2).',
          code: 'read_only',
        },
      },
    );
    const none = deps(services(fakeFetch().fetchImpl), {
      dataDir: path.join(tmpDir, 'missing'),
    });
    expect(
      (await call(none, 'PUT', statementUrl(FREE.id), { text: 'a' })).status,
    ).toBe(400);
  });

  it('a write the OS refuses → 409 read_only', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const d = deps(services(fakeFetch().fetchImpl));
    fs.mkdirSync(path.join(tmpDir, PROBLEM_CACHE_DIR), { mode: 0o500 });
    try {
      const res = await call(d, 'PUT', statementUrl(FREE.id), { text: 'a' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('read_only');
    } finally {
      fs.chmodSync(path.join(tmpDir, PROBLEM_CACHE_DIR), 0o700);
    }
  });
});

// ---------------------------------------------------------------------------
// problem-cache.ts
// ---------------------------------------------------------------------------

function entry(overrides: Partial<ProblemCacheEntry> = {}): ProblemCacheEntry {
  return {
    schema: 1,
    id: FREE.id,
    titleSlug: 'some-slug',
    title: FREE.title,
    isPaidOnly: false,
    fetchedAt: NOW.toISOString(),
    blocks: [{ t: 'p', c: [{ t: 'text', v: 'x' }] }],
    truncated: false,
    exampleTestcases: null,
    snippets: { python: null, go: null },
    pastedText: null,
    ...overrides,
  };
}

describe('problem-cache.ts', () => {
  it('problemCachePath: lc-<n> only, always inside problem-cache/', () => {
    expect(problemCachePath(tmpDir, 'lc-1')).toBe(
      path.join(tmpDir, PROBLEM_CACHE_DIR, 'lc-1.json'),
    );
    for (const bad of [
      '',
      'lc-',
      'lc-1/../../x',
      '../lc-1',
      'lc-1.json',
      'lc-1\u0000',
      'u-abc',
      'LC-1',
      'lc-1 ',
      'lc-01a',
      '..',
      '/etc/passwd',
    ]) {
      expect(() => problemCachePath(tmpDir, bad)).toThrow(RangeError);
    }
  });

  it('round-trips a valid entry; the reader rejects anything else as not cached', async () => {
    expect((await writeProblemCache(tmpDir, entry())).ok).toBe(true);
    expect(await readProblemCache(tmpDir, FREE.id)).toEqual(entry());
    const file = cacheFile(FREE.id);
    const bad: unknown[] = [
      'not json',
      JSON.stringify([]),
      JSON.stringify({ ...entry(), schema: 2 }),
      JSON.stringify({ ...entry(), id: 'lc-4' }),
      JSON.stringify({ ...entry(), extra: true }),
      JSON.stringify({ ...entry(), titleSlug: '../x' }),
      JSON.stringify({ ...entry(), fetchedAt: 'yesterday' }),
      JSON.stringify({ ...entry(), blocks: [{ t: 'script', c: [] }] }),
      JSON.stringify({ ...entry(), blocks: [{ t: 'p', c: [], class: 'x' }] }),
      JSON.stringify({ ...entry(), pastedText: 'a'.repeat(64 * 1024 + 1) }),
      JSON.stringify({
        ...entry(),
        exampleTestcases: 'a'.repeat(16 * 1024 + 1),
      }),
      JSON.stringify({ ...entry(), snippets: { python: 1, go: null } }),
      JSON.stringify({
        ...entry(),
        snippets: { python: null, go: null, rust: '' },
      }),
      JSON.stringify({ ...entry(), truncated: 'no' }),
      JSON.stringify({
        ...entry(),
        pastedText: 'x'.repeat(CACHE_FILE_MAX_BYTES),
      }),
    ];
    for (const content of bad) {
      fs.writeFileSync(file, content as string);
      expect(await readProblemCache(tmpDir, FREE.id)).toBeNull();
    }
    // Not a regular file (a symlink to a valid entry elsewhere).
    if (process.platform !== 'win32') {
      const elsewhere = path.join(tmpDir, 'elsewhere.json');
      fs.writeFileSync(elsewhere, serializeProblemCacheEntry(entry())!);
      fs.rmSync(file);
      fs.symlinkSync(elsewhere, file);
      expect(await readProblemCache(tmpDir, FREE.id)).toBeNull();
    }
    // A corrupt file reads as "not cached" in the API and is overwritten.
    fs.rmSync(file);
    fs.writeFileSync(file, '{oops');
    const d = deps(services(fakeFetch().fetchImpl));
    expect((await getStatement(d)).state).toBe('not-cached');
    expect((await call(d, 'POST', fetchUrl(FREE.id), {})).status).toBe(200);
    expect(await readProblemCache(tmpDir, FREE.id)).not.toBeNull();
  });

  it('the writer refuses an entry over the 512 KiB read cap (and writes nothing)', async () => {
    // 4,000 breaks + 128 KiB of quotes (escaped to 2 bytes each) + a quoted paste.
    const blocks: StatementNode[] = [
      ...Array.from({ length: 4000 }, (): StatementNode => ({ t: 'br' })),
      { t: 'text', v: '"'.repeat(128 * 1024) },
    ];
    expect(isStatementTree(blocks)).toBe(true);
    const quotes = '"'.repeat(16 * 1024);
    const huge = entry({
      blocks,
      pastedText: '"'.repeat(64 * 1024),
      exampleTestcases: quotes,
      snippets: { python: quotes, go: quotes },
    });
    expect(serializeProblemCacheEntry(huge)).toBeNull();
    expect(await writeProblemCache(tmpDir, huge)).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(fs.existsSync(cacheFile(FREE.id))).toBe(false);
  });

  it('keeps an existing .gitignore and never creates the data folder', async () => {
    const dir = path.join(tmpDir, PROBLEM_CACHE_DIR);
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, '.gitignore'), 'mine\n');
    expect((await writeProblemCache(tmpDir, entry())).ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe(
      'mine\n',
    );
    const missing = path.join(tmpDir, 'nope');
    expect((await writeProblemCache(missing, entry())).ok).toBe(false);
    expect(fs.existsSync(missing)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

describe('GET / PUT /api/preferences', () => {
  it('defaults: python, fetch on and not pinned', async () => {
    const d = deps(services(fakeFetch().fetchImpl));
    expect(await call(d, 'GET', '/api/preferences')).toEqual({
      status: 200,
      body: {
        language: 'python',
        leetcodeFetch: { enabled: true, pinned: false },
      },
    });
  });

  it('PUT stores both keys in preferences.json (0600), keeping unknown keys', async () => {
    const file = path.join(tmpDir, PREFERENCES_FILE);
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark' }));
    const d = deps(services(fakeFetch().fetchImpl));
    const res = await call(d, 'PUT', '/api/preferences', {
      language: 'go',
      leetcodeFetch: false,
    });
    expect(res).toEqual({
      status: 200,
      body: {
        language: 'go',
        leetcodeFetch: { enabled: false, pinned: false },
      },
    });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      theme: 'dark',
      language: 'go',
      leetcodeFetch: false,
    });
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    // Partial updates keep the other key.
    await call(d, 'PUT', '/api/preferences', { leetcodeFetch: true });
    expect((await call(d, 'GET', '/api/preferences')).body).toEqual({
      language: 'go',
      leetcodeFetch: { enabled: true, pinned: false },
    });
  });

  it('bad values and unknown fields → 400', async () => {
    const d = deps(services(fakeFetch().fetchImpl));
    for (const body of [
      { language: 'rust' },
      { language: 1 },
      { leetcodeFetch: 'off' },
      { theme: 'dark' },
      '[]',
      'nope',
    ]) {
      expect((await call(d, 'PUT', '/api/preferences', body)).status).toBe(400);
    }
    expect(fs.existsSync(path.join(tmpDir, PREFERENCES_FILE))).toBe(false);
  });

  it('IBAI_LEETCODE_FETCH pins the setting: GET shows it, PUT of leetcodeFetch → 400, language still saves; unpinned, the file decides again', async () => {
    fs.writeFileSync(
      path.join(tmpDir, PREFERENCES_FILE),
      JSON.stringify({ leetcodeFetch: true }),
    );
    const pinned = deps(
      services(fakeFetch().fetchImpl, { env: { IBAI_LEETCODE_FETCH: 'OFF' } }),
    );
    expect((await call(pinned, 'GET', '/api/preferences')).body).toEqual({
      language: 'python',
      leetcodeFetch: { enabled: false, pinned: true },
    });
    expect(
      await call(pinned, 'PUT', '/api/preferences', { leetcodeFetch: true }),
    ).toEqual({
      status: 400,
      body: { error: 'Set by IBAI_LEETCODE_FETCH', code: 'pinned' },
    });
    expect(
      (await call(pinned, 'PUT', '/api/preferences', { language: 'go' }))
        .status,
    ).toBe(200);
    expect((await getStatement(pinned)).fetch).toEqual({
      enabled: false,
      pinned: true,
    });

    const on = deps(
      services(fakeFetch().fetchImpl, { env: { IBAI_LEETCODE_FETCH: '1' } }),
    );
    await call(on, 'PUT', '/api/preferences', { language: 'go' });
    fs.writeFileSync(
      path.join(tmpDir, PREFERENCES_FILE),
      JSON.stringify({ leetcodeFetch: false, language: 'go' }),
    );
    expect((await call(on, 'GET', '/api/preferences')).body).toEqual({
      language: 'go',
      leetcodeFetch: { enabled: true, pinned: true },
    });

    const unpinned = deps(services(fakeFetch().fetchImpl, { env: {} }));
    expect((await call(unpinned, 'GET', '/api/preferences')).body).toEqual({
      language: 'go',
      leetcodeFetch: { enabled: false, pinned: false },
    });
  });

  it('IBAI_LEETCODE_FETCH values: on/off, 1/0, true/false pin; blank is unset; anything else warns', () => {
    for (const v of ['off', '0', 'false', ' FALSE ']) {
      expect(resolveLeetCodeFetchEnv({ IBAI_LEETCODE_FETCH: v })).toEqual({
        pinned: true,
        enabled: false,
      });
    }
    for (const v of ['on', '1', 'true', 'On']) {
      expect(resolveLeetCodeFetchEnv({ IBAI_LEETCODE_FETCH: v })).toEqual({
        pinned: true,
        enabled: true,
      });
    }
    expect(resolveLeetCodeFetchEnv({})).toEqual({});
    expect(resolveLeetCodeFetchEnv({ IBAI_LEETCODE_FETCH: '  ' })).toEqual({});
    const odd = resolveLeetCodeFetchEnv({
      IBAI_LEETCODE_FETCH: 'maybe-secret',
    });
    expect(odd.pinned).toBeUndefined();
    expect(odd.warning).toMatch(/IBAI_LEETCODE_FETCH/);
    expect(odd.warning).not.toContain('maybe-secret');
  });

  it('an untrusted file: bad values fall back with ONE warning each; oversize / non-object → defaults', async () => {
    const file = path.join(tmpDir, PREFERENCES_FILE);
    const warnings: string[] = [];
    const d = deps(
      services(fakeFetch().fetchImpl, {}, (l) => warnings.push(l)),
    );
    fs.writeFileSync(
      file,
      JSON.stringify({ language: 'cobol', leetcodeFetch: 'yes' }),
    );
    for (let i = 0; i < 3; i++) {
      expect((await call(d, 'GET', '/api/preferences')).body).toEqual({
        language: 'python',
        leetcodeFetch: { enabled: true, pinned: false },
      });
    }
    expect(warnings).toHaveLength(2);
    for (const content of ['[1]', 'null', '{bad', ' '.repeat(64 * 1024 + 1)]) {
      fs.writeFileSync(file, content);
      expect((await call(d, 'GET', '/api/preferences')).body).toEqual({
        language: 'python',
        leetcodeFetch: { enabled: true, pinned: false },
      });
    }
  });

  it('a file filled by unknown keys: a save keeps only our keys (no 500)', async () => {
    const file = path.join(tmpDir, PREFERENCES_FILE);
    fs.writeFileSync(
      file,
      JSON.stringify({ junk: 'x'.repeat(64 * 1024 - 20) }),
    );
    expect(fs.statSync(file).size).toBeLessThanOrEqual(64 * 1024);
    const d = deps(services(fakeFetch().fetchImpl));
    const res = await call(d, 'PUT', '/api/preferences', { language: 'go' });
    expect(res.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      language: 'go',
    });
  });

  it('a symlinked preferences file is not followed (defaults)', async () => {
    if (process.platform === 'win32') return;
    const elsewhere = path.join(tmpDir, 'elsewhere.json');
    fs.writeFileSync(elsewhere, JSON.stringify({ language: 'go' }));
    fs.symlinkSync(elsewhere, path.join(tmpDir, PREFERENCES_FILE));
    const d = deps(services(fakeFetch().fetchImpl));
    expect((await call(d, 'GET', '/api/preferences')).body).toMatchObject({
      language: 'python',
    });
  });

  it('no data folder → PUT 400; read-only → 409', async () => {
    const none = deps(services(fakeFetch().fetchImpl), {
      dataDir: path.join(tmpDir, 'x'),
    });
    expect((await call(none, 'GET', '/api/preferences')).status).toBe(200);
    expect(
      (await call(none, 'PUT', '/api/preferences', { language: 'go' })).status,
    ).toBe(400);
    const ro = deps(services(fakeFetch().fetchImpl), {
      readOnlyFormat: () => 9,
    });
    expect(
      (await call(ro, 'PUT', '/api/preferences', { language: 'go' })).status,
    ).toBe(409);
    expect((await call(ro, 'DELETE', '/api/preferences')).status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Same-origin / CSRF (through the handler's prechecks)
// ---------------------------------------------------------------------------

describe('same-origin checks on the new routes', () => {
  function handler(fetchImpl: typeof fetch) {
    return createCoachHandler({
      storage: new LocalFileStorageAdapter(tmpDir),
      catalog: CATALOG,
      createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
      dataDir: tmpDir,
      dataDirSource: 'default',
      homeDir: tmpDir,
      env: {},
      argv: [],
      port: PORT,
      warn: () => undefined,
      fetchImpl: () => Promise.reject(new Error('unexpected provider call')),
      leetcodeFetchImpl: fetchImpl,
      clock: () => clock,
    });
  }
  const req = (
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown,
  ): HandlerRequest => ({
    method,
    url,
    headers: { host: HOST, ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  it('POST fetch and PUT routes refuse cross-site requests (403) and non-JSON (415), with no LeetCode call', async () => {
    const fake = fakeFetch();
    const h = handler(fake.fetchImpl);
    const json = { 'content-type': 'application/json' };
    const cases: [string, string, unknown][] = [
      ['POST', fetchUrl(FREE.id), {}],
      ['PUT', statementUrl(FREE.id), { text: 'x' }],
      ['PUT', '/api/preferences', { language: 'go' }],
    ];
    for (const [method, url, body] of cases) {
      const evil = await h(
        req(method, url, { ...json, origin: 'https://evil.example' }, body),
      );
      expect(evil.status).toBe(403);
      const site = await h(
        req(method, url, { ...json, 'sec-fetch-site': 'cross-site' }, body),
      );
      expect(site.status).toBe(403);
      const plain = await h(
        req(
          method,
          url,
          { 'content-type': 'text/plain', origin: ORIGIN },
          body,
        ),
      );
      expect(plain.status).toBe(415);
      const rebind = await h({
        ...req(method, url, { ...json, origin: ORIGIN }, body),
        headers: { host: 'evil.example', origin: ORIGIN, ...json },
      });
      expect(rebind.status).toBe(421);
    }
    expect(fake.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, PREFERENCES_FILE))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, PROBLEM_CACHE_DIR))).toBe(false);

    // A cross-site GET is not blocked (GET skips the check) — and it never fetches.
    const get = await h(
      req('GET', statementUrl(FREE.id), { 'sec-fetch-site': 'cross-site' }),
    );
    expect(get.status).toBe(200);
    expect(fake.calls).toHaveLength(0);

    // Same-origin works.
    const ok = await h(
      req('POST', fetchUrl(FREE.id), { ...json, origin: ORIGIN }, {}),
    );
    expect(ok.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
  });

  it('GET /api/settings lists IBAI_LEETCODE_FETCH (set ✓/✗ only)', async () => {
    const h = createCoachHandler({
      storage: new LocalFileStorageAdapter(tmpDir),
      catalog: CATALOG,
      dataDir: tmpDir,
      homeDir: tmpDir,
      env: { IBAI_LEETCODE_FETCH: 'off' },
      argv: [],
      port: PORT,
      warn: () => undefined,
    });
    const res = await h(req('GET', '/api/settings', {}));
    const body = JSON.parse(res.body) as {
      envHelp: { var: string; set: boolean }[];
    };
    expect(
      body.envHelp.find((e) => e.var === 'IBAI_LEETCODE_FETCH'),
    ).toMatchObject({ set: true });
    expect(res.body).not.toContain('"off"');
  });
});

// ---------------------------------------------------------------------------
// Over a real socket: PUT bodies are read (BODY_METHODS), boot warning
// ---------------------------------------------------------------------------

describe('over a real socket', () => {
  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => resolve(port));
      });
    });
  }
  function request(
    port: number,
    method: string,
    urlPath: string,
    body: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path: urlPath,
          headers: {
            host: `127.0.0.1:${port}`,
            origin: `http://127.0.0.1:${port}`,
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(body)),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      r.on('error', reject);
      r.end(body);
    });
  }

  it('PUT /api/preferences and PUT …/statement bodies reach the handler; a bad IBAI_LEETCODE_FETCH warns once at boot', async () => {
    const port = await freePort();
    const lines: string[] = [];
    const handle = await startServer({
      env: { IBAI_DATA_DIR: tmpDir, IBAI_LEETCODE_FETCH: 'sometimes' },
      argv: [`--port=${port}`],
      homeDir: tmpDir,
      log: (line) => lines.push(line),
    });
    try {
      const prefs = await request(
        port,
        'PUT',
        '/api/preferences',
        JSON.stringify({ language: 'go' }),
      );
      expect(prefs.status).toBe(200);
      expect(JSON.parse(prefs.body)).toEqual({
        language: 'go',
        leetcodeFetch: { enabled: true, pinned: false },
      });
      const paste = await request(
        port,
        'PUT',
        statementUrl(FREE.id),
        JSON.stringify({ text: 'pasted over http' }),
      );
      expect(paste.status).toBe(200);
      expect(JSON.parse(paste.body)).toMatchObject({
        source: 'pasted',
        text: 'pasted over http',
      });
      const warnings = lines.filter((l) => l.includes('IBAI_LEETCODE_FETCH'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toContain('sometimes');
    } finally {
      await handle.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures for PR B (web-ui/src/test/fixtures/statement/)
// ---------------------------------------------------------------------------

describe('statement fixtures match what the routes return', () => {
  /** Build every fixture body from the real routes. */
  async function produce(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const fake = fakeFetch([
      questionReply(),
      questionReply({
        content:
          '<p>' +
          '<em>'.repeat(40) +
          'Deeply nested text.' +
          '</em>'.repeat(40) +
          '</p>',
      }),
      PREMIUM_REPLY(),
      NOT_FOUND_REPLY(),
    ]);
    const d = deps(services(fake.fetchImpl));

    out['statement-not-cached.json'] = await getStatement(d);
    await call(d, 'POST', fetchUrl(FREE.id), {});
    out['statement-ready.json'] = await getStatement(d);
    clock += 1;
    await call(d, 'POST', fetchUrl(FREE.id), { refresh: true });
    out['statement-ready-truncated.json'] = await getStatement(d);
    clock += 1;
    await call(d, 'POST', fetchUrl(PREMIUM.id), {});
    out['statement-premium.json'] = await getStatement(d, PREMIUM.id);
    clock += 1;
    const notFound = await call(d, 'POST', fetchUrl(GONE.id), {});
    out['fetch-error-404-not_found.json'] = notFound.body;
    out['statement-unavailable.json'] = await getStatement(d, GONE.id);

    // Pasted over a fetched statement (snippets kept).
    clock += 1;
    const pasteFake = fakeFetch([questionReply()]);
    const p = deps({ ...d.statementServices!, fetchImpl: pasteFake.fetchImpl });
    await call(p, 'POST', fetchUrl(FREE.id), { refresh: true });
    await call(p, 'PUT', statementUrl(FREE.id), {
      text: 'My own notes on the problem.\nExample: "abca" -> 3',
    });
    out['statement-pasted.json'] = await getStatement(p);

    await addCustomProblem('Count the distinct letters in a word.');
    out['statement-custom.json'] = await getStatement(d, CUSTOM_ID);

    // Fetch turned off, nothing cached.
    await call(d, 'PUT', '/api/preferences', { leetcodeFetch: false });
    out['statement-disabled.json'] = await getStatement(d, 'lc-11');
    out['fetch-error-403-fetch_disabled.json'] = (
      await call(d, 'POST', fetchUrl('lc-11'), {})
    ).body;
    await call(d, 'PUT', '/api/preferences', { leetcodeFetch: true });
    out['preferences-unpinned.json'] = (
      await call(d, 'GET', '/api/preferences')
    ).body;
    const pinned = deps(
      services(fakeFetch().fetchImpl, { env: { IBAI_LEETCODE_FETCH: 'off' } }),
    );
    out['preferences-pinned.json'] = (
      await call(pinned, 'GET', '/api/preferences')
    ).body;

    // Error bodies.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const busy = fakeFetch([
      async () => {
        await gate;
        return questionReply();
      },
    ]);
    const b = deps(services(busy.fetchImpl));
    const inFlight = call(b, 'POST', fetchUrl('lc-11'), {});
    await new Promise((r) => setTimeout(r, 5));
    out['fetch-error-429-rate_limited.json'] = (
      await call(b, 'POST', fetchUrl('lc-17'), {})
    ).body;
    release();
    await inFlight;
    clock += 1;
    out['fetch-error-502-fetch_failed.json'] = (
      await call(
        deps(services(fakeFetch([new TypeError('x')]).fetchImpl)),
        'POST',
        fetchUrl('lc-17'),
        {},
      )
    ).body;
    clock += 1;
    out['fetch-error-504-fetch_timeout.json'] = (
      await call(
        deps(
          services(fakeFetch([{ hang: true }]).fetchImpl, { timeoutMs: 10 }),
        ),
        'POST',
        fetchUrl('lc-17'),
        {},
      )
    ).body;
    return out;
  }

  it('each fixture equals the route output (and statement trees pass isStatementTree)', async () => {
    const produced = await produce();
    if (process.env.IBAI_WRITE_STATEMENT_FIXTURES === '1') {
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      for (const [name, body] of Object.entries(produced)) {
        fs.writeFileSync(
          path.join(FIXTURE_DIR, name),
          JSON.stringify(body, null, 2) + '\n',
        );
      }
    }
    const onDisk = fs
      .readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();
    expect(onDisk).toEqual(Object.keys(produced).sort());
    for (const [name, body] of Object.entries(produced)) {
      expect(readFixture(name), name).toEqual(body);
    }
    const states = onDisk
      .filter((f) => f.startsWith('statement-'))
      .map((f) => readFixture(f) as ApiProblemStatement);
    for (const s of states) {
      if (s.blocks !== null) expect(isStatementTree(s.blocks)).toBe(true);
    }
    expect(new Set(states.map((s) => s.state))).toEqual(
      new Set(['ready', 'not-cached', 'disabled', 'premium', 'unavailable']),
    );
    expect(states.filter((s) => s.truncated)).toHaveLength(1);
    expect(readFixture('fetch-error-429-rate_limited.json')).toMatchObject({
      retryAfterMs: expect.any(Number),
    });
  });
});
