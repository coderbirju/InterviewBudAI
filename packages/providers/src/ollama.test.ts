import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { OllamaProvider } from './ollama.js';
import type { CompletionRequest } from './index.js';

describe('OllamaProvider', () => {
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
      const ollamaResponse = {
        model: 'llama3',
        created_at: '2024-01-01T00:00:00Z',
        message: { role: 'assistant', content: 'Hello, world!' },
        done: true,
        done_reason: 'stop',
        total_duration: 5000000000,
        prompt_eval_count: 26,
        eval_count: 290,
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(ollamaResponse));

      const provider = new OllamaProvider({
        model: 'llama3',
        fetchImpl: mockFetch,
      });

      const request: CompletionRequest = {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi there' },
        ],
        options: {
          temperature: 0.7,
          maxTokens: 1000,
          topP: 0.9,
          stop: ['\n\n'],
        },
      };

      const result = await provider.complete(request);

      // Verify fetch was called with correct arguments
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:11434/api/chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3',
            messages: [
              { role: 'system', content: 'You are helpful.' },
              { role: 'user', content: 'Hi there' },
            ],
            stream: false,
            options: {
              temperature: 0.7,
              num_predict: 1000,
              top_p: 0.9,
              stop: ['\n\n'],
            },
          }),
        },
      );

      // Verify response mapping
      expect(result.content).toBe('Hello, world!');
      expect(result.usage).toEqual({
        promptTokens: 26,
        completionTokens: 290,
        totalTokens: 316,
      });
      expect(result.metadata).toEqual({
        model: 'llama3',
        done: true,
        done_reason: 'stop',
        created_at: '2024-01-01T00:00:00Z',
        total_duration: 5000000000,
      });
    });

    it('handles response with only prompt_eval_count', async () => {
      const ollamaResponse = {
        message: { role: 'assistant', content: 'Response' },
        prompt_eval_count: 50,
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(ollamaResponse));

      const provider = new OllamaProvider({
        model: 'mistral',
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

    it('handles response with only eval_count', async () => {
      const ollamaResponse = {
        message: { role: 'assistant', content: 'Response' },
        eval_count: 100,
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(ollamaResponse));

      const provider = new OllamaProvider({
        model: 'mistral',
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

    it('handles response with no token counts', async () => {
      const ollamaResponse = {
        message: { role: 'assistant', content: 'Response' },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(ollamaResponse));

      const provider = new OllamaProvider({
        model: 'mistral',
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
      const ollamaResponse = {
        message: { role: 'assistant', content: 'Response' },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(ollamaResponse));

      const provider = new OllamaProvider({
        model: 'llama3',
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

      const [, requestInit] = mockFetch.mock.calls[0];
      const body = JSON.parse(requestInit.body as string);

      expect(body.options).toEqual({
        temperature: 0.9, // Overridden
        num_predict: 500, // From default
        top_p: 0.8, // New
      });
    });

    it('uses only defaultOptions when no request options', async () => {
      const ollamaResponse = {
        message: { role: 'assistant', content: 'Response' },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(ollamaResponse));

      const provider = new OllamaProvider({
        model: 'llama3',
        defaultOptions: {
          temperature: 0.5,
        },
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [, requestInit] = mockFetch.mock.calls[0];
      const body = JSON.parse(requestInit.body as string);

      expect(body.options).toEqual({
        temperature: 0.5,
      });
    });

    it('omits options object entirely when no options provided', async () => {
      const ollamaResponse = {
        message: { role: 'assistant', content: 'Response' },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(ollamaResponse));

      const provider = new OllamaProvider({
        model: 'llama3',
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [, requestInit] = mockFetch.mock.calls[0];
      const body = JSON.parse(requestInit.body as string);

      expect(body.options).toBeUndefined();
    });
  });

  describe('custom endpoint override', () => {
    it('uses custom endpoint when provided', async () => {
      const ollamaResponse = {
        message: { role: 'assistant', content: 'Response' },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(ollamaResponse));

      const provider = new OllamaProvider({
        model: 'llama3',
        endpoint: 'http://custom-host:8080',
        fetchImpl: mockFetch,
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom-host:8080/api/chat',
        expect.any(Object),
      );
    });
  });

  describe('error handling', () => {
    it('rejects with status code and body snippet on non-2xx response', async () => {
      const errorBody = { error: 'Model not found' };
      mockFetch.mockResolvedValueOnce(
        createMockResponse(errorBody, { status: 500, ok: false }),
      );

      const provider = new OllamaProvider({
        model: 'nonexistent',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Ollama returned HTTP 500');
    });

    it('rejects with descriptive error on network throw', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const provider = new OllamaProvider({
        model: 'llama3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow(
        'Ollama request failed to http://127.0.0.1:11434/api/chat: Connection refused',
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

      const provider = new OllamaProvider({
        model: 'llama3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Ollama returned invalid JSON response');
    });

    it('rejects when message.content is missing', async () => {
      const malformedResponse = {
        message: { role: 'assistant' }, // No content
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(malformedResponse));

      const provider = new OllamaProvider({
        model: 'llama3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow(
        'Ollama response missing required field: message.content must be a string',
      );
    });

    it('rejects when message is missing', async () => {
      const malformedResponse = {
        model: 'llama3',
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(malformedResponse));

      const provider = new OllamaProvider({
        model: 'llama3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow(
        'Ollama response missing required field: message.content must be a string',
      );
    });

    it('rejects when message.content is not a string', async () => {
      const malformedResponse = {
        message: { role: 'assistant', content: 123 },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(malformedResponse));

      const provider = new OllamaProvider({
        model: 'llama3',
        fetchImpl: mockFetch,
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow(
        'Ollama response missing required field: message.content must be a string',
      );
    });
  });
});

describe('OllamaProvider — responseFormat (additive JSON hint)', () => {
  const ok = (): Response =>
    new Response(
      JSON.stringify({ message: { role: 'assistant', content: '{}' } }),
      { status: 200 },
    );

  it("maps responseFormat: 'json' to format: 'json'; absent otherwise", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const p = new OllamaProvider({ model: 'llama3', fetchImpl });
    await p.complete({
      messages: [{ role: 'user', content: 'x' }],
      options: { responseFormat: 'json' },
    });
    await p.complete({ messages: [{ role: 'user', content: 'x' }] });
    const bodies = fetchImpl.mock.calls.map(
      (c) =>
        JSON.parse(
          String((c as unknown as [string, RequestInit])[1].body),
        ) as Record<string, unknown>,
    );
    expect(bodies[0]?.format).toBe('json');
    expect(bodies[0]).not.toHaveProperty('options');
    expect(bodies[1]).not.toHaveProperty('format');
  });
});
