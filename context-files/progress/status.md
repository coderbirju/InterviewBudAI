# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. One line per item: PR # + what.
> Detail belongs in PRs and ADRs, not here.

_Last updated: 2026-09-30. PRs #1–#79 are merged or closed (source: `gh pr list`), and no other PRs are open. ADR 0011 (local AI via Docker) has shipped. ADR 0004 was deleted with founder approval._

**Legend:** ✅ merged · 🟡 PR open · 🔨 in progress · ⏸ deferred · ✖ closed unmerged

**Team model:** Architect (sole orchestrator, talks to the founder) plus the skills in
`skills/`. See `team-charter.md` §0 and §9A.

## Current product (on `main`)
- **The web app is the product** (ADR 0008). It is a React SPA started with `npm start` or `docker compose up`. The CLI is frozen.
- **Catalog:** the Home page lists curated problems (links and difficulty only, no answers) in the 13-topic learning order, with search and filters.
- **Notes and import:** a notes editor per problem with status tags, plus CSV import from Notion (preview, conflict choices, backups before import).
- **Custom problems:** you can add problems yourself, or add unmatched CSV rows as custom problems (ADR 0010).
- **Quiz:** the Quickfire Quiz Master. The Home page shows guidance ("Where you stand / Next up").
- **Analytics** shows progress and competency. **Settings** shows the active provider and has a test-connection button; keys are set by env only. The **Data page** (`/data`) shows the data folder and recovers legacy folders.
- **AI providers:** local AI through Docker Model Runner (default `ai/qwen3:4b-instruct-2507-q4_K_M`), OpenAI-compatible, Anthropic, and Ollama. A provider is required; there is no demo fallback.

## Recent work (one line per PR)
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

**Data lifecycle (ADR 0009)**
- ✅ #61 ADR
- ✅ #62 `/data` page
- ✅ #63 D5 release-zip decision
- ✅ #64 `/data` hardening
- ✅ #65 CSV import
- ⏸ PR C (manifest/migrations) and PR D (release zip) are not started or deferred

**Earlier (all ✅)**
- #55–#60: web usability and hardening (ADR 0008)
- #52–#54: status-page rewrite, its review follow-up, and Home catalog search and filters
- #46–#51: Quiz Master (ADR 0007)
- #39–#45: React migration (ADR 0006)
- #1–#38: foundation, engine, adapters, curriculum, server-rendered UI
- ✖ Closed unmerged as superseded duplicates: #5, #8, #23, #25

## In progress
- 🟡 ADR 0012: Analytics v2, quiz miss codes, prompt diet (`architect/adr-0012-analytics-v2`).

## Next up
1. **Analytics v2 (ADR 0012).** PR 1: quiz miss codes + prompt diet + storage aggregation + `GET /api/insights`. PR 2: Analytics UI (donut, locked/unlocked, topic tiles). They can run in parallel against the ADR's API shape.
2. **"Reference approach" note field vs shipping solutions.** Waiting on a founder decision (§6.2).
3. **Docs pass.** On hold until the founder says go.
4. **Small follow-ups:**
   - Notes without `lastUpdated` currently read as "today" (fix in the storage adapter).
   - Pin CI actions by SHA.
   - Pin the provider empty-response error text with a shared constant and a test.

## Open founder decisions
- System Design: whether it is in scope, and in what shape.
- Backups: git-backed or export.
- Coaching beyond the quiz (free-form coach/plan in the web).
- Quiz difficulty knob and per-topic quizzes.
- Release zip and Docker image publishing (ADR 0009 D5 PR D is deferred; the founder pushes tags).
- ⛔ Branch protection: GitHub returns 403 on this free private repo. The options are to go public, upgrade to Pro, or rely on the charter alone. See `.github/BRANCH_PROTECTION.md`.
