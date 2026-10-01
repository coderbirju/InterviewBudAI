# @ibai/web

Locally-hosted web front-end for InterviewBudAI: problem catalog, notes, analytics, and the Quickfire Quiz Master.

## Overview

This package provides a thin, localhost-only Node server that serves a React SPA and a same-origin JSON API. It does not currently expose `assess`/`plan` (CLI-only since M6), and the Quiz Master engine lives in this package rather than `core`, so the CLI has no quiz — both are tracked parity gaps in `context-files/progress/status.md`.

## React SPA (ADR 0006) — the app

The web UI is a **React + Vite + Tailwind + lucide-react** single-page app, served at the **site root (`/`)** by the existing localhost-only Node server. It was migrated in incremental milestones (M0–M6, see `context-files/decisions/0006-web-react-toolchain.md`); **M6 completed the migration** — the SPA is now the whole UI and the old server-rendered HTML pages were retired.

### Server surface (M6)

The server is intentionally small — three surfaces:

- **`/` (and all other non-API, non-`/setup` GET paths)** — the React SPA bundle + assets. Client-side routing (History API, no routing library) handles `/notes/:id`, `/analytics`, `/interview`, `/data`, and `/settings`; deep links and refreshes fall back to `index.html`. Vite `base` is `/`, so assets are served at `/assets/*` (local, same-origin — no CDN).
- **`/api/*`** — the same-origin, localhost-only JSON API the SPA consumes (`/api/catalog`, `/api/notes/:id` GET+POST, `/api/progress`, `/api/competency`, `/api/guidance`, `/api/config`, `/api/settings` + `/api/settings/test-provider`, `/api/data-dir*`, the CSV import routes `/api/import/csv/preview|commit`, and the Quiz Master routes `/api/quiz/start|new|session|answer` plus session-management `/api/quiz/sessions` GET, `/api/quiz/end` POST, `/api/quiz/resume` POST, `/api/quiz/delete` POST + `DELETE /api/quiz/session/:id`). The server owns the data directory; the browser is UI only (see [The data directory](#first-run-and-the-data-directory)).
- **`/setup`** — the one remaining **server-rendered page**: `GET /setup` shows the create-database form; `POST /setup` creates the data directory, saves the choice to `~/.interviewbudai/config.json` and switches the server to it immediately (for every browser, and after restarts), then links back to the SPA at `/`. It is the **no-JavaScript fallback** for the SPA's [Your data](#your-data-data--adr-0009-d1) page (`/data`), shares its code path (`DataDirControl.choose` in `src/data-dir-control.ts`) and links to it; the SPA itself links to `/data`, not here.

Everything else (home/catalog/notes/analytics/interview HTML, `/coach`, `/coach.json`, `/dashboard`, `/assess`, `/assess.json`, `/plan.json`) was **removed**. Home/notes/analytics/interview now live in the SPA; the assess/plan views (Where You Stand / Next Session) were not ported and are CLI-only for now.

### SPA views

- **Home** (`/`) — global progress banner (`GET /api/progress`) + categorized accordion problem list (`GET /api/catalog`) with an interactive 4-state Status control that optimistically updates and `POST`s to `/api/notes/:id`. No Solution/Video/Code columns (the project ships no answers, charter §6.2). A **search + filter bar** narrows the catalog client-side (no extra API): instant case-insensitive search on title or problem id, plus multi-select **Difficulty** (Easy/Medium/Hard) and **Status** (Not started/Done/To revisit/Didn't understand) chips — OR within a facet, AND across facets. While filtering, matching topics auto-expand, empty topics are hidden, each header shows an "N matches" badge, and the bar shows "N of M problems" with **Clear filters**; zero matches shows a friendly empty state. The filter lives in the URL query (`/?q=sum&difficulty=Easy,Hard&status=to_revisit`, written with `history.replaceState`) so reload, browser Back/Forward and the Notes page's **Back to problems** link all keep it (the URL is the source of truth: clicking the Problems nav link to a bare `/` clears it; facet values parse case-insensitively). Clearing restores whichever topics you had open before filtering, and a topic you collapse while filtering stays collapsed as you type. Changing a row's status under an active filter keeps that row visible until the filter next changes. Pure logic: `web-ui/src/lib/home.ts` (`filterCatalog`, `filterFromSearch`, `searchWithFilter`).

  **Guidance card (w2a).** Between the progress banner and the filter bar, Home shows a collapsible card fed by `GET /api/guidance` (fetched in parallel with the catalog, never blocking it). **Where you stand**: up to 6 topic chips, each leading with `done/total` and an "N need review" marker (to-revisit + didn't-understand), plus the topic's strength band using the exact Analytics colors/labels (`STRENGTH_COLORS` / `STRENGTH_LABELS` in `web-ui/src/lib/competency.ts`; with little quiz data most bands read "Not enough data", so the counts carry the chip), and a **See all in Analytics** link. **Next up**: up to 3 rows — kind icon (revisit / weak topic / continue / start), the problem title as an external link (new tab, `rel="noopener noreferrer"`), difficulty badge, the count-based reason, and an in-app **Notes** link. A quiz nudge links to `/interview` when `quiz.suggested`. `state: "empty"` shows **Start here** with the starter problems; `no_db` renders nothing (the data-folder CTA covers it). Guidance is refetched after each successful status change and when Home remounts on Back from Notes (`popstate`). A guidance fetch error hides only the card. The collapsed state is kept in `localStorage` (`ibai.guidance.collapsed`); the header is a real `<button>` with `aria-expanded`. Component: `web-ui/src/components/GuidanceCard.tsx`.
- **Notes** (`/notes/:id`) — the intuition editor: status control + free-text intuition + time/space complexity, saved via `POST /api/notes/:id`. For a **custom problem** (ADR 0010 D5) the header shows a **Custom** badge, the problem's plain-text **statement** (escaped, line breaks kept), and **Edit** (the same form as Add, `PATCH /api/problems/:id`; clearing the link or statement sends `null`) and **Delete** (a confirm dialog; if the problem has a note the server answers `409 { hasNote }` and a second, explicit confirm — "Delete the problem AND its note (a backup is made first)" — resends with `deleteNote: true`; then Home shows a notice with the backup path).
- **Custom problems on Home** (ADR 0010 D5) — an **Add problem** button above the catalog and a **+** on each topic header (pre-selects that topic) open an accessible modal (`role="dialog"`, focus moves to Title, Tab is trapped, Escape/Cancel close and return focus to the opener): title (≤ 200, one line), link (optional, http(s) ≤ 2048), difficulty, topics (1–3 of the 13, labelled from `/api/catalog`), statement (optional plain text ≤ 2000 — the problem, never an answer). Client checks mirror the server (`web-ui/src/lib/problemForm.ts`); server errors show inline. A duplicate `409` shows "This looks like <problem> — open it instead" (link to its Notes), plus **Add anyway** (`allowSimilarTitle`) for a title-only match. After a create the catalog is refetched, the problem's topics expand, and a notice links to its Notes. Custom rows carry a **Custom** badge; a row without a link shows its title as plain text. Components: `ProblemForm.tsx`, `Modal.tsx`, `CustomBadge.tsx`.
- **Analytics** (`/analytics`, ADR 0012 D3) — "what to focus on", fed by one `GET /api/insights` call. A status **donut** (Done emerald / To revisit amber / Didn't understand red / Not started slate) with the total in the center, a legend with counts and a screen-reader text summary. **Locked** (fewer than 2 quiz sessions with an answer): donut, a "Take a quiz to see your gaps and patterns — X of 2 sessions done" link to `/interview`, and the topic tiles — nothing else. **Unlocked**: donut, **Focus next** (≤ 3 topics: label, band chip with the shared `STRENGTH_COLORS`/`STRENGTH_LABELS`, count-based reason), **Where you keep slipping** (≤ 3 miss codes: label, ×count, up to 3 topic chips with counts), **Strengths** (≤ 5 chips with correct/incorrect; a Focus topic is never listed), then the tiles. An empty unlocked section says "Not enough quiz data yet in this section." **Topic tiles**: the 13 topics in API order (`TOPIC_ORDER`), each a mini SVG progress ring + label + `done/total`, 2–4 columns. Miss labels come from the API; `lib/analytics.ts` keeps a fallback map (unknown codes read "Other slip") and the pure donut/ring geometry. Labels fall back to the topic id. `no_db` shows the create-your-database link; loading and API-error states as elsewhere. Hand-built SVG, no chart library.
- **Interview** (`/interview`) — the **Quickfire Quiz Master** (ADR 0007 Q3, amended by quiz-fix-a), replacing the old generic interview chat. On load it resumes the single active session via `GET /api/quiz/session` (current question + prior transcript + progress); with none it offers a **Start quiz** entry (`POST /api/quiz/start`). Each question shows a real problem you marked **Done** **directly** from the catalog — its title, a difficulty badge, and an **Open problem** link (new tab, `rel="noopener noreferrer"`); no invented story, no hints, no model call — type your approach and `POST /api/quiz/answer` returns a **verdict**: `correct` (emerald "Correct ✓" + optional optimal nudge) → advance; `incorrect` (amber "Marked for revisit" + feedback) → advance; `on_track` → the same question (title stays visible) with **one** probe shown in its own card, also re-shown after a reload (at most one nudge per question; a second `on_track` is coerced to `incorrect`). The Quiz Master **never reveals the answer**. The prior verdict card is cleared when the next question renders. A progress bar tracks `answered / deckSize`; when the deck is exhausted a **Session complete** summary (correct / to-revisit tallies) offers **New session** (`POST /api/quiz/new`, reshuffle from the current done-set). Empty done-set → a friendly "mark problems as Done first" state linking Home; provider **required** → the "Configure a model" state; provider/verdict failures → a friendly inline banner that never loses the session; model starting / unreachable (`503 model unavailable`) → a **"The model isn't ready yet"** state with the server's hint and a **Retry** button that re-sends the same answer (question and typed answer are kept).

  **Session management (quiz-fix-b).** An **End session** control is shown during an active quiz — `POST /api/quiz/end` persists the session `complete` and clears the active pointer, so it stops being resumable-active but **remains listed** (ending never deletes). The idle and complete views show a **Your sessions** list (`GET /api/quiz/sessions`, empty-safe): one card per past + active session (created time, `answered / deckSize`, correct tally, status/Active badge) with a **Resume** button (`POST /api/quiz/resume { sessionId }` — re-activates it as the resumable session and continues from its position; a session whose deck is exhausted is shown as complete and is not re-activated) and a **Delete** button (`POST /api/quiz/delete { sessionId }` after a small confirm; a REST-form `DELETE /api/quiz/session/:id` is also accepted). Delete is idempotent (missing → `ok:true`); deleting the active session also clears the pointer. Loading/empty/error states are handled and the page never crashes with no DB / no sessions.

- **Your data** (`/data`, nav link **Data**) — see [below](#your-data-data--adr-0009-d1).
- **Settings** (`/settings`, nav link **Settings**, ADR 0008 Wave 2c-lite) — read-only model status. **Model** card: provider (Anthropic / OpenAI-compatible — shown as "Docker Model Runner (local)" for a DMR host / Ollama / none), model, Ollama or OpenAI-compatible endpoint (origin only), "Anthropic API key" (or, for OpenAI-compatible, "API key (optional)"): Configured ✓ / Not configured ✗, and a **Test connection** button (explicit click only; Anthropic shows a note that it makes one tiny billable 1-token call) with the result + latency. **How to configure**: the env vars the server reads with set ✓/✗, a copyable `.env` snippet with placeholders only, and a note that changes need a server restart. **Data** card (folder + source, links to `/data`) and **App** card (version, Node). **Keys stay env-only**: the page has no input, never receives, stores or shows a key. The Interview page's "Configure a model" state links here. Component: `web-ui/src/components/SettingsPage.tsx`.

All no-DB states link to `/data`. All values render via JSX (auto-escaped); no `dangerouslySetInnerHTML`. The only outbound calls are the user-configured LLM provider, made **server-side** inside the `POST /api/quiz/*` routes and `POST /api/settings/test-provider`.

### Where the UI lives

```
packages/web/
  src/          existing Node server (tsc build → dist/)  ← unchanged pipeline
  web-ui/       React SPA source (Vite build → dist-ui/)  ← separate pipeline
    index.html
    src/main.tsx, src/App.tsx, src/index.css
    src/components/  ProgressBanner, CatalogFilterBar, CategoryAccordion,
                     ProblemRow, StatusControl, DifficultyBadge, Home, Notes,
                     Analytics, Interview
    src/lib/         api.ts (typed M1 client), home.ts (pure helpers),
                     analytics.ts (donut/ring geometry, miss labels),
                     competency.ts (strength band colors/labels),
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
| `GET /api/competency` | Quiz-derived competency signals for Analytics (ADR 0007 Q4): `{ topics: [{ topicId, label, correct, incorrect, strength, lastSeen }], patterns: [{ id, description, topics, topicLabels, occurrences, lastObserved }] }`. `label` / `topicLabels` (index-aligned with `topics`) are the curriculum display labels (raw id when unknown). Retired topic ids fold via `TOPIC_ALIASES` at read time; a merged topic with no string `lastSeen` is dropped, and a pattern whose topics were ALL dropped (e.g. only `miscellaneous`) is dropped (a pattern that never listed topics is kept). `topics` are sorted weak→strong then by most misses; `patterns` by most occurrences. Read-only — reads via `readCompetencySignals`, the user's OWN outcomes/patterns only (no shipped answers, §6.2). | `200` | Safe empty `{ topics: [], patterns: [] }`. |
| `GET /api/guidance` | "Where you stand / Next up" (ADR 0007 amendment w2a), derived at read time by core `deriveGuidance` — nothing is written, no model call: `{ state: 'no_db'\|'empty'\|'ready', generatedAt, standing: [{ topicId, label, notes: { done, toRevisit, didNotUnderstand, total }, quiz: { correct, incorrect }, lastActivity, band, needsReview }], nextUp: [{ kind: 'revisit'\|'weak_topic'\|'continue'\|'start', problemId, title, url, difficulty, topicId, label, reason }], quiz: { doneCount, lastQuizAt, suggested } }`. `nextUp[].topicId` (and `label`) is `null` only for a revisit whose problem lists no topics. `label` is the curriculum display label (raw id when unknown); reasons use it too (e.g. `Dynamic Programming: 1/5 correct in quiz`). `standing` lists topics with activity, weak→improving→unknown→strong (`band` = the same `deriveTopicStrength` label Analytics shows). `nextUp` = 3 problems, no repeats, distinct topics preferred: up to 2 oldest to-revisit / didn't-understand notes, then an unattempted problem (easy→medium→hard; hard only after 2 done in the topic) from a weak/improving topic, then the least-complete in-progress topic, then an unstarted one. Revisits claim their slots before any other kind, and the list is always ordered revisit → weak_topic → continue → start. `reason` is built from counts only (never a hint). `quiz.suggested` when ≥1 done and no quiz in the last 7 days (`lastQuizAt` = latest topic `lastSeen` in the signals). Malformed signals degrade to notes-only. | `200` (`405` non-GET) | `200 { state: 'no_db', standing: [], nextUp: [] }`. With a folder but no activity: `state: 'empty'`, `nextUp` = 3 easiest problems from 3 topics. |
| `POST /api/problems` | Add a custom problem (ADR 0010). Body `{ title, url?, statement?, difficulty, topics, allowSimilarTitle? }`; unknown fields ⇒ 400. Limits: title 1–200 (one line), `url` http(s) ≤ 2048, `statement` plain text ≤ 2000, 1–3 of the 13 topics (retired ids canonicalised), ≤ 1,000 per data folder. The id is server-generated (`u-…`). Duplicates via the CSV matcher over catalog + custom: LeetCode url / `NNN.` number ⇒ `409 { duplicate: { problemId, title, custom } }`; title-only ⇒ the same 409 with `overridable: true` (resend with `allowSimilarTitle: true`). | `201 { problem }` | `400 { error: 'no database configured' }`. |
| `PATCH /api/problems/:id` | Edit any of `title, url, statement` (`null` clears), `difficulty, topics` (+ `allowSimilarTitle`); same rules; the id never changes; `updatedAt` bumped. Catalog id ⇒ `403`; unknown id ⇒ `404`. | `200 { problem }` | `400`. |
| `DELETE /api/problems/:id` | Body `{ deleteNote? }` (optional). A problem with a note ⇒ `409 { hasNote: true }` unless `deleteNote: true`, which first takes a `.backups/` snapshot (failure ⇒ `500`, nothing deleted), then deletes the note and the problem. Quiz history is kept. Catalog id ⇒ `403`; unknown ⇒ `404`. | `200 { deleted, noteDeleted, backup? }` | `400`. |
| `GET /api/config` | `{ dbConfigured, dataDir?, provider }` so the SPA can choose create-db vs show-catalog and show the provider banner. `dataDir` is display-only and omitted when no DB. | `200` | `{ dbConfigured: false, provider }`. |

**Custom problems are merged in everywhere** (ADR 0010 D4): every
problem-aware route (catalog, progress, notes, guidance, quiz, CSV import,
note counting on `/data`) resolves ids through a per-request merged source —
the catalog plus the active folder's `problems/`. In `/api/catalog` a topic
lists catalog problems first, then custom ones by `createdAt`; custom entries
carry `custom: true` and may have a `statement` and no `url` (quiz questions
too). Render the title without a link when `url` is absent.

Response shapes are exported as types from `@ibai/web` (`ApiCatalogResponse`,
`ApiNoteResponse`, `ApiProgressResponse`, `ApiCompetencyResponse`,
`ApiGuidanceResponse`, `ApiConfigResponse`, `ApiDataDirResponse`, `ApiDataDirInspection`). The old
generic interview chat (`POST /api/chat`) was removed (ADR 0008 D4) — it now
404s like any unknown `/api` path.

### Settings API (ADR 0008 Wave 2c-lite)

| Route | Response |
|---|---|
| `GET /api/settings` | `{ provider: { kind: 'anthropic'\|'openai'\|'ollama'\|'none', model, endpoint, keyConfigured, label?, hint? }, dataDir: { path, source, pinned }, app: { version, node }, envHelp: [{ var, purpose, set }] }`. `endpoint` is the Ollama / OpenAI-compatible origin (`scheme://host:port`; userinfo, path and query stripped), `null` otherwise. `label` (`openai` only) is `"Docker Model Runner (local)"` when the normalized base URL host is `model-runner.docker.internal`, or loopback / `172.17.0.1` on port `12434` under `/engines/`; else `"OpenAI-compatible"`. `keyConfigured` is the active provider's key (OpenAI-compatible: the key that would be sent — `IBAI_OPENAI_API_KEY`, or `OPENAI_API_KEY` only for `https://api.openai.com`; otherwise Anthropic). `hint` explains a half-set/rejected config, or an OpenAI-compatible config ignored next to an active Anthropic/Ollama provider. Secrets are checked for presence only; `envHelp` covers `ANTHROPIC_API_KEY`, `IBAI_ANTHROPIC_API_KEY`, `IBAI_ANTHROPIC_MODEL`, `IBAI_OPENAI_BASE_URL`, `IBAI_OPENAI_MODEL`, `IBAI_OPENAI_API_KEY`, `OPENAI_API_KEY`, `IBAI_OPENAI_TIMEOUT_MS`, `IBAI_OLLAMA_MODEL`, `IBAI_OLLAMA_URL`, `IBAI_DATA_DIR`, `IBAI_WEB_PORT`, `IBAI_HOST_DATA_DIR` with `set` booleans — never values. `405` non-GET. |
| `POST /api/settings/test-provider` | Same prechecks as every mutating `/api` route (Host 421, cross-site 403, non-JSON 415). Rate limited in-process: one test per 5 s (and one at a time) → else `429 { error }`. No provider → `400 { error: 'no model configured' }`. Ollama: `GET <IBAI_OLLAMA_URL>/api/tags` (5 s timeout), `ok` only if the configured model is pulled (`llama3` ≡ `llama3:latest`). OpenAI-compatible: `GET <base URL>/models` (Bearer only when a key is set; 5 s timeout), `ok` only if `data[].id` lists the configured model (`m` ≡ `m:latest`); "not listed" gets its own detail (DMR: a `docker model pull` hint). Anthropic: one `max_tokens: 1` messages call through `AnthropicProvider` (billable, 5 s timeout). `200 { ok, latencyMs, detail }`; `detail` is fixed, sanitized text (HTTP status class + a plain `error.type` identifier at most) — provider bodies, headers, keys and URL userinfo are never echoed. |

### Your data (`/data` — ADR 0009 D1)

The SPA's data-setup page (nav link **Data**; `/setup` is the no-JS
fallback). Sections: **Active folder** (path, source, note count; read-only
with "restart without `--data-dir` / unset `IBAI_DATA_DIR`" when pinned),
**Found previous data** (legacy-recovery cards, below), **Use an existing
notes folder** (path field → **Check** = dry run, **Use this folder** =
switch; server validation errors inline, success toast + refreshed counts),
and **Import notes from CSV** ([below](#csv-import-adr-0009-d2d3)).

A **banner** on Home and Analytics links here: "Don't see your solved
problems? …" whenever the active folder has **0 notes** (not dismissible), or
"A folder with InterviewBudAI notes was found — review it" when a candidate exists
(dismissible for the tab via `sessionStorage` once the folder has notes).

| Method & path | Body | Result |
|---|---|---|
| `GET /api/data-dir` | — | `{ dataDir, source: 'flag'\|'env'\|'config'\|'default', pinned, exists, noteCount, formatVersion, legacyCandidates: [{ path, noteCount, origin: 'cookie'\|'legacy-default' }], docker? }`. `docker` only inside the Docker image: `{ hostDataDir, writable, writableHelp?, hostConfigDataDir? }` (display-only host folder, boot writability check, and the folder from the host's read-only `/host-config/config.json` when it differs). |
| `POST /api/data-dir` | `{ path, dryRun?: boolean }` | **Dry run:** `{ dryRun: true, path, exists, noteCount, quizSessionCount, hint? }` — no writes; `hint` is `{ kind: 'use-parent', path }` for a `…/notes` folder whose parent holds notes, or `{ kind: 'not-ibai-format' }` for Markdown that is not `notes/<id>.md`. **Otherwise:** validated exactly like `POST /setup` (absolute or `~/`, normalized, no NUL, not a root, not a file), created `0700` if missing, `config.json` written atomically (`0600`), the running server switched; returns the `GET` shape. Invalid path / pinned dir → `400 { error }` (the pinned message names the flag/env). |
| `POST /api/data-dir/legacy/dismiss` | `{}` | Stops offering the current candidates (this server process); returns the `GET` shape. |

All three sit behind the same checks as every `/api` write (Host allowlist,
same-origin `Origin`/`Sec-Fetch-Site` → `403`, `Content-Type:
application/json` → else `415`, 1 MiB cap → `413`). `noteCount` counts
recognised notes, matching how storage reads them (by filename id): regular
files `notes/<id>.md` whose id is in the catalog, that open with frontmatter,
and whose `id:` is absent or equal to `<id>` (only a conflicting `id:` is
rejected; an Obsidian/Jekyll `notes/recipe.md` does not count). The same rule decides candidate
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

### CSV import (ADR 0009 D2/D3)

The **Import notes from CSV** section of `/data` imports a Notion export:
pick the `.csv` files (read in the browser; sizes shown; > 64 files or > 1 MiB
total is refused up front) → **Preview** (the server parses and matches, **no
writes**) → review a table of rows (matched problem + how, or *Unmatched*;
*New* vs *Conflict*; per-problem action and status; "apply to all
conflicts"; a default status, `Done` by default) → **Import** → summary
(created / overwritten / merged / skipped / unmatched, the backup path, a link
to Home). Unmatched rows can be copied or downloaded as a text list, and each
can be ticked **Add as custom problem** (ADR 0010 D4) with a difficulty
(default Medium) and a **required** topic chosen in the row — Import stays
disabled until every ticked row has a topic. The summary adds a *Custom
problems added* count and lists per-row failures by file and line.

| Method & path | Body | Result |
|---|---|---|
| `POST /api/import/csv/preview` | `{ files: [{ name, text }], defaultStatus? }` | `{ previewHash, defaultStatus, rows: [{ key, file, line, title, match: { problemId, title, by: 'url'\|'number'\|'title' } \| null, existing: 'none'\|'note', chosen, fields: { status, lastUpdated, timeComplexity?, spaceComplexity?, bodyPreview }, warnings }], unmatched, duplicatesCollapsed, blankRows, errors }` — no writes. |
| `POST /api/import/csv/commit` | `{ files, previewHash, defaultStatus, decisions: { [problemId]: { action: 'create'\|'skip'\|'overwrite'\|'merge', status?, rowKey? }, [unmatchedRowKey]: { action: 'add-custom', difficulty, topics, status? } } }` | Re-parses and re-matches the same files (stateless); a different hash (files, default status, data folder, a note that appeared/disappeared, or any change to an unmatched row — incl. one that now matches a problem) → `409` "re-run preview", nothing written. Bad decisions (unknown id/row key, missing difficulty, not 1–3 of the 13 topics) → `400` before any write. Then backs up the data folder once and writes via the storage adapter. An `add-custom` row creates a custom problem (title from the row, its `URL` cell if http(s) — anything else is dropped; the `POST /api/problems` cap and duplicate rules, under the same write lock), then writes the row's note to it as for a matched `create`; a failure (duplicate — even of another row in the same commit —, over-long title, the 1,000 cap) affects only that row → `failed[]` with `rowKey` (`problemId` = the created id, or `''`). → `{ created, overwritten, merged, skipped, unmatched, customCreated: [{ rowKey, problemId, title }], failed, backup }` (`unmatched` = rows left unimported). |

- **Parsing** (`src/import/csv.ts`): in-repo RFC 4180 subset — comma, `"`
  quoting, `""` escapes, quoted multiline cells, CRLF/LF, optional BOM; C0
  controls except tab/newline stripped. An unterminated quote or a row wider
  than the header rejects that file only (listed in `errors`).
- **Mapping** (`src/import/notion.ts`): headers/cells trimmed of Unicode
  whitespace (incl. NBSP), case-insensitive. Title = `Problem`, else the first
  column; body = `Intuition`, else `Property`; `Notes` → `## Notes`; other
  non-empty text columns → `## <Header>`; `Last Visited on` / `Last Visited` →
  `lastUpdated` (ISO, `Month D, YYYY [h:mm AM/PM]`, `YYYY-MM-DD`,
  `YYYY/MM/DD`; `NN/NN/YYYY` is not guessed → import time + warning).
  Complexities: `(TC|Time|SC|Space)[:=-]? O(…)` with balanced parentheses on one
  line (`"` → `'`, `\` dropped so they round-trip through the frontmatter).
- **Matching** (`src/import/match.ts`, server-side only): LeetCode slug from
  `URL` (or a URL in the title; `/description/`, `/editorial/`, … ignored) →
  leading `NNN.` → `lc-NNN` → normalized title. Rows are de-duplicated by
  mapped fields (so `X.csv` + `X_all.csv` collapse); blank rows are skipped
  and counted; several distinct rows for one problem → the most recent
  `Last Visited` is used unless you pick another row.
- **Conflicts:** `skip` (default), `overwrite` (body, complexities, status,
  date), `merge` (append under `## Imported <YYYY-MM-DD>`, keep the existing
  status unless you pick one, fill empty complexities, later date; re-merging
  the same row does not append it again).
- **Backups** (`src/import/backup.ts`): before every commit the data folder is
  copied to `<dataDir>/.backups/<YYYYMMDDTHHMMSSZ>/` (everything except
  `.backups/`; symlinks skipped; dirs `0700`; `.backups/.gitignore` = `*`),
  keeping the last 5. If the backup fails — or `.backups` (or its
  `.gitignore`) is a symlink or the wrong type — nothing is imported. Restore is
  manual: copy the snapshot back.
- **Limits:** ≤ 64 files, ≤ 5,000 rows, ≤ 64 columns, ≤ 64 KiB per cell, all
  within the 1 MiB request cap → `413` with a message, no partial import.
  Same `/api` checks as every write (Host, same-origin, JSON-only). CSV text
  is stored as Markdown source and only ever rendered as escaped text.

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
| `GET /api/quiz/session` | **Resume**: the active session (re-presents the current question from the catalog, plus any pending `probe`, full transcript + progress). A current card whose problem no longer resolves (a deleted custom problem) is skipped forward to the next resolvable one; a session with nothing left to present is reported as `{ active:false }`. | `200 { active:true, session, question, transcript }`; `200 { active:false }` when none. | `405` wrong method. |
| `POST /api/quiz/answer` | The core turn. Body `{ answer: string, problemId?: string }` (untrusted → validated; `problemId` names the card the client showed). If the stored current card no longer resolves (a deleted custom problem, ADR 0010 D4) and the client did not name the skipped-to card, or the client names a card that is not current, the answer is **not graded**: no model call, no verdict, no note/competency writes; any skip is persisted with the next card's presentation turn and the route answers `409 { error: "question changed", skipped, complete, session, question }` (`question: null`, `complete: true` when nothing remains). Builds an evaluation prompt (persona + the problem + the user's OWN intuition note as personalization; a custom problem's statement goes in its own `"""` block marked as untrusted context, and `"""` inside the note, answer or statement is neutralised), calls the provider, parses a strict JSON verdict **fail-closed**. Small-model robustness (ADR 0011 D4): the prompt is compact and capped so the worst case stays under ~3000 estimated tokens (`estimatePromptTokens`, chars/4) — note ≤ 4000 chars (start kept), statement ≤ 2000, answer ≤ 2000 (start and end kept), title ≤ 200, ≤ 5 topics, each cut with a visible marker; the call asks for JSON mode (`responseFormat: 'json'`) and at most 512 reply tokens; a **malformed** verdict is re-asked **once** with a terse "reply with ONLY the JSON object" reminder (never more than 2 model calls; transport errors are not retried). **`correct`** (terminal, semi-optimal-or-better accepted) → record correct, bump competency signals, advance (no repeat; ids that no longer resolve are skipped, completing only when none remains), return next question. **`incorrect`** (terminal) → flip the note to `to_revisit`, record a miss `PatternSignal`, bump signals, advance. **`on_track`** → one non-terminal probe on the same question — **at most one nudge per question**: a second `on_track` from the model is **coerced by the engine to a terminal `incorrect`** (→ `to_revisit` + advance). Persists after every turn (resumable). | `200 { verdict, feedback, optimalNudge?, terminal, complete?, session, question }`. | `400` bad body / no provider; `404` no active session; `409` the shown card changed (not graded, see left); `503 { error: "model unavailable", code: "model_unavailable", detail, hint }` when the model is starting or unreachable (connection refused / unknown host, timeout, HTTP 503, or a 5xx saying it is loading; `hint` adds the first-run download + "enable Docker Model Runner" tip when the provider is Docker Model Runner) — **no writes**; `502` provider auth / unusable response / **malformed verdict after the one retry** (fail-closed: **no writes**, no fabricated verdict); `405` wrong method. |
| `POST /api/quiz/new` | Discard the active session and start a fresh shuffled deck from the **current** done-set (same shape as `start`). | `200` (same as `start`). | same as `start`. |

The verdict JSON the model must emit is
`{ "verdict": "correct"|"incorrect"|"on_track", "feedback": string, "optimalNudge"?: string }`
as a bare JSON object with no code fence, so it also works in JSON mode (a
fenced ```json block is still accepted; parsed fail-closed, mirroring `core`'s
`coach()`). An empty completion counts as malformed and gets the same one
retry. On a malformed/absent verdict after that retry the turn returns `502`
and performs **no storage writes** — never a fabricated verdict. `optimalNudge` nudges the user
toward a more optimal approach **without revealing it** (§6.2). Competency
signals are updated via `readCompetencySignals`/`writeCompetencySignals`; the
`to_revisit` flip is written via `writeIntuitionNote`, preserving other note
fields. The pure engine pieces (prompt building, verdict parsing, seedable
shuffle, session advance/no-repeat, competency-signal derivation) live in
`quiz.ts` and are unit-tested independently of the HTTP layer.

The quiz routes never crash on a provider failure: **connection** errors
(model starting or unreachable) map to `503 model_unavailable` with a hint,
and **auth** errors map to `502` with a clear message. The only outbound
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

### Option 2: OpenAI-compatible server (e.g. Docker Model Runner)

Any server that speaks the OpenAI Chat Completions API: Docker Model Runner,
llama.cpp, vLLM, LM Studio, Ollama's `/v1`, or a hosted OpenAI-style API.

```bash
# Docker Model Runner on the host (enable host-side TCP support; Linux: port 12434)
export IBAI_OPENAI_BASE_URL=http://localhost:12434/engines/v1
export IBAI_OPENAI_MODEL=<model-id>        # as the server names it, e.g. an ai/... tag
export IBAI_OPENAI_API_KEY=...             # optional; OPENAI_API_KEY only for https://api.openai.com
export IBAI_OPENAI_TIMEOUT_MS=120000       # optional (clamped 5000–600000)
```

The base URL is the one ending in `/v1`: trailing slashes are dropped, a bare
origin gets `/v1` appended, `/engines` or `/engines/<engine>` gets `/v1`, a
bare Docker Model Runner host (`model-runner.docker.internal`, or loopback /
`172.17.0.1` on `:12434`) becomes `…/engines/v1`, a pasted
`…/chat/completions` or `…/models` is trimmed, and any other path is kept
(never a double `/v1`). A key is sent as `Authorization: Bearer …` only when
set, and only over `https` or loopback `http` (else the provider is skipped
with a Settings hint). `OPENAI_API_KEY` is used only when the base URL is
`https://api.openai.com`; for any other server set `IBAI_OPENAI_API_KEY`. A
base URL with a username/password is rejected (provider `none`, Settings
hint). When an OpenAI-compatible config is set but Anthropic wins, or it is
rejected and Ollama is used, Settings and the startup banner show a hint. The key never
appears in logs, errors or `/api/settings`.

**Precedence** (first match wins; `resolveProviderStatus` / `selectProvider`):
Anthropic (key + model) → OpenAI-compatible (base URL + model) → Ollama
(model) → none.

### Option 3: Ollama (Local)

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
| Bind host | — | `IBAI_BIND_HOST` | `127.0.0.1` (`::1` allowed; `0.0.0.0` only with `IBAI_CONTAINER=1`, else the server refuses to start). The image sets both; never set them outside Docker — the app would listen on all interfaces with no authentication (only a warning) |
| Public port (Docker) | — | `IBAI_PUBLIC_PORT` | the listen port |
| Ollama URL | — | `IBAI_OLLAMA_URL` | `http://127.0.0.1:11434` |
| Ollama Model | — | `IBAI_OLLAMA_MODEL` | *(required for Ollama)* |
| Anthropic API Key | — | `IBAI_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY` | *(required for Anthropic)* |
| Anthropic Model | — | `IBAI_ANTHROPIC_MODEL` | *(required for Anthropic)* |

Precedence: CLI flag > environment variable (shell > `.env`) > default (for the data directory: > `config.json` > default). The host is `127.0.0.1` unless `IBAI_BIND_HOST` says otherwise; `0.0.0.0` is accepted only with `IBAI_CONTAINER=1`, which only the Docker image should set (ADR 0011 D2), where Compose publishes the port on `127.0.0.1` only. With `IBAI_PUBLIC_PORT` ≠ listen port, `Host` on the listen port is accepted for non-mutating requests only (the HEALTHCHECK) and `Origin` only on the public port.

## Privacy & Security

- **Localhost-only** — Server binds to 127.0.0.1 (`0.0.0.0` only inside the Docker image, published on 127.0.0.1 only)
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
