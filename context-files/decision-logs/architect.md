# Decision Log — Architect

> Write-only running record for founder oversight. Format:
> `YYYY-MM-DD  <branch/PR>  — decision — rejected alternative — why`

2026-09-05  architect/scaffold-monorepo (PR #2)  — Scaffold monorepo with npm workspaces + TS project references (`tsc --build`) — rejected a single flat tsconfig — project refs enforce package build order and the dependency direction (cli/web → core) at compile time.
2026-09-05  architect/scaffold-monorepo (PR #2)  — Kept scaffold to structure + tooling + placeholder exports only; did NOT define the storage/LLM interfaces — rejected shipping interfaces here — charter §5.2 requires interface contracts to land via their own ADR (next-up item 2).
2026-09-05  architect/scaffold-monorepo (PR #2)  — `verify` = typecheck → lint → format(check) → build → test, matching CI order — rejected omitting format from verify — keeps local `npm run verify` a true mirror of the CI gate (charter §3.2).
2026-09-05  architect/scaffold-monorepo (PR #2)  — Scoped Prettier to code and ignored prose docs (`*.md`, `context-files/`, `.github/`) — rejected reformatting the committed foundation docs to satisfy `prettier --check` — reformatting design-session prose is out of scope and would churn files owned elsewhere.
2026-09-05  architect/scaffold-monorepo (PR #2)  — Pinned all devDeps to exact versions (charter §7.1); deferred ESLint 9 upgrade despite audit warnings on eslint@8 transitive deps — rejected `npm audit fix --force` — it would force a major ESLint bump (flat config) mid-scaffold; tracked as a follow-up. Dev-only, not shipped.
2026-09-05  architect/interface-skeletons (PR #3)  — Landed Storage + LLM Provider interface contracts as types-only skeletons (ADR 0002) — rejected shipping concrete adapters in same PR — charter §5.2 requires interface contracts land separately from implementations; keeps verify green without feature logic.
