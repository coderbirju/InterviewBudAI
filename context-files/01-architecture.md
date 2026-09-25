# 01 — Architecture (Locked Blueprint)

> This is the technical contract for the whole project. Changes to anything in
> this file MUST be recorded as an ADR in `decisions/` and approved before
> implementation.

## Shape: one engine, two front-ends, pluggable everything

```
┌─────────────┐     ┌─────────────┐
│  CLI        │     │  Local Web  │   two front-ends, same engine
└──────┬──────┘     └──────┬──────┘
       └────────┬──────────┘
          ┌─────▼─────┐
          │  Core     │  session orchestration, personas,
          │  Engine   │  competency logic, prompt building
          └──┬─────┬──┘
     ┌────────┘     └────────┐
┌────▼─────┐          ┌───────▼──────┐
│ Storage  │          │ LLM Provider │   both pluggable via interface
│ interface│          │ interface    │
└────┬─────┘          └───────┬──────┘
 git/local          OpenAI│Anthropic│Ollama│…
 (default)
```

## Two hard rules (fall directly out of the product vision)

1. **The engine is stateless per session.** All durable state lives in the
   storage layer. The engine holds nothing across sessions.
2. **The engine never hardcodes a provider or a store.** LLM providers and
   storage both sit behind interfaces. Bring-your-own-LLM and
   bring-your-own-store work because the engine only knows the interface.

## Stack (locked)

- **Language:** TypeScript, end-to-end (CLI + web + engine + adapters share one
  language and one contributor onboarding path).
- **Runtime:** Node.js (LTS).
- **Monorepo:** npm workspaces (zero extra tooling; simplest for OSS
  contributors).
- **Tooling:** TypeScript compiler (typecheck), ESLint (lint), Prettier
  (format), Vitest (test).

## Package layout (npm workspaces)

```
packages/
  core/         Engine: assess / plan / coach, session orchestration,
                persona logic, prompt building. Depends on interfaces only.
  providers/    LLM provider interface + adapters (OpenAI, Anthropic, Ollama…).
  storage/      Storage interface + adapters (git/local default, then others).
  cli/          CLI front-end. Thin; delegates to core.
  web/          Locally hosted web front-end (the v1 product). Delegates to
                core; may host web-only features, e.g. the Quiz Master
                engine (ADR 0008 D2).
```

**Dependency rule:** `cli` and `web` depend on `core`. `core` depends on the
**interfaces** exposed by `providers` and `storage`, never on a concrete
adapter. Front-ends wire concrete adapters into the engine at startup
(dependency injection). No package may create a dependency cycle.

## The two pluggable interfaces (contracts, not implementations)

These are the most important boundaries in the system. The Architect owns their
exact shape; the sketch below is the intent.

### Storage interface
- Purpose: persist and retrieve the user's **progress layer** (intuitions,
  tracking, competency map, custom problems/questions, session summaries).
- Default adapter: **git-backed local files** (human-readable markdown/JSON,
  diffable, personal).
- Must support: read full history/context for a session; write a structured
  session summary; read/update the competency map and weakness register.
- Must NOT assume any specific backend beyond the interface.

### LLM provider interface
- Purpose: send prompts to whatever model the user configured and get
  completions back.
- Adapters: OpenAI, Anthropic, Ollama (local), and community-added ones.
- The engine builds prompts; the provider only transports them to a model.
- Configuration (keys, endpoints, model names) is user-supplied and never
  committed.

## The engine's three jobs (module intent)

- **Assess** — load progress via storage; produce a "where you stand" view.
- **Plan** — from competency gaps, choose the next session's focus.
- **Coach** — run a persona-driven session using the LLM provider; on close,
  write a structured summary + competency update back through storage.

## Curriculum vs. progress (enforced in code, not just docs)

- The **curriculum** (problem catalog: links + difficulty only) ships in the
  repo. It contains no answers and no personal data.
- The **progress** data lives only in the user's storage target. The engine
  reads/writes it through the storage interface. It is never committed to this
  repository.

## Front-end parity principle

**Relaxed by ADR 0008 (web-first).** The local web app is the v1 product; the
CLI is frozen. Web-only features are allowed. Engine-first (domain logic in
`core`) remains **preferred** where cheap but is not required — e.g. the Quiz
Master engine may live in `packages/web`. The dependency rule above is
unchanged. See `decisions/0008-web-first-product-focus.md`.

## Non-negotiables checklist (for reviews / CI intent)

- [ ] No cross-session state held in the engine.
- [ ] No hardcoded LLM provider or storage backend in `core`.
- [ ] No dependency cycles between packages.
- [ ] No shipped answers/intuitions in the curriculum layer.
- [ ] No user progress data committed to the repo.
- [ ] No mandatory network calls except to the user-configured LLM.
