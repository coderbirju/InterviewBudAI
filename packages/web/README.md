# @ibai/web

Locally-hosted web front-end for InterviewBudAI's ASSESS, PLAN, and COACH capabilities.

## Overview

This package provides a thin, localhost-only web server that exposes the ASSESS, PLAN, and COACH functionality through a polished UI, including an **Analytics** page with hand-built inline-SVG charts. It maintains **front-end parity** with the CLI—the same engine capabilities are available through both interfaces.

## React SPA (ADR 0006) — the app

The web UI is a **React + Vite + Tailwind + lucide-react** single-page app, served at the **site root (`/`)** by the existing localhost-only Node server. It was migrated in incremental milestones (M0–M6, see `context-files/decisions/0006-web-react-toolchain.md`); **M6 completed the migration** — the SPA is now the whole UI and the old server-rendered HTML pages were retired.

### Server surface (M6)

The server is intentionally small — three surfaces:

- **`/` (and all other non-API, non-`/setup` GET paths)** — the React SPA bundle + assets. Client-side routing (History API, no routing library) handles `/notes/:id`, `/analytics`, and `/interview`; deep links and refreshes fall back to `index.html`. Vite `base` is `/`, so assets are served at `/assets/*` (local, same-origin — no CDN).
- **`/api/*`** — the same-origin, localhost-only JSON API the SPA consumes (`/api/catalog`, `/api/notes/:id` GET+POST, `/api/progress`, `/api/competency`, `/api/config`, `/api/chat`). The server remains the storage owner; the browser is UI + cookie.
- **`/setup`** — the one remaining **server-rendered page**: `GET /setup` shows the create-database form; `POST /setup` creates the data directory and sets the persistent `ibai_data_dir` cookie (`Max-Age=31536000`), then links back to the SPA at `/`. The SPA's no-DB states link here.

Everything else (home/catalog/notes/analytics/interview HTML, `/coach`, `/coach.json`, `/dashboard`, `/assess`, `/assess.json`, `/plan.json`) was **removed** — those surfaces now live entirely in the SPA.

### SPA views

- **Home** (`/`) — global progress banner (`GET /api/progress`) + categorized accordion problem list (`GET /api/catalog`) with an interactive 4-state Status control that optimistically updates and `POST`s to `/api/notes/:id`. No Solution/Video/Code columns (the project ships no answers, charter §6.2).
- **Notes** (`/notes/:id`) — the intuition editor: status control + free-text intuition + time/space complexity, saved via `POST /api/notes/:id`.
- **Analytics** (`/analytics`) — hand-built inline-SVG progress charts (status breakdown + per-topic completion) driven by pure geometry helpers — no external chart library/CDN. It also surfaces a **Competency** section (ADR 0007 Q4) fed by `GET /api/competency`: per-topic **strength** bars (weak=red / improving=amber / strong=emerald / slate=too little data) with each topic's correct/incorrect tally, worst-first, plus a **recurring miss patterns** list (the topics to focus next — the user's own recurring gaps, never a solution, §6.2). When no quiz signals exist yet it shows a "Take a quiz session to build your competency map" empty state linking to `/interview`; loading + API-error states are handled like the rest of the page.
- **Interview** (`/interview`) — the **Quickfire Quiz Master** (ADR 0007 Q3, amended by quiz-fix-a), replacing the old generic interview chat. On load it resumes the single active session via `GET /api/quiz/session` (current question + prior transcript + progress); with none it offers a **Start quiz** entry (`POST /api/quiz/start`). Each question presents a problem you marked **Done** **directly** (its real title — no invented story, no hints) — type your approach and `POST /api/quiz/answer` returns a **verdict**: `correct` (emerald "Correct ✓" + optional optimal nudge) → advance; `incorrect` (amber "Marked for revisit" + feedback) → advance; `on_track` → the same question stays with **one** probe to refine (at most one nudge per question; a second `on_track` is coerced to `incorrect`). The Quiz Master **never reveals the answer**. The prior verdict card is cleared when the next question renders. A progress bar tracks `answered / deckSize`; when the deck is exhausted a **Session complete** summary (correct / to-revisit tallies) offers **New session** (`POST /api/quiz/new`, reshuffle from the current done-set). Empty done-set → a friendly "mark problems as Done first" state linking Home; provider **required** → the "Configure a model" state; provider/verdict failures → a friendly inline banner that never loses the session.

All no-DB states link to `/setup`. All values render via JSX (auto-escaped); no `dangerouslySetInnerHTML`. The only outbound calls are the user-configured LLM provider, made **server-side** inside `POST /api/chat` and the `POST /api/quiz/*` routes.

### Where the UI lives

```
packages/web/
  src/          existing Node server (tsc build → dist/)  ← unchanged pipeline
  web-ui/       React SPA source (Vite build → dist-ui/)  ← separate pipeline
    index.html
    src/main.tsx, src/App.tsx, src/index.css
    src/components/  ProgressBanner, CategoryAccordion, ProblemRow,
                     StatusControl, DifficultyBadge, Home, Notes,
                     Analytics, StatusBreakdownChart, TopicCompletionChart,
                     CompetencyChart, Interview
    src/lib/         api.ts (typed M1 client), home.ts (pure helpers),
                     analytics.ts (pure chart geometry),
                     competency.ts (pure competency-section geometry),
                     router.ts (minimal History-API router)
    vite.config.ts, vitest.config.ts, tailwind.config.cjs, postcss.config.cjs
  dist-ui/      built SPA bundle (generated, git-ignored)
```

The server's `tsc` build (`dist/`) and the Vite build (`dist-ui/`) are **separate** so both work independently.

### Build the UI

```bash
# Build just the SPA bundle (Vite → packages/web/dist-ui/)
npm run build:ui                     # from repo root
# or:  npm --workspace @ibai/web run build:ui

# The root build does BOTH the server tsc build and the UI build:
npm run build                        # tsc --build && build:ui  → server + dist-ui
```

`npm run build` (and therefore `npm run verify`) produces the servable bundle. After a clean `npm ci`, `npm run verify` compiles the SPA as part of the build step and stays green.

### Test the UI

React component/unit tests run under Vitest + jsdom + React Testing Library:

```bash
npm --workspace @ibai/web run test:ui   # jsdom component tests (web-ui)
```

The root `npm test` (and `npm run verify`) runs both the Node test suite and this UI suite.

### Run (single server serves the SPA at `/`)

```bash
npm run build                                   # ensure dist/ and dist-ui/ exist
npm --workspace @ibai/web run start             # existing server, serves the SPA at /
# open http://127.0.0.1:4173/
```

If the SPA bundle is absent (you ran the server without `build:ui`), `/` **degrades gracefully** with a short "run `npm run build:ui`" message; `/api/*` and `/setup` still work.

### Local-first guarantee

Tailwind is compiled to a **static CSS file at build time** and lucide-react icons are **bundled into the JS**. The served `/app` HTML references only local, same-origin `/app/assets/*` files — **no CDN, no remote fonts, no runtime network**. The SPA is served by the existing localhost-only Node server.

## JSON API (M1 — ADR 0006 D4)

The server exposes a same-origin, **localhost-only JSON API** under `/api` for
the React SPA to consume. The server remains the **storage owner** (the browser
is UI + cookie; the server is the filesystem authority). These routes are
**additive** — the existing server-rendered pages and `/app` keep working
unchanged. There is **no auth** (local-first).

Every `/api` route returns `application/json`, resolves the data directory
per-request via the same **cookie `ibai_data_dir` > `IBAI_DATA_DIR` env >
default** precedence used everywhere else, uses proper status codes, and never
emits HTML (`404` for unknown `/api` paths, `405` for wrong methods).

| Method & path | Purpose | Success | No-DB behaviour |
|---|---|---|---|
| `GET /api/catalog` | Full curated catalog grouped by topic (alphabetical), each problem `{ id, title, url, difficulty, status, completed }`, plus `totals: { total, byStatus }`. | `200` | Safe: every `status` is `'none'`. |
| `GET /api/notes/:id` | Saved note for a problem id (validated against the catalog). | `200` note (or empty note if none saved); `404` unknown id. | `200 { dbConfigured: false }`. |
| `POST /api/notes/:id` | Upsert a note. Body `{ content?, status?, timeComplexity?, spaceComplexity? }` (untrusted → validated). Keeps `completed` consistent with `status: 'done'`. | `200` saved note; `400` malformed body / invalid status; `404` unknown id. | `400 { error: 'no database configured' }` (does not crash). |
| `GET /api/progress` | Overall counts for the banner: `{ completed, total, byStatus: { done, to_revisit, did_not_understand, none } }`. | `200` | Safe empty (all `none`). |
| `GET /api/competency` | Quiz-derived competency signals for Analytics (ADR 0007 Q4): `{ topics: [{ topicId, correct, incorrect, strength, lastSeen }], patterns: [{ id, description, topics, occurrences, lastObserved }] }`. `topics` are sorted weak→strong then by most misses; `patterns` by most occurrences. Read-only — reads via `readCompetencySignals`, the user's OWN outcomes/patterns only (no shipped answers, §6.2). | `200` | Safe empty `{ topics: [], patterns: [] }`. |
| `GET /api/config` | `{ dbConfigured, dataDir?, provider }` so the SPA can choose create-db vs show-catalog and show the provider banner. `dataDir` is display-only and omitted when no DB. | `200` | `{ dbConfigured: false, provider }`. |
| `POST /api/chat` | One interview-coach chat turn. Body `{ messages: [{ role: 'user'\|'assistant', content }, …] }` — the prior transcript **plus** the new user turn (untrusted → validated; must be a non-empty array ending with a `user` turn). Prepends the coach persona as a `system` message, calls the provider, returns `{ reply }` (the model's text — the only source of assistant text, §6.2). | `200 { reply }` | `400 { error: 'no model configured', … }` (provider REQUIRED). |

Response shapes are exported as types from `@ibai/web` (`ApiCatalogResponse`,
`ApiNoteResponse`, `ApiProgressResponse`, `ApiCompetencyResponse`,
`ApiConfigResponse`, `ApiChatResponse`).

### Quiz Master API (ADR 0007 — Q2)

The **Quickfire Quiz Master** engine (`quiz.ts`) drives a resumable,
shuffled, one-shot quiz over the user's `status: 'done'` problems. The MODEL is
the sole source of both the **question wording** and the **verdict** —
the app ships **no** canonical answers and the Quiz Master **never reveals the
answer** (§6.2). All four routes require a configured **provider** and the
server as storage owner.

| Method & path | Purpose | Success | Errors |
|---|---|---|---|
| `POST /api/quiz/start` | Build a session: read the done-set (catalog × per-problem note status `'done'`), **shuffle** into a deck (no repeats), persist as the active session, and present the first question (the problem **directly** — real title, no story, no hints). | `200 { empty:false, session:{ sessionId, deckSize, index, answered, status }, question:{ problemId, wrapped } }`; or `200 { empty:true, message }` when the done-set is empty (no session). | `400 { error:'no model configured' }`; `400 { error:'no database configured' }`; `405` wrong method. |
| `GET /api/quiz/session` | **Resume**: the active session (re-presents the current question + full transcript + progress). | `200 { active:true, session, question, transcript }`; `200 { active:false }` when none. | `405` wrong method. |
| `POST /api/quiz/answer` | The core turn. Body `{ answer: string }` (untrusted → validated). Builds an evaluation prompt (persona + the problem + the user's OWN intuition note as personalization), calls the provider, parses a strict JSON verdict **fail-closed**. **`correct`** (terminal, semi-optimal-or-better accepted) → record correct, bump competency signals, advance (no repeat), return next question. **`incorrect`** (terminal) → flip the note to `to_revisit`, record a miss `PatternSignal`, bump signals, advance. **`on_track`** → one non-terminal probe on the same question — **at most one nudge per question**: a second `on_track` from the model is **coerced by the engine to a terminal `incorrect`** (→ `to_revisit` + advance). Persists after every turn (resumable). | `200 { verdict, feedback, optimalNudge?, terminal, complete?, session, question }`. | `400` bad body / no provider; `404` no active session; `502` provider auth/connection/**malformed verdict** (fail-closed: **no writes**, no fabricated verdict); `405` wrong method. |
| `POST /api/quiz/new` | Discard the active session and start a fresh shuffled deck from the **current** done-set (same shape as `start`). | `200` (same as `start`). | same as `start`. |

The verdict JSON the model must emit is
`{ "verdict": "correct"|"incorrect"|"on_track", "feedback": string, "optimalNudge"?: string }`
in a fenced ```json block (parsed fail-closed, mirroring `core`'s `coach()`).
On any malformed/absent verdict the turn returns `502` and performs **no
storage writes** — never a fabricated verdict. `optimalNudge` nudges the user
toward a more optimal approach **without revealing it** (§6.2). Competency
signals are updated via `readCompetencySignals`/`writeCompetencySignals`; the
`to_revisit` flip is written via `writeIntuitionNote`, preserving other note
fields. The pure engine pieces (prompt building, verdict parsing, seedable
shuffle, session advance/no-repeat, competency-signal derivation) live in
`quiz.ts` and are unit-tested independently of the HTTP layer.

`POST /api/chat` never crashes on a provider failure: it returns a JSON error
with an appropriate status distinguishing the failure mode — **auth** and
**connection** errors (and any malformed/empty model output) map to `502` with a
clear message; a malformed request body or invalid `messages` array maps to
`400`; a wrong method maps to `405`. The only outbound network call is to the
user-configured provider, made server-side inside `complete()`.

Example:

```bash
curl -s http://127.0.0.1:4173/api/config
# {"dbConfigured":true,"provider":"...","dataDir":"/…/.interviewbudai/data"}

curl -s -X POST http://127.0.0.1:4173/api/notes/lc-3 \
  -H 'Content-Type: application/json' -d '{"status":"done","content":"…"}'
# {"problemId":"lc-3","content":"…","status":"done","completed":true,…}

curl -s -X POST http://127.0.0.1:4173/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"How should I start Two Sum?"}]}'
# {"reply":"What data structure lets you look up a complement in O(1)?"}
```

## Overview

This package provides a thin, localhost-only web server that exposes the ASSESS, PLAN, and COACH functionality through a polished UI, including an **Analytics** page with hand-built inline-SVG charts. It maintains **front-end parity** with the CLI—the same engine capabilities are available through both interfaces.

## Provider Required

The AI interview **requires a configured LLM provider**. All processing is local-first; your data never leaves your machine. The only outbound call is to your configured provider.

### Option 1: Anthropic (Claude)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export IBAI_ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

### Option 2: Ollama (Local)

```bash
# Start Ollama
ollama serve

# Pull a model
ollama pull llama2

# Configure
export IBAI_OLLAMA_MODEL=llama2

# Optionally set a custom URL (default: http://127.0.0.1:11434)
export IBAI_OLLAMA_URL=http://127.0.0.1:11434
```

## Features

- **Navigation bar** — Shared top nav on all pages. The **InterviewBudAI wordmark** sits on the left (appears on every page); nav links (Home, Analytics, Interview) sit on the right. Catalog is no longer a separate nav item — the Home page surfaces the catalog directly (see below).
- **Home page = the catalog** — The landing page at `/` has two states:
  - **No database**: Shows a "Create your database" start CTA linking to `/setup`.
  - **Database configured**: The home page **is** the problem catalog — the grouped-by-topic table is rendered directly on `/`, with a **"Continue practicing"** button in a top action bar. There is no separate "database ready" interstitial; you land straight on the problems.
- **Per-row status** — Each problem row on the home catalog shows its **status badge** (resolved via `resolveNoteStatus`): **Done** (green), **To revisit** (amber), **Did not understand** (red), or none. Read-only and safe when no database is configured.
- **Problem Catalog** — Browse curated problems grouped by topic with a status column, difficulty badges, LeetCode links, and Notes links. Available directly on the home page and at the standalone `/catalog` route (same grouped table).
- **Catalog-first onboarding** — New users see the create-database CTA; once a database exists, the home page shows the full catalog to explore and track.
- **Create database** — Simple setup flow to create and remember your data directory via browser cookie
- **Where You Stand** — View your current proficiency across topics, top strengths, focus areas, and recurring weaknesses
- **Your Next Session** — AI-derived session plan with warmup, focus, and twist topics displayed as cards with role badges and proficiency bars
- **Turn-by-turn AI Interview** — Conduct mock interviews where the AI asks questions and evaluates your answers
- **AI-Evaluation** — The model evaluates your performance; no self-assessment required
- **JSON APIs** — Machine-readable endpoints for integration with other tools
- **Dark theme** — Modern, accessible UI with dark color scheme
- **Local-first** — All data stays on your machine; no telemetry, no cloud dependencies
- **Cookie-based directory persistence** — Browser remembers your data directory across visits (no login required)
- **Notes editor** — Capture your intuition, solution approach, time/space complexity, and set a **status tag** for each problem
- **Status tags** — Each note carries a status: **None**, **Done**, **To revisit**, or **Did not understand**. `Done` keeps the legacy `completed` flag consistent, so the analytics count and catalog ✓ markers keep working
- **Analytics charts** — The **Analytics** page (`/analytics`) renders real, hand-built **inline-SVG** visualizations (no external chart library, CDN, font, or network): a **proficiency bar chart** (per-topic proficiency from your competency map) and a **status breakdown** bar chart + table (problem counts by note status — Done / To revisit / Did not understand / Not started — aggregated across the catalog via `resolveNoteStatus`). Shows a friendly **empty state** ("No data yet — start practicing") when there is no data. All dynamic labels are HTML-escaped, including inside SVG text.
- **Per-request data resolution** — Home and analytics honor the cookie-specified data directory

## Quick Start

```bash
# Build
npm run build

# Configure a provider (choose one)
export IBAI_OLLAMA_MODEL=llama2  # For Ollama
# OR
export ANTHROPIC_API_KEY=sk-ant-... && export IBAI_ANTHROPIC_MODEL=claude-sonnet-4-20250514  # For Anthropic

# Start the server
npm --workspace @ibai/web run start
```

Open http://127.0.0.1:4173/coach and start your AI-powered interview!

## Building

```bash
npm run build
```

## Starting the Server

```bash
# With default settings (data dir: ~/.interviewbudai/data, port: 4173)
npm --workspace @ibai/web run start

# With custom data directory
IBAI_DATA_DIR=/path/to/data npm --workspace @ibai/web run start

# With custom port
IBAI_WEB_PORT=8080 npm --workspace @ibai/web run start

# Using CLI flags
node packages/web/dist/server-bin.js --data-dir=/path/to/data --port=8080
```

## Configuration

| Setting | CLI Flag | Environment Variable | Default |
|---------|----------|---------------------|----------|
| Data directory | `--data-dir=<path>` | `IBAI_DATA_DIR` | `~/.interviewbudai/data` |
| Port | `--port=<port>` | `IBAI_WEB_PORT` | `4173` |
| Ollama URL | — | `IBAI_OLLAMA_URL` | `http://127.0.0.1:11434` |
| Ollama Model | — | `IBAI_OLLAMA_MODEL` | *(required for Ollama)* |
| Anthropic API Key | — | `ANTHROPIC_API_KEY` | *(required for Anthropic)* |
| Anthropic Model | — | `IBAI_ANTHROPIC_MODEL` | *(required for Anthropic)* |

Precedence: CLI flag > environment variable > default.

## Endpoints

| Path | Method | Format | Description |
|------|--------|--------|-------------|
| `/app` | GET | HTML/asset | React SPA (M0 scaffold, ADR 0006). Serves the Vite-built shell + local `/app/assets/*` JS/CSS. Graceful message if the bundle is not built. |
| `/` | GET | HTML | Home page. With a database configured it renders the problem catalog directly (grouped table + per-row status + "Continue practicing"); with no database it shows the create-database CTA. |
| `/analytics` | GET | HTML | Analytics page: Where You Stand, Your Next Session, and inline-SVG proficiency + status-breakdown charts (with a table). Friendly empty state when no data. |
| `/dashboard` | GET | 302 | Back-compat redirect to `/analytics` (the page was renamed from Dashboard → Analytics). Old bookmarks keep working. |
| `/assess` | GET | HTML | Alias for `/analytics` |
| `/catalog` | GET | HTML | Standalone problem catalog grouped by topic (same table as home) with status, LeetCode, and Notes links |
| `/notes/<id>` | GET | HTML | View/edit notes for a problem. Shows setup CTA if no database exists. (SPA users get the React editor at `/app/notes/<id>` — M3; this server-rendered route remains until M6.) |
| `/notes/<id>` | POST | HTML | Save notes content, status tag, and complexity. Shows 'Saved' banner on success. |
| `/setup` | GET | HTML | Form to create/select data directory |
| `/setup` | POST | HTML | Create data directory and set cookie |
| `/assess.json` | GET | JSON | AssessmentView as JSON |
| `/plan.json` | GET | JSON | SessionPlan as JSON |
| `/coach` | GET | HTML | Start turn-by-turn AI interview (requires provider). SPA users get the React chat at `/app/interview` — M5; this server-rendered route remains until M6. |
| `/coach` | POST | HTML | Submit answer, get next question or final evaluation |
| `/coach.json` | POST | JSON | Execute coaching session with JSON API |
| `/api/chat` | POST | JSON | One interview-coach chat turn for the React chat page. Body `{ messages: [...] }` (transcript + new user turn); returns `{ reply }`. Provider REQUIRED (no provider → `400`). |

Optional query parameter: `?sessionId=<id>` to assess/plan/coach for a specific session.

## AI Interview Flow

### GET /coach

Starts a turn-by-turn AI interview. The model generates interviewer questions for each topic in your session plan. Requires a configured provider.

### POST /coach

Submits your answer to the current question. If more topics remain, returns the next question. When all topics are complete, the model evaluates your answers and returns:
- AI-generated coaching narrative
- Per-topic evaluations (succeeded/failed with feedback)
- Updated competency map and weakness register

### POST /coach.json

JSON API for programmatic access. Accepts:
```json
{
  "sessionId": "optional-session-id",
  "answers": [
    { "topicId": "arrays", "question": "What is...", "answer": "My answer..." },
    { "topicId": "graphs", "answer": "My answer..." }
  ]
}
```

Returns the full `CoachResult` object with evaluations, summary, and updated competency/weakness data.

### Error Handling

| Scenario | Status | Message |
|----------|--------|---------|
| No provider configured | 200 (HTML) / 400 (JSON) | Configuration instructions |
| Provider connection error | 502 | "Could not reach the model provider..." |
| Authentication error | 502 | "The model rejected the request..." |
| Malformed model output | 502 | "The model returned an unusable response..." |
| Invalid request | 400 | Specific validation error |

## Analytics Sections

### Where You Stand

Displays your current proficiency across topics with:
- Proficiency bars for each topic
- Top 3 strengths highlighted
- Focus areas that need work
- Recurring weaknesses from the weakness register

### Your Next Session

Shows the AI-derived session plan with:
- Topic cards with role badges (warmup/focus/twist)
- Proficiency indicators
- Rationale for each topic selection

### Charts (inline SVG, local-first)

- **Proficiency by topic** — a horizontal bar chart of per-topic proficiency, derived from the AssessmentView competency map (strengths + focus areas). Empty state when there is no competency data yet.
- **Status breakdown** — a vertical bar chart plus a compact table counting problems by resolved note status (Done / To revisit / Did not understand / Not started), aggregated across the catalog via `resolveNoteStatus`.

Both charts are hand-built inline `<svg>` — no chart library, no CDN, no network. All labels are HTML-escaped, including SVG `<text>`. When there is neither competency data nor tracked problems, the page shows a single friendly empty state instead of charts.

## Privacy & Security

- **Localhost-only** — Server binds to 127.0.0.1 by default
- **No telemetry** — No usage data is collected or transmitted
- **Local-first** — All user data stored locally in your data directory
- **Provider calls only** — The only network calls are to your configured LLM provider
