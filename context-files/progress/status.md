# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. One line per item: PR # + what.
> Detail belongs in PRs and ADRs, not here.

_Last updated: 2026-09-25 — PRs #1–#62 merged or closed; distribution decided (GitHub Release zip, ADR 0009 D5)._

## Legend
✅ merged · 🟡 PR open · 🔨 in progress, no PR yet · ⛔ blocked · ⬜ not started · ⏸ deferred · ✖ closed unmerged

## Team model
**Architect** (sole orchestrator; talks to founder) + skills in `skills/`
(scaffold, implement, integrate, frontend, verify, code-review, architect-task).
See `team-charter.md` §0, §9A.

## In progress
- 🟡 ADR 0009 D5 accepted (GitHub zip releases) + CHANGELOG for #62 — `architect/adr-0009-d5-zip-release`.
- 🔨 ADR 0009 PR B — CSV import (Notion) — `feature/csv-import`.

## Founder decision (2026-09-25) — recorded in ADR 0008
- **The web app is the product.** CLI frozen (compiles + tests, no features).
  Canonical data dir `~/.interviewbudai/data` (0700).
- Consequence (ADR 0008 D2): front-end parity principle relaxed — web-only
  features allowed.

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

## Milestone: Web usability (ADR 0008)
| Item | What | Status |
|---|---|---|
| W1 | Quiz reliability — questions from catalog (ADR 0007 A8) | ✅ #56 |
| W3 | Home catalog search + difficulty/status filters | ✅ #54 |
| W4 | One-command start (`npm start`, first-run data dir 0700, `.env.example`) | ✅ #55 |
| W2 | Localhost hardening (Host/Origin/CSRF/content-type) | ✅ #58 |
| 2a | Growth loop: quiz signals → CompetencyMap/WeaknessRegister; "Where you stand / Next up" Home card | ⬜ |
| 2b | User-added custom problems | ⬜ needs storage ADR |
| 2c | Settings / provider status (active provider, test connection) | ⬜ key storage pending founder |
| 2d | Server-side data dir as single source of truth (legacy cookie dropped — no migration; see ADR 0009) | ✅ #60 |
| 3 | Backup/export or git-backing · OpenAI-compatible provider · System Design | ⬜ pending founder |
| H | Hygiene: tests/deps (dup `@testing-library/dom`, popstate, `rememberHomeSearch`, App filter test, lc-209, `postChat`; `POST /api/chat` in #60) | ✅ #59, #60 |

## Milestone: Data lifecycle (ADR 0009)
| Item | What | Status |
|---|---|---|
| ADR | ADR 0009 + root `CHANGELOG.md` (#60 breaking change recorded) | ✅ #61; D5 zip amendment 🟡 `architect/adr-0009-d5-zip-release` |
| A | `/data` page, nav link, zero-notes banner, `/api/data-dir`, legacy-cookie / `~/.ibai/data` recovery prompt | ✅ #62 |
| B | CSV import (Notion) preview/commit + backups (`.backups/`, keep 5) | 🔨 `feature/csv-import` |
| C | `manifest.json` format versioning + migration framework | ⬜ after B |
| D | Release zip (prebuilt server + SPA, `node …` start) + tag-triggered Action: verify → zip → GitHub Release from CHANGELOG (no npm) | ⏸ deferred (founder) — D5 accepted; founder pushes tags |

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
- **Open founder decisions (ADR 0008 D5):** System Design in v1 + shape; API
  keys on disk?; meaning of "git-backed"; quiz-only vs free-form coach/plan;
  delete ADR 0004?; delete stale branches/worktrees? (Distribution answered:
  GitHub Release zip, ADR 0009 D5.)
- ⛔ **Branch protection on `main` — not enabled.** GitHub returns 403
  ("Upgrade to GitHub Pro or make this repository public") for both branch
  protection and rulesets on this private repo. Founder options: make the repo
  public, upgrade to Pro, or accept charter-only enforcement. See
  `.github/BRANCH_PROTECTION.md`.

## Open questions / deferred
- **ESLint 9** (flat config) upgrade — deferred; eslint@8 has dev-only audit warnings.
- **Bulk import** of founder's Notion intuitions — scheduled: ADR 0009 PR B.
- **Quiz difficulty knob** (ADR 0007 D2 "future") — not implemented.
- **Quiz engine in `packages/web`** — allowed by ADR 0008 D2 (parity relaxed).
- **CLI-frozen known issues (ADR 0008 D1, not fixing):** CLI data-dir default `~/.ibai/data`
  differs from the canonical web default `~/.interviewbudai/data`; `ibai coach`
  with fewer `--answer`s than plan topics prints "Proceeding with partial
  answers" but exits 0 without running `coach()`.

## Next up (proposed)
1. ADR 0009 PR B (CSV import, in progress) + `/data` (#62) hardening → C. PR D (release zip) deferred.
2. Wave 2a growth loop.
3. `architect-task` — storage-interface ADR for custom problems (Wave 2b).
4. Wave 2c; hygiene PRs in between.
5. `scaffold` — ESLint 9 flat-config upgrade.
6. Later: quiz difficulty knob.
