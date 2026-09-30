import { describe, it, expect, vi, type Mock } from 'vitest';
import { HttpProviderError, postJson } from './http-provider.js';

describe('postJson', () => {
  function createMockFetch(response: {
    ok: boolean;
    status: number;
    json?: unknown;
    text?: string;
  }): Mock {
    return vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json:
        response.json !== undefined
          ? async () => response.json
          : async () => {
              throw new Error('Invalid JSON');
            },
      text: async () => response.text ?? JSON.stringify(response.json ?? {}),
    } as Response);
  }

  it('returns parsed JSON on success', async () => {
    const mockFetch = createMockFetch({
      ok: true,
      status: 200,
      json: { result: 'success' },
    });

    const result = await postJson({
      url: 'https://api.example.com/endpoint',
      headers: { 'content-type': 'application/json' },
      body: '{"test":true}',
      fetchImpl: mockFetch,
      providerName: 'TestProvider',
    });

    expect(result).toEqual({ result: 'success' });
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/endpoint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"test":true}',
    });
  });

  it('rejects with provider-labeled error on network failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      postJson({
        url: 'https://api.example.com/endpoint',
        headers: {},
        body: '{}',
        fetchImpl: mockFetch,
        providerName: 'TestProvider',
      }),
    ).rejects.toThrow(
      'TestProvider request failed to https://api.example.com/endpoint: ECONNREFUSED',
    );
  });

  it('rejects with status and body snippet on non-2xx response', async () => {
    const mockFetch = createMockFetch({
      ok: false,
      status: 500,
      text: '{"error":"Internal server error"}',
    });

    await expect(
      postJson({
        url: 'https://api.example.com/endpoint',
        headers: {},
        body: '{}',
        fetchImpl: mockFetch,
        providerName: 'TestProvider',
      }),
    ).rejects.toThrow(
      'TestProvider returned HTTP 500: {"error":"Internal server error"}',
    );
  });

  it('truncates long error body to 500 chars', async () => {
    const longBody = 'x'.repeat(1000);
    const mockFetch = createMockFetch({
      ok: false,
      status: 400,
      text: longBody,
    });

    await expect(
      postJson({
        url: 'https://api.example.com/endpoint',
        headers: {},
        body: '{}',
        fetchImpl: mockFetch,
        providerName: 'TestProvider',
      }),
    ).rejects.toThrow(
      new RegExp(`TestProvider returned HTTP 400: ${'x'.repeat(500)}$`),
    );
  });

  it('rejects with provider-labeled error on invalid JSON response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token');
      },
    } as unknown as Response);

    await expect(
      postJson({
        url: 'https://api.example.com/endpoint',
        headers: {},
        body: '{}',
        fetchImpl: mockFetch,
        providerName: 'TestProvider',
      }),
    ).rejects.toThrow('TestProvider returned invalid JSON response');
  });

  it('handles error reading body on non-2xx gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => {
        throw new Error('Stream error');
      },
    } as unknown as Response);

    await expect(
      postJson({
        url: 'https://api.example.com/endpoint',
        headers: {},
        body: '{}',
        fetchImpl: mockFetch,
        providerName: 'TestProvider',
      }),
    ).rejects.toThrow('TestProvider returned HTTP 503: ');
  });
});

describe('postJson — typed errors + optional deadline (additive)', () => {
  const base = {
    url: 'http://x.test/p',
    headers: {},
    body: '{}',
    providerName: 'P',
  };

  it('classifies connection / http / malformed with kind + status', async () => {
    const kinds: unknown[] = [];
    const fetches: Array<typeof fetch> = [
      (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
      (async () => new Response('nope', { status: 503 })) as typeof fetch,
      (async () => new Response('<html>', { status: 200 })) as typeof fetch,
    ];
    for (const fetchImpl of fetches) {
      try {
        await postJson({ ...base, fetchImpl });
      } catch (e) {
        expect(e).toBeInstanceOf(HttpProviderError);
        const err = e as HttpProviderError;
        kinds.push([err.kind, err.status, err.bodySnippet]);
      }
    }
    expect(kinds).toEqual([
      ['connection', undefined, undefined],
      ['http', 503, 'nope'],
      ['malformed', undefined, undefined],
    ]);
  });

  it('timeoutMs aborts a hung request with kind "timeout"', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const err = (await postJson({ ...base, fetchImpl, timeoutMs: 10 }).catch(
      (e: unknown) => e,
    )) as HttpProviderError;
    expect(err.kind).toBe('timeout');
    expect(signal?.aborted).toBe(true);
  });

  it('without timeoutMs no signal is attached (historical behavior)', async () => {
    let init: RequestInit | undefined;
    const fetchImpl = (async (_: unknown, i?: RequestInit) => {
      init = i;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await postJson({ ...base, fetchImpl });
    expect(init).not.toHaveProperty('signal');
  });
});
