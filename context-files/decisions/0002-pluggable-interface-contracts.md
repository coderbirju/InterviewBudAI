# ADR 0002 — Pluggable Interface Contracts (Storage & LLM Provider)

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Founder + Architect design session
- **Supersedes:** —

## Context

ADR 0001 locked two foundational rules: the engine is **stateless per session**
(all durable state lives in the user's storage layer) and the engine **never
hardcodes a provider or store** (bring-your-own-LLM, bring-your-own-storage).
To let the `implement`, `integrate`, and `frontend` skills work in parallel
without blocking on each other, `@ibai/core` needs two stable *seams* it can
program against: a **Storage** contract and an **LLM Provider** contract.

This ADR fixes the *shape* of those two interfaces (types only). Concrete
adapters (git-backed local storage; OpenAI/Anthropic/Ollama providers) are out
of scope here and land in later implementation PRs. Nothing in these contracts
may name a specific backend or model.

## Decisions

### D1 — Interfaces live in the package that owns them

The Storage contract lives in `@ibai/storage`; the LLM Provider contract lives
in `@ibai/providers`. `@ibai/core` imports **only** these interface types and
never a concrete adapter. Front-ends (`@ibai/cli`, `@ibai/web`) construct a
concrete adapter and inject it into the engine at startup. This preserves the
dependency direction cli/web → core → (storage interface, provider interface)
and keeps the engine backend-agnostic (ADR 0001 D7). No package may create a
dependency cycle: neither `@ibai/storage` nor `@ibai/providers` may depend on
`@ibai/core`.

### D2 — Storage contract shape

`StorageAdapter` is the single interface a storage backend implements. It is
organized around the engine's needs, not a database:

- **Session history / context** — read the full prior history and context for a
  session (the material the Assess step loads).
- **Session summary** — write a single **structured** session summary produced by
  the Coach step (append-only from the engine's perspective).
- **Competency map** — read and update the user's competency map (per-topic
  proficiency the Plan step reasons over).
- **Weakness register** — read and update the register of recurring weaknesses.

All operations are `async` (return `Promise<…>`), backend-agnostic, and typed
over plain serializable data structures. The contract does not expose files,
tables, or connection concepts — those are adapter internals. Reads that may find
nothing return `null`/empty rather than throwing.

### D3 — LLM Provider contract shape

`LlmProvider` is the single interface an LLM backend implements. Its one
responsibility is transport: **take a fully-built prompt from the engine and
return a completion**. The engine owns prompt construction; the provider only
carries the request to whatever model the user configured. The contract:

- Accepts a provider-agnostic `CompletionRequest` (messages + generation options)
  and returns a `CompletionResponse` (text + optional usage/metadata).
- Names **no** model, endpoint, or vendor. Model selection and credentials are
  user-supplied configuration handed to the adapter, never baked into the
  contract and never committed.
- Uses a small role-tagged message shape so any chat-style backend can map it.

### D4 — Types only; verify stays green

This PR introduces contracts and doc comments only — no feature logic, no
adapters. It must pass `npm run verify` (typecheck → lint → format → build →
test) without weakening any check.

## Consequences

- **Positive:** `implement`/`integrate`/`frontend` skills can now program against
  stable seams in parallel; the engine stays testable with fakes.
- **Positive:** Backends stay swappable; no vendor or store leaks into core.
- **Tradeoff:** The contracts are intentionally minimal; adding capabilities
  (streaming completions, tool/function calls, richer history queries) will
  require extending these interfaces — a change that requires a new ADR.
- Any change to the *shape* of these contracts requires a new ADR.
