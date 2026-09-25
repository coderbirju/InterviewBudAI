# @ibai/web

Locally-hosted web front-end for InterviewBudAI: problem catalog, notes, analytics, and the Quickfire Quiz Master.

## Overview

This package provides a thin, localhost-only Node server that serves a React SPA and a same-origin JSON API. It does not currently expose `assess`/`plan` (CLI-only since M6), and the Quiz Master engine lives in this package rather than `core`, so the CLI has no quiz — both are tracked parity gaps in `context-files/progress/status.md`.

## React SPA (ADR 0006) — the app

The web UI is a **React + Vite + Tailwind + lucide-react** single-page app, served at the **site root (`/`)** by the existing localhost-only Node server. It was migrated in incremental milestones (M0–M6, see `context-files/decisions/0006-web-react-toolchain.md`); **M6 completed the migration** — the SPA is now the whole UI and the old server-rendered HTML pages were retired.

### Server surface (M6)

The server is intentionally small — three surfaces:

- **`/` (and all other non-API, non-`/setup` GET paths)** — the React SPA bundle + assets. Client-side routing (History API, no routing library) handles `/notes/:id`, `/analytics`, and `/interview`; deep links and refreshes fall back to `index.html`. Vite `base` is `/`, so assets are served at `/assets/*` (local, same-origin — no CDN).
- **`/api/*`** — the same-origin, localhost-only JSON API the SPA consumes (`/api/catalog`, `/api/notes/:id` GET+POST, `/api/progress`, `/api/competency`, `/api/config`, `/api/chat`, and the Quiz Master routes `/api/quiz/start|new|session|answer` plus session-management `/api/quiz/sessions` GET, `/api/quiz/end` POST, `/api/quiz/resume` POST, `/api/quiz/delete` POST + `DELETE /api/quiz/session/:id`). The server remains the storage owner; the browser is UI + cookie.
- **`/setup`** — the one remaining **server-rendered page**: `GET /setup` shows the create-database form; `POST /setup` creates the data directory and sets the persistent `ibai_data_dir` cookie (`Max-Age=31536000`), then links back to the SPA at `/`. The SPA's no-DB states link here.

Everything else (home/catalog/notes/analytics/interview HTML, `/coach`, `/coach.json`, `/dashboard`, `/assess`, `/assess.json`, `/plan.json`) was **removed**. Home/notes/analytics/interview now live in the SPA; the assess/plan views (Where You Stand / Next Session) were not ported and are CLI-only for now.

### SPA views

- **Home** (`/`) — global progress banner (`GET /api/progress`) + categorized accordion problem list (`GET /api/catalog`) with an interactive 4-state Status control that optimistically updates and `POST`s to `/api/notes/:id`. No Solution/Video/Code columns (the project ships no answers, charter §6.2).
- **Notes** (`/notes/:id`) — the intuition editor: status control + free-text intuition + time/space complexity, saved via `POST /api/notes/:id`.
- **Analytics** (`/analytics`) — hand-built inline-SVG progress charts (status breakdown + per-topic completion) driven by pure geometry helpers — no external chart library/CDN. It also surfaces a **Competency** section (ADR 0007 Q4) fed by `GET /api/competency`: per-topic **strength** bars (weak=red / improving=amber / strong=emerald / slate=too little data) with each topic's correct/incorrect tally, worst-first, plus a **recurring miss patterns** list (the topics to focus next — the user's own recurring gaps, never a solution, §6.2). When no quiz signals exist yet it shows a "Take a quiz session to build your competency map" empty state linking to `/interview`; loading + API-error states are handled like the rest of the page.
- **Interview** (`/interview`) — the **Quickfire Quiz Master** (ADR 0007 Q3, amended by quiz-fix-a), replacing the old generic interview chat. On load it resumes the single active session via `GET /api/quiz/session` (current question + prior transcript + progress); with none it offers a **Start quiz** entry (`POST /api/quiz/start`). Each question shows a real problem you marked **Done** **directly** from the catalog — its title, a difficulty badge, and an **Open problem** link (new tab, `rel="noopener noreferrer"`); no invented story, no hints, no model call — type your approach and `POST /api/quiz/answer` returns a **verdict**: `correct` (emerald "Correct ✓" + optional optimal nudge) → advance; `incorrect` (amber "Marked for revisit" + feedback) → advance; `on_track` → the same question (title stays visible) with **one** probe shown in its own card, also re-shown after a reload (at most one nudge per question; a second `on_track` is coerced to `incorrect`). The Quiz Master **never reveals the answer**. The prior verdict card is cleared when the next question renders. A progress bar tracks `answered / deckSize`; when the deck is exhausted a **Session complete** summary (correct / to-revisit tallies) offers **New session** (`POST /api/quiz/new`, reshuffle from the current done-set). Empty done-set → a friendly "mark problems as Done first" state linking Home; provider **required** → the "Configure a model" state; provider/verdict failures → a friendly inline banner that never loses the session.

  **Session management (quiz-fix-b).** An **End session** control is shown during an active quiz — `POST /api/quiz/end` persists the session `complete` and clears the active pointer, so it stops being resumable-active but **remains listed** (ending never deletes). The idle and complete views show a **Your sessions** list (`GET /api/quiz/sessions`, empty-safe): one card per past + active session (created time, `answered / deckSize`, correct tally, status/Active badge) with a **Resume** button (`POST /api/quiz/resume { sessionId }` — re-activates it as the resumable session and continues from its position; a session whose deck is exhausted is shown as complete and is not re-activated) and a **Delete** button (`POST /api/quiz/delete { sessionId }` after a small confirm; a REST-form `DELETE /api/quiz/session/:id` is also accepted). Delete is idempotent (missing → `ok:true`); deleting the active session also clears the pointer. Loading/empty/error states are handled and the page never crashes with no DB / no sessions.

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

Tailwind is compiled to a **static CSS file at build time** and lucide-react icons are **bundled into the JS**. The served `/` HTML references only local, same-origin `/assets/*` files — **no CDN, no remote fonts, no runtime network**. The SPA is served by the existing localhost-only Node server.

## JSON API (M1 — ADR 0006 D4)

The server exposes a same-origin, **localhost-only JSON API** under `/api` for
the React SPA to consume. The server remains the **storage owner** (the browser
is UI + cookie; the server is the filesystem authority). There is **no auth** (local-first).

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
shuffled, one-shot quiz over the user's `status: 'done'` problems. Questions
are presented **deterministically from the catalog** (title + difficulty +
link — ADR 0007 A8; no model call), so a session can never be left active
without a presentable question. The MODEL is the sole source of the
**verdict** — the app ships **no** canonical answers and the Quiz Master
**never reveals the answer** (§6.2). Every `question` object is
`{ problemId, wrapped, title, difficulty, url, probe? }` — `wrapped` is kept for
wire stability and holds `"<title> (<difficulty>)"`; `probe` is the `on_track`
nudge already given for the current question, if any. The four routes below
require a configured **provider** (start/new still return `400 no model
configured` without one, because answers need a model);
session-management routes (`GET /api/quiz/sessions`, `POST /api/quiz/end`,
`POST /api/quiz/resume`, `POST /api/quiz/delete`, `DELETE /api/quiz/session/:id`)
are described under SPA views above.

| Method & path | Purpose | Success | Errors |
|---|---|---|---|
| `POST /api/quiz/start` | Build a session: read the done-set (catalog × per-problem note status `'done'`), **shuffle** into a deck (no repeats), persist it as the active session **together with** its first question (the catalog problem **directly** — real title, difficulty, link; no model call). | `200 { empty:false, session:{ sessionId, deckSize, index, answered, status }, question:{ problemId, wrapped, title, difficulty, url } }`; or `200 { empty:true, message }` when the done-set is empty (no session). | `400 { error:'no model configured' }`; `400 { error:'no database configured' }`; `405` wrong method. |
| `GET /api/quiz/session` | **Resume**: the active session (re-presents the current question from the catalog, plus any pending `probe`, full transcript + progress). A session with nothing to present (deck exhausted, problem no longer in the catalog) is reported as `{ active:false }`. | `200 { active:true, session, question, transcript }`; `200 { active:false }` when none. | `405` wrong method. |
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

## Provider Required

The Quiz Master (and `POST /api/chat`) **require a configured LLM provider**. Everything else is local-first; the only outbound call is to your configured provider.

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

## Quick Start

```bash
# Build
npm run build

# Configure a provider (choose one)
export IBAI_OLLAMA_MODEL=llama3  # For Ollama
# OR
export ANTHROPIC_API_KEY=sk-ant-... && export IBAI_ANTHROPIC_MODEL=claude-sonnet-4-20250514  # For Anthropic

# Start the server
npm --workspace @ibai/web run start
```

Open http://127.0.0.1:4173/ — mark problems Done on Home, then take a quiz under **Interview**.

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

## Privacy & Security

- **Localhost-only** — Server binds to 127.0.0.1 by default
- **No telemetry** — No usage data is collected or transmitted
- **Local-first** — All user data stored locally in your data directory
- **Provider calls only** — The only network calls are to your configured LLM provider
