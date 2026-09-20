# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. Keep entries short and current.
> Format per active item: **[agent] branch — what / status / PR link / next**.

_Last updated: 2026-09-14 (Notes/intuition capture PR open on feature/notes-capture; ADR 0005 onboarding-catalog-first accepted; supersedes ADR 0004 demo-provider path; extends ADR 0003 curriculum usage; 6-step implementation roadmap recorded. Interactive interview UI on feature/interview-ui; Demo provider PR open on feature/demo-provider; Web Coach wiring PR open on frontend/web-coach; CLI Coach wiring PR open on frontend/cli-coach; Coach engine PR merged; Plan PR #12 merged; Ollama provider PR #13 merged; CLI assess+plan merged; web Assess PR #10 open; UI/UX rework backlogged #11)_

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
| Demo provider (zero-config) | 🟡 | `feature/demo-provider` → PR open. EchoDemoProvider + ADR 0004; unblocks zero-config interview demo. |

## Milestone: Front-ends (current)

| Item | Status | Notes |
|---|---|---|
| CLI assess command | ✅ merged | `frontend/cli-assess` → PR #9 merged. |
| CLI plan command | ✅ merged | `frontend/cli-plan` → PR merged. |
| CLI coach command | 🟡 PR open | `frontend/cli-coach` — wires coach into CLI as thin composition root; OllamaProvider config; --outcome flag. |
| Web assess slice | 🟡 PR open | `frontend/web-assess` → PR #10 open. localhost HTTP server, HTML/JSON render. |
| Interactive interview UI | 🟡 in progress | `feature/interview-ui` — zero-config turn-by-turn interview; EchoDemoProvider default; stateless carry-forward; chat transcript UI. |

## Milestone: Curriculum

| Item | Status | Notes |
|---|---|---|
| ADR 0003 curriculum layer | 🟡 PR open | `architect/curriculum-adr` — decides @ibai/curriculum location, Problem schema (links+difficulty only), read-only CurriculumSource contract. Types-only skeleton; real catalog + loader is follow-up. |
| ADR 0005 onboarding + intuition | ✅ | `architect/onboarding-adr` — catalog-first onboarding, intuition capture (IntuitionNote type + optional StorageAdapter methods), AI-evaluation interview model. Supersedes ADR 0004 demo-provider path; extends ADR 0003 curriculum usage. 6-step roadmap: (1) ADR → (2) seed catalog → (3) web catalog landing → (4) notes/intuition impl → (5) Anthropic provider → (6) remove demo + AI-eval interview. |
| Web catalog landing + create-database | ✅ merged | `feature/web-catalog-landing` — ADR 0005 D1/D2 impl. Catalog-first onboarding, /catalog route, /notes/<id> placeholder, /setup + create-database + cookie persistence. Roadmap step 3. |
| Notes/intuition capture | 🟡 PR open | `feature/notes-capture` — ADR 0005 D3/D4 impl. IntuitionNote type, StorageAdapter.saveNote/listNotes/getNote, /notes routes with save/edit. Roadmap remaining: Anthropic provider, AI-eval interview, demo removal, bulk-import. |

## Next up (Architect dispatches these skills)

1. 🟡 `frontend` — **CLI coach command** (`@ibai/cli`) coach() wiring + formatCoach + tests.
   **PR open** on `frontend/cli-coach`. → `code-review`.
2. 🟡 `frontend` — **web ASSESS slice** (`@ibai/web`) localhost HTTP server,
   HTML/JSON render of AssessmentView. **PR #10 open** on `frontend/web-assess`. → `code-review`.

## Decision Log

| Label | Date | Summary |
|-------|------|--------|
| onboarding-adr | 2026-09-13 | ADR 0005 accepted: catalog-first onboarding, intuition capture (IntuitionNote + optional StorageAdapter methods), AI-evaluation interview. Supersedes ADR 0004 demo-provider fallback; extends ADR 0003 curriculum usage. 6-step impl roadmap recorded. |
| web-catalog-landing | 2026-09-14 | Catalog-first landing + create-database + cookie dataDir; Notes placeholder, intuition capture next PR. |
| app-shell-nav | 2026-09-14 | Added shared nav bar on all pages (Home, Catalog, Dashboard, Interview). Home landing at `/` with action buttons and progress summary. Dashboard moved to `/dashboard`. Nav includes active state and aria-current for a11y. |
| notes-capture | 2026-09-14 | IntuitionNote type + StorageAdapter methods (saveNote/listNotes/getNote) + web /notes routes with save/edit UI. Local-first note storage at dataDir/notes/<id>.json. No external deps added. |
| ui-hardening | 2026-09-15 | IntuitionNote extended with completed/timeComplexity/spaceComplexity (additive, ADR 0005 amendment). Notes editor UI with checkbox + complexity inputs. Dashboard shows completed list. Catalog shows ✓ done marker. Home bug fixed: boot now injects createStorage factory + defaultDataDir so per-request cookie>env>default resolution works. |

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


## 2026-09-20: Cookie Persistence Fix

- **Issue**: `ibai_data_dir` cookie was a session cookie, lost on browser restart
- **Fix**: Added `Max-Age=31536000` (~1 year) to make cookie persistent
- **Status**: PR open on `fix/cookie-persistence` branch
- **Tests**: Added regression tests for cookie persistence and round-trip verification
