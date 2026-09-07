# Skill — integrate

### 1. Purpose
Implement a concrete adapter behind a pluggable interface (LLM provider or
storage backend).

### 2. Inputs
`interface` (provider or storage), `adapter name`, `branch`, `task`,
`acceptance criteria`.

### 3. Tool allowlist (predefined permissions)
- Read/write files, shell (`npm`, `git` branch/commit/push).
- Write scope: `packages/providers` or `packages/storage` + their tests +
  `.env.example`.
- MUST NOT: change the interface itself (Architect/ADR); commit secrets; make
  the project depend on one provider; push/merge to main.

### 4. Steps
1. Implement the adapter to satisfy the interface exactly.
2. Parse/validate config from env (never commit keys); ship `.env.example`.
3. Write tests with the external API/filesystem mocked (no live network in CI).

### 5. Self-evaluation & verification
- Run `verify`; iterate to green.
- For storage: round-trip test (write summary → read back → competency update).
- Treat all external responses as untrusted; validate + handle failures.

### 6. Done / Blocked
- Done: adapter satisfies interface, tests pass, `verify` green.
- Blocked: interface insufficient → bubble up for an ADR.

### 7. Output contract
`status`, `branch`, `PR`, `summary`, `blocker?`.

### 8. Project binding (InterviewBudAI)
Default + priority adapter: **git-backed local files** (markdown/JSON, diffable,
private). Providers: OpenAI, Anthropic, Ollama, community — all optional,
user-selected. New SDKs pinned exact.
