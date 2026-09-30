import { describe, it, expect, vi } from 'vitest';
import {
  OpenAICompatibleProvider,
  normalizeOpenAIBaseUrl,
  openAIKeyTransportAllowed,
} from './openai-compatible.js';
import type { OpenAICompatibleProviderConfig } from './openai-compatible.js';
import type { CompletionRequest } from './index.js';

const KEY = 'sk-oai-SECRET-do-not-leak-42';
const BASE = 'http://localhost:12434/engines/v1';

interface Call {
  url: string;
  init: RequestInit;
}

function fake(respond: (call: Call) => Promise<Response> | Response): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OK = {
  model: 'ai/smollm2',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello!' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
};

function provider(
  fetchImpl: typeof fetch,
  extra: Partial<OpenAICompatibleProviderConfig> = {},
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: BASE,
    model: 'ai/smollm2',
    fetchImpl,
    ...extra,
  });
}

const REQ: CompletionRequest = {
  messages: [
    { role: 'system', content: 'You are terse.' },
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hey.' },
    { role: 'user', content: 'Again' },
  ],
};

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init.body)) as Record<string, unknown>;
}

async function errorOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a rejection');
}

describe('OpenAICompatibleProvider — request shape', () => {
  it('POSTs <baseUrl>/chat/completions with model + messages (roles 1:1)', async () => {
    const f = fake(() => json(200, OK));
    const res = await provider(f.fetchImpl).complete(REQ);

    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe(`${BASE}/chat/completions`);
    expect(f.calls[0]?.init.method).toBe('POST');
    expect(bodyOf(f.calls[0])).toEqual({
      model: 'ai/smollm2',
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hey.' },
        { role: 'user', content: 'Again' },
      ],
    });
    expect(res).toEqual({
      content: 'Hello!',
      usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 },
      metadata: { finishReason: 'stop', model: 'ai/smollm2' },
    });
  });

  it('maps options (request wins over defaults); no response_format unless asked', async () => {
    const f = fake(() => json(200, OK));
    await provider(f.fetchImpl, {
      defaultOptions: { temperature: 0.1, maxTokens: 50 },
    }).complete({
      ...REQ,
      options: { temperature: 0.7, topP: 0.9, stop: ['\n\n'] },
    });
    const body = bodyOf(f.calls[0]);
    expect(body.max_tokens).toBe(50);
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.stop).toEqual(['\n\n']);
    expect(body).not.toHaveProperty('response_format');
  });

  it("sends response_format json_object only when responseFormat: 'json'", async () => {
    const f = fake(() => json(200, OK));
    await provider(f.fetchImpl).complete({
      ...REQ,
      options: { responseFormat: 'json' },
    });
    expect(bodyOf(f.calls[0]).response_format).toEqual({ type: 'json_object' });
  });

  it('sends no Authorization header without a key (and with an empty key)', async () => {
    for (const apiKey of [undefined, '']) {
      const f = fake(() => json(200, OK));
      await provider(
        f.fetchImpl,
        apiKey === undefined ? {} : { apiKey },
      ).complete(REQ);
      const headers = f.calls[0]?.init.headers as Record<string, string>;
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
    }
  });

  it('sends Authorization: Bearer <key> when a key is set', async () => {
    const f = fake(() => json(200, OK));
    await provider(f.fetchImpl, { apiKey: KEY }).complete(REQ);
    const headers = f.calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it('performs no I/O on construction', () => {
    const f = fake(() => json(200, OK));
    provider(f.fetchImpl, { apiKey: KEY });
    expect(f.calls).toHaveLength(0);
  });
});

describe('normalizeOpenAIBaseUrl', () => {
  it.each([
    ['http://localhost:12434/engines/v1', 'http://localhost:12434/engines/v1'],
    ['http://localhost:12434/engines/v1/', 'http://localhost:12434/engines/v1'],
    [
      'http://localhost:12434/engines/v1//',
      'http://localhost:12434/engines/v1',
    ],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['http://localhost:11434', 'http://localhost:11434/v1'],
    ['http://localhost:11434/', 'http://localhost:11434/v1'],
    [
      'http://model-runner.docker.internal/engines/llama.cpp/v1',
      'http://model-runner.docker.internal/engines/llama.cpp/v1',
    ],
    ['http://localhost:8080/v1/chat/completions', 'http://localhost:8080/v1'],
    ['http://localhost:8080/v1/models/', 'http://localhost:8080/v1'],
    ['http://localhost:8080/openai', 'http://localhost:8080/openai'],
    ['  http://localhost:8080/v1?x=1#y  ', 'http://localhost:8080/v1'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeOpenAIBaseUrl(raw)).toBe(expected);
  });

  it('never double-appends /v1', () => {
    const once = normalizeOpenAIBaseUrl('http://localhost:11434');
    expect(normalizeOpenAIBaseUrl(once)).toBe(once);
  });

  it('rejects non-URLs and non-http(s) schemes without echoing input', () => {
    expect(() => normalizeOpenAIBaseUrl(`not a url ${KEY}`)).toThrow(
      /not a valid URL/,
    );
    try {
      normalizeOpenAIBaseUrl(`not a url ${KEY}`);
    } catch (e) {
      expect((e as Error).message).not.toContain(KEY);
    }
    expect(() => normalizeOpenAIBaseUrl('file:///etc/passwd')).toThrow(
      /http or https/,
    );
  });

  it('complete() refuses a base URL with userinfo (no call, not echoed)', async () => {
    const f = fake(() => json(200, OK));
    const err = await errorOf(
      provider(f.fetchImpl, {
        baseUrl: `http://user:${KEY}@localhost:12434/engines/v1`,
      }).complete(REQ),
    );
    expect(err.message).toMatch(/must not contain a username\/password/);
    expect(err.message).not.toContain(KEY);
    expect(f.calls).toHaveLength(0);
  });
});

describe('OpenAICompatibleProvider — untrusted response + error classification', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['not an object', 'hello', /malformed: expected a "choices" array/],
    ['no choices', { id: 'x' }, /malformed: expected a "choices" array/],
    ['choices not an array', { choices: {} }, /malformed/],
    ['empty choices', { choices: [] }, /empty response \(no choices\)/],
    [
      'missing message',
      { choices: [{}] },
      /malformed: choices\[0\]\.message\.content/,
    ],
    [
      'numeric content',
      { choices: [{ message: { content: 42 } }] },
      /malformed: choices\[0\]\.message\.content must be a string/,
    ],
    [
      'null content',
      { choices: [{ message: { content: null } }] },
      /empty response \(no content\)/,
    ],
    [
      'empty content',
      { choices: [{ message: { content: '' } }] },
      /empty response \(no content\)/,
    ],
    [
      'whitespace content',
      { choices: [{ message: { content: '  \n' } }] },
      /empty response \(no content\)/,
    ],
  ];
  for (const [label, body, pattern] of cases) {
    it(`rejects ${label}`, async () => {
      const f = fake(() => json(200, body));
      const err = await errorOf(provider(f.fetchImpl).complete(REQ));
      expect(err.message).toMatch(pattern);
    });
  }

  it('ignores junk usage fields instead of trusting them', async () => {
    const f = fake(() =>
      json(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 'many', completion_tokens: null },
      }),
    );
    expect(await provider(f.fetchImpl).complete(REQ)).toEqual({
      content: 'ok',
    });
  });

  it('invalid JSON body → malformed', async () => {
    const f = fake(() => new Response('<html>oops', { status: 200 }));
    const err = await errorOf(provider(f.fetchImpl).complete(REQ));
    expect(err.message).toBe(
      'OpenAI-compatible server response is malformed: invalid JSON',
    );
  });

  it('HTTP 401 → auth error naming the env var; key and body never echoed', async () => {
    const f = fake(() =>
      json(401, { error: { message: `Incorrect API key provided: ${KEY}` } }),
    );
    const err = await errorOf(
      provider(f.fetchImpl, { apiKey: KEY }).complete(REQ),
    );
    expect(err.message).toMatch(/HTTP 401 unauthorized/);
    expect(err.message).toMatch(/IBAI_OPENAI_API_KEY/);
    expect(err.message).not.toContain(KEY);
  });

  it('HTTP 404 → model/endpoint not found', async () => {
    const f = fake(() => json(404, { error: 'model not found' }));
    const err = await errorOf(provider(f.fetchImpl).complete(REQ));
    expect(err.message).toMatch(/HTTP 404: model or endpoint not found/);
  });

  it('HTTP 500 → status + short snippet with the key redacted', async () => {
    const f = fake(
      () => new Response(`boom ${KEY} ${'x'.repeat(400)}`, { status: 500 }),
    );
    const err = await errorOf(
      provider(f.fetchImpl, { apiKey: KEY }).complete(REQ),
    );
    expect(err.message).toMatch(
      /^OpenAI-compatible server returned HTTP 500: boom \[redacted\]/,
    );
    expect(err.message).not.toContain(KEY);
    expect(err.message.length).toBeLessThan(300);
  });

  it('connection failure → "network error" with the origin only (no path/userinfo)', async () => {
    const f = fake(() => {
      throw new TypeError(`fetch failed: ECONNREFUSED ${BASE}?k=${KEY}`);
    });
    const err = await errorOf(
      provider(f.fetchImpl, { apiKey: KEY }).complete(REQ),
    );
    expect(err.message).toBe(
      'OpenAI-compatible server request failed: network error — could not reach http://localhost:12434. Is the server running?',
    );
    expect(err.message).not.toContain(KEY);
  });

  it('timeout (fetch never settles) → "timed out", request aborted', async () => {
    const f = fake(
      (call) =>
        new Promise<Response>((_, reject) => {
          call.init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const err = await errorOf(
      provider(f.fetchImpl, { timeoutMs: 20 }).complete(REQ),
    );
    expect(err.message).toBe(
      'OpenAI-compatible server at http://localhost:12434 timed out after 20 ms',
    );
    expect(f.calls[0]?.init.signal?.aborted).toBe(true);
  });

  it('timeout also covers a stalled body (headers sent, body never ends)', async () => {
    vi.useFakeTimers();
    try {
      const f = fake(
        () =>
          new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 200,
          }),
      );
      const pending = errorOf(
        provider(f.fetchImpl, { timeoutMs: 5_000 }).complete(REQ),
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await pending).message).toMatch(/timed out after 5 s$/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OpenAICompatibleProvider — JSON-mode capability latch (ADR 0011 D1)', () => {
  const rejectFormat = (): Response =>
    json(400, {
      error: { message: "Unrecognized request argument: 'response_format'" },
    });

  it('400 mentioning response_format → one retry without it, latched for later calls', async () => {
    const f = fake((call) =>
      bodyOf(call).response_format ? rejectFormat() : json(200, OK),
    );
    const p = provider(f.fetchImpl);
    const jsonReq = { ...REQ, options: { responseFormat: 'json' as const } };
    expect((await p.complete(jsonReq)).content).toBe('Hello!');
    expect(f.calls).toHaveLength(2);
    expect(bodyOf(f.calls[0]).response_format).toEqual({ type: 'json_object' });
    expect(bodyOf(f.calls[1])).not.toHaveProperty('response_format');

    await p.complete(jsonReq);
    expect(f.calls).toHaveLength(3);
    expect(bodyOf(f.calls[2])).not.toHaveProperty('response_format');
  });

  it('a 400 NOT about response_format is not retried', async () => {
    const f = fake(() => json(400, { error: { message: 'bad temperature' } }));
    const err = await errorOf(
      provider(f.fetchImpl).complete({
        ...REQ,
        options: { responseFormat: 'json' },
      }),
    );
    expect(err.message).toMatch(/HTTP 400/);
    expect(f.calls).toHaveLength(1);
  });

  it('without JSON mode a response_format 400 is not retried', async () => {
    const f = fake(() => rejectFormat());
    await errorOf(provider(f.fetchImpl).complete(REQ));
    expect(f.calls).toHaveLength(1);
  });

  it("responseFormat: 'text' sends no response_format", async () => {
    const f = fake(() => json(200, OK));
    await provider(f.fetchImpl).complete({
      ...REQ,
      options: { responseFormat: 'text' },
    });
    expect(bodyOf(f.calls[0])).not.toHaveProperty('response_format');
  });
});

describe('OpenAICompatibleProvider — key transport rule (ADR 0011 D1)', () => {
  it.each([
    ['https://api.example.com/v1', true, true],
    ['http://localhost:12434/engines/v1', true, true],
    ['http://127.0.0.1:1234/v1', true, true],
    ['http://[::1]:8080/v1', true, true],
    ['http://model-runner.docker.internal/engines/v1', true, true],
    ['http://192.168.1.20:8000/v1', true, false],
    ['http://172.17.0.1:12434/engines/v1', true, false],
    ['http://192.168.1.20:8000/v1', false, true],
    ['not a url', true, false],
  ])('%s (key: %s) → %s', (url, hasKey, allowed) => {
    expect(openAIKeyTransportAllowed(url, hasKey)).toBe(allowed);
  });

  it('refuses a key over plain http to a LAN host (no call, key not echoed)', async () => {
    const f = fake(() => json(200, OK));
    const err = await errorOf(
      provider(f.fetchImpl, {
        baseUrl: 'http://192.168.1.20:8000/v1',
        apiKey: KEY,
      }).complete(REQ),
    );
    expect(err.message).toMatch(/refusing to send an API key over plain http/);
    expect(err.message).not.toContain(KEY);
    expect(f.calls).toHaveLength(0);
  });

  it('no key → plain http to a LAN host is allowed', async () => {
    const f = fake(() => json(200, OK));
    await provider(f.fetchImpl, {
      baseUrl: 'http://192.168.1.20:8000/v1',
    }).complete(REQ);
    expect(f.calls[0]?.url).toBe(
      'http://192.168.1.20:8000/v1/chat/completions',
    );
  });
});

describe('OpenAICompatibleProvider — 1 MiB body cap', () => {
  it('rejects an oversized body as malformed', async () => {
    const big = JSON.stringify({
      choices: [{ message: { content: 'x'.repeat(1024 * 1024 + 10) } }],
    });
    const f = fake(() => new Response(big, { status: 200 }));
    const err = await errorOf(provider(f.fetchImpl).complete(REQ));
    expect(err.message).toBe(
      'OpenAI-compatible server response is malformed: too large (over 1 MiB)',
    );
  });
});
