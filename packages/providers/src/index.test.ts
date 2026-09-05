import { describe, it, expect } from 'vitest';
import type {
  MessageRole,
  PromptMessage,
  CompletionOptions,
  CompletionRequest,
  CompletionUsage,
  CompletionResponse,
  LlmProvider,
} from './index.js';

describe('@ibai/providers interface contracts', () => {
  it('exports MessageRole type that accepts valid roles', () => {
    const roles: MessageRole[] = ['system', 'user', 'assistant'];
    expect(roles).toHaveLength(3);
  });

  it('exports PromptMessage type that compiles with correct shape', () => {
    const msg: PromptMessage = {
      role: 'user',
      content: 'Hello',
    };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
  });

  it('exports CompletionOptions type that compiles with correct shape', () => {
    const opts: CompletionOptions = {
      temperature: 0.7,
      maxTokens: 1000,
      topP: 0.9,
      stop: ['\n'],
    };
    expect(opts.temperature).toBe(0.7);
    expect(opts.maxTokens).toBe(1000);
  });

  it('exports CompletionRequest type that compiles with correct shape', () => {
    const req: CompletionRequest = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
      options: { temperature: 0.5 },
    };
    expect(req.messages).toHaveLength(2);
    expect(req.options?.temperature).toBe(0.5);
  });

  it('exports CompletionUsage type that compiles with correct shape', () => {
    const usage: CompletionUsage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    };
    expect(usage.totalTokens).toBe(30);
  });

  it('exports CompletionResponse type that compiles with correct shape', () => {
    const resp: CompletionResponse = {
      content: 'Hello, how can I help?',
      usage: { promptTokens: 5, completionTokens: 10 },
      metadata: { finishReason: 'stop' },
    };
    expect(resp.content).toBe('Hello, how can I help?');
    expect(resp.usage?.completionTokens).toBe(10);
  });

  it('LlmProvider interface can be implemented', () => {
    // Type-level test: verifies the interface is implementable
    const mockProvider: LlmProvider = {
      complete: async (_request: CompletionRequest) => ({
        content: 'Mock response',
      }),
    };
    expect(mockProvider).toBeDefined();
  });
});
