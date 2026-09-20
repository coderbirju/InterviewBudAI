import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import type { CompletionRequest } from './index.js';

describe('AnthropicProvider', () => {
  let mockFetch: Mock;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  // Helper to create a mock Response
  function createMockResponse(
    body: unknown,
    options: { status?: number; ok?: boolean } = {},
  ): Response {
    const { status = 200, ok = true } = options;
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }

  describe('success mapping', () => {
    it('sends correct request to default endpoint and maps response', async () => {
      const anthropicResponse = {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ' world' },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
        model: 'claude-x',
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3-5-sonnet-20241022',
        fetchImpl: mockFetch,
      });

      const request: CompletionRequest = {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi there' },
          { role: 'assistant', content: 'Hello!' },
        ],
        options: {
          temperature: 0.7,
          maxTokens: 2000,
          topP: 0.9,
          stop: ['\n\n'],
        },
      };

      const result = await provider.complete(request);

      // Verify fetch was called with correct arguments
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];

      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      });

      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.model).toBe('claude-3-5-sonnet-20241022');
      expect(body.system).toBe('You are helpful.');
      expect(body.messages).toEqual([
        { role: 'user', content: 'Hi there' },
        { role: 'assistant', content: 'Hello!' },
      ]);
      expect(body.max_tokens).toBe(2000);
      expect(body.temperature).toBe(0.7);
      expect(body.top_p).toBe(0.9);
      expect(body.stop_sequences).toEqual(['\n\n']);

      // Verify response mapping
      expect(result.content).toBe('Hello world');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      expect(result.metadata).toEqual({
        stopReason: 'end_turn',
        model: 'claude-x',
      });
    });

    it('uses DEFAULT_MAX_TOKENS (1024) when no options provided', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.max_tokens).toBe(1024);
    });

    it('uses DEFAULT_MAX_TOKENS when options provided but maxTokens missing', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        options: { temperature: 0.5 },
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.max_tokens).toBe(1024);
      expect(body.temperature).toBe(0.5);
    });

    it('joins multiple system messages with newlines into top-level system field', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'Hi' },
        ],
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.system).toBe('You are helpful.\n\nBe concise.');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    });

    it('omits system field when no system messages present', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.system).toBeUndefined();
    });

    it('handles response with zero text blocks (empty content)', async () => {
      const anthropicResponse = {
        content: [{ type: 'tool_use', id: 'xyz' }], // No text blocks
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.content).toBe('');
    });

    it('handles response with only input_tokens', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 50 },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.usage).toEqual({
        promptTokens: 50,
        totalTokens: 50,
      });
    });

    it('handles response with only output_tokens', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
        usage: { output_tokens: 100 },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.usage).toEqual({
        completionTokens: 100,
        totalTokens: 100,
      });
    });

    it('handles response with no usage', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.usage).toBeUndefined();
    });
  });

  describe('options passthrough and defaults merge', () => {
    it('merges defaultOptions with request options (request wins)', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        defaultOptions: {
          temperature: 0.5,
          maxTokens: 500,
        },
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        options: {
          temperature: 0.9, // Override default
          topP: 0.8, // Add new option
        },
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;

      expect(body.temperature).toBe(0.9); // Overridden
      expect(body.max_tokens).toBe(500); // From default
      expect(body.top_p).toBe(0.8); // New
    });

    it('uses only defaultOptions when no request options', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        defaultOptions: {
          temperature: 0.5,
          maxTokens: 800,
        },
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;

      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(800);
    });
  });

  describe('custom endpoint and version override', () => {
    it('uses custom endpoint when provided', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        endpoint: 'https://custom.anthropic.example/v1/messages',
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://custom.anthropic.example/v1/messages');
    });

    it('uses custom anthropicVersion when provided', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        anthropicVersion: '2024-01-01',
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['anthropic-version']).toBe('2024-01-01');
    });
  });

  describe('error handling', () => {
    it('rejects with status code and body snippet on non-2xx response', async () => {
      const errorBody = { error: { message: 'Invalid API key' } };
      mockFetch.mockResolvedValueOnce(
        createMockResponse(errorBody, { status: 401, ok: false }),
      );

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Anthropic returned HTTP 401');
    });

    it('rejects with descriptive error on network throw', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow(
        'Anthropic request failed to https://api.anthropic.com/v1/messages: Connection refused',
      );
    });

    it('rejects on invalid JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token');
        },
      } as Response);

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Anthropic returned invalid JSON response');
    });

    it('rejects when content is not an array', async () => {
      const malformedResponse = {
        content: 'not an array',
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(malformedResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Anthropic response has invalid content array shape');
    });

    it('rejects when content is missing', async () => {
      const malformedResponse = {
        model: 'claude-3',
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(malformedResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Anthropic response has invalid content array shape');
    });

    it('rejects when text block has non-string text', async () => {
      const malformedResponse = {
        content: [{ type: 'text', text: 123 }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(malformedResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Anthropic response has invalid content array shape');
    });

    it('rejects with HTTP 400 error', async () => {
      const errorBody = { error: { message: 'Bad request' } };
      mockFetch.mockResolvedValueOnce(
        createMockResponse(errorBody, { status: 400, ok: false }),
      );

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Anthropic returned HTTP 400');
    });
  });

  describe('headers security', () => {
    it('uses dummy test-key in headers (never exposes real key)', async () => {
      const anthropicResponse = {
        content: [{ type: 'text', text: 'Response' }],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(anthropicResponse));

      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3',
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-key');
    });
  });
});
