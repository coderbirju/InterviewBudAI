# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. One line per item: PR # + what.
> Detail belongs in PRs and ADRs, not here.

_Last updated: 2026-09-25 — PRs #1–#52 merged or closed; review follow-up to #52 open on `architect/status-cleanup`._

## Legend
✅ merged · 🟡 PR open · ⛔ blocked · ⬜ not started · ✖ closed unmerged

## Team model
**Architect** (sole orchestrator; talks to founder) + skills in `skills/`
(scaffold, implement, integrate, frontend, verify, code-review, architect-task).
See `team-charter.md` §0, §9A.

## In progress
- ✅ #52 status rewrite + stale-docs cleanup. 🟡 follow-up PR (code-review fixes) on `architect/status-cleanup`.

## Founder decision (2026-09-25)
- **The web app is the product.** CLI is deprioritized/frozen. Web data-dir
  default `~/.interviewbudai/data` is canonical.

## Current product (on `main`)
- **Web** (`@ibai/web`): React SPA at `/` — Home (catalog + status), Notes,
  Analytics (progress + competency), Interview = **Quickfire Quiz Master**
  (start/answer/end/list/resume/delete). Server: `/api/*` JSON + `/setup`.
- **CLI** (`ibai`): `assess`, `plan`, `coach` (AI-evaluation via `--answer`).
- **Providers**: `AnthropicProvider`, `OllamaProvider` (reusable HTTP core). No
  demo provider; a provider is REQUIRED.
- **Storage**: `LocalFileStorageAdapter` (sessions, summaries, competency map,
  weaknesses, notes, quiz sessions, competency signals).
- **Curriculum**: curated links + difficulty catalog (no answers).

## Milestones (all ✅)

### Quickfire Quiz Master (ADR 0007)
- ✅ Q1 #46 — quiz storage foundation (`QuizSession`, `CompetencySignals`).
- ✅ Q2 #47 — quiz engine (`packages/web/src/quiz.ts`) + `/api/quiz/*`.
- ✅ Q3 #48 — Quiz Master UI replaces the generic interview.
- ✅ Q4 #49 — competency signals surfaced in Analytics (`GET /api/competency`).
- ✅ quiz-fix-a #50 — raw problem (no wrapper), at-most-one nudge, verdict-card clear.
- ✅ quiz-fix-b #51 — session end/list/resume/delete.

### Web React migration (ADR 0006)
- ✅ M0 #39 — React + Vite + Tailwind + Lucide scaffold.
- ✅ M1 #40 — same-origin JSON API under `/api`.
- ✅ M2 #41 — Home. ✅ M3 #42 — Notes. ✅ M4 #43 — Analytics. ✅ M5 #44 — chat (`POST /api/chat`).
- ✅ M6 #45 — SPA is the whole app at `/`; server-rendered pages retired.

### Earlier web UI (server-rendered — superseded by M6)
- ✅ #10, #14, #18, #21, #26, #27, #29, #31, #32, #34, #35, #36, #37, #38 —
  assess/plan/coach pages, catalog landing, nav, notes, status tags, home
  revamp, analytics charts, cookie/home fixes. Pages retired in M6 (#45);
  data model (note status, cookie) still in use.

### Engine, adapters, curriculum
- ✅ #7 assess · #12 plan · #16 coach · #33 AI-evaluation coach contract (ADR 0005 D6).
- ✅ #6 LocalFileStorageAdapter · #13 OllamaProvider · #30 AnthropicProvider + HTTP core.
- ✅ #20 EchoDemoProvider (ADR 0004) — later **removed** in #33.
- ✅ #19 ADR 0003 curriculum · #22 ADR 0005 onboarding · #24 curated catalog.
- ✅ #28 intuition notes storage.

### CLI (frozen)
- ✅ #9 assess · #15 plan · #17 coach (now `--answer`, Anthropic or Ollama).

### Closed unmerged (superseded duplicates)
- ✖ #5 (→ #6) · ✖ #8 (→ #9) · ✖ #23 (→ #24) · ✖ #25 (→ #26).

### Foundation & scaffold
- ✅ #1 context docs, charter, ADR 0001, CI · #2 monorepo + `verify` ·
  #3 two-tier team model · #4 Storage + LLM interfaces (ADR 0002) · #11 UI rework backlog note.

## Blocked / needs founder action
- ⛔ **Branch protection on `main` — not enabled.** GitHub returns 403
  ("Upgrade to GitHub Pro or make this repository public") for both branch
  protection and rulesets on this private repo. Founder options: make the repo
  public, upgrade to Pro, or accept charter-only enforcement. See
  `.github/BRANCH_PROTECTION.md`.

## Open questions / deferred
- **ESLint 9** (flat config) upgrade — deferred; eslint@8 has dev-only audit warnings.
- **Bulk import** of founder's Notion intuitions — deferred.
- **Quiz difficulty knob** (ADR 0007 D2 "future") — not implemented.
- **CompetencySignals → CompetencyMap/WeaknessRegister reconciliation** (ADR 0007
  Consequences / Q4 row) — not implemented; quiz results do not feed `assess`/`plan`.
- **Quiz engine lives in `packages/web`, not `core`** — conflicts with the
  front-end parity principle in `01-architecture.md`; moot while the CLI is frozen,
  but the doc should be reconciled (ADR).
- **Web no longer exposes assess/plan** (Where You Stand / Next Session were
  retired with the server pages in M6); only the frozen CLI has them.
- **CLI-frozen known issues (not fixing):** CLI data-dir default `~/.ibai/data`
  differs from the canonical web default `~/.interviewbudai/data`; `ibai coach`
  with fewer `--answer`s than plan topics prints "Proceeding with partial
  answers" but exits 0 without running `coach()`.
- **`POST /api/chat`** is unused by the SPA since Q3 (vestigial).
- **No OpenAI provider** (listed in `01-architecture.md`; only Anthropic + Ollama ship).
- **No System Design curriculum** — catalog is DSA only.
- **`.env.example`** lists `IBAI_LLM_*` / `IBAI_STORAGE_*` vars no code reads.

## Next up (proposed)
1. **Web usability roadmap — pending ADR 0008 (web-first).**
2. `implement` — reconcile `CompetencySignals` into `CompetencyMap`/`WeaknessRegister`.
3. `frontend` — restore "where you stand / next session" in the SPA.
4. `integrate` — `OpenAIProvider` on the shared HTTP core.
5. `architect-task` — ADR: System Design curriculum shape (links only).
6. `scaffold` — ESLint 9 flat-config upgrade; prune unused `.env.example` vars.
7. Later: quiz difficulty knob; bulk Notion import.
