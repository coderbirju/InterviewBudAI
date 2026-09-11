# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. Keep entries short and current.
> Format per active item: **[agent] branch — what / status / PR link / next**.

_Last updated: 2026-09-08 (Coach PR open on implement/coach — closes the growth loop; Plan PR #12 merged; Ollama provider PR #13 open; CLI assess PR #9 merged; web Assess PR #10 open; UI/UX rework backlogged #11; interface skeletons PR #4 open; scaffold PR #2 and two-tier restructure PR #3 merged to main)_

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
| Project context + architecture docs | ✅ | `context-files/00`, `01` |
| Team charter (RFC 2119) | ✅ | two-tier model, §9A layered review |
| Architect orchestrator agent | ✅ | `team/architect.md` |
| Skill contract + 6 skills | ✅ | `skills/*.md` |
| ADR 0001 foundational decisions | ✅ | `context-files/decisions/0001-*` |
| CI workflow + PR template | ✅ | `.github/` |
| Branch-protection setup guide | ✅ | `.github/BRANCH_PROTECTION.md` |
| Retired 4 agent files → skills | ✅ | engine/integrations/interface/qa removed |

## Milestone: Scaffold

| Item | Status | Notes |
|---|---|---|
| npm workspaces monorepo skeleton | ✅ merged | `architect/scaffold-monorepo` → PR #2 merged. `packages/{core,providers,storage,cli,web}` |
| Root tooling + `npm run verify` | ✅ merged | TS project refs, ESLint, Prettier, Vitest; `verify` green locally |
| Two-tier team model restructure | ✅ merged | `architect/two-tier-restructure` → PR #3 merged |

## Milestone: Interfaces (current)

| Item | Status | Notes |
|---|---|---|
| Storage + LLM provider interface contracts (types-only) | 🟡 PR open | `architect/interface-skeletons` → PR #4. ADR 0002; `packages/storage`, `packages/providers` |

## Milestone: Engine Jobs

| Item | Status | Notes |
|---|---|---|
| Assess engine job | ✅ merged | `implement/assess` → PR merged. Pure read-and-derive from StorageAdapter. |
| Plan engine job | ✅ merged | `implement/plan` → PR #12 merged. Pure sync derivation from AssessmentView. |
| Coach engine job | 🟡 PR open | `implement/coach` — closes the growth loop: read progress → session → structured summary → competency/weakness updates. |

## Next up (Architect dispatches these skills)

1. ✅ `scaffold` — npm workspaces skeleton `packages/{core,providers,storage,cli,web}`
   + root TS/ESLint/Prettier/Vitest + `npm run verify`. **PR #2 merged.**
2. 🟡 `architect` (ADR + skeletons) — **storage interface** & **LLM provider
   interface** contracts, so skills parallelize. **PR #4 open** on
   `architect/interface-skeletons`; → then `code-review`.
3. 🟡 `integrate` — default **git/local storage adapter** (`LocalFileStorageAdapter`). **PR open** on `integrate/storage-git`. → `code-review`.
4. 🟡 `implement` — engine **Assess** path (read progress → "where you stand").
   **PR open** on `implement/assess`. → `code-review`.
5. ✅ `frontend` — minimal **CLI assess** wiring config + adapters → engine.
   **PR #9 merged** on `frontend/cli-assess`. → `code-review`.
6. 🟡 `frontend` — **CLI plan command** (`@ibai/cli`) plan() wiring + formatPlan + tests.
   **PR open** on `frontend/cli-plan`. → `code-review`.
7. 🟡 `frontend` — **web ASSESS slice** (`@ibai/web`) localhost HTTP server,
   HTML/JSON render of AssessmentView. **PR #10 open** on `frontend/web-assess`. → `code-review`.
8. 🟡 `integrate` — **Ollama LLM provider adapter** (first concrete provider,
   local-first, bring-your-own-LLM). **PR #13 open** on `integrate/provider-ollama`.
   → `code-review`.

## Backlog / future

- 🟡 **Web UI/UX rework** — rework the minimal `web` front-end into a polished UX with Plan engine wiring. **PR open** on `frontend/web-plan-ux`. Adds /plan.json endpoint, redesigned HTML with 'Where You Stand' + 'Your Next Session' sections, warmup→focus→twist cards with role badges and proficiency bars. (Tracked via #11.)

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
