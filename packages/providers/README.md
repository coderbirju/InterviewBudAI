# @ibai/providers

LLM provider boundary for InterviewBudAI — interface contract + concrete adapters.

## Overview

This package defines the **pluggable LLM Provider contract** (`LlmProvider`)
and ships concrete adapters. It is a **leaf package**: it NEVER depends on
`@ibai/core` (no dependency cycles) and has zero external runtime dependencies.

## Adapters

| Adapter | Description |
| --- | --- |
| `OllamaProvider` | Real LLM provider for Ollama (recommended for actual use) |
| `EchoDemoProvider` | Built-in deterministic demo provider (zero-config trial) |

### OllamaProvider (Recommended)

The recommended provider for real usage. Connects to a local or remote Ollama
instance.

```typescript
import { OllamaProvider } from '@ibai/providers';

const provider = new OllamaProvider({
  model: 'llama3.2', // required: model name
  endpoint: 'http://localhost:11434', // optional: defaults to localhost
});
```

### EchoDemoProvider

A **zero-config** deterministic demo adapter for trying the app with **no LLM
installed**. Ships built-in so a fresh clone can run the interview flow
immediately.

```typescript
import { EchoDemoProvider } from '@ibai/providers';

const provider = new EchoDemoProvider(); // zero config required
```

**Key characteristics:**

- **Deterministic & offline** — no network, no filesystem, no randomness. Same
  request → same response, always.
- **Interviewer-style prompting only** — reflects the user's last turn into a
  probing follow-up question + neutral coaching acknowledgement. It elicits the
  user's own reasoning.
- **NEVER emits answers or solutions** — product rule §6.2 guardrail. The demo
  provider asks questions; it does not solve problems.
- **OPT-IN, not required** — this is a convenience for zero-config demos, NOT a
  required or privileged provider. Real providers (Ollama, OpenAI, etc.) are the
  recommended path for actual interview prep.
- **Front-ends choose** — the engine never hardcodes a provider; front-ends
  inject whichever adapter the user configured.

See [ADR 0004](../../context-files/decisions/0004-demo-provider.md) for design
rationale.

## Usage

Front-ends are composition roots that choose which adapter to inject:

```typescript
import { EchoDemoProvider, OllamaProvider } from '@ibai/providers';

// For zero-config demo (no LLM required)
const demoProvider = new EchoDemoProvider();

// For real usage with Ollama
const realProvider = new OllamaProvider({ model: 'llama3.2' });

// Front-end picks one and passes to engine
const provider = useDemoMode ? demoProvider : realProvider;
```

## Design Principles

- **Types + adapters only** — no business logic, no prompt construction
- **Zero-dep leaf** — never depends on `@ibai/core`
- **Bring-your-own-LLM** — no provider is required or privileged (§6.3)
- **Local-first** — all adapters work offline or with local models (§6.4)
