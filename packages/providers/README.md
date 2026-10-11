# @ibai/providers

LLM provider boundary for InterviewBudAI — interface contract + concrete adapters.

## Overview

This package defines the **pluggable LLM Provider contract** (`LlmProvider`)
and ships concrete adapters. It is a **leaf package**: it NEVER depends on
`@ibai/core` (no dependency cycles) and has zero external runtime dependencies.

## Adapters

| Adapter | Description |
| --- | --- |
| `OllamaProvider` | Real LLM provider for Ollama (recommended for local-first use) |
| `AnthropicProvider` | Claude adapter for Anthropic API (bring-your-own-key) |

**Note:** A provider is now REQUIRED. Configure either Anthropic or Ollama to use InterviewBudAI.

### OllamaProvider (Recommended for local-first)

The recommended provider for local-first usage. Connects to a local or remote Ollama
instance.

```typescript
import { OllamaProvider } from '@ibai/providers';

const provider = new OllamaProvider({
  model: 'llama3.2', // required: model name
  endpoint: 'http://localhost:11434', // optional: defaults to localhost
});
```

### AnthropicProvider (Claude)

Connects to the Anthropic Messages API for Claude models. Requires a user-supplied
API key (bring-your-own-key, never committed).

```typescript
import { AnthropicProvider } from '@ibai/providers';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!, // required: your API key
  model: 'claude-3-5-sonnet-20241022', // required: model name
  endpoint: 'https://api.anthropic.com/v1/messages', // optional: default endpoint
  anthropicVersion: '2023-06-01', // optional: API version header
  defaultOptions: { temperature: 0.7 }, // optional: default generation options
  effort: 'low', // optional: sent as output_config.effort only when set
});
```

**Configuration:**

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | Yes | — | Your Anthropic API key (never commit!) |
| `model` | Yes | — | Model name (e.g. `claude-3-5-sonnet-20241022`) |
| `endpoint` | No | `https://api.anthropic.com/v1/messages` | Anthropic API endpoint |
| `anthropicVersion` | No | `2023-06-01` | `anthropic-version` header |
| `defaultOptions` | No | — | Default CompletionOptions (request options override) |
| `fetchImpl` | No | `globalThis.fetch` | Fetch implementation for testing |
| `effort` | No | unset | `low`/`medium`/`high`/`xhigh`/`max`, sent as `output_config: { effort }`. Unset sends nothing (some models reject the parameter) |

**Environment variables** (for front-end wiring, not read by the adapter itself):

```
ANTHROPIC_API_KEY=       # Your API key (NEVER commit real values)
IBAI_ANTHROPIC_MODEL=    # Model name
IBAI_ANTHROPIC_EFFORT=   # Optional: low|medium|high|xhigh|max (low suits short replies)
```

**API mapping notes:**

- System messages are extracted and joined with `\n\n` into a top-level `system` field (not in the messages array)
- `max_tokens` is **required** by Anthropic. The adapter sends
  `max(requested ?? 1024, ANTHROPIC_MIN_MAX_TOKENS)` with a floor of 16000:
  models that think before answering count the thinking toward `max_tokens`,
  so a small budget could end with no text. The call is non-streaming and the
  model stops when it is done, so cost follows the tokens used.
- Response text is the concatenation of `content` blocks with `type: 'text'`
  only; `thinking` / `redacted_thinking` blocks are ignored. No `thinking`
  parameter and no assistant prefill are sent.
- Typed `ProviderReplyError` (fixed text, safe to show): `refusal` on
  `stop_reason: 'refusal'` (with the sanitized `stop_details.category`, never
  the model's text); `budget_exhausted` on `stop_reason: 'max_tokens'` with no
  text; `option_rejected` on an HTTP 400 that mentions `effort` while one was
  sent. None of them is retried.
- Usage maps: `input_tokens` → `promptTokens`, `output_tokens` → `completionTokens`

## Reusable HTTP Core

The `src/http-provider.ts` module provides a generic HTTP transport layer that
LLM adapters can reuse. It handles:

- Network errors (fetch throws)
- Non-2xx HTTP status codes (with body snippet)
- Invalid JSON responses

Currently used by `AnthropicProvider`. Future adapters (e.g., OpenAI) can reuse
this core — see the top-of-file comment for API shape differences.

## Usage

Front-ends are composition roots that choose which adapter to inject:

```typescript
import { AnthropicProvider, OllamaProvider } from '@ibai/providers';

// For Claude via Anthropic API
const claudeProvider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-5-sonnet-20241022',
});

// For local Ollama
const ollamaProvider = new OllamaProvider({ model: 'llama3.2' });
```

## Design Principles

- **Types + adapters only** — no business logic, no prompt construction
- **Zero-dep leaf** — never depends on `@ibai/core`
- **Bring-your-own-LLM** — no provider is required or privileged (§6.3)
- **Local-first** — all adapters work offline or with local models (§6.4)
- **Lazy network** — importing modules performs no I/O; only `complete()` touches the network
