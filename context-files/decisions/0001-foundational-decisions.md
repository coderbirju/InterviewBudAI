# ADR 0001 — Foundational Decisions

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Founder + design session
- **Supersedes:** —

## Context

InterviewBudAI is a new open-source, local-first, AI-assisted interview-prep
coach for DSA and System Design. This ADR records the foundational decisions made
in the initial design session so every future session builds on a stable base.

## Decisions

### D1 — Product shape
An open-source, **local-first** tool. No mandatory cloud, no central server, no
telemetry. Cloud is an optional future ring, never required.

### D2 — Bring-your-own-LLM, not opinionated
The project works with **any** LLM (OpenAI, Anthropic, local Ollama, …) behind a
**pluggable provider interface**, on day one. It never ships or requires a
specific model.

### D3 — Two data layers
- **Curriculum** (ships with project): problem catalog as **links + difficulty
  only**. No answers, no intuitions.
- **Progress** (owned by user, private): intuitions, custom problems, tracking,
  competency map. Never bundled, never uploaded.

### D4 — Stateless engine, persistent portable knowledge
The engine holds no cross-session state. All durable state lives behind a
**pluggable storage interface**; the **default adapter is git-backed local
files** (human-readable, diffable, private).

### D5 — One engine, two front-ends
A single core engine (Assess / Plan / Coach) with **CLI and a locally hosted web
app** as thin front-ends. Capabilities live in the engine; front-ends expose
them at parity.

### D6 — Stack & monorepo
**TypeScript end-to-end** on **Node.js (LTS)**, in an **npm workspaces**
monorepo: `packages/{core,providers,storage,cli,web}`. Tooling: TypeScript,
ESLint, Prettier, Vitest.

### D7 — Dependency direction
`cli`/`web` → `core` → **interfaces** of `providers`/`storage`. `core` never
depends on a concrete adapter (injected at startup). No dependency cycles.

### D8 — AI-first build with a human merge gate
The project is built by a team of AI builder agents. Agents work on **feature
branches**, push to their branches, and open **PRs**. Agents **never push to
main** and **never merge**.

### D9 — CI is the autonomous quality gate
GitHub Actions runs typecheck → lint → build → test on every PR. **Branch
protection** requires green CI on `main`. Checks must not be weakened to pass.

### D10 — Human merge, no auto-merge
The founder reviews open PRs **each morning** and merges the green ones they
approve. **Auto-merge is disabled.** Every PR carries a short plain-language
description as the primary status signal.

## Consequences

- Positive: no inference cost/liability for the project; strong privacy;
  low-friction OSS contribution; quality enforced by machines, not manual review;
  the founder stays informed without being a bottleneck.
- Tradeoffs: pluggability adds interface indirection; two front-ends require
  parity discipline; human-gated merge means merges happen in daily batches.
- Any change to these decisions requires a new ADR.
