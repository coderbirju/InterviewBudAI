# Skill — scaffold

### 1. Purpose
Create project/package skeletons and shared tooling.

### 2. Inputs
`scope` (what to scaffold), `branch`, `task`, `acceptance criteria`.

### 3. Tool allowlist (predefined permissions)
- Read/write files, create directories, shell (for `npm`, `git` branch/commit/push).
- Write scope: repo root config + `packages/<name>` being scaffolded.
- MUST NOT: push/merge to main; touch unrelated packages; edit interfaces
  (Architect owns those).

### 4. Steps
1. Create the package/dir structure and its `package.json` (npm workspace).
2. Add/align root tooling: TypeScript, ESLint, Prettier, Vitest, `verify` script.
3. Add a package README with run instructions.

### 5. Self-evaluation & verification
- Run `verify` (typecheck → lint → build → test). Structure must build clean.
- Confirm no dependency cycle introduced; `core` has no concrete adapter deps.

### 6. Done / Blocked
- Done: structure builds, `verify` green, acceptance criteria met.
- Blocked: missing an interface contract or tooling decision → bubble up.

### 7. Output contract
`status`, `branch`, `PR`, `summary`, `blocker?`.

### 8. Project binding (InterviewBudAI)
Layout `packages/{core,providers,storage,cli,web}`; TS/Node LTS; npm workspaces;
`verify` = typecheck+lint+build+test. Deps pinned exact (charter §7).
