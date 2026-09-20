import { describe, it, expect, vi, type Mock } from 'vitest';
import { postJson } from './http-provider.js';

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
