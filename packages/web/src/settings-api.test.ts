/**
 * ADR 0008 Wave 2(c-lite): GET /api/settings + POST /api/settings/test-provider.
 * Keys stay env-only — every test asserts the key string never appears in any
 * response. All provider calls go to an injected fake fetch (no real network).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { createCoachHandler } from './handler.js';
import {
  OPENAI_IGNORED_HINT,
  OPENAI_INSECURE_KEY_HINT,
  OPENAI_USERINFO_HINT,
} from './config.js';
import type {
  CoachHandlerDeps,
  HandlerRequest,
  HandlerResponse,
} from './handler.js';
import {
  OLLAMA_USERINFO_DETAIL,
  openAICompatibleLabel,
  TEST_TIMEOUT_MS,
  createProviderTester,
  sanitizeEndpoint,
} from './settings.js';
import type {
  ApiProviderTestResponse,
  ApiSettingsResponse,
} from './settings.js';

const PORT = 4173;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const CATALOG = createCatalogSource();
const KEY = 'sk-ant-SECRET-key-do-not-leak-123';
const OLLAMA_PASS = 'hunter2-ollama-pass';
const OAI_KEY = 'sk-oai-SECRET-do-not-leak-777';

const ANTHROPIC_ENV = {
  ANTHROPIC_API_KEY: KEY,
  IBAI_ANTHROPIC_MODEL: 'claude-test-model',
};
const OLLAMA_ENV = {
  IBAI_OLLAMA_MODEL: 'llama3',
  IBAI_OLLAMA_URL: `http://user:${OLLAMA_PASS}@127.0.0.1:11434/base?token=${OLLAMA_PASS}`,
};

let root: string;
let home: string;
let serverDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-settings-test-'));
  home = path.join(root, 'home');
  serverDir = path.join(root, 'data');
  fs.mkdirSync(home);
  fs.mkdirSync(serverDir);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

type Handler = (req: HandlerRequest) => Promise<HandlerResponse>;

interface FakeCall {
  url: string;
  init?: RequestInit;
}

function makeHandler(
  env: NodeJS.ProcessEnv,
  overrides: Partial<CoachHandlerDeps> = {},
): Handler {
  const inner = createCoachHandler({
    storage: new LocalFileStorageAdapter(serverDir),
    catalog: CATALOG,
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    dataDir: serverDir,
    dataDirSource: 'default',
    homeDir: home,
    env,
    argv: [],
    port: PORT,
    warn: () => undefined,
    fetchImpl: () => Promise.reject(new Error('unexpected network call')),
    ...overrides,
  });
  return (req) =>
    inner({ ...req, headers: { host: HOST, origin: ORIGIN, ...req.headers } });
}

function fakeFetch(respond: (call: FakeCall) => Promise<Response> | Response): {
  fetchImpl: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getSettings(handler: Handler): Promise<{
  res: HandlerResponse;
  body: ApiSettingsResponse;
}> {
  const res = await handler({ method: 'GET', url: '/api/settings' });
  expect(res.status).toBe(200);
  expect(res.contentType).toBe('application/json; charset=utf-8');
  return { res, body: JSON.parse(res.body) as ApiSettingsResponse };
}

function postTest(
  handler: Handler,
  headers: Record<string, string> = {},
  contentType = 'application/json',
): Promise<HandlerResponse> {
  return handler({
    method: 'POST',
    url: '/api/settings/test-provider',
    body: '{}',
    contentType,
    headers,
  });
}

function assertNoSecrets(res: HandlerResponse): void {
  const serialized = JSON.stringify(res);
  expect(serialized).not.toContain(KEY);
  expect(serialized).not.toContain(OLLAMA_PASS);
  expect(serialized).not.toContain('x-api-key');
  expect(serialized).not.toContain(OAI_KEY);
  expect(serialized).not.toContain('Bearer');
}

describe('GET /api/settings', () => {
  it('anthropic: kind/model/keyConfigured, no endpoint, key never serialized', async () => {
    const { res, body } = await getSettings(makeHandler(ANTHROPIC_ENV));
    expect(body.provider).toEqual({
      kind: 'anthropic',
      model: 'claude-test-model',
      endpoint: null,
      keyConfigured: true,
    });
    assertNoSecrets(res);
  });

  it('ollama: endpoint is the origin only (userinfo, path and query stripped)', async () => {
    const { res, body } = await getSettings(makeHandler(OLLAMA_ENV));
    expect(body.provider).toEqual({
      kind: 'ollama',
      model: 'llama3',
      endpoint: 'http://127.0.0.1:11434',
      keyConfigured: false,
    });
    assertNoSecrets(res);
  });

  it('ollama without IBAI_OLLAMA_URL reports the default origin', async () => {
    const { body } = await getSettings(
      makeHandler({ IBAI_OLLAMA_MODEL: 'qwen2:7b' }),
    );
    expect(body.provider.endpoint).toBe('http://127.0.0.1:11434');
    expect(body.provider.model).toBe('qwen2:7b');
  });

  it('none: null model/endpoint; a key without a model gives a hint but no key', async () => {
    const empty = await getSettings(makeHandler({}));
    expect(empty.body.provider).toEqual({
      kind: 'none',
      model: null,
      endpoint: null,
      keyConfigured: false,
    });
    const keyOnly = await getSettings(
      makeHandler({ IBAI_ANTHROPIC_API_KEY: KEY }),
    );
    expect(keyOnly.body.provider.kind).toBe('none');
    expect(keyOnly.body.provider.keyConfigured).toBe(true);
    expect(keyOnly.body.provider.hint).toMatch(/IBAI_ANTHROPIC_MODEL/);
    assertNoSecrets(keyOnly.res);
  });

  it('envHelp lists every var the app reads with set booleans only', async () => {
    const { res, body } = await getSettings(
      makeHandler({
        ...ANTHROPIC_ENV,
        IBAI_ANTHROPIC_API_KEY: KEY,
        IBAI_WEB_PORT: '4173',
      }),
    );
    expect(body.envHelp.map((e) => e.var)).toEqual([
      'ANTHROPIC_API_KEY',
      'IBAI_ANTHROPIC_API_KEY',
      'IBAI_ANTHROPIC_MODEL',
      'IBAI_OPENAI_BASE_URL',
      'IBAI_OPENAI_MODEL',
      'IBAI_OPENAI_API_KEY',
      'OPENAI_API_KEY',
      'IBAI_OPENAI_TIMEOUT_MS',
      'IBAI_OLLAMA_MODEL',
      'IBAI_OLLAMA_URL',
      'IBAI_DATA_DIR',
      'IBAI_WEB_PORT',
      'IBAI_LEETCODE_FETCH',
      'IBAI_HOST_DATA_DIR',
    ]);
    const set = Object.fromEntries(body.envHelp.map((e) => [e.var, e.set]));
    expect(set).toEqual({
      ANTHROPIC_API_KEY: true,
      IBAI_ANTHROPIC_API_KEY: true,
      IBAI_ANTHROPIC_MODEL: true,
      IBAI_OPENAI_BASE_URL: false,
      IBAI_OPENAI_MODEL: false,
      IBAI_OPENAI_API_KEY: false,
      OPENAI_API_KEY: false,
      IBAI_OPENAI_TIMEOUT_MS: false,
      IBAI_OLLAMA_MODEL: false,
      IBAI_OLLAMA_URL: false,
      IBAI_DATA_DIR: false,
      IBAI_WEB_PORT: true,
      IBAI_LEETCODE_FETCH: false,
      IBAI_HOST_DATA_DIR: false,
    });
    for (const e of body.envHelp) {
      expect(Object.keys(e).sort()).toEqual(['purpose', 'set', 'var']);
    }
    assertNoSecrets(res);
  });

  it('reports data dir (path/source/pinned) and app versions', async () => {
    const { body } = await getSettings(
      makeHandler({}, { dataDirSource: 'env' }),
    );
    expect(body.dataDir).toEqual({
      path: serverDir,
      source: 'env',
      pinned: true,
    });
    expect(body.app.node).toBe(process.version);
    expect(typeof body.app.version).toBe('string');
    expect(body.app.version.length).toBeGreaterThan(0);
  });

  it('foreign Host (DNS rebinding) → 421', async () => {
    const handler = makeHandler(ANTHROPIC_ENV);
    const res = await handler({
      method: 'GET',
      url: '/api/settings',
      headers: { host: 'evil.example:4173' },
    });
    expect(res.status).toBe(421);
    assertNoSecrets(res);
  });

  it('wrong method → 405', async () => {
    const res = await makeHandler({})({
      method: 'POST',
      url: '/api/settings',
      body: '{}',
      contentType: 'application/json',
    });
    expect(res.status).toBe(405);
  });
});

describe('sanitizeEndpoint', () => {
  it('keeps scheme://host:port only; rejects junk', () => {
    expect(sanitizeEndpoint('http://a:b@host:1/x?y=1#z')).toBe('http://host:1');
    expect(sanitizeEndpoint('https://example.com')).toBe('https://example.com');
    expect(sanitizeEndpoint('not a url')).toBeNull();
    expect(sanitizeEndpoint('file:///etc/passwd')).toBeNull();
  });
});

describe('POST /api/settings/test-provider', () => {
  it('none → 400 "no model configured", no outbound call', async () => {
    const fake = fakeFetch(() => jsonResponse(200, {}));
    const res = await postTest(makeHandler({}, { fetchImpl: fake.fetchImpl }));
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'no model configured' });
    expect(fake.calls).toHaveLength(0);
  });

  it('ollama success: GET <endpoint>/api/tags, model present (llama3 ≡ llama3:latest)', async () => {
    let t = 1000;
    const fake = fakeFetch(() => {
      t += 42;
      return jsonResponse(200, {
        models: [{ name: 'llama3:latest', model: 'llama3:latest' }],
      });
    });
    const res = await postTest(
      makeHandler(
        {
          IBAI_OLLAMA_MODEL: 'llama3',
          IBAI_OLLAMA_URL: 'http://127.0.0.1:11434',
        },
        { fetchImpl: fake.fetchImpl, clock: () => t },
      ),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(true);
    expect(body.latencyMs).toBe(42);
    expect(body.detail).toMatch(/llama3/);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('http://127.0.0.1:11434/api/tags');
    expect(fake.calls[0]?.init?.method).toBe('GET');
  });

  it('ollama reachable but model missing → ok:false with a pull hint', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(200, { models: [{ name: 'mistral:latest' }] }),
    );
    const res = await postTest(
      makeHandler(
        { IBAI_OLLAMA_MODEL: 'llama3' },
        { fetchImpl: fake.fetchImpl },
      ),
    );
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toMatch(/ollama pull llama3/);
  });

  it('ollama connection refused → sanitized detail (no path / query)', async () => {
    const env = {
      IBAI_OLLAMA_MODEL: 'llama3',
      IBAI_OLLAMA_URL: `http://127.0.0.1:11434/base?token=${OLLAMA_PASS}`,
    };
    const fake = fakeFetch(() => {
      throw new TypeError(
        `fetch failed: connect ECONNREFUSED ${env.IBAI_OLLAMA_URL}`,
      );
    });
    const res = await postTest(makeHandler(env, { fetchImpl: fake.fetchImpl }));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toBe(
      'Could not reach Ollama at http://127.0.0.1:11434. Is Ollama running?',
    );
    assertNoSecrets(res);
  });

  it('ollama URL with userinfo → fixed detail, no call, URL never echoed', async () => {
    const fake = fakeFetch(() => jsonResponse(200, { models: [] }));
    const res = await postTest(
      makeHandler(OLLAMA_ENV, { fetchImpl: fake.fetchImpl }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toBe(OLLAMA_USERINFO_DETAIL);
    expect(fake.calls).toHaveLength(0);
    assertNoSecrets(res);
  });

  it('ollama timeout → ok:false "did not answer"', async () => {
    const fake = fakeFetch(
      (call) =>
        new Promise<Response>((_, rejectFetch) => {
          call.init?.signal?.addEventListener('abort', () =>
            rejectFetch(new Error('aborted')),
          );
        }),
    );
    const test = createProviderTester({
      env: { IBAI_OLLAMA_MODEL: 'llama3' },
      fetchImpl: fake.fetchImpl,
      timeoutMs: 20,
    });
    const outcome = await test();
    expect(outcome.status).toBe(200);
    const body = outcome.body as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toMatch(/^Ollama did not answer within \d+ s\.$/);
  });

  it('anthropic success: one 1-token messages call through the adapter', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(200, {
        content: [{ type: 'text', text: 'Hi' }],
        stop_reason: 'max_tokens',
      }),
    );
    const res = await postTest(
      makeHandler(ANTHROPIC_ENV, { fetchImpl: fake.fetchImpl }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const sent = JSON.parse(String(fake.calls[0]?.init?.body)) as {
      max_tokens: number;
      model: string;
    };
    expect(sent.max_tokens).toBe(1);
    expect(sent.model).toBe('claude-test-model');
    assertNoSecrets(res);
  });

  it('anthropic 401 → sanitized "rejected the API key"; body/headers never echoed', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(401, {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: `invalid x-api-key ${KEY}`,
        },
      }),
    );
    const res = await postTest(
      makeHandler(ANTHROPIC_ENV, { fetchImpl: fake.fetchImpl }),
    );
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toMatch(
      /rejected the API key \(HTTP 401\) \(authentication_error\)/,
    );
    assertNoSecrets(res);
  });

  it('anthropic 404 with an untrusted error type → type dropped', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(404, { error: { type: `<script>${KEY}` } }),
    );
    const res = await postTest(
      makeHandler(ANTHROPIC_ENV, { fetchImpl: fake.fetchImpl }),
    );
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toBe(
      'Anthropic could not find the model or endpoint (HTTP 404). Check the model name.',
    );
    assertNoSecrets(res);
  });

  it('anthropic network failure → generic detail, error text not echoed', async () => {
    const fake = fakeFetch(() => {
      throw new Error(`boom x-api-key: ${KEY}`);
    });
    const res = await postTest(
      makeHandler(ANTHROPIC_ENV, { fetchImpl: fake.fetchImpl }),
    );
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toBe(
      'Could not reach Anthropic. Check your network connection.',
    );
    assertNoSecrets(res);
  });

  it('rate limit: a second test within 5 s → 429, allowed again after', async () => {
    let t = 0;
    const fake = fakeFetch(() =>
      jsonResponse(200, { models: [{ name: 'llama3' }] }),
    );
    const handler = makeHandler(
      { IBAI_OLLAMA_MODEL: 'llama3' },
      { fetchImpl: fake.fetchImpl, clock: () => t },
    );
    expect((await postTest(handler)).status).toBe(200);
    t = 4_999;
    const limited = await postTest(handler);
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body).error).toMatch(/wait 5 s/);
    t = 5_000;
    expect((await postTest(handler)).status).toBe(200);
    expect(fake.calls).toHaveLength(2);
  });

  describe('stalled response body (headers sent, body never ends)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const stalled = (): Response =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    for (const [label, env] of [
      ['Ollama', { IBAI_OLLAMA_MODEL: 'llama3' }],
      ['Anthropic', ANTHROPIC_ENV],
    ] as const) {
      it(`${label}: "did not answer" at the deadline; a retry is not 429`, async () => {
        vi.useFakeTimers();
        let stall = true;
        const fake = fakeFetch(() =>
          stall
            ? stalled()
            : jsonResponse(200, {
                models: [{ name: 'llama3' }],
                content: [{ type: 'text', text: 'Hi' }],
              }),
        );
        const test = createProviderTester({
          env,
          fetchImpl: fake.fetchImpl,
          clock: () => Date.now(),
        });
        const pending = test();
        await vi.advanceTimersByTimeAsync(TEST_TIMEOUT_MS);
        const outcome = await pending;
        expect(outcome.status).toBe(200);
        const body = outcome.body as ApiProviderTestResponse;
        expect(body.ok).toBe(false);
        expect(body.detail).toBe(
          `${label} did not answer within ${TEST_TIMEOUT_MS / 1000} s.`,
        );
        expect(fake.calls[0]?.init?.signal?.aborted).toBe(true);

        stall = false;
        const retry = await test();
        expect(retry.status).toBe(200);
        expect((retry.body as ApiProviderTestResponse).ok).toBe(true);
      });
    }
  });

  it('single flight: two concurrent tests → one 200 and one 429', async () => {
    let release: (res: Response) => void = () => undefined;
    const fake = fakeFetch(
      () =>
        new Promise<Response>((resolveFetch) => {
          release = resolveFetch;
        }),
    );
    let t = 0;
    const handler = makeHandler(
      { IBAI_OLLAMA_MODEL: 'llama3' },
      { fetchImpl: fake.fetchImpl, clock: () => t },
    );
    const first = postTest(handler);
    t = 60_000; // past the min interval: only the in-flight guard applies
    const second = await postTest(handler);
    release(jsonResponse(200, { models: [{ name: 'llama3' }] }));
    const statuses = [(await first).status, second.status].sort();
    expect(statuses).toEqual([200, 429]);
    expect(fake.calls).toHaveLength(1);
  });

  it('request body {endpoint, model} is ignored: target stays the env one', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(200, { models: [{ name: 'llama3' }] }),
    );
    const handler = makeHandler(
      { IBAI_OLLAMA_MODEL: 'llama3' },
      { fetchImpl: fake.fetchImpl },
    );
    const res = await handler({
      method: 'POST',
      url: '/api/settings/test-provider',
      body: JSON.stringify({ endpoint: 'http://169.254.169.254', model: 'x' }),
      contentType: 'application/json',
    });
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('http://127.0.0.1:11434/api/tags');
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.detail).toContain('"llama3"');
    expect(body.detail).not.toContain('"x"');
  });

  it('prechecks: cross-site Origin → 403, text/plain → 415, GET → 405; no call made', async () => {
    const fake = fakeFetch(() => jsonResponse(200, {}));
    const handler = makeHandler(ANTHROPIC_ENV, { fetchImpl: fake.fetchImpl });
    expect(
      (await postTest(handler, { origin: 'http://evil.example' })).status,
    ).toBe(403);
    expect((await postTest(handler, {}, 'text/plain')).status).toBe(415);
    expect(
      (await handler({ method: 'GET', url: '/api/settings/test-provider' }))
        .status,
    ).toBe(405);
    expect(fake.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// OpenAI-compatible (ADR 0011 D5)
// ---------------------------------------------------------------------------

const DMR_ENV = {
  IBAI_OPENAI_BASE_URL: 'http://localhost:12434/engines/v1/',
  IBAI_OPENAI_MODEL: 'ai/qwen3:4b-instruct-2507-q4_K_M',
};

describe('GET /api/settings — openai', () => {
  it('DMR host: kind openai, origin-only endpoint, DMR label, key presence only', async () => {
    const { res, body } = await getSettings(
      makeHandler({
        ...DMR_ENV,
        IBAI_OPENAI_BASE_URL: 'http://localhost:12434/engines/v1/?t=abc#x',
        IBAI_OPENAI_API_KEY: OAI_KEY,
      }),
    );
    expect(body.provider).toEqual({
      kind: 'openai',
      model: 'ai/qwen3:4b-instruct-2507-q4_K_M',
      endpoint: 'http://localhost:12434',
      keyConfigured: true,
      label: 'Docker Model Runner (local)',
    });
    expect(body.envHelp.find((e) => e.var === 'IBAI_OPENAI_API_KEY')?.set).toBe(
      true,
    );
    assertNoSecrets(res);
  });

  it('generic server: "OpenAI-compatible" label, path/query stripped', async () => {
    const { res, body } = await getSettings(
      makeHandler({
        IBAI_OPENAI_BASE_URL: `https://llm.example.com/v1?k=${OAI_KEY}`,
        IBAI_OPENAI_MODEL: 'gpt-x',
      }),
    );
    expect(body.provider).toEqual({
      kind: 'openai',
      model: 'gpt-x',
      endpoint: 'https://llm.example.com',
      keyConfigured: false,
      label: 'OpenAI-compatible',
    });
    assertNoSecrets(res);
  });

  it('key over plain http to a LAN host → none with a hint (no key echoed)', async () => {
    const { res, body } = await getSettings(
      makeHandler({
        IBAI_OPENAI_BASE_URL: 'http://192.168.1.9:8000/v1',
        IBAI_OPENAI_MODEL: 'm',
        IBAI_OPENAI_API_KEY: OAI_KEY,
      }),
    );
    expect(body.provider.kind).toBe('none');
    expect(body.provider.hint).toMatch(/plain http/);
    assertNoSecrets(res);
  });

  it.each([
    ['DMR', 'http://localhost:12434/engines/v1'],
    ['LM Studio', 'http://localhost:1234/v1'],
    ['LAN vLLM', 'http://192.168.1.9:8000/v1'],
    ['other https host', 'https://llm.example.com/v1'],
    ['look-alike host', 'https://api.openai.com.evil.example/v1'],
  ])('OPENAI_API_KEY + %s → not used (keyConfigured false)', async (_, url) => {
    const { res, body } = await getSettings(
      makeHandler({
        IBAI_OPENAI_BASE_URL: url,
        IBAI_OPENAI_MODEL: 'm',
        OPENAI_API_KEY: OAI_KEY,
      }),
    );
    expect(body.provider.kind).toBe('openai');
    expect(body.provider.keyConfigured).toBe(false);
    assertNoSecrets(res);
  });

  it('OPENAI_API_KEY + https://api.openai.com → used (keyConfigured true)', async () => {
    const { res, body } = await getSettings(
      makeHandler({
        IBAI_OPENAI_BASE_URL: 'https://api.openai.com/v1/',
        IBAI_OPENAI_MODEL: 'gpt-x',
        OPENAI_API_KEY: OAI_KEY,
      }),
    );
    expect(body.provider).toMatchObject({
      kind: 'openai',
      keyConfigured: true,
      label: 'OpenAI-compatible',
    });
    assertNoSecrets(res);
  });

  it('base URL with userinfo → none with a hint (URL never echoed)', async () => {
    const { res, body } = await getSettings(
      makeHandler({
        IBAI_OPENAI_BASE_URL: `https://u:${OAI_KEY}@llm.example.com/v1`,
        IBAI_OPENAI_MODEL: 'gpt-x',
      }),
    );
    expect(body.provider).toEqual({
      kind: 'none',
      model: null,
      endpoint: null,
      keyConfigured: false,
      hint: OPENAI_USERINFO_HINT,
    });
    assertNoSecrets(res);
  });

  it('Anthropic + OpenAI config → anthropic, with an "ignored" hint', async () => {
    const { res, body } = await getSettings(
      makeHandler({ ...ANTHROPIC_ENV, ...DMR_ENV }),
    );
    expect(body.provider.kind).toBe('anthropic');
    expect(body.provider.hint).toBe(OPENAI_IGNORED_HINT);
    assertNoSecrets(res);
  });

  it('rejected OpenAI config + Ollama → ollama, with a hint', async () => {
    const { res, body } = await getSettings(
      makeHandler({
        ...OLLAMA_ENV,
        IBAI_OPENAI_BASE_URL: 'http://192.168.1.9:8000/v1',
        IBAI_OPENAI_MODEL: 'm',
        IBAI_OPENAI_API_KEY: OAI_KEY,
      }),
    );
    expect(body.provider.kind).toBe('ollama');
    expect(body.provider.hint).toBe(
      `${OPENAI_INSECURE_KEY_HINT}; using Ollama instead`,
    );
    assertNoSecrets(res);
  });
});

describe('openAICompatibleLabel (ADR 0011 D5)', () => {
  it.each([
    ['http://model-runner.docker.internal/engines/v1', true],
    ['http://model-runner.docker.internal:12434/engines/llama.cpp/v1', true],
    ['http://localhost:12434/engines/v1', true],
    ['http://127.0.0.1:12434/engines/v1', true],
    ['http://[::1]:12434/engines/v1', true],
    ['http://172.17.0.1:12434/engines/v1', true],
    // Judged on the NORMALIZED URL (ADR 0011 D5).
    ['http://localhost:12434/engines', true],
    ['http://localhost:12434/engines/llama.cpp', true],
    ['http://localhost:12434', true],
    ['http://172.17.0.1:12434/', true],
    ['http://model-runner.docker.internal', true],
    // Same loopback rule as the provider (`isLoopbackHostname`).
    ['http://[::1]:12434', true],
    ['http://dmr.localhost:12434/engines/v1', true],
    ['http://localhost:12434/v1', false],
    ['http://localhost:1234/v1', false],
    ['http://10.0.0.5:12434/engines/v1', false],
    ['https://api.openai.com/v1', false],
    ['not a url', false],
  ])('%s → DMR %s', (url, dmr) => {
    expect(openAICompatibleLabel(url)).toBe(
      dmr ? 'Docker Model Runner (local)' : 'OpenAI-compatible',
    );
  });
});

describe('POST /api/settings/test-provider — openai', () => {
  it('HTTP 503 → the "starting or unavailable" loading state (ADR 0011 D4)', async () => {
    const fake = fakeFetch(() => jsonResponse(503, { error: 'loading' }));
    const res = await postTest(
      makeHandler(DMR_ENV, { fetchImpl: fake.fetchImpl }),
    );
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toBe(
      'Docker Model Runner is starting or unavailable (HTTP 503). Try again in a moment.',
    );
  });

  it('model listed → ok; GET <baseUrl>/models, no Authorization without a key', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(200, {
        object: 'list',
        data: [
          { id: 'ai/smollm2' },
          { id: 'ai/qwen3:4b-instruct-2507-q4_K_M' },
        ],
      }),
    );
    const res = await postTest(
      makeHandler(DMR_ENV, { fetchImpl: fake.fetchImpl }),
    );
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(true);
    expect(body.detail).toBe(
      'Docker Model Runner is reachable and lists the model "ai/qwen3:4b-instruct-2507-q4_K_M".',
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('http://localhost:12434/engines/v1/models');
    expect(fake.calls[0]?.init?.method).toBe('GET');
    expect(fake.calls[0]?.init?.headers).toEqual({
      Accept: 'application/json',
    });
  });

  it('with a key: Bearer header sent, never echoed; m ≡ m:latest', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(200, { data: [{ id: 'gpt-x:latest' }] }),
    );
    const res = await postTest(
      makeHandler(
        {
          IBAI_OPENAI_BASE_URL: 'https://llm.example.com/v1',
          IBAI_OPENAI_MODEL: 'gpt-x',
          IBAI_OPENAI_API_KEY: OAI_KEY,
        },
        { fetchImpl: fake.fetchImpl },
      ),
    );
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(true);
    expect(
      (fake.calls[0]?.init?.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${OAI_KEY}`);
    assertNoSecrets(res);
  });

  it('model not listed → ok:false (DMR: pull hint; generic: check the model)', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(200, { data: [{ id: 'other' }] }),
    );
    const dmr = JSON.parse(
      (await postTest(makeHandler(DMR_ENV, { fetchImpl: fake.fetchImpl })))
        .body,
    ) as ApiProviderTestResponse;
    expect(dmr.ok).toBe(false);
    expect(dmr.detail).toMatch(
      /not listed\. Run: docker model pull ai\/qwen3:4b-instruct-2507-q4_K_M$/,
    );
    const generic = JSON.parse(
      (
        await postTest(
          makeHandler(
            {
              IBAI_OPENAI_BASE_URL: 'http://localhost:1234/v1',
              IBAI_OPENAI_MODEL: 'm',
            },
            { fetchImpl: fake.fetchImpl },
          ),
        )
      ).body,
    ) as ApiProviderTestResponse;
    expect(generic.ok).toBe(false);
    expect(generic.detail).toBe(
      'The OpenAI-compatible server is reachable, but does not list the model "m". Check IBAI_OPENAI_MODEL.',
    );
  });

  it('not a model list → ok:false', async () => {
    const fake = fakeFetch(() => jsonResponse(200, { models: [] }));
    const body = JSON.parse(
      (await postTest(makeHandler(DMR_ENV, { fetchImpl: fake.fetchImpl })))
        .body,
    ) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toMatch(/not with a model list/);
  });

  it('unreachable → sanitized detail with the origin only', async () => {
    const env = {
      ...DMR_ENV,
      IBAI_OPENAI_BASE_URL: `http://localhost:12434/engines/v1?token=${OAI_KEY}`,
    };
    const fake = fakeFetch(() => {
      throw new TypeError(`fetch failed ${env.IBAI_OPENAI_BASE_URL}`);
    });
    const res = await postTest(makeHandler(env, { fetchImpl: fake.fetchImpl }));
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toBe(
      'Could not reach Docker Model Runner at http://localhost:12434. Is Docker Model Runner enabled? Docker Desktop: Settings → AI → Enable Docker Model Runner. Docker Engine: install the docker-model-plugin package (check with `docker model status`).',
    );
    assertNoSecrets(res);
  });

  it('HTTP 401 → fixed "rejected the API key" text; body never echoed', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(401, {
        error: { type: 'invalid_request_error', message: `bad key ${OAI_KEY}` },
      }),
    );
    const res = await postTest(
      makeHandler(
        {
          IBAI_OPENAI_BASE_URL: 'https://llm.example.com/v1',
          IBAI_OPENAI_MODEL: 'gpt-x',
          IBAI_OPENAI_API_KEY: OAI_KEY,
        },
        { fetchImpl: fake.fetchImpl },
      ),
    );
    const body = JSON.parse(res.body) as ApiProviderTestResponse;
    expect(body.ok).toBe(false);
    expect(body.detail).toBe(
      'The OpenAI-compatible server rejected the API key (HTTP 401) (invalid_request_error). Check the key in your environment.',
    );
    assertNoSecrets(res);
  });

  it('base URL with userinfo → provider none, no call', async () => {
    const fake = fakeFetch(() => jsonResponse(200, { data: [] }));
    const res = await postTest(
      makeHandler(
        {
          IBAI_OPENAI_BASE_URL: `http://u:${OAI_KEY}@localhost:12434/engines/v1`,
          IBAI_OPENAI_MODEL: 'm',
        },
        { fetchImpl: fake.fetchImpl },
      ),
    );
    expect(res.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
    assertNoSecrets(res);
  });

  it('OPENAI_API_KEY + DMR → GET /models sends no Authorization header', async () => {
    const fake = fakeFetch(() =>
      jsonResponse(200, { data: [{ id: DMR_ENV.IBAI_OPENAI_MODEL }] }),
    );
    const res = await postTest(
      makeHandler(
        { ...DMR_ENV, OPENAI_API_KEY: OAI_KEY },
        { fetchImpl: fake.fetchImpl },
      ),
    );
    expect(fake.calls).toHaveLength(1);
    expect(
      (fake.calls[0]?.init?.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    assertNoSecrets(res);
  });

  it('timeout → "did not answer" at the shared 5 s deadline', async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeFetch(
        (call) =>
          new Promise<Response>((_, rejectFetch) => {
            call.init?.signal?.addEventListener('abort', () =>
              rejectFetch(new Error('aborted')),
            );
          }),
      );
      const test = createProviderTester({
        env: DMR_ENV,
        fetchImpl: fake.fetchImpl,
        clock: () => Date.now(),
      });
      const pending = test();
      await vi.advanceTimersByTimeAsync(TEST_TIMEOUT_MS);
      const body = (await pending).body as ApiProviderTestResponse;
      expect(body.ok).toBe(false);
      expect(body.detail).toBe(
        `Docker Model Runner did not answer within ${TEST_TIMEOUT_MS / 1000} s.`,
      );
      expect(fake.calls[0]?.init?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
