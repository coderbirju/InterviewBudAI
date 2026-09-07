# Decision Log — Architect

> Write-only running record for founder oversight. Format:
> `YYYY-MM-DD  <branch/PR>  — decision — rejected alternative — why`

2026-09-05  architect/scaffold-monorepo (PR #2)  — Scaffold monorepo with npm workspaces + TS project references (`tsc --build`) — rejected a single flat tsconfig — project refs enforce package build order and the dependency direction (cli/web → core) at compile time.
2026-09-05  architect/scaffold-monorepo (PR #2)  — Kept scaffold to structure + tooling + placeholder exports only; did NOT define the storage/LLM interfaces — rejected shipping interfaces here — charter §5.2 requires interface contracts to land via their own ADR (next-up item 2).
2026-09-05  architect/scaffold-monorepo (PR #2)  — `verify` = typecheck → lint → format(check) → build → test, matching CI order — rejected omitting format from verify — keeps local `npm run verify` a true mirror of the CI gate (charter §3.2).
2026-09-05  architect/scaffold-monorepo (PR #2)  — Scoped Prettier to code and ignored prose docs (`*.md`, `context-files/`, `.github/`) — rejected reformatting the committed foundation docs to satisfy `prettier --check` — reformatting design-session prose is out of scope and would churn files owned elsewhere.
2026-09-05  architect/scaffold-monorepo (PR #2)  — Pinned all devDeps to exact versions (charter §7.1); deferred ESLint 9 upgrade despite audit warnings on eslint@8 transitive deps — rejected `npm audit fix --force` — it would force a major ESLint bump (flat config) mid-scaffold; tracked as a follow-up. Dev-only, not shipped.

2026-09-05  architect/two-tier-restructure (PR #3)  — Split the two-tier team-model restructure into its own PR, separate from scaffold PR #2 — rejected bundling it into the scaffold PR — keeps scaffold PR focused on monorepo skeleton/tooling; also excluded .kiro/ (local agent tooling) from version control via .gitignore.
2026-09-05  architect/interface-skeletons (PR #4)  — Landed Storage + LLM Provider interface contracts as types-only skeletons (ADR 0002) — rejected shipping concrete adapters in same PR — charter §5.2 requires interface contracts land separately from implementations; keeps verify green without feature logic.

2026-09-06  integrate/storage-git  — LocalFileStorageAdapter with JSON diffable files under user-configured basePath, zero new deps (node:fs/promises + node:path), type guards for untrusted input validation — rejected env-based config — constructor arg keeps config explicit and testable without global state.

2026-09-07  implement/assess  — Assess implemented against StorageAdapter (type-only import), takes optional front-end-supplied sessionId, no interface change, no ADR needed.

2026-09-06  frontend/web-assess  — web front-end (ASSESS slice): Node built-in http localhost:127.0.0.1 composition root; env IBAI_DATA_DIR (+ --data-dir flag) → LocalFileStorageAdapter → core assess() → HTML/JSON render — rejected external web framework (kept zero-dep, local-first) — no product logic in web, front-end parity with engine.
