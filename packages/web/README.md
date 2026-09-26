# @ibai/web

Locally-hosted web front-end for InterviewBudAI: problem catalog, notes, analytics, and the Quickfire Quiz Master.

## Overview

This package provides a thin, localhost-only Node server that serves a React SPA and a same-origin JSON API. It does not currently expose `assess`/`plan` (CLI-only since M6), and the Quiz Master engine lives in this package rather than `core`, so the CLI has no quiz — both are tracked parity gaps in `context-files/progress/status.md`.

## React SPA (ADR 0006) — the app

The web UI is a **React + Vite + Tailwind + lucide-react** single-page app, served at the **site root (`/`)** by the existing localhost-only Node server. It was migrated in incremental milestones (M0–M6, see `context-files/decisions/0006-web-react-toolchain.md`); **M6 completed the migration** — the SPA is now the whole UI and the old server-rendered HTML pages were retired.

### Server surface (M6)

The server is intentionally small — three surfaces:

- **`/` (and all other non-API, non-`/setup` GET paths)** — the React SPA bundle + assets. Client-side routing (History API, no routing library) handles `/notes/:id`, `/analytics`, `/interview`, and `/data`; deep links and refreshes fall back to `index.html`. Vite `base` is `/`, so assets are served at `/assets/*` (local, same-origin — no CDN).
- **`/api/*`** — the same-origin, localhost-only JSON API the SPA consumes (`/api/catalog`, `/api/notes/:id` GET+POST, `/api/progress`, `/api/competency`, `/api/config`, and the Quiz Master routes `/api/quiz/start|new|session|answer` plus session-management `/api/quiz/sessions` GET, `/api/quiz/end` POST, `/api/quiz/resume` POST, `/api/quiz/delete` POST + `DELETE /api/quiz/session/:id`). The server owns the data directory; the browser is UI only (see [The data directory](#first-run-and-the-data-directory)).
- **`/setup`** — the one remaining **server-rendered page**: `GET /setup` shows the create-database form; `POST /setup` creates the data directory, saves the choice to `~/.interviewbudai/config.json` and switches the server to it immediately (for every browser, and after restarts), then links back to the SPA at `/`. It is the **no-JavaScript fallback** for the SPA's [Your data](#your-data-data--adr-0009-d1) page (`/data`), shares its code path (`DataDirControl.choose` in `src/data-dir-control.ts`) and links to it; the SPA itself links to `/data`, not here.

Everything else (home/catalog/notes/analytics/interview HTML, `/coach`, `/coach.json`, `/dashboard`, `/assess`, `/assess.json`, `/plan.json`) was **removed**. Home/notes/analytics/interview now live in the SPA; the assess/plan views (Where You Stand / Next Session) were not ported and are CLI-only for now.

### SPA views

- **Home** (`/`) — global progress banner (`GET /api/progress`) + categorized accordion problem list (`GET /api/catalog`) with an interactive 4-state Status control that optimistically updates and `POST`s to `/api/notes/:id`. No Solution/Video/Code columns (the project ships no answers, charter §6.2). A **search + filter bar** narrows the catalog client-side (no extra API): instant case-insensitive search on title or problem id, plus multi-select **Difficulty** (Easy/Medium/Hard) and **Status** (Not started/Done/To revisit/Didn't understand) chips — OR within a facet, AND across facets. While filtering, matching topics auto-expand, empty topics are hidden, each header shows an "N matches" badge, and the bar shows "N of M problems" with **Clear filters**; zero matches shows a friendly empty state. The filter lives in the URL query (`/?q=sum&difficulty=Easy,Hard&status=to_revisit`, written with `history.replaceState`) so reload, browser Back/Forward and the Notes page's **Back to problems** link all keep it (the URL is the source of truth: clicking the Problems nav link to a bare `/` clears it; facet values parse case-insensitively). Clearing restores whichever topics you had open before filtering, and a topic you collapse while filtering stays collapsed as you type. Changing a row's status under an active filter keeps that row visible until the filter next changes. Pure logic: `web-ui/src/lib/home.ts` (`filterCatalog`, `filterFromSearch`, `searchWithFilter`).
- **Notes** (`/notes/:id`) — the intuition editor: status control + free-text intuition + time/space complexity, saved via `POST /api/notes/:id`.
- **Analytics** (`/analytics`) — hand-built inline-SVG progress charts (status breakdown + per-topic completion) driven by pure geometry helpers — no external chart library/CDN. It also surfaces a **Competency** section (ADR 0007 Q4) fed by `GET /api/competency`: per-topic **strength** bars (weak=red / improving=amber / strong=emerald / slate=too little data) with each topic's correct/incorrect tally, worst-first, plus a **recurring miss patterns** list (the topics to focus next — the user's own recurring gaps, never a solution, §6.2). When no quiz signals exist yet it shows a "Take a quiz session to build your competency map" empty state linking to `/interview`; loading + API-error states are handled like the rest of the page.
- **Interview** (`/interview`) — the **Quickfire Quiz Master** (ADR 0007 Q3, amended by quiz-fix-a), replacing the old generic interview chat. On load it resumes the single active session via `GET /api/quiz/session` (current question + prior transcript + progress); with none it offers a **Start quiz** entry (`POST /api/quiz/start`). Each question shows a real problem you marked **Done** **directly** from the catalog — its title, a difficulty badge, and an **Open problem** link (new tab, `rel="noopener noreferrer"`); no invented story, no hints, no model call — type your approach and `POST /api/quiz/answer` returns a **verdict**: `correct` (emerald "Correct ✓" + optional optimal nudge) → advance; `incorrect` (amber "Marked for revisit" + feedback) → advance; `on_track` → the same question (title stays visible) with **one** probe shown in its own card, also re-shown after a reload (at most one nudge per question; a second `on_track` is coerced to `incorrect`). The Quiz Master **never reveals the answer**. The prior verdict card is cleared when the next question renders. A progress bar tracks `answered / deckSize`; when the deck is exhausted a **Session complete** summary (correct / to-revisit tallies) offers **New session** (`POST /api/quiz/new`, reshuffle from the current done-set). Empty done-set → a friendly "mark problems as Done first" state linking Home; provider **required** → the "Configure a model" state; provider/verdict failures → a friendly inline banner that never loses the session.

  **Session management (quiz-fix-b).** An **End session** control is shown during an active quiz — `POST /api/quiz/end` persists the session `complete` and clears the active pointer, so it stops being resumable-active but **remains listed** (ending never deletes). The idle and complete views show a **Your sessions** list (`GET /api/quiz/sessions`, empty-safe): one card per past + active session (created time, `answered / deckSize`, correct tally, status/Active badge) with a **Resume** button (`POST /api/quiz/resume { sessionId }` — re-activates it as the resumable session and continues from its position; a session whose deck is exhausted is shown as complete and is not re-activated) and a **Delete** button (`POST /api/quiz/delete { sessionId }` after a small confirm; a REST-form `DELETE /api/quiz/session/:id` is also accepted). Delete is idempotent (missing → `ok:true`); deleting the active session also clears the pointer. Loading/empty/error states are handled and the page never crashes with no DB / no sessions.

- **Your data** (`/data`, nav link **Data**) — see [below](#your-data-data--adr-0009-d1).

All no-DB states link to `/data`. All values render via JSX (auto-escaped); no `dangerouslySetInnerHTML`. The only outbound calls are the user-configured LLM provider, made **server-side** inside the `POST /api/quiz/*` routes.

### Where the UI lives

```
packages/web/
  src/          existing Node server (tsc build → dist/)  ← unchanged pipeline
  web-ui/       React SPA source (Vite build → dist-ui/)  ← separate pipeline
    index.html
    src/main.tsx, src/App.tsx, src/index.css
    src/components/  ProgressBanner, CatalogFilterBar, CategoryAccordion,
                     ProblemRow, StatusControl, DifficultyBadge, Home, Notes,
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
npm start                                       # from repo root: builds if needed, then serves
# open http://127.0.0.1:4173/
```

`npm start` (root) runs `packages/web/bin/start.mjs`: an incremental
`tsc --build` (a no-op when `dist/` is current), a Vite build only when
`dist-ui/` is missing or older than `web-ui/`, then the server. To skip the
build check entirely, use `npm --workspace @ibai/web run serve` (runs
`dist/server-bin.js` directly).

If the SPA bundle is absent (you ran the server without `build:ui`), `/` **degrades gracefully** with a short "run `npm run build:ui`" message; `/api/*` and `/setup` still work.

### Local-first guarantee

Tailwind is compiled to a **static CSS file at build time** and lucide-react icons are **bundled into the JS**. The served `/` HTML references only local, same-origin `/assets/*` files — **no CDN, no remote fonts, no runtime network**. The SPA is served by the existing localhost-only Node server.

## JSON API (M1 — ADR 0006 D4)

The server exposes a same-origin, **localhost-only JSON API** under `/api` for
the React SPA to consume. The server is the **storage owner** and the filesystem
authority; the browser is UI only. There is **no auth** (local-first),
but requests must pass the [localhost hardening](#localhost-hardening-csrf--dns-rebinding)
checks: a loopback `Host`, same-origin writes, and `Content-Type: application/json`
on every mutating call.

Every `/api` route returns `application/json`, uses the **server's** data
directory (resolved once at boot — see
[The data directory](#first-run-and-the-data-directory) — and changed only by
`POST /setup` or `POST /api/data-dir`; no cookie or other request metadata can
redirect it), uses proper status codes,
and never emits HTML (`404` for unknown `/api` paths, `405` for wrong methods,
`413` for a body over 1 MiB).

| Method & path | Purpose | Success | No-DB behaviour |
|---|---|---|---|
| `GET /api/catalog` | Full curated catalog grouped by topic (alphabetical), each problem `{ id, title, url, difficulty, status, completed }`, plus `totals: { total, byStatus }`. | `200` | Safe: every `status` is `'none'`. |
| `GET /api/notes/:id` | Saved note for a problem id (validated against the catalog). | `200` note (or empty note if none saved); `404` unknown id. | `200 { dbConfigured: false }`. |
| `POST /api/notes/:id` | Upsert a note. Body `{ content?, status?, timeComplexity?, spaceComplexity? }` (untrusted → validated). Keeps `completed` consistent with `status: 'done'`. | `200` saved note; `400` malformed body / invalid status; `404` unknown id. | `400 { error: 'no database configured' }` (does not crash). |
| `GET /api/progress` | Overall counts for the banner: `{ completed, total, byStatus: { done, to_revisit, did_not_understand, none } }`. | `200` | Safe empty (all `none`). |
| `GET /api/competency` | Quiz-derived competency signals for Analytics (ADR 0007 Q4): `{ topics: [{ topicId, correct, incorrect, strength, lastSeen }], patterns: [{ id, description, topics, occurrences, lastObserved }] }`. `topics` are sorted weak→strong then by most misses; `patterns` by most occurrences. Read-only — reads via `readCompetencySignals`, the user's OWN outcomes/patterns only (no shipped answers, §6.2). | `200` | Safe empty `{ topics: [], patterns: [] }`. |
| `GET /api/config` | `{ dbConfigured, dataDir?, provider }` so the SPA can choose create-db vs show-catalog and show the provider banner. `dataDir` is display-only and omitted when no DB. | `200` | `{ dbConfigured: false, provider }`. |

Response shapes are exported as types from `@ibai/web` (`ApiCatalogResponse`,
`ApiNoteResponse`, `ApiProgressResponse`, `ApiCompetencyResponse`,
`ApiConfigResponse`, `ApiDataDirResponse`, `ApiDataDirInspection`). The old
generic interview chat (`POST /api/chat`) was removed (ADR 0008 D4) — it now
404s like any unknown `/api` path.

### Your data (`/data` — ADR 0009 D1)

The SPA's data-setup page (nav link **Data**; `/setup` is the no-JS
fallback). Sections: **Active folder** (path, source, note count; read-only
with "restart without `--data-dir` / unset `IBAI_DATA_DIR`" when pinned),
**Found previous data** (legacy-recovery cards, below), **Use an existing
notes folder** (path field → **Check** = dry run, **Use this folder** =
switch; server validation errors inline, success toast + refreshed counts),
and an **Import notes from CSV** placeholder (ADR 0009 D2, next PR).

A **banner** on Home and Analytics links here: "Don't see your solved
problems? …" whenever the active folder has **0 notes** (not dismissible), or
"A folder with InterviewBudAI notes was found — review it" when a candidate exists
(dismissible for the tab via `sessionStorage` once the folder has notes).

| Method & path | Body | Result |
|---|---|---|
| `GET /api/data-dir` | — | `{ dataDir, source: 'flag'\|'env'\|'config'\|'default', pinned, exists, noteCount, formatVersion, legacyCandidates: [{ path, noteCount, origin: 'cookie'\|'legacy-default' }] }` |
| `POST /api/data-dir` | `{ path, dryRun?: boolean }` | **Dry run:** `{ dryRun: true, path, exists, noteCount, quizSessionCount, hint? }` — no writes; `hint` is `{ kind: 'use-parent', path }` for a `…/notes` folder whose parent holds notes, or `{ kind: 'not-ibai-format' }` for Markdown that is not `notes/<id>.md`. **Otherwise:** validated exactly like `POST /setup` (absolute or `~/`, normalized, no NUL, not a root, not a file), created `0700` if missing, `config.json` written atomically (`0600`), the running server switched; returns the `GET` shape. Invalid path / pinned dir → `400 { error }` (the pinned message names the flag/env). |
| `POST /api/data-dir/legacy/dismiss` | `{}` | Stops offering the current candidates (this server process); returns the `GET` shape. |

All three sit behind the same checks as every `/api` write (Host allowlist,
same-origin `Origin`/`Sec-Fetch-Site` → `403`, `Content-Type:
application/json` → else `415`, 1 MiB cap → `413`). `noteCount` counts
recognised notes: regular files `notes/<id>.md` whose leading frontmatter
`id:` equals `<id>` and whose id is in the catalog (so an Obsidian/Jekyll
`notes/recipe.md` does not count). The same rule decides candidate
eligibility and the dry-run `not-ibai-format` hint. `formatVersion` is `1` for every folder today (no
`manifest.json` yet — ADR 0009 D4).

**Legacy recovery.** Folders chosen with the old cookie-era `/setup` are not
lost — the server just stopped looking there. `legacyCandidates` offers:

- `cookie` — the path(s) seen in a legacy `ibai_data_dir` cookie on requests
  that passed the Host check, remembered in memory (newest first, up to 3
  distinct valid values) so they survive the browser dropping or overwriting
  the cookie. A small set rather than first-wins or latest-wins: any page on
  another localhost port can set this cookie, so a planted value can neither
  lock out nor silently replace the real one — the user sees both and picks
  the folder they recognise; and
- `legacy-default` — `~/.ibai/data` (the old documented default, still used
  by the frozen CLI),

each only while the dir is **not pinned** and **no `config.json` exists**,
and only if the path passes the same validation, is an existing directory
other than the active one, and holds ≥ 1 recognised note (re-checked on every
read). A candidate is only a **suggestion**: "Use it" sends an ordinary
`POST /api/data-dir { path }` (re-validated from scratch). The cookie never
selects the directory; it is expired (`Set-Cookie … Max-Age=0`) on a
successful switch (`POST /api/data-dir` or `POST /setup`) or a dismiss.

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
nudge already given for the current question, if any. Only
`POST /api/quiz/start`, `/new`, and `/answer` require a configured
**provider** (start/new still return `400 no model configured` without one,
because answers need a model); `GET /api/quiz/session` (resume) does not.
Session-management routes (`GET /api/quiz/sessions`, `POST /api/quiz/end`,
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

The quiz routes never crash on a provider failure: **auth** and
**connection** errors map to `502` with a clear message. The only outbound
network call is to the user-configured provider, made server-side inside
`complete()`.

Example:

```bash
curl -s http://127.0.0.1:4173/api/config
# {"dbConfigured":true,"provider":"...","dataDir":"/…/.interviewbudai/data"}

curl -s -X POST http://127.0.0.1:4173/api/notes/lc-3 \
  -H 'Content-Type: application/json' -d '{"status":"done","content":"…"}'
# {"problemId":"lc-3","content":"…","status":"done","completed":true,…}
```

## Provider Required

The Quiz Master **requires a configured LLM provider**. Everything else is local-first; the only outbound call is to your configured provider.

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
npm ci
cp .env.example .env    # optional: fill in a provider (or export the vars)
npm start               # builds if needed, then serves http://127.0.0.1:4173/
```

Open http://127.0.0.1:4173/ — mark problems Done on Home, then take a quiz under **Interview**.

### Startup banner

On boot the server prints the URL, the data directory, and the provider
status, e.g.:

```
InterviewBudAI is running at http://127.0.0.1:4173/
  Data:     /Users/you/.interviewbudai/data (created on first run)
  Provider: no model configured — quiz disabled; set ANTHROPIC_API_KEY + IBAI_ANTHROPIC_MODEL or IBAI_OLLAMA_MODEL
  Press Ctrl+C to stop.
```

Only the provider kind and model name are shown — never an API key.

### First run and the data directory

The **server owns the data directory** (ADR 0005 amendment w2d). It is resolved
**once at boot**, with this precedence:

1. `--data-dir=<path>` flag
2. `IBAI_DATA_DIR` environment variable
3. `~/.interviewbudai/config.json` — `{ "dataDir": "<absolute path>" }`,
   written by `/setup` (file `0600`, directory `0700`; holds no secrets)
4. the default `~/.interviewbudai/data`

Every request uses that server state — the browser cannot choose or redirect
it, and every browser sees the same data.

- **Default:** if the directory does not exist, boot creates it (`mkdir -p`,
  mode `0700`) so the app is usable immediately.
- **Flag / env / config.json:** never auto-created (a typo, or a directory you
  removed, must not silently reappear). The banner says it does not exist yet;
  create it yourself or choose one on **Your data** (`/data`) or `/setup`.
- **`/data` (SPA) and `/setup` (no-JS fallback)** share one code path.
  `/setup` creates the chosen directory, writes `config.json` atomically
  (temp file + rename) and switches the running server to it immediately; it
  survives restarts. If the directory is **pinned** by `--data-dir` /
  `IBAI_DATA_DIR`, `/setup` says so and refuses to change it (`400`) — it can
  only create the pinned directory. Restart without the flag/env to choose here.
- **Invalid `config.json`** (not JSON, `dataDir` not an absolute path, NUL
  bytes, a filesystem root, …) is ignored with a one-time warning at boot; the
  default is used.
- **Legacy cookie:** older versions remembered the path in an `ibai_data_dir`
  browser cookie. It never selects the directory any more. If that folder (or
  the old default `~/.ibai/data`) still holds notes and you have not chosen a
  folder yet, **Your data** offers "Found previous data at … — Use it /
  Dismiss" (see [Your data](#your-data-data--adr-0009-d1)); the cookie is
  expired once you switch folders or dismiss. Otherwise type the old path
  into "Use an existing notes folder".

### `.env` loading

`server-bin` loads the **repo-root** `.env` (whatever directory you start
from, e.g. `npm start` at the root or `npm -w @ibai/web start`) using Node's
built-in `process.loadEnvFile` — no dependency. The path is fixed, not
configurable. Variables already exported in your shell take precedence. A
`.env` that cannot be read or parsed prints a one-line warning and the server
starts without it. Requires Node 20.12+ (the repo `engines` minimum).

## Building

```bash
npm run build
```

## Starting the Server

```bash
# With default settings (data dir: ~/.interviewbudai/data, port: 4173)
npm start

# With custom data directory (must exist, or create it via /setup)
IBAI_DATA_DIR=/path/to/data npm start

# With custom port
IBAI_WEB_PORT=8080 npm start

# Using CLI flags (after a build)
node packages/web/dist/server-bin.js --data-dir=/path/to/data --port=8080
```

## Configuration

| Setting | CLI Flag | Environment Variable | Default |
|---------|----------|---------------------|----------|
| Data directory | `--data-dir=<path>` | `IBAI_DATA_DIR` | `~/.interviewbudai/config.json` (set via `/setup`), else `~/.interviewbudai/data` (auto-created) |
| Port | `--port=<port>` | `IBAI_WEB_PORT` | `4173` |
| Ollama URL | — | `IBAI_OLLAMA_URL` | `http://127.0.0.1:11434` |
| Ollama Model | — | `IBAI_OLLAMA_MODEL` | *(required for Ollama)* |
| Anthropic API Key | — | `IBAI_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY` | *(required for Anthropic)* |
| Anthropic Model | — | `IBAI_ANTHROPIC_MODEL` | *(required for Anthropic)* |

Precedence: CLI flag > environment variable (shell > `.env`) > default (for the data directory: > `config.json` > default). The host is always `127.0.0.1` (not configurable).

## Privacy & Security

- **Localhost-only** — Server always binds to 127.0.0.1 (not configurable)
- **No telemetry** — No usage data is collected or transmitted
- **Local-first** — All user data stored locally in your data directory
- **Provider calls only** — The only network calls are to your configured LLM provider

### Localhost hardening (CSRF / DNS rebinding)

Binding to 127.0.0.1 does not stop a web page you visit from sending requests
to the server through your browser, so every request is checked
(`src/security.ts`, applied in `src/handler.ts`):

- **Host allowlist** — only `Host: 127.0.0.1:<port>`, `localhost:<port>` or
  `[::1]:<port>` (the bound port) is served; anything else gets `421`. This
  blocks DNS rebinding (an attacker domain resolving to 127.0.0.1).
- **Same-origin writes** — on `POST`/`PUT`/`PATCH`/`DELETE`, a present
  `Origin` must be `http://<allowed host>`; otherwise `Sec-Fetch-Site` must be
  `same-origin` or `none` (`Origin: null` also defers to it). Cross-site →
  `403`. Requests with **neither** header are allowed: browsers always send one
  on cross-site writes, so such requests come from non-browser clients (curl,
  scripts) that already run as you and are not a CSRF vector. This is safe
  **only because** the JSON-only rule below still applies to every `/api`
  write and `/setup` still requires its CSRF token.
- **JSON-only API writes** — mutating `/api` requests must send
  `Content-Type: application/json` (else `415`), including body-less ones like
  `POST /api/quiz/end`. Browsers cannot send that cross-site without a CORS
  preflight (never approved), which defeats "simple request" CSRF.
- **`/setup`** — the form carries a random per-process CSRF token (checked in
  constant time; restarting the server invalidates an open form — reload it).
  The path must be absolute (or `~/…`), contain no NUL bytes, not be a
  filesystem root, and not be an existing file; new directories are created
  `0700`. The choice is persisted server-side (`config.json`, `0600`), never
  in a cookie.
- **Server-owned data dir** — no request input selects where data is read or
  written. (The retired `ibai_data_dir` cookie was a hole: cookies are not
  port-isolated, so a page on another localhost port could set it and point
  writes at any existing directory. It never selects the dir now; it is only
  read as a recovery suggestion the user must confirm, and expired on a
  switch or dismiss — ADR 0009 D1.) `POST /api/data-dir` is protected like
  every `/api` write (same-origin + JSON-only is the SPA equivalent of the
  `/setup` CSRF token).
- **Body cap** — request bodies over 1 MiB are refused with `413` (JSON for
  `/api`, plain text for `/setup`) before any parsing. The Host / Origin /
  Content-Type checks run before a body is read at all; a declared
  `Content-Length` over the cap gets `413` + `Connection: close` immediately
  (the upload is not read), and a chunked upload is cut off once it passes
  2 MiB. Server timeouts: request 30s, headers 10s, keep-alive 5s.
- **Headers on every response** — `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` (`same-origin` on the server-rendered pages,
  so the `/setup` form post sends a real `Origin` even in browsers without
  `Sec-Fetch-Site`), `X-Frame-Options: DENY`, COOP/CORP
  `same-origin`, and a CSP: the SPA gets `default-src 'self'` with no inline
  script/style (`frame-ancestors 'none'`); the server-rendered pages get a
  script-free CSP that allows only their inline `<style>`.
