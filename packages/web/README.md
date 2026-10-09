# @ibai/web

Locally-hosted web front-end for InterviewBudAI: problem catalog, notes, analytics, and the Quickfire Quiz Master.

## Overview

This package provides a thin, localhost-only Node server that serves a React SPA and a same-origin JSON API. It does not currently expose `assess`/`plan` (CLI-only since M6), and the Quiz Master engine lives in this package rather than `core`, so the CLI has no quiz — both are tracked parity gaps in `context-files/progress/status.md`.

## React SPA (ADR 0006) — the app

The web UI is a **React + Vite + Tailwind + lucide-react** single-page app, served at the **site root (`/`)** by the existing localhost-only Node server. It was migrated in incremental milestones (M0–M6, see `context-files/decisions/0006-web-react-toolchain.md`); **M6 completed the migration** — the SPA is now the whole UI and the old server-rendered HTML pages were retired.

### Server surface (M6)

The server is intentionally small — three surfaces:

- **`/` (and all other non-API, non-`/setup` GET paths)** — the React SPA bundle + assets. Client-side routing (History API, no routing library) handles `/notes/:id`, `/analytics`, `/interview`, `/data`, and `/settings`; deep links and refreshes fall back to `index.html`. Vite `base` is `/`, so assets are served at `/assets/*` (local, same-origin — no CDN).
- **`/api/*`** — the same-origin, localhost-only JSON API the SPA consumes (`/api/catalog`, `/api/notes/:id` GET+POST, `/api/progress`, `/api/competency`, `/api/guidance`, `/api/insights`, `/api/config`, `/api/settings` + `/api/settings/test-provider`, `/api/data-dir*`, the CSV import routes `/api/import/csv/preview|commit`, and the Quiz Master routes `/api/quiz/start|new|session|answer` plus session-management `/api/quiz/sessions` GET, `/api/quiz/end` POST, `/api/quiz/resume` POST, `/api/quiz/delete` POST + `DELETE /api/quiz/session/:id`). The server owns the data directory; the browser is UI only (see [The data directory](#first-run-and-the-data-directory)).
- **`/setup`** — the one remaining **server-rendered page**: `GET /setup` shows the create-database form; `POST /setup` creates the data directory, saves the choice to `~/.interviewbudai/config.json` and switches the server to it immediately (for every browser, and after restarts), then links back to the SPA at `/`. It is the **no-JavaScript fallback** for the SPA's [Your data](#your-data-data--adr-0009-d1) page (`/data`), shares its code path (`DataDirControl.choose` in `src/data-dir-control.ts`) and links to it; the SPA itself links to `/data`, not here.

Everything else (home/catalog/notes/analytics/interview HTML, `/coach`, `/coach.json`, `/dashboard`, `/assess`, `/assess.json`, `/plan.json`) was **removed**. Home/notes/analytics/interview now live in the SPA; the assess/plan views (Where You Stand / Next Session) were not ported and are CLI-only for now.

### SPA views

- **Home** (`/`) — global progress banner (`GET /api/progress`) + categorized accordion problem list (`GET /api/catalog`) with an interactive 4-state Status control that optimistically updates and `POST`s to `/api/notes/:id`. No Solution/Video/Code columns (the project ships no answers, charter §6.2). Each row has three columns — **Status**, **Problem**, **Difficulty**. The problem **title opens that problem's Notes page** (`/notes/<id>`): a plain click navigates in-app (History API, no reload), while Ctrl/Cmd/Shift/middle clicks keep the browser default (e.g. open in a new tab). A small **external-link icon** next to the title is its own link that opens the problem on LeetCode in a new tab (`target="_blank"`, `rel="noopener noreferrer"`, labelled "Open <title> on LeetCode"; a custom problem's non-LeetCode link is labelled "Open the link for <title> in a new tab"); a custom problem without a link has no icon. There is no separate Notes column. Component: `web-ui/src/components/ProblemTitleLink.tsx` (shared by `ProblemRow` and the guidance card's Next up rows). A **search + filter bar** narrows the catalog client-side (no extra API): instant case-insensitive search on title or problem id, plus multi-select **Difficulty** (Easy/Medium/Hard) and **Status** (Not started/Done/To revisit/Didn't understand) chips — OR within a facet, AND across facets. While filtering, matching topics auto-expand, empty topics are hidden, each header shows an "N matches" badge, and the bar shows "N of M problems" with **Clear filters**; zero matches shows a friendly empty state. The filter lives in the URL query (`/?q=sum&difficulty=Easy,Hard&status=to_revisit`, written with `history.replaceState`) so reload, browser Back/Forward and the Notes page's **Back to problems** link all keep it (the URL is the source of truth: clicking the Problems nav link to a bare `/` clears it; facet values parse case-insensitively). Clearing restores whichever topics you had open before filtering, and a topic you collapse while filtering stays collapsed as you type. Changing a row's status under an active filter keeps that row visible until the filter next changes. Pure logic: `web-ui/src/lib/home.ts` (`filterCatalog`, `filterFromSearch`, `searchWithFilter`).

  **Guidance card (w2a).** Between the progress banner and the filter bar, Home shows a collapsible card fed by `GET /api/guidance` (fetched in parallel with the catalog, never blocking it). **Where you stand**: up to 6 topic chips, each leading with `done/total` and an "N need review" marker (to-revisit + didn't-understand), plus the topic's strength band using the exact Analytics colors/labels (`STRENGTH_COLORS` / `STRENGTH_LABELS` in `web-ui/src/lib/competency.ts`; with little quiz data most bands read "Not enough data", so the counts carry the chip), and a **See all in Analytics** link. **Next up**: up to 3 rows — kind icon (revisit / weak topic / continue / start), the problem title (opens its Notes page in-app, like a Home row) with the small LeetCode icon link when it has a url, difficulty badge, and the count-based reason. A quiz nudge links to `/interview` when `quiz.suggested`. `state: "empty"` shows **Start here** with the starter problems; `no_db` renders nothing (the data-folder CTA covers it). Guidance is refetched after each successful status change and when Home remounts on Back from Notes (`popstate`). A guidance fetch error hides only the card. The collapsed state is kept in `localStorage` (`ibai.guidance.collapsed`); the header is a real `<button>` with `aria-expanded`. Component: `web-ui/src/components/GuidanceCard.tsx`.
- **Notes** (`/notes/:id`) — the intuition editor: status control + free-text intuition + time/space complexity, saved via `POST /api/notes/:id`. There is one text box for the whole note (the separate Reference approach field was removed by ADR 0014 D1; an older note's Reference text now shows at the end of the note under its `## Reference approach` heading). For a **custom problem** (ADR 0010 D5) the header shows a **Custom** badge, the problem's plain-text **statement** (escaped, line breaks kept), and **Edit** (the same form as Add, `PATCH /api/problems/:id`; clearing the link or statement sends `null`) and **Delete** (a confirm dialog; if the problem has a note the server answers `409 { hasNote }` and a second, explicit confirm — "Delete the problem AND its note (a backup is made first)" — resends with `deleteNote: true`; then Home shows a notice with the backup path).
  **Code editor** (ADR 0014 D2). The note box is a CodeMirror 6 Markdown editor (`web-ui/src/components/NoteEditor.tsx`, a lazy chunk loaded only here; Markdown wrapper in `web-ui/src/lib/noteEditor/markdown.ts`). Fenced `python`/`py`/`python3` and `go`/`golang` blocks are highlighted and auto-indent (4 spaces); other fences are plain. Tab/Shift-Tab indent; **Esc then Tab** leaves the editor (Ctrl-M, or Shift-Alt-M on macOS, toggles tab-focus mode), announced through the help text under the editor. Lines wrap; undo/redo; no autocomplete or search panel. The toolbar holds only the **Python | Go** picker and **Copy code** (below; `navigator.clipboard`, "Code copied" via `aria-live` for 2 s, or "Copy failed — select all and copy."), in the editor and the textarea fallback alike (the Python block / Go block / Copy note buttons were removed, ADR 0014 D2 amendment 2026-10-05). Clicking the label focuses the editor. **CSP:** the server gives every `index.html` response a fresh 16-byte style nonce (meta `ibai-style-nonce` + `style-src 'nonce-…'`, `Cache-Control: no-store`); the client accepts only `^[A-Za-z0-9+/]{22}==$` and passes it to `EditorView.cspNonce`. With no valid nonce (e.g. the Vite dev server), a failed chunk load or a constructor error, the page keeps the plain `<textarea id="note-content">` (same value, toolbar and save; a `console.warn`, no banner). When the editor replaces the textarea it keeps the value and, if focused, the focus and selection. Notes stay plain Markdown on disk.
  **Problem view and code-first notes** (ADR 0015 D3–D5). The page is a **split view**: on wide screens (`lg`) the statement is on the left and the editor on the right, each scrolling on its own; on narrow screens the statement comes first in an open `<details>`. The statement pane (a region labelled by the title) shows the title, a difficulty badge, **Open on LeetCode** (new tab, `rel="noopener noreferrer"`), the statement rendered from the server's sanitized node tree with React elements (`StatementView.tsx`; no HTML string, no `dangerouslySetInnerHTML`; the tree is re-checked with the shared `isStatementTree()` from `packages/web/src/statement-tree.ts` and a bad tree shows the fallback), a collapsed **Example test cases** block, and the fetched date with **Refresh**. It reads `GET /api/problems/:id/statement` (cache only); only when that says `not-cached` and fetching is on does it send **one** `POST …/statement/fetch` (a `429` is retried once after `retryAfterMs`, capped at 2 s, for React StrictMode; a second `429` shows the fallback). The **fallback** (premium, unknown problem, fetching off, LeetCode unreachable, rate limited, or the local GET failing) shows a short reason, **Open on LeetCode** and a **Paste the problem** box (`PUT …/statement`, shown as plain text; **Remove pasted text** clears it). Pasted text wins over a fetched statement. A custom problem shows its own statement and is never fetched. **Template:** once the final statement state is known (after the GET, or after the fetch settles), an **empty** note is filled with the starter code for your language (LeetCode's `python3` / `golang` snippet, or a generic `solve` template for custom and unfetched problems) with `# Intuition:` / `# Approach:` / `# Complexity:` comments as the first lines of the function (Python methods with an empty body get `pass`); an existing note that does not contain the signature gets the starter **appended** as a fenced block. If you type before then, nothing is added. Neither is saved on open: **Unsaved changes** shows next to Save until you save (no leave prompt). The editor mode follows the text (fenced → Markdown, code-only → Python or Go). The toolbar has a **Python | Go** picker (saved with `PUT /api/preferences`; an untouched template switches language) and **Copy code** (a code-only note whole; else the last fence in your language, else the last Python/Go fence, else the whole note). The Time / Space fields stay the source for the quiz, coach and Analytics; the `# Complexity:` comment is only a prompt. Pure helpers: `web-ui/src/lib/noteTemplate.ts` (`buildTemplate`, `signatureKey`, `starterFor`, `noteEditorMode`, `extractCode`); fence aliases shared in `lib/noteEditor/fencedBlock.ts` (`FENCE_ALIASES`, `fenceLanguageOf`); flow in `lib/useProblemStatement.ts`; clients `fetchStatement` / `fetchStatementFromLeetcode` / `pasteStatement` / `fetchPreferences` / `savePreferences` in `lib/api.ts`, tested against the JSON fixtures in `web-ui/src/test/fixtures/statement/`.
  **Check my intuition** (ADR 0013 D5) — a button next to Save, on this page only. It sends the editor's **current** text (unsaved edits included), the complexities and status to `POST /api/notes/:id/check` and shows the coach's result below the form: an assessment chip (**On track** / **Partly there** / **Off track**), up to 3 questions, a **Ready to code** badge, the one-line note (or "This is the right direction — go ahead." when an on-track reply has neither), the slip label, a "First check" tag, and a notice when only the start of the note was checked. The result is in an `aria-live` region. Any edit dims it ("Your note changed") and the button reads **Re-check**. It is disabled with a hint when the note is empty or no provider is set up (`GET /api/settings`, or a `no_provider` reply). A `503` shows the "model isn't ready yet" card with Retry; a `429` disables the button for `retryAfterMs` with a countdown. The feedback is never saved (not even in `localStorage`) and is cleared when you leave the problem. Client: `web-ui/src/lib/intuitionCheck.ts`; component: `web-ui/src/components/IntuitionCheck.tsx`.
- **Custom problems on Home** (ADR 0010 D5) — an **Add problem** button above the catalog and a **+** on each topic header (pre-selects that topic) open an accessible modal (`role="dialog"`, focus moves to Title, Tab is trapped, Escape/Cancel close and return focus to the opener): title (≤ 200, one line), link (optional, http(s) ≤ 2048), difficulty, topics (1–3 of the 13, labelled from `/api/catalog`), statement (optional plain text ≤ 2000 — the problem, never an answer). Client checks mirror the server (`web-ui/src/lib/problemForm.ts`); server errors show inline. A duplicate `409` shows "This looks like <problem> — open it instead" (link to its Notes), plus **Add anyway** (`allowSimilarTitle`) for a title-only match. After a create the catalog is refetched, the problem's topics expand, and a notice links to its Notes. Custom rows carry a **Custom** badge; their title opens Notes like any row, and a row without a link has no external-link icon. Components: `ProblemForm.tsx`, `Modal.tsx`, `CustomBadge.tsx`.
- **Analytics** (`/analytics`, ADR 0012 D3) — "what to focus on", fed by one `GET /api/insights` call. A status **donut** (Done emerald / To revisit amber / Didn't understand red / Not started slate) with the total in the center, a legend with counts and a screen-reader text summary. **Locked** (fewer than 2 quiz sessions with an answer): donut, a "Take a quiz to see your gaps and patterns — X of 2 sessions done" link to `/interview`, and the topic tiles — nothing else. **Unlocked**: donut, **Focus next** (≤ 3 topics: label, band chip with the shared `STRENGTH_COLORS`/`STRENGTH_LABELS`, count-based reason), **Where you keep slipping** (≤ 3 slip codes: label, ×count, up to 3 topic chips with counts), **Strengths** (≤ 5 chips with correct/incorrect; a Focus topic is never listed), then the tiles. An empty unlocked section says "Not enough quiz data yet in this section." **Topic tiles**: the 13 topics in API order (`TOPIC_ORDER`), each a mini SVG progress ring + label (wraps, never truncated) + `done/total`, in an auto-fill grid with an 11rem minimum tile width (one column on the narrowest screens, up to 5 on wide ones). Slip labels come from the API; `lib/analytics.ts` keeps a fallback map (unknown codes read "Other slip") and the pure donut/ring geometry. Labels fall back to the topic id. `no_db` shows the create-your-database link; loading and API-error states as elsewhere. Hand-built SVG, no chart library.

  **Practice (intuition checks)** (ADR 0013 D5). A separate, compact section below the topic tiles, fed by `GET /api/practice` (fetched after insights, independently). It renders **only** when `state` is `ready`; `no_db`, `empty`, a `404` from a server without the route, or any error just hide it — the rest of the page is unaffected. It shares no numbers with the quiz sections: a small **first-check outcomes** donut (On track emerald / Partly there amber / Off track red, legend counts and a screen-reader summary), **Top practice slips** (≤ 3: label, ×count, up to 3 topic chips), **Fixed after re-check** and **Ready to code on first check** as `X of Y`, and **Since <date>**. **Reset practice history** is a two-step inline confirm ("Deletes all practice history. Quiz analytics are not affected. A backup is saved first." — Confirm reset / Cancel, focus on Cancel) that sends `POST /api/practice/reset { confirm: "reset-practice" }`; on success it shows "Backup saved to <path>" and refetches (an empty history hides the section; the notice stays). `409 read_only` and `500 backup_failed` / `reset_failed` show the server's message (plus the backup path for `reset_failed`). Component: `web-ui/src/components/PracticeSection.tsx`; client `fetchPractice` / `normalizePractice` / `resetPractice` in `lib/api.ts`.
- **Interview** (`/interview`) — the **Quickfire Quiz Master** (ADR 0007 Q3, amended by quiz-fix-a), replacing the old generic interview chat. On load it resumes the single active session via `GET /api/quiz/session` (current question + prior transcript + progress); with none it offers a **Start quiz** entry (`POST /api/quiz/start`). Each question shows a real problem you marked **Done** **directly** from the catalog — its title, a difficulty badge, and an **Open problem** link (new tab, `rel="noopener noreferrer"`), then the problem **statement and examples** from the ADR 0015 cache (`QuizStatement.tsx`: the same `useProblemStatement` flow and `StatementView` renderer as Notes; one `POST …/statement/fetch` only when the GET says `not-cached` and fetching is on; pasted and custom text as plain text; no starter code; on `disabled` / `premium` / `unavailable` / an error, a short reason and an **Add it from the Notes page** link, no paste box). It is open by default in a height-capped, scrolling box behind a **Hide problem** / **Show problem** button (`aria-expanded`), and the choice holds until reload. An `on_track` probe keeps it without refetching; a new question drops late replies for the old one. It is display only: the answer request stays `{ answer, problemId }` (ADR 0007 amendment 2026-10-08). No invented story, no hints, no model call — type your approach and `POST /api/quiz/answer` returns a **verdict**: `correct` (emerald "Correct ✓" + optional optimal nudge) → advance; `incorrect` (amber "Marked for revisit" + feedback) → advance; `on_track` → the same question (title stays visible) with **one** probe shown in its own card, also re-shown after a reload (at most one nudge per question; a second `on_track` is coerced to `incorrect`). The Quiz Master **never reveals the answer**. The prior verdict card is cleared when the next question renders. A progress bar tracks `answered / deckSize`; when the deck is exhausted a **Session complete** summary (correct / to-revisit tallies) offers **New session** (`POST /api/quiz/new`, reshuffle from the current done-set). Empty done-set → a friendly "mark problems as Done first" state linking Home; provider **required** → the "Configure a model" state; provider/verdict failures → a friendly inline banner that never loses the session; model starting / unreachable (`503 model unavailable`) → a **"The model isn't ready yet"** state with the server's hint and a **Retry** button that re-sends the same answer (question and typed answer are kept).

  **Session management (quiz-fix-b).** An **End session** control is shown during an active quiz — `POST /api/quiz/end` persists the session `complete` and clears the active pointer, so it stops being resumable-active but **remains listed** (ending never deletes). The idle and complete views show a **Your sessions** list (`GET /api/quiz/sessions`, empty-safe): one card per past + active session (created time, `answered / deckSize`, correct tally, status/Active badge) with a **Resume** button (`POST /api/quiz/resume { sessionId }` — re-activates it as the resumable session and continues from its position; a session whose deck is exhausted is shown as complete and is not re-activated) and a **Delete** button (`POST /api/quiz/delete { sessionId }` after a small confirm; a REST-form `DELETE /api/quiz/session/:id` is also accepted). Delete is idempotent (missing → `ok:true`); deleting the active session also clears the pointer. Loading/empty/error states are handled and the page never crashes with no DB / no sessions.

- **Your data** (`/data`, nav link **Data**) — see [below](#your-data-data--adr-0009-d1).
- **Settings** (`/settings`, nav link **Settings**, ADR 0008 Wave 2c-lite) — read-only model status, at-a-glance first; reference detail sits in collapsed native `<details>` and every warning stays visible (founder feedback 2026-10-05). **AI provider** card: provider (Anthropic / OpenAI-compatible — shown as "Docker Model Runner (local)" for a DMR host / Ollama / none), model, Ollama or OpenAI-compatible endpoint (origin only), "Anthropic API key" (or, for OpenAI-compatible, "API key (optional)"): Configured ✓ / Not configured ✗, a **Connection** row (Not tested yet / Reachable / Failed, from the last explicit test), and a **Test connection** button (explicit click only; Anthropic shows a note that it makes one tiny billable 1-token call) with the result + latency. The provider `hint`, an invalid endpoint and the "No model is configured" state are always shown, never collapsed. A collapsed **How to change the provider** holds the env/`.env` explanation, the provider precedence (Anthropic → OpenAI-compatible → Ollama), the Compose note, a copyable `.env` snippet with placeholders only, and a note that changes need a server restart. **Problems & code** card (ADR 0015 D1/D4, `GET`/`PUT /api/preferences`): a **Code language** select (Python / Go, default Python) and a **Fetch problem statements from LeetCode** toggle (default on); when `IBAI_LEETCODE_FETCH` pins it, the toggle is read-only with a lock and "Set by IBAI_LEETCODE_FETCH". These are the only inputs on the page. **Data & app** card (folder + source, version, Node; links to `/data`), beside Problems & code on wide screens. **Configuration reference** card: a collapsed **Environment variables (n)** table of the env vars the server reads with set ✓/✗. **Keys stay env-only**: the page has no key input, never receives, stores or shows a key. The Interview page's "Configure a model" state links here. Components: `web-ui/src/components/SettingsPage.tsx`, `web-ui/src/components/Disclosure.tsx` (shared with `/data`).

All no-DB states link to `/data`. All values render via JSX (auto-escaped); no `dangerouslySetInnerHTML`. The only outbound calls are the user-configured LLM provider, made **server-side** inside the `POST /api/quiz/*` routes and `POST /api/settings/test-provider`, and the optional, user-triggered LeetCode statement fetch (ADR 0015 D1), made server-side by `POST /api/problems/:id/statement/fetch` and turned off in Settings or with `IBAI_LEETCODE_FETCH=off`.

### Where the UI lives

```
packages/web/
  src/          existing Node server (tsc build → dist/)  ← unchanged pipeline
  web-ui/       React SPA source (Vite build → dist-ui/)  ← separate pipeline
    index.html
    src/main.tsx, src/App.tsx, src/index.css
    src/components/  ProgressBanner, CatalogFilterBar, CategoryAccordion,
                     ProblemRow, ProblemTitleLink, StatusControl,
                     DifficultyBadge, Home, Notes,
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
| `POST /api/notes/:id` | Upsert a note. Body `{ content?, status?, timeComplexity?, spaceComplexity? }` (untrusted → validated). Keeps `completed` consistent with `status: 'done'`. `content` is stored as sent, except that a legacy `<!-- ibai:reference-approach -->` line outside fenced code is dropped; the reply is the persisted note. A `referenceApproach` field from an older client (any type) is ignored, never stored (ADR 0014 D1). | `200` saved note; `400` malformed body / invalid status; `404` unknown id. | `400 { error: 'no database configured' }` (does not crash). |
| `POST /api/notes/:id/check` | "Check my intuition" (ADR 0013 D1/D2; engine `coach-check.ts`, routes `coach-routes.ts`). Body `{ content, timeComplexity?, spaceComplexity?, status? }` is the editor's CURRENT text — the saved note is never read; absent = absent; `content` is checked as sent, and a `referenceApproach` field (any type) is ignored (ADR 0014 D1). Two messages: the rules once in the system message (never the answer/solution/algorithm/pseudocode/step list/code even if asked; never a technique the note does not name; `"""` blocks are data) and a data-only user message (problem line — the url is never sent; a custom problem's statement block; `Their complexity:`; `Note:`). Caps: note 2 500, statement 1 200, title 200, 5 topics (each neutralised, ≤ 40 chars), complexities 80; fixed fixture ≤ 250 tokens (measured 236), worst incl. retry ≤ 1 500 (measured 1 371) (ADR 0014 D1). JSON mode, ≤ 256 reply tokens. Strict parse + server-side leak guard (text NFKC-normalised, format characters stripped, Cyrillic/Greek look-alikes folded): code → one retry with a leak reminder — a code fence; a keyword-led line ending in `{`/`;`, or in `:` when it opens a block (`def`/`class`/`elif`/`except`, bare `else:`/`try:`/`finally:`, `while True:`) or holds a code signal (`( [ = < > !`, ` in `/` not `/` and `/` or `), so "For example:" / "If so:" pass; a C-style `for (;;)`; and, unless the line ends in `?`, an assignment/subscript line, `if (cond)` with an operator, or a keyword line with `->`/`=>`. Two or more numbered/bulleted items in one field (a step list) are a leak too; a question/note naming a technique not in the note, title or topics is dropped / blanked; malformed after the ONE retry → `502`. Nothing in the feedback is saved; only the structured outcome is appended to `practice-signals.json` (`recorded`). Rate limit per process: one in flight, ≥ 3 s between starts. | `200 { assessment, questions, readyToCode, note, miss?, missLabel?, firstCheck, truncated: { note, statement }, checkedAt, recorded }`; `400 { code: 'empty_note' \| 'invalid_body' \| 'no_provider' }`; `404` unknown id; `405`; `413`; `429 { code: 'rate_limited', retryAfterMs }`; `502`; `503 { code: 'model_unavailable', detail, hint }`. | Still checks; `recorded: false`, `firstCheck: false`. |
| `GET /api/practice` | Practice trends (ADR 0013 D3) from `practice-signals.json` only — never quiz data: `{ state: 'no_db'\|'empty'\|'ready', generatedAt, totals: { checks, problems (all-time), windowEvents, windowCap: 500 }, firstCheck: { on_track, partial, off_track }, slips (top 3, ≤ 3 topics each), fixedAfterRecheck: { count, of } (anchored on each problem's first check in the window), readyToCodeFirstTry: { count, of }, since }`. | `200`; `405`. | `200 { state: 'no_db' }`, zero counts. |
| `POST /api/practice/reset` | Body `{ confirm: 'reset-practice' }`. ADR 0009 D3 backup of the data folder FIRST, then delete `practice-signals.json` only (quiz files, notes and `.corrupt-*` copies untouched); every problem's next check is a first check again. | `200 { reset: true, backup }`; `400 { code: 'invalid_body' }`; `409 { code: 'read_only' }`; `500 { code: 'backup_failed' }` (nothing deleted) or `{ code: 'reset_failed', backup }`; `501 { code: 'reset_unsupported' }` when the storage's reset takes no backup hook (checked before anything is touched); `405`. | `400 { error: 'no database configured' }`. |
| `GET /api/progress` | Overall counts for the banner: `{ completed, total, byStatus: { done, to_revisit, did_not_understand, none } }`. | `200` | Safe empty (all `none`). |
| `GET /api/competency` | Quiz-derived competency signals for Analytics (ADR 0007 Q4): `{ topics: [{ topicId, label, correct, incorrect, strength, lastSeen }], patterns: [{ id, description, topics, topicLabels, occurrences, lastObserved }] }`. `label` / `topicLabels` (index-aligned with `topics`) are the curriculum display labels (raw id when unknown). Retired topic ids fold via `TOPIC_ALIASES` at read time; a merged topic with no string `lastSeen` is dropped, and a pattern whose topics were ALL dropped (e.g. only `miscellaneous`) is dropped (a pattern that never listed topics is kept). `topics` are sorted weak→strong then by most misses; `patterns` by most occurrences. Read-only — reads via `readCompetencySignals`, the user's OWN outcomes/patterns only (no shipped answers, §6.2). | `200` | Safe empty `{ topics: [], patterns: [] }`. |
| `GET /api/guidance` | "Where you stand / Next up" (ADR 0007 amendment w2a), derived at read time by core `deriveGuidance` — nothing is written, no model call: `{ state: 'no_db'\|'empty'\|'ready', generatedAt, standing: [{ topicId, label, notes: { done, toRevisit, didNotUnderstand, total }, quiz: { correct, incorrect }, lastActivity, band, needsReview }], nextUp: [{ kind: 'revisit'\|'weak_topic'\|'continue'\|'start', problemId, title, url, difficulty, topicId, label, reason }], quiz: { doneCount, lastQuizAt, suggested } }`. `nextUp[].topicId` (and `label`) is `null` only for a revisit whose problem lists no topics. `label` is the curriculum display label (raw id when unknown); reasons use it too (e.g. `Dynamic Programming: 1/5 correct in quiz`). `standing` lists topics with activity, weak→improving→unknown→strong (`band` = the same `deriveTopicStrength` label Analytics shows). `nextUp` = 3 problems, no repeats, distinct topics preferred: up to 2 oldest to-revisit / didn't-understand notes, then an unattempted problem (easy→medium→hard; hard only after 2 done in the topic) from a weak/improving topic, then the least-complete in-progress topic, then an unstarted one. Revisits claim their slots before any other kind, and the list is always ordered revisit → weak_topic → continue → start. `reason` is built from counts only (never a hint). `quiz.suggested` when ≥1 done and no quiz in the last 7 days (`lastQuizAt` = latest topic `lastSeen` in the signals). Malformed signals degrade to notes-only. | `200` (`405` non-GET) | `200 { state: 'no_db', standing: [], nextUp: [] }`. With a folder but no activity: `state: 'empty'`, `nextUp` = 3 easiest problems from 3 topics. |
| `GET /api/insights` | Analytics v2 (ADR 0012 D3), read-only, no model call: `{ state: 'no_db'\|'locked'\|'unlocked', generatedAt, sessions: { counted, required: 2 }, status: { done, toRevisit, didNotUnderstand, notStarted, total }, topics: [{ topicId, label, done, total }], focus: [{ topicId, label, band, reason }], slips: [{ code, label, count, lastSeen, topics: [{ topicId, label, count }] }], strengths: [{ topicId, label, correct, incorrect }] }`. A **counted session** is any quiz session file (active included) with ≥ 1 terminal answer; `state` is `unlocked` at ≥ 2 counted sessions, else `locked` (deleting sessions can lock it again; an adapter without `listQuizSessions` counts 0). `topics` is always the 13 in `TOPIC_ORDER` (custom problems count). When unlocked: `focus` = up to 3 `deriveGuidance` standing topics that are weak or need review, with a count-only reason (e.g. `4 of 6 quiz answers missed · 2 to revisit`); `slips` = top 3 miss codes by count then latest, labels from `MISS_LABELS`, up to 3 topics each (empty for data from before ADR 0012); `strengths` = up to 5 strong topics not in `focus`. Missing or malformed signals empty these lists but never change `state`. Labels fall back to the raw id. | `200` (`405` non-GET) | `200 { state: 'no_db' }` with zero counts, 13 zeroed topics, empty lists. |
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

### Problem statements + preferences (ADR 0015)

The one optional, user-triggered network call besides the LLM: the local
server fetches ONE catalog problem from `https://leetcode.com/graphql` (fixed
URL, `POST`, slug from the catalog `url` only, `redirect: 'error'`, no cookies
or auth, 10 s timeout, 1 MiB streamed cap, JSON + shape check, one fetch in
flight and ≤ 10 per 10 minutes per process). `leetcode.ts` makes the request;
`statement-sanitize.ts` (`htmlparser2` 10.1.0, server only) turns the HTML into
the allowlisted node tree of `statement-tree.ts` (zero imports, shared with
the SPA: `isStatementTree()`; linear time: input cut to 256 KiB, at most
1 024 open tags, parsing stops at the first cap and sets `truncated`); `problem-cache.ts` stores it in
`<dataDir>/problem-cache/<id>.json` (`^lc-[0-9]+$` ids only, 0700/0600,
atomic, `.gitignore` = `*`, ≤ 512 KiB, untrusted on read). Turn it off in
Settings or with `IBAI_LEETCODE_FETCH=off` (this pins it). The root README
explains what is sent and stored, and the ToS note.

| Route | Behaviour |
|---|---|
| `GET /api/problems/:id/statement` | Cache only, **never calls LeetCode**. `ApiProblemStatement`: `{ id, title, difficulty, url, custom, state: 'ready'\|'not-cached'\|'disabled'\|'premium'\|'unavailable', source: 'leetcode'\|'pasted'\|'custom'\|null, blocks, text, exampleTestcases, snippets: { python, go }, fetchedAt, truncated, cached, fetch: { enabled, pinned } }`. Pasted text wins over a fetched statement (its snippets are kept). Custom problems return their own `statement` (`source: 'custom'`, or `unavailable` without one). Unknown id → `404`. |
| `POST /api/problems/:id/statement/fetch` | Body `{ refresh? }`. Catalog ids only (custom → `400`). A cached fetch without `refresh` → `200` from the cache, no request. Else one request → `200` (`ready` or `premium`, both cached). Errors: `403 fetch_disabled`; `404 not_found` (LeetCode has no such slug; cached, so a later GET is `unavailable`, and a later POST without `refresh` returns `200` from the cache with `state: 'unavailable'`, no request); `429 rate_limited` with `retryAfterMs` (also while another fetch is in flight); `502 fetch_failed`; `504 fetch_timeout`. Fixed error text; LeetCode's reply is never echoed. Read-only or missing folder → still `200`, `cached: false`. |
| `PUT /api/problems/:id/statement` | Body `{ text }`, normalised (CRLF → LF, C0 controls except tab/newline removed, trimmed), ≤ 64 KiB, else `413`. Saves the paste; empty text clears it. Custom → `400`; no folder → `400`; read-only → `409`. |
| `GET /api/preferences` | `{ language: 'python'\|'go', leetcodeFetch: { enabled, pinned } }` from `<dataDir>/preferences.json` (defaults `python` and on; `IBAI_LEETCODE_FETCH` pins). |
| `PUT /api/preferences` | Body `{ language?, leetcodeFetch? }`; a bad value or unknown field → `400`; `leetcodeFetch` while pinned → `400 "Set by IBAI_LEETCODE_FETCH"`; unknown keys in the file are kept; atomic, 0600; no folder → `400`; read-only → `409`. |

Every POST/PUT passes the usual prechecks (Host `421`, cross-site `403`,
non-JSON `415`, 1 MiB body cap). Fixtures for every state and error body live
in `web-ui/src/test/fixtures/statement/`; `statement-api.test.ts` checks they
match what the routes return (regenerate with
`IBAI_WRITE_STATEMENT_FIXTURES=1 npx vitest run packages/web/src/statement-api.test.ts`).

### Settings API (ADR 0008 Wave 2c-lite)

| Route | Response |
|---|---|
| `GET /api/settings` | `{ provider: { kind: 'anthropic'\|'openai'\|'ollama'\|'none', model, endpoint, keyConfigured, label?, hint? }, dataDir: { path, source, pinned }, app: { version, node }, envHelp: [{ var, purpose, set }] }`. `endpoint` is the Ollama / OpenAI-compatible origin (`scheme://host:port`; userinfo, path and query stripped), `null` otherwise. `label` (`openai` only) is `"Docker Model Runner (local)"` when the normalized base URL host is `model-runner.docker.internal`, or loopback / `172.17.0.1` on port `12434` under `/engines/`; else `"OpenAI-compatible"`. `keyConfigured` is the active provider's key (OpenAI-compatible: the key that would be sent — `IBAI_OPENAI_API_KEY`, or `OPENAI_API_KEY` only for `https://api.openai.com`; otherwise Anthropic). `hint` explains a half-set/rejected config, or an OpenAI-compatible config ignored next to an active Anthropic/Ollama provider. Secrets are checked for presence only; `envHelp` covers `ANTHROPIC_API_KEY`, `IBAI_ANTHROPIC_API_KEY`, `IBAI_ANTHROPIC_MODEL`, `IBAI_OPENAI_BASE_URL`, `IBAI_OPENAI_MODEL`, `IBAI_OPENAI_API_KEY`, `OPENAI_API_KEY`, `IBAI_OPENAI_TIMEOUT_MS`, `IBAI_OLLAMA_MODEL`, `IBAI_OLLAMA_URL`, `IBAI_DATA_DIR`, `IBAI_WEB_PORT`, `IBAI_LEETCODE_FETCH`, `IBAI_HOST_DATA_DIR` with `set` booleans — never values. `405` non-GET. |
| `POST /api/settings/test-provider` | Same prechecks as every mutating `/api` route (Host 421, cross-site 403, non-JSON 415). Rate limited in-process: one test per 5 s (and one at a time) → else `429 { error }`. No provider → `400 { error: 'no model configured' }`. Ollama: `GET <IBAI_OLLAMA_URL>/api/tags` (5 s timeout), `ok` only if the configured model is pulled (`llama3` ≡ `llama3:latest`). OpenAI-compatible: `GET <base URL>/models` (Bearer only when a key is set; 5 s timeout), `ok` only if `data[].id` lists the configured model (`m` ≡ `m:latest`); "not listed" gets its own detail (DMR: a `docker model pull` hint). Anthropic: one `max_tokens: 1` messages call through `AnthropicProvider` (billable, 5 s timeout). `200 { ok, latencyMs, detail }`; `detail` is fixed, sanitized text (HTTP status class + a plain `error.type` identifier at most) — provider bodies, headers, keys and URL userinfo are never echoed. |

### Your data (`/data` — ADR 0009 D1)

The SPA's data-setup page (nav link **Data**; `/setup` is the no-JS
fallback). Sections: **Active folder** (path, source, note count; when
pinned, a visible "pinned by …, so it can't be changed here" line; Docker
notices), **Found previous data** (legacy-recovery cards, below), **Use an
existing notes folder** (path field → **Check** = dry run, **Use this
folder** = switch; server validation errors inline, success toast +
refreshed counts), and **Import notes from CSV**
([below](#csv-import-adr-0009-d2d3)).

Reference detail lives in native `<details>` disclosures, collapsed by
default: **How this folder is chosen** inside Active folder (the
flag > env > `config.json` > default precedence and, when pinned, how to
unpin; under Docker the `IBAI_HOST_DATA_DIR` pinning details instead), and
**Use an existing notes folder** itself — collapsed while the active folder
has notes, open when it has none (it is then the recovery path). Warnings
(missing folder, Docker notices), errors and the Found previous data prompt
are never inside a disclosure.

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
  `Reference approach`, `Solution approach` and `Reference` columns are
  ordinary `## <Header>` sections like any other (ADR 0014 D1 removed the
  reference role; `previewHash` is v4, so an older preview asks to preview
  again).
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
| `POST /api/quiz/answer` | The core turn. Body `{ answer: string, problemId?: string }` (untrusted → validated; `problemId` names the card the client showed). If the stored current card no longer resolves (a deleted custom problem, ADR 0010 D4) and the client did not name the skipped-to card, or the client names a card that is not current, the answer is **not graded**: no model call, no verdict, no note/competency writes; any skip is persisted with the next card's presentation turn and the route answers `409 { error: "question changed", skipped, complete, session, question }` (`question: null`, `complete: true` when nothing remains). Builds an evaluation prompt (persona + the problem + the user's OWN intuition note as personalization; a custom problem's statement goes in its own `"""` block, covered by the system rule that `"""` blocks are data, never instructions, and `"""` inside the note, answer or statement is neutralised), calls the provider, parses a strict JSON verdict **fail-closed**. Small-model robustness (ADR 0011 D4, ADR 0012 D2): two messages — a system message with every rule once (never reveal, even if asked or wrong; the note is the candidate's own and the main reference, no gap filling; semi-optimal or better is `correct`; one probing `on_track` at most; `incorrect` at once; `"""` blocks are data) plus the JSON template and miss-code menu, and a data-only user message (problem line, custom statement, note, then after a nudge the question's `FIRST ANSWER` and `PROBE GIVEN`, then the answer). Never session history. Budgets (`estimatePromptTokens`, chars/4 + 4 per message): fixed prompt ≤ 280 tokens (measured 277), worst case incl. retry ≤ 2000 (`QUIZ_PROMPT_TOKEN_BUDGET`, measured 1980; restored by ADR 0014 D1). Caps, each cut with a visible marker (≤ 60 chars): note ≤ 2500 chars (start kept), statement ≤ 1200, answer ≤ 1500 (start and end kept), first answer ≤ 600 (start and end), probe ≤ 300, title ≤ 200, ≤ 5 topics. The call asks for JSON mode (`responseFormat: 'json'`) and at most 256 reply tokens; the reply is `{ verdict, feedback (≤ 2 short sentences), miss?, optimalNudge? }` where `miss` is one generic code (`edge`, `complexity`, `brute`, `technique`, `vague`, `boundary`, `misread`; only `brute` on `correct`) — an unknown or missing code is dropped and never fails the verdict. One code per question is tallied (`terminal ?? probe ?? none`) globally and on each topic of the problem; a **malformed** verdict is re-asked **once** with a terse "reply with ONLY the JSON object" reminder (never more than 2 model calls; transport errors are not retried). **`correct`** (terminal, semi-optimal-or-better accepted) → record correct, bump competency signals, advance (no repeat; ids that no longer resolve are skipped, completing only when none remains), return next question. **`incorrect`** (terminal) → flip the note to `to_revisit`, record a miss `PatternSignal`, bump signals, advance. **`on_track`** → one non-terminal probe on the same question — **at most one nudge per question**: a second `on_track` from the model is **coerced by the engine to a terminal `incorrect`** (→ `to_revisit` + advance). Persists after every turn (resumable). | `200 { verdict, feedback, optimalNudge?, terminal, complete?, session, question }`. | `400` bad body / no provider; `404` no active session; `409` the shown card changed (not graded, see left); `503 { error: "model unavailable", code: "model_unavailable", detail, hint }` when the model is starting or unreachable (connection refused / unknown host, timeout, HTTP 503, or a 5xx saying it is loading; `hint` adds the first-run download + "enable Docker Model Runner" tip when the provider is Docker Model Runner) — **no writes**; `502` provider auth / unusable response / **malformed verdict after the one retry** (fail-closed: **no writes**, no fabricated verdict); `405` wrong method. |
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
starts without it. Requires Node 24+ (the repo `engines` minimum, ADR 0019).

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
