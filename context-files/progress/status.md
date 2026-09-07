# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. Keep entries short and current.
> Format per active item: **[agent] branch — what / status / PR link / next**.

_Last updated: 2026-09-05 (two-tier restructure PR open, separate from scaffold PR #2)_

## Legend
- ✅ done & merged   🟡 in progress / PR open   ⛔ blocked   ⬜ not started

## Team model

Two tiers: **Architect** (sole orchestrator agent; talks to founder; dispatches
skills) + six **skills** in `skills/` (scaffold, implement, integrate, frontend,
verify, code-review). See `team-charter.md` §0 & §9A and
`skills/00-skill-contract.md`.

## Milestone: Foundation

| Item | Status | Notes |
|---|---|---|
| Project context + architecture docs | ✅ (in PR) | `context-files/00`, `01` |
| Team charter (RFC 2119) | ✅ (in PR) | two-tier model, §9A layered review |
| Architect orchestrator agent | ✅ (in PR) | `team/architect.md` |
| Skill contract + 6 skills | ✅ (in PR) | `skills/*.md` |
| ADR 0001 foundational decisions | ✅ (in PR) | `context-files/decisions/0001-*` |
| CI workflow + PR template | ✅ (in PR) | `.github/` |
| Branch-protection setup guide | ✅ (in PR) | `.github/BRANCH_PROTECTION.md` |
| Retired 4 agent files → skills | ✅ (in PR) | engine/integrations/interface/qa removed |

## Milestone: Scaffold (current)

| Item | Status | Notes |
|---|---|---|
| npm workspaces monorepo skeleton | 🟡 PR open | `architect/scaffold-monorepo` → PR #2. `packages/{core,providers,storage,cli,web}` |
| Root tooling + `npm run verify` | 🟡 PR open | TS project refs, ESLint, Prettier, Vitest; `verify` green locally |
| Two-tier team model restructure | 🟡 PR open | `architect/two-tier-restructure` (split out of scaffold PR #2) |

## Next up (Architect dispatches these skills)

1. 🟡 `scaffold` — npm workspaces skeleton `packages/{core,providers,storage,cli,web}`
   + root TS/ESLint/Prettier/Vitest + `npm run verify`. **PR #2 open** on
   `architect/scaffold-monorepo`; → then `code-review`.
2. ⬜ `architect` (ADR + skeletons) — **storage interface** & **LLM provider
   interface** contracts, so skills parallelize.
3. ⬜ `integrate` — default **git/local storage adapter**. → `code-review`.
4. ⬜ `implement` — engine **Assess** path (read progress → "where you stand").
   → `code-review`.
5. ⬜ `frontend` — minimal **CLI** wiring config + adapters → engine.
   → `code-review`.

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
