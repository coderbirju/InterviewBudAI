# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. One line per item: PR # + what.
> Detail belongs in PRs and ADRs, not here.

_Last updated: 2026-10-08. PRs #1–#104 are merged or closed (source: `gh pr list`). ADR 0020 (local code runner) is proposed. ADR 0019, ADR 0014, ADR 0013 and ADR 0012 have shipped. ADR 0011 (local AI via Docker) has shipped. ADR 0004 was deleted with founder approval._

**Legend:** ✅ merged · 🟡 PR open · 🔨 in progress · ⏸ deferred · ✖ closed unmerged

**Team model:** Architect (sole orchestrator, talks to the founder) plus the skills in
`skills/`. See `team-charter.md` §0 and §9A. The Architect may merge green, reviewed PRs (charter §2.5, ADR 0017).

## Current product (on `main`)
- **The web app is the product** (ADR 0008). It is a React SPA started with `npm start` or `docker compose up`. The CLI is frozen.
- **Catalog:** the Home page lists curated problems (links and difficulty only, no answers) in the 13-topic learning order, with search and filters.
- **Notes and import:** a notes editor per problem (CodeMirror, Python/Go fences highlighted, textarea fallback; ADR 0014) with status tags, plus CSV import from Notion (preview, conflict choices, backups before import).
- **Custom problems:** you can add problems yourself, or add unmatched CSV rows as custom problems (ADR 0010).
- **Quiz:** the Quickfire Quiz Master. The Home page shows guidance ("Where you stand / Next up").
- **Analytics** shows progress and competency. **Settings** shows the active provider and has a test-connection button; keys are set by env only. The **Data page** (`/data`) shows the data folder and recovers legacy folders.
- **AI providers:** local AI through Docker Model Runner (default `ai/qwen3:4b-instruct-2507-q4_K_M`), OpenAI-compatible, Anthropic, and Ollama. A provider is required; there is no demo fallback.

## Recent work (one line per PR)
**Problem view, metrics and release (ADRs 0015–0018)**
- ✅ #92 ADRs 0015 (problem view + code-first notes), 0016 (usage metrics + release zip), 0017 (Architect merge authority)
- ✅ #93 Data page disclosures; more room on Analytics
- ✅ #94 ADR 0016: release zip workflow (its metrics part later moved out by #97)
- ✅ #96 ADR 0015 PR A: problem statement fetch, cache, sanitizer, preferences API
- ✅ #95 ADR 0015 PR B: split problem view, code-first notes, language picker
- ✅ #97 ADR 0018: usage metrics move to the private `coderbirju/repo-metrics` repo; the release zip stays here
- ✅ #98 Review follow-ups: Data page heading a11y, doc fixes, CI actions pinned by SHA
- ✅ #99 Notes toolbar trimmed to the language picker and "Copy code" (ADR 0014 D2 amendment)
- ✅ #100 ADR 0019: Node 24 LTS minimum (engines, CI, Docker, release zip; breaking)
- ✅ #101 Settings page: simpler layout, config details in collapsed sections
- ✅ #102 Cleanup: Settings "Last test" wording, ADR cross-references, status refresh
- ✅ #103 Home problem titles open the Notes page; LeetCode via a small icon
- ✅ #104 Quiz question card shows the cached problem statement (display only)

**Wave 2a: growth loop and topics**
- ✅ #66 Frontmatter escaping fix (complexity round-trip)
- ✅ #67 Core `deriveGuidance` + `GET /api/guidance`
- ✅ #68 Home guidance card
- ✅ #69 13-topic taxonomy in learning order
- ✅ #70 CI flake fix (in-memory fs)
- ✅ #71 Topic labels in guidance and patterns; importer uses the 13 topics

**Wave 2b: custom problems (ADR 0010)**
- ✅ #72 ADR 0010
- ✅ #74 API and storage
- ✅ #75 UI and CSV "Add as custom problem"

**Wave 2c-lite: settings**
- ✅ #73 Settings page + provider test connection (keys env-only)

**Local AI via Docker (ADR 0011)**
- ✅ #76 ADR 0011
- ✅ #77 `OpenAICompatibleProvider`
- ✅ #78 Docker Compose + Docker Model Runner
- ✅ #79 Quiz robustness on small models (JSON mode, one retry, "model not ready" state)

**Intuition check (ADR 0013)**
- ✅ #84 ADR 0013
- ✅ #87 Reference approach + quiz grounding (removed again by ADR 0014)
- ✅ #88 Coach server: check route, practice storage and routes
- ✅ #86 Notes "Check my intuition" UI
- ✅ #85 Analytics Practice section + reset

**Note code editor (ADR 0014)**
- ✅ #89 ADR 0014
- ✅ #90 Remove the Reference approach
- ✅ #91 CodeMirror note editor (Python/Go fences, lazy chunk, style nonce)

**Analytics v2 (ADR 0012)**
- ✅ #81 ADR 0012
- ✅ #82 Analytics UI (donut, locked/unlocked, topic tiles)
- ✅ #83 Quiz miss codes, prompt diet, `GET /api/insights`

**Data lifecycle (ADR 0009)**
- ✅ #61 ADR
- ✅ #62 `/data` page
- ✅ #63 D5 release-zip decision
- ✅ #64 `/data` hardening
- ✅ #65 CSV import
- ⏸ PR C (manifest/migrations) not started; PR D (release zip) is now ADR 0016 PR B

**Earlier (all ✅)**
- #55–#60: web usability and hardening (ADR 0008)
- #52–#54: status-page rewrite, its review follow-up, and Home catalog search and filters
- #46–#51: Quiz Master (ADR 0007)
- #39–#45: React migration (ADR 0006)
- #1–#38: foundation, engine, adapters, curriculum, server-rendered UI
- ✖ Closed unmerged as superseded duplicates: #5, #8, #23, #25

## In progress
- 🟡 ADR 0020: local code runner for Python and Go (Run, Run examples), opt-in, off by default (`architect/adr-0020-code-runner`; founder merges).

## Next up
ADR 0020 roadmap (after the founder merges the ADR; A0 first, then A and B in parallel against its fixtures):
- PR A0: shared run types (`run-types.ts`) and all the D7 fixtures.
- PR A: runner core, run token + Host/Origin checks, Run mode for Python and Go, `codeRunner` setting / `IBAI_CODE_RUNNER`, detection.
- PR B: Notes UI (Run, output pane) and the Settings "Code runner" card.
- PR C: `metaData` sidecar cache + Python Run examples harness.
- PR D: Go Run examples harness.
- PR E: ListNode / TreeNode converters.
- PR F: Docker image adds `python3` (Go behind a build arg).

Other:
1. `htmlparser2` 11.x/12.x bump, now allowed by the Node 24 floor (ADR 0019 D4; optional, own PR).
2. Notes without `lastUpdated` currently read as "today" (fix in the storage adapter).
3. Pin the provider empty-response error text with a shared constant and a test.
4. **Docs pass.** On hold until the founder says go.
5. `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19; watch CI that week.

## Founder actions
- Create the `METRICS_TOKEN` secret in `coderbirju/repo-metrics` (ADR 0018). Its seed is the ref `493a711:scripts/metrics/`.
- Push the first release tag (ADR 0016).

## Open founder decisions
- ADR 0020 recommendations to confirm: run limits (Python 5 s; Go 30 s build + 5 s run; 64 KiB output per stream), Go in Docker behind a build arg (default off), "do not enable on shared computers" documented rather than enforced, empty stdin in phase 1.
- System Design: whether it is in scope, and in what shape.
- Backups: git-backed or export.
- Coaching beyond the quiz and the Notes intuition check (ADR 0013): a free-form coach or plan in the web.
- Quiz difficulty knob and per-topic quizzes.
- Docker image publishing (the release zip is decided in ADR 0016; the founder pushes tags).
- ⛔ Branch protection: GitHub returns 403 on this free private repo. The options are to go public, upgrade to Pro, or rely on the charter alone. See `.github/BRANCH_PROTECTION.md`.
