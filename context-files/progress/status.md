# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. Keep entries short and current.
> Format per active item: **[agent] branch — what / status / PR link / next**.

_Last updated: 2026-09-12 (Web Coach wiring PR open on frontend/web-coach — wires coach into web with assess→plan→coach loop + write-back; CLI Coach wiring PR open on frontend/cli-coach — wires coach into CLI; Coach engine PR merged; Plan PR #12 merged; Ollama provider PR #13 merged; CLI assess+plan merged; web Assess PR #10 open; UI/UX rework backlogged #11; interface skeletons PR #4 open; scaffold PR #2 and two-tier restructure PR #3 merged to main)_

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

## Milestone: Interfaces

| Item | Status | Notes |
|---|---|---|
| Storage + LLM provider interface contracts (types-only) | ✅ merged | `architect/interface-skeletons` → PR #4 merged. ADR 0002; `packages/storage`, `packages/providers` |

## Milestone: Engine Jobs

| Item | Status | Notes |
|---|---|---|
| Assess engine job | ✅ merged | `implement/assess` → PR merged. Pure read-and-derive from StorageAdapter. |
| Plan engine job | ✅ merged | `implement/plan` → PR #12 merged. Pure sync derivation from AssessmentView. |
| Coach engine job | ✅ merged | `implement/coach` → PR merged. Closes the growth loop: read progress → session → structured summary → competency/weakness updates. |

## Milestone: Adapters

| Item | Status | Notes |
|---|---|---|
| LocalFileStorageAdapter | ✅ merged | `integrate/storage-git` → PR merged. Git/local file storage adapter. |
| OllamaProvider | ✅ merged | `integrate/provider-ollama` → PR #13 merged. First concrete LLM provider. |

## Milestone: Front-ends (current)

| Item | Status | Notes |
|---|---|---|
| CLI assess command | ✅ merged | `frontend/cli-assess` → PR #9 merged. |
| CLI plan command | ✅ merged | `frontend/cli-plan` → PR merged. |
| CLI coach command | 🟡 PR open | `frontend/cli-coach` — wires coach into CLI as thin composition root; OllamaProvider config; --outcome flag. |
| Web assess slice | 🟡 PR open | `frontend/web-assess` → PR #10 open. localhost HTTP server, HTML/JSON render. |

## Milestone: Curriculum

| Item | Status | Notes |
|---|---|---|
| ADR 0003 curriculum layer | 🟡 PR open | `architect/curriculum-adr` — decides @ibai/curriculum location, Problem schema (links+difficulty only), read-only CurriculumSource contract. Types-only skeleton; real catalog + loader is follow-up. |

## Next up (Architect dispatches these skills)

1. 🟡 `frontend` — **CLI coach command** (`@ibai/cli`) coach() wiring + formatCoach + tests.
   **PR open** on `frontend/cli-coach`. → `code-review`.
2. 🟡 `frontend` — **web ASSESS slice** (`@ibai/web`) localhost HTTP server,
   HTML/JSON render of AssessmentView. **PR #10 open** on `frontend/web-assess`. → `code-review`.

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
