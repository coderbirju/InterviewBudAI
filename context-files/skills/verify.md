# Skill — verify

### 1. Purpose
The CI-mirroring quality gate: typecheck → lint → build → test. Owns CI config
and the `verify` script contract.

### 2. Inputs
`scope` (whole repo or a package), `branch`, `task`.

### 3. Tool allowlist (predefined permissions)
- Read/write files, shell (`npm`, `git` branch/commit/push).
- Write scope: `.github/workflows/`, shared test/tooling config, `verify` script.
- MUST NOT: weaken/skip checks to pass (charter §3.3); add live network to CI;
  push/merge to main.

### 4. Steps
1. Ensure `verify` runs typecheck, lint, build, test locally and mirrors CI.
2. Keep CI green, fast, and honest; mock external APIs/filesystem in tests.
3. Add tests guarding architecture non-negotiables where feasible.

### 5. Self-evaluation & verification
- CI reflects true code state; `verify` reproduces CI locally.
- No live network / real keys required in CI.

### 6. Done / Blocked
- Done: CI green and truthful; `verify` mirrors it.
- Blocked: a check needs a policy change → bubble up for an ADR.

### 7. Output contract
`status`, `branch`, `PR`, `summary`, `blocker?`.

### 8. Project binding (InterviewBudAI)
GitHub Actions; `verify` = typecheck+lint+build+test; branch protection requires
green on main (founder-enabled). Pre-scaffold CI no-ops until `package.json`.
