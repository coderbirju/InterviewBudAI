/**
 * Provider precedence (ADR 0011 D1): ONE order shared by startServer
 * (`selectProvider`), `resolveProviderStatus` and settings —
 * Anthropic → OpenAI-compatible → Ollama → none. No network: constructing a
 * provider performs no I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  AnthropicProvider,
  OllamaProvider,
  OpenAICompatibleProvider,
} from '@ibai/providers';
import {
  OPENAI_INSECURE_KEY_HINT,
  resolveOpenAIApiKey,
  resolveOpenAITimeoutMs,
  resolveProviderStatus,
} from './config.js';
import { formatStartupBanner, selectProvider } from './server.js';

const KEY = 'sk-SECRET-precedence-555';
const ANTHROPIC = { ANTHROPIC_API_KEY: KEY, IBAI_ANTHROPIC_MODEL: 'claude-x' };
const OPENAI = {
  IBAI_OPENAI_BASE_URL: 'http://localhost:12434/engines/v1',
  IBAI_OPENAI_MODEL: 'ai/qwen3',
};
const OLLAMA = { IBAI_OLLAMA_MODEL: 'llama3' };

describe('provider precedence matrix', () => {
  const cases: Array<
    [string, NodeJS.ProcessEnv, string, unknown, string | undefined]
  > = [
    [
      'all three',
      { ...ANTHROPIC, ...OPENAI, ...OLLAMA },
      'anthropic',
      AnthropicProvider,
      'claude-x',
    ],
    [
      'anthropic + openai',
      { ...ANTHROPIC, ...OPENAI },
      'anthropic',
      AnthropicProvider,
      'claude-x',
    ],
    [
      'openai + ollama',
      { ...OPENAI, ...OLLAMA },
      'openai',
      OpenAICompatibleProvider,
      'ai/qwen3',
    ],
    ['openai only', OPENAI, 'openai', OpenAICompatibleProvider, 'ai/qwen3'],
    ['ollama only', OLLAMA, 'ollama', OllamaProvider, 'llama3'],
    [
      'half anthropic + openai',
      { ANTHROPIC_API_KEY: KEY, ...OPENAI },
      'openai',
      OpenAICompatibleProvider,
      'ai/qwen3',
    ],
    [
      'half openai (url) + ollama',
      { IBAI_OPENAI_BASE_URL: OPENAI.IBAI_OPENAI_BASE_URL, ...OLLAMA },
      'ollama',
      OllamaProvider,
      'llama3',
    ],
    ['nothing', {}, 'none', undefined, undefined],
  ];
  for (const [label, env, kind, cls, model] of cases) {
    it(`${label} → ${kind}`, () => {
      const status = resolveProviderStatus(env);
      expect(status.kind).toBe(kind);
      if (model !== undefined) {
        expect(status).toEqual({ kind, model });
      }
      const { provider, label: text } = selectProvider(env);
      if (cls === undefined) {
        expect(provider).toBeUndefined();
        expect(text).toBe('No model configured');
      } else {
        expect(provider).toBeInstanceOf(cls);
        expect(text).toContain(model);
      }
      expect(text).not.toContain(KEY);
      expect(JSON.stringify(status)).not.toContain(KEY);
    });
  }

  it('half-set OpenAI configs give hints', () => {
    expect(
      resolveProviderStatus({ IBAI_OPENAI_BASE_URL: 'http://x/v1' }),
    ).toEqual({
      kind: 'none',
      hint: 'IBAI_OPENAI_BASE_URL is set but IBAI_OPENAI_MODEL is missing',
    });
    expect(resolveProviderStatus({ IBAI_OPENAI_MODEL: 'm' })).toEqual({
      kind: 'none',
      hint: 'IBAI_OPENAI_MODEL is set but IBAI_OPENAI_BASE_URL is missing',
    });
    expect(
      resolveProviderStatus({
        IBAI_OPENAI_BASE_URL: '  ',
        IBAI_OPENAI_MODEL: ' ',
      }),
    ).toEqual({ kind: 'none' });
  });

  it('key over plain http to a non-loopback host → skipped with a hint', () => {
    const env = {
      IBAI_OPENAI_BASE_URL: 'http://192.168.1.9:8000/v1',
      IBAI_OPENAI_MODEL: 'm',
      IBAI_OPENAI_API_KEY: KEY,
    };
    expect(resolveProviderStatus(env)).toEqual({
      kind: 'none',
      hint: OPENAI_INSECURE_KEY_HINT,
    });
    expect(selectProvider(env).provider).toBeUndefined();
    // ...and falls through to Ollama when that is configured.
    expect(resolveProviderStatus({ ...env, ...OLLAMA }).kind).toBe('ollama');
    // Without the key the same URL is fine; https with a key is fine.
    expect(
      resolveProviderStatus({ ...env, IBAI_OPENAI_API_KEY: '' }).kind,
    ).toBe('openai');
    expect(
      resolveProviderStatus({
        ...env,
        IBAI_OPENAI_BASE_URL: 'https://llm.example.com/v1',
      }).kind,
    ).toBe('openai');
  });
});

describe('OpenAI-compatible env parsing', () => {
  it('key: IBAI_OPENAI_API_KEY > OPENAI_API_KEY', () => {
    expect(resolveOpenAIApiKey({})).toBeUndefined();
    expect(resolveOpenAIApiKey({ OPENAI_API_KEY: 'b' })).toBe('b');
    expect(
      resolveOpenAIApiKey({ IBAI_OPENAI_API_KEY: 'a', OPENAI_API_KEY: 'b' }),
    ).toBe('a');
  });

  it('timeout: default 120 s, clamped to 5 s–600 s, junk → default', () => {
    expect(resolveOpenAITimeoutMs({})).toBe(120_000);
    expect(resolveOpenAITimeoutMs({ IBAI_OPENAI_TIMEOUT_MS: '30000' })).toBe(
      30_000,
    );
    expect(resolveOpenAITimeoutMs({ IBAI_OPENAI_TIMEOUT_MS: '10' })).toBe(
      5_000,
    );
    expect(resolveOpenAITimeoutMs({ IBAI_OPENAI_TIMEOUT_MS: '99999999' })).toBe(
      600_000,
    );
    expect(resolveOpenAITimeoutMs({ IBAI_OPENAI_TIMEOUT_MS: 'soon' })).toBe(
      120_000,
    );
  });
});

describe('startup banner', () => {
  it('shows OpenAI-compatible with the model only', () => {
    const text = formatStartupBanner({
      url: 'http://127.0.0.1:4173',
      data: {
        dataDir: '/tmp/x',
        source: 'default',
        explicit: false,
        created: false,
        exists: true,
      },
      provider: { kind: 'openai', model: 'ai/qwen3' },
    }).join('\n');
    expect(text).toContain('Provider: OpenAI-compatible (model: ai/qwen3)');
  });
});
