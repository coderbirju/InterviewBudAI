# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. Keep entries short and current.
> Format per active item: **[agent] branch — what / status / PR link / next**.

_Last updated: 2026-09-05 (architect: interface skeletons)_

## Legend
- ✅ done & merged   🟡 in progress / PR open   ⛔ blocked   ⬜ not started

## Milestone: Foundation (this session)

| Item | Status | Notes |
|---|---|---|
| Project context + architecture docs | ✅ (in this PR) | `context-files/00`, `01` |
| Team charter (RFC 2119 rules) | ✅ (in this PR) | `context-files/team-charter.md` |
| Five team agent files | ✅ (in this PR) | `context-files/team/*.md` |
| ADR 0001 foundational decisions | ✅ (in this PR) | `context-files/decisions/0001-*` |
| CI workflow + PR template | ✅ (in this PR) | `.github/` |
| Branch-protection setup guide | ✅ (in this PR) | `.github/BRANCH_PROTECTION.md` |

## Milestone: Scaffold (current)

| Item | Status | Notes |
|---|---|---|
| npm workspaces monorepo skeleton | 🟡 PR open | `architect/scaffold-monorepo` → PR #2. `packages/{core,providers,storage,cli,web}` |
| Root tooling + `npm run verify` | 🟡 PR open | TS project refs, ESLint, Prettier, Vitest; `verify` green locally |

## Next up (not started — for future sessions)

1. 🟡 **[architect]** Scaffold the npm workspaces monorepo skeleton
   (`packages/{core,providers,storage,cli,web}`) + root TS/ESLint/Prettier/Vitest
   config + `npm run verify`. **PR #2 open** on `architect/scaffold-monorepo`.
2. 🟡 **[architect]** Draft the **storage interface** and **LLM provider
   interface** contracts (ADR + skeletons) so other agents can parallelize.
   **PR open** on `architect/interface-skeletons`.
3. ⬜ **[integrations-dev]** Implement the default **git/local storage adapter**.
4. ⬜ **[engine-dev]** Implement the **Assess** path against the storage
   interface (read progress → "where you stand").
5. ⬜ **[interface-dev]** Minimal **CLI** entry that wires config + adapters and
   calls the engine.

## Blocked / needs founder action

- ⛔ **Branch protection on `main`** must be enabled in GitHub settings by the
  founder (cannot be set from committed files). See `.github/BRANCH_PROTECTION.md`.
  Until then, the "never push to main / green-CI-required" guarantee is not
  enforced by the platform.

## Open questions / decisions pending

- _Foundational decisions recorded in ADR 0001._
- **Deferred (follow-up):** dev-only audit warnings from `eslint@8.57.0`
  transitive deps (`glob@7`). Upgrading to ESLint 9 (flat config) is a separate
  scoped change, not pulled into the scaffold PR. Not shipped (devDependency).
