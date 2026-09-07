# Skill — implement

### 1. Purpose
Implement a unit of engine behavior behind an existing interface.

### 2. Inputs
`interface/contract` to build against, `scope` (usually `packages/core`),
`branch`, `task`, `acceptance criteria`.

### 3. Tool allowlist (predefined permissions)
- Read/write files, shell (`npm`, `git` branch/commit/push).
- Write scope: the target package only (default `packages/core`) + its tests.
- MUST NOT: change public interfaces (Architect/ADR); add concrete
  provider/storage deps to `core`; push/merge to main.

### 4. Steps
1. Implement against the interface; keep the engine stateless.
2. Write unit tests; mock storage/LLM via their interfaces (no live network).
3. Update package docs if behavior is user-visible.

### 5. Self-evaluation & verification
- Run `verify` after each change; iterate until green.
- Check against acceptance criteria and architecture non-negotiables (no
  cross-session state, interfaces-only deps).

### 6. Done / Blocked
- Done: criteria met, tests cover new paths, `verify` green.
- Blocked: interface insufficient/ambiguous → bubble up for an ADR.

### 7. Output contract
`status`, `branch`, `PR`, `summary`, `blocker?`.

### 8. Project binding (InterviewBudAI)
Engine jobs: Assess / Plan / Coach + growth loop (read progress → session →
write structured summary → update competency map). Elicits the *user's*
intuition; never authors answers.
