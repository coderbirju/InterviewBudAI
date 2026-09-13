import { describe, expect, it } from 'vitest';

import { EchoDemoProvider } from './demo-provider.js';
import type { CompletionRequest } from './index.js';

describe('EchoDemoProvider', () => {
  describe('determinism', () => {
    it('returns identical content for same request across two calls', async () => {
      const provider = new EchoDemoProvider();
      const request: CompletionRequest = {
        messages: [
          { role: 'user', content: 'I think we should use a hash map' },
        ],
      };

      const response1 = await provider.complete(request);
      const response2 = await provider.complete(request);

      expect(response1.content).toBe(response2.content);
    });

    it('returns identical content across two provider instances with same config', async () => {
      const provider1 = new EchoDemoProvider();
      const provider2 = new EchoDemoProvider();
      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'Binary search might work here' }],
      };

      const response1 = await provider1.complete(request);
      const response2 = await provider2.complete(request);

      expect(response1.content).toBe(response2.content);
    });
  });

  describe('reflects user message', () => {
    it('includes snippet of user message in response', async () => {
      const provider = new EchoDemoProvider();
      const request: CompletionRequest = {
        messages: [
          { role: 'user', content: 'I would start with a recursive approach' },
        ],
      };

      const response = await provider.complete(request);

      expect(response.content).toContain('recursive approach');
    });

    it('response contains a question mark (interviewer-style)', async () => {
      const provider = new EchoDemoProvider();
      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'Maybe dynamic programming' }],
      };

      const response = await provider.complete(request);

      expect(response.content).toContain('?');
    });
  });

  describe('uses last user turn', () => {
    it('reflects the LAST user message when multiple user/assistant messages exist', async () => {
      const provider = new EchoDemoProvider();
      const request: CompletionRequest = {
        messages: [
          { role: 'user', content: 'First I thought about brute force' },
          { role: 'assistant', content: 'Tell me more' },
          { role: 'user', content: 'Now I think a sliding window is better' },
        ],
      };

      const response = await provider.complete(request);

      expect(response.content).toContain('sliding window');
      expect(response.content).not.toContain('brute force');
    });
  });

  describe('guardrails (§6.2)', () => {
    const forbiddenPhrases = [
      'the answer is',
      'the solution is',
      'here is the code',
      "here's the code",
      'the correct approach is',
      'you should implement',
      'the optimal solution',
    ];

    it.each(forbiddenPhrases)(
      'does NOT contain forbidden phrase: "%s"',
      async (phrase) => {
        const provider = new EchoDemoProvider();
        const request: CompletionRequest = {
          messages: [
            {
              role: 'user',
              content: 'How do I solve this two sum problem efficiently?',
            },
          ],
        };

        const response = await provider.complete(request);

        expect(response.content.toLowerCase()).not.toContain(
          phrase.toLowerCase(),
        );
      },
    );
  });

  describe('edge cases', () => {
    it('returns neutral opening prompt for empty messages array', async () => {
      const provider = new EchoDemoProvider();
      const request: CompletionRequest = { messages: [] };

      const response = await provider.complete(request);

      expect(response.content).toBeTruthy();
      expect(response.content).toContain('?');
    });

    it('does not throw for empty messages array', async () => {
      const provider = new EchoDemoProvider();
      const request: CompletionRequest = { messages: [] };

      await expect(provider.complete(request)).resolves.not.toThrow();
    });

    it('handles whitespace-only user content gracefully', async () => {
      const provider = new EchoDemoProvider();
      const request: CompletionRequest = {
        messages: [{ role: 'user', content: '   \n\t  ' }],
      };

      const response = await provider.complete(request);

      expect(response.content).toBeTruthy();
      expect(response.content).toContain('?');
    });

    it('handles messages with only system/assistant roles', async () => {
      const provider = new EchoDemoProvider();
      const request: CompletionRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'assistant', content: 'Hello!' },
        ],
      };

      const response = await provider.complete(request);

      expect(response.content).toBeTruthy();
      expect(response.content).toContain('?');
    });

    it('truncates long user content with ellipsis', async () => {
      const provider = new EchoDemoProvider({ maxReflectChars: 20 });
      const request: CompletionRequest = {
        messages: [
          {
            role: 'user',
            content: 'This is a very long message that should be truncated',
          },
        ],
      };

      const response = await provider.complete(request);

      expect(response.content).toContain('...');
    });
  });

  describe('metadata', () => {
    it('includes provider metadata', async () => {
      const provider = new EchoDemoProvider();
      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'test' }],
      };

      const response = await provider.complete(request);

      expect(response.metadata?.provider).toBe('echo-demo');
      expect(response.metadata?.deterministic).toBe(true);
    });
  });

  describe('configuration', () => {
    it('applies label prefix when configured', async () => {
      const provider = new EchoDemoProvider({ label: 'Demo' });
      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'test input' }],
      };

      const response = await provider.complete(request);

      expect(response.content).toMatch(/^Demo:/);
    });

    it('respects custom maxReflectChars', async () => {
      const provider = new EchoDemoProvider({ maxReflectChars: 10 });
      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'This is a longer message' }],
      };

      const response = await provider.complete(request);

      // Should contain truncated snippet with ellipsis
      expect(response.content).toContain('This is a ...');
    });
  });
});
