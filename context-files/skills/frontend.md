# Skill — frontend

### 1. Purpose
Build CLI or local web front-end features as thin clients over the engine.

### 2. Inputs
`target` (cli or web), `scope`, `branch`, `task`, `acceptance criteria`.

### 3. Tool allowlist (predefined permissions)
- Read/write files, shell (`npm`, `git` branch/commit/push).
- Write scope: `packages/cli` or `packages/web` + their tests.
- MUST NOT: put product logic in a front-end; add telemetry/mandatory network;
  hardcode provider/model; push/merge to main.

### 4. Steps
1. Expose an engine capability via CLI command or web route (delegate to `core`).
2. Wire user config + inject chosen adapters at startup (composition root).
3. Handle/surface engine/provider/storage errors clearly.

### 5. Self-evaluation & verification
- Run `verify`; iterate to green.
- Confirm parity: shared capability works from both front-ends (or is engine-side
  so both can expose it).

### 6. Done / Blocked
- Done: criteria met, tests pass, `verify` green.
- Blocked: engine lacks a needed capability → bubble up (needs `implement`).

### 7. Output contract
`status`, `branch`, `PR`, `summary`, `blocker?`.

### 8. Project binding (InterviewBudAI)
Two thin front-ends, feature parity, local-first (no external hosting/telemetry).
Web app runs on the user's machine.
