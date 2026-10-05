# Changelog

All notable changes to InterviewBudAI are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (`0.x.y` while pre-1.0).

Every release MUST have a `### Breaking changes` section (write "None." if
empty). Any change to where your data lives or how the data folder is chosen,
and any non-back-compatible change to the on-disk format, is a breaking change
and is listed there with what you need to do (ADR 0009 D4).

## [Unreleased]

### Breaking changes

- **The data folder is no longer chosen by a browser cookie** (#60). The server
  now decides it once at startup: `--data-dir` flag > `IBAI_DATA_DIR` env >
  `~/.interviewbudai/config.json` > default `~/.interviewbudai/data`.
  **If you picked a custom folder through `/setup` before this change, the app
  will look empty — your notes are not lost.** Nothing was moved or deleted.
  Open the **Your data** page (`/data`, "Data" in the nav) and either accept
  the "Found previous data" offer or enter that folder's path under "Use an
  existing folder"; the choice is then saved in
  `~/.interviewbudai/config.json` and shared by every browser. (`/setup`
  remains as a no-JavaScript fallback. If you do not remember the path, look
  for a folder containing a `notes/` directory of `lc-*.md` files;
  `~/.ibai/data` is the CLI's default and a common choice — the page offers it
  automatically when it has notes, only if you haven't chosen a folder since;
  your old cookie folder is offered only if your browser still has the old
  cookie; otherwise use "Use an existing folder".)
- **The legacy `ibai_data_dir` cookie is now kept until you act** (#62). Since
  #60 it was expired on every response; it is now expired only after you
  switch folders (on `/data` or `/setup`) or dismiss the "Found previous data"
  prompt, so the app can offer the folder it points to. The cookie still
  never selects the data folder — using it always takes an explicit click.
  Nothing to do.
- **Under Docker the data folder comes from `IBAI_HOST_DATA_DIR`** (else
  `IBAI_DATA_DIR` from `.env` / the shell, else `~/.interviewbudai/data`),
  **not from the folder chosen at `/setup` or
  `/data`** (ADR 0011 D3). Only affects the new `docker compose up` path;
  `npm start` is unchanged and nothing on disk changes. If you picked another
  folder outside Docker, the app shows a banner with its path: set
  `IBAI_HOST_DATA_DIR=<that path>` in `.env` and restart. Inside Docker, `/data`
  shows "Pinned by Docker (`IBAI_HOST_DATA_DIR=…`)" and does not offer
  switching.
- **The Reference approach field is removed** (ADR 0014). No text is deleted.
  A note that had one now shows it at the end of the note, under a
  `## Reference approach` heading. You can keep it there or delete it. The
  hidden `<!-- ibai:reference-approach -->` marker line is dropped, so the
  next save rewrites that note file without it; a marker line you save is
  dropped the same way (a marker-looking line inside a ```` ``` ```` / `~~~`
  code block, including an unclosed one, is your own text and is kept). Notes
  without a Reference are unchanged, byte for byte. The quiz and the
  intuition check now read the text as part of your note. CSV columns named
  Reference approach, Solution approach or Reference now import as a normal
  `## <Header>` section; a CSV preview made before this change asks you to
  preview again. An older client that still sends `referenceApproach` is not
  rejected: the field is ignored.

### Added

- **Release zip** (ADR 0016 D2, ADR 0009 D5). Pushing a `vX.Y.Z` tag builds
  `interviewbudai-vX.Y.Z.zip` (one bundled server file plus the built web
  app), smoke-tests it and attaches it to a GitHub Release. Run it with
  `node interviewbudai-vX.Y.Z/dist/server.js` (Node ≥ 20.12); nothing is
  installed or built. Inside the zip the server reads `.env` from the
  unzipped folder; from a clone it still reads the repo-root `.env`. A
  release whose CHANGELOG section is missing or has no `### Breaking changes`
  heading fails. `esbuild` 0.21.5 (already in the tree through Vite) is now a
  pinned root dev dependency. Breaking changes: none.
- **Usage metrics, repo side only** (ADR 0016 D1). A nightly workflow copies
  GitHub's clone and view counts and the release download counts to CSV files
  on a data-only `metrics` branch, so the history outlives GitHub's 14 days.
  The app sends nothing. Needs a founder-held `METRICS_TOKEN` (see README);
  without it only downloads are recorded. Breaking changes: none.
- **Code editor for notes** (ADR 0014 D2). The "Intuition & approach" box on
  the Notes page is now a CodeMirror 6 Markdown editor. Fenced ` ```python `
  (also `py`, `python3`) and ` ```go ` (also `golang`) blocks get syntax
  highlighting and language-aware auto-indent; other fences stay plain. Tab /
  Shift-Tab indent (press Esc then Tab to leave the editor), lines wrap, and a
  toolbar has **Python block**, **Go block** and **Copy note**. Notes stay
  plain Markdown on disk. The editor is a separate lazy chunk (~148 KB gzip)
  loaded only on the Notes page, bundled locally (no CDN). If it cannot start,
  the page keeps the plain text box.

- **Analytics Practice section** (ADR 0013 D5, PR 4). Below the quiz
  sections, a compact "Practice (intuition checks)" section, fed by
  `GET /api/practice`, shows first-check outcomes (On track / Partly there /
  Off track donut), up to 3 practice slips with topics, "Fixed after
  re-check" and "Ready to code on first check" (`X of Y`) and "Since <date>".
  It shares no numbers with quiz analytics and is shown only when practice
  data is ready (hidden with no data folder, no checks, or a server without
  the route). **Reset practice history** is a two-step confirm that calls
  `POST /api/practice/reset`; a backup is made first, only practice history is
  deleted, and the backup path is shown. Read-only folder (`409`) and backup
  or reset failures (`500`) show the server's message. UI only; no new
  dependencies.

- **Notes: "Check my intuition"** (ADR 0013 D5, PR 3). A button next to Save
  sends the current editor text (unsaved edits included) to
  `POST /api/notes/:id/check` and shows the coach's verdict (On track / Partly
  there / Off track), up to 3 questions, a "Ready to code" badge and a one-line
  note. It never shows the answer. Editing marks the result stale and offers
  **Re-check**. The feedback is not saved anywhere, not even in the browser.
  The button is disabled until a provider is set up and the note has text.
  Needs the coach server route (ADR 0013 PR 2).

- **"Check my intuition" coach — server** (ADR 0013 D1–D3, PR 2).
  `POST /api/notes/:id/check` sends the Notes editor's CURRENT text (unsaved
  edits included) to your model, which says whether you are on track and asks
  1–3 questions — never the answer, code, or a technique your note does not
  name, and never anything from your Reference approach. The feedback is
  never saved. Only the structured outcome (assessment, ready-to-code, slip
  code, status) goes to a **new file, `practice-signals.json`**, in your data
  folder (newest 500 checks + the set of problems checked; no text). Older
  builds ignore it — additive, no format change, nothing to do.
  `GET /api/practice` reports practice trends from that file only; quiz
  analytics are untouched. `POST /api/practice/reset` (`{ "confirm":
  "reset-practice" }`) saves a backup of the data folder first, then deletes
  only that file. One check at a time, ≥ 3 s apart.

- **Reference approach on notes** (ADR 0013 D4, PR 1; removed again by
  ADR 0014, see Breaking changes). Each note could hold an
  optional, private **Your reference approach** — your own write-up of how you
  solved it — in a collapsed disclosure on the Notes page. It is stored in the
  note file as a marked trailing section (`<!-- ibai:reference-approach -->`,
  then `## Reference approach`), so old notes read unchanged and an older
  build shows it as body text and keeps it. `GET`/`POST /api/notes/:id` carry
  `referenceApproach` (absent keeps, `''` clears, ≤ 50 000 chars). Every note
  writer keeps it — including a wrong quiz answer that flips the note to
  `to_revisit`. The quiz grader now sees it as grounding in a delimited
  `Reference (theirs, never reveal)` block (first 600 chars) and never reveals
  it; quiz prompt budgets are now fixed ≤ 300 and worst ≤ 2 200 tokens
  (measured 287 / 2 165). CSV import maps a `Reference approach`, `Solution
  approach` or `Reference` column to it (a link-only cell stays in the body),
  the preview shows which column was used, `overwrite` clears it and `merge`
  keeps or appends. Additive: no data-format version bump.
- **Quiz slips + insights API** (ADR 0012, PR 1). The grader may tag each miss
  with one generic code (`edge`, `complexity`, `brute`, `technique`, `vague`,
  `boundary`, `misread` — how you slipped, never the answer); one code per
  question is tallied in `competency-signals.json` (new optional `misses`,
  global and per topic) and on the probe's transcript entry. **Additive
  format change** (ADR 0009 D4): no migration, older data reads as "no
  slips". Running an **older build** after this one keeps working, but its
  next quiz answer rewrites the signals file without `misses`, so the slip
  tallies are lost (quiz correct/incorrect tallies are kept). New read-only
  `GET /api/insights` (status, 13 topic tiles, focus next, slips, strengths;
  unlocks after 2 quiz sessions with at least one answer each). `MISS_LABELS`
  is exported from `@ibai/web`.

- **Quiz: "The model isn't ready yet" state** (ADR 0011 PR C). When the
  model is starting, loading or unreachable (connection refused, unknown
  host, timeout, HTTP 503, or a "loading" error), the Interview page shows a
  friendly state with a hint and a **Retry** button; your question and typed
  answer are kept and nothing is graded or saved. With Docker Model Runner
  the hint mentions the first-run download (~2.5 GB for the default model)
  and how to enable Docker Model Runner. Settings → Test connection reports
  HTTP 503 as "starting or unavailable — try again in a moment".
- **Quiz: one retry on an unreadable verdict** (ADR 0011 PR C). If the model's
  verdict cannot be parsed, the app asks once more with a short "reply with
  only the JSON object" reminder; if that also fails, it fails closed as
  before (no writes). Never more than 2 model calls per answer.
- **Run with local AI: `docker compose up`** (ADR 0011 PR B). A `Dockerfile`
  and `compose.yaml` start the app plus a local model through Docker Model
  Runner (default `ai/qwen3:4b-instruct-2507-q4_K_M`, ~2.5 GB, change it in
  `compose.yaml`) — no account, no key. Published on `127.0.0.1` only; your
  `.env` is never passed into the container. Notes live in your host folder
  (`IBAI_HOST_DATA_DIR`), bind-mounted at `/data`; the app checks on boot that
  it is writable and says how to fix it if not. Docker Engine (Linux):
  `compose.engine.yaml`. New optional server settings: `IBAI_BIND_HOST`
  (`127.0.0.1` / `::1`; `0.0.0.0` only with `IBAI_CONTAINER=1`, which the
  image sets — never set both on a normal computer: the app would listen on
  all interfaces with no authentication) and `IBAI_PUBLIC_PORT` (the Host/Origin allowlist port
  when the published port differs; state-changing requests are accepted only
  there). A failed connection to Docker Model Runner now asks whether
  Model Runner is enabled (Docker Desktop: Settings → AI; Docker Engine: the
  `docker-model-plugin` package). `compose.yaml` uses `restart: "no"`. CI builds the
  image and smoke-tests it against a fake OpenAI-compatible server.

- **OpenAI-compatible provider — run the Quiz Master on Docker Model Runner**
  (ADR 0011 PR A). Set `IBAI_OPENAI_BASE_URL` (e.g.
  `http://localhost:12434/engines/v1`) and `IBAI_OPENAI_MODEL`; an
  `IBAI_OPENAI_API_KEY` is optional and only sent over `https` or loopback
  `http`; `OPENAI_API_KEY` is used only for `https://api.openai.com`. Also works with llama.cpp, vLLM, LM Studio,
  Ollama's `/v1` and hosted OpenAI-style APIs. Precedence: Anthropic →
  OpenAI-compatible → Ollama. Timeout `IBAI_OPENAI_TIMEOUT_MS` (default
  120 s). **Settings** shows "Docker Model Runner (local)" for a DMR host,
  and **Test connection** checks that the server lists your model. The
  provider interface gains an optional `responseFormat: 'json'` hint
  (additive; Ollama maps it to `format: 'json'`, Anthropic ignores it).

- **Custom problems in the app** (ADR 0010, PR 2): **Add problem** on Home
  (and a **+** on each topic to pre-select it) opens a small form — title,
  optional link, difficulty, 1–3 topics, optional plain-text statement; if it
  already exists you get a link to open it instead (or **Add anyway** for a
  similar title). Custom problems show a **Custom** badge (no link ⇒ plain
  title). On a custom problem's Notes page you see its statement and can
  **Edit** or **Delete** it (deleting one with a note asks twice and backs up
  your data folder first; Home then shows the backup path). **CSV import:**
  rows that match no catalog problem can now be ticked **Add as custom
  problem** (pick a difficulty and a topic) — the problem is created and the
  row's note imported into it, after the usual pre-import backup; a failing
  row is listed and the rest still import. The commit `previewHash` now also
  covers unmatched rows (a preview from an older build must be re-run: `409`).
  Additive — no migration. The quiz's "question changed" notice is now
  neutral ("That question changed — your answer wasn't graded. Here's the
  current one.").

- **Custom problems API** (ADR 0010, PR 1 — the UI follows in PR 2): add your
  own problems (a book, an interview) with `POST /api/problems`, edit them
  with `PATCH /api/problems/:id`, delete them with `DELETE /api/problems/:id`
  (a problem with a note needs `deleteNote: true` and is backed up to
  `.backups/` first). Each problem is one file,
  `<data folder>/problems/<id>.json` (ids `u-…`), with a title, optional
  link, optional plain-text statement (≤ 2000 chars, never an answer),
  difficulty and 1–3 topics. Custom problems appear everywhere catalog ones
  do: Home catalog and totals, notes, progress, guidance, Analytics, the quiz
  deck (the grader gets your statement as delimited context) and CSV import
  matching. A problem that already exists (same LeetCode link or number) is
  refused; a similar title can be confirmed. Additive: no migration, nothing
  existing is rewritten. **Downgrade note:** an older build ignores
  `problems/`: your custom notes are hidden (not deleted, and not counted — a
  folder with only custom notes shows 0), and an active quiz whose next card
  is custom ends early. Upgrading again restores everything. Also: a quiz
  now skips a card whose problem was deleted instead of ending (an answer
  typed for the deleted card is not graded: `409`, and the next card is
  shown), and `"""` in
  a note or answer can no longer close its block in the grading prompt.
  Storage adapters gain optional `hasIntuitionNote` / `deleteIntuitionNote`
  (ADR 0010 D3 amendment).

- **Settings page** (`/settings`, gear in the nav): shows the active model
  (provider, model, Ollama endpoint, whether an Anthropic key is configured),
  a **Test connection** button (Ollama: checks the model is pulled; Anthropic:
  one tiny billable 1-token call, only on click), the environment variables
  the app reads (set ✓/✗) with a copyable placeholder `.env` snippet, and data
  folder + app/Node versions. Keys stay in your environment — the page never
  asks for, stores or shows one. New `GET /api/settings` and rate-limited
  `POST /api/settings/test-provider`. The Interview "Configure a model" state
  links to it.
- Home catalog search plus difficulty and status filters (#54).
- One-command start: `npm start` builds what is stale and creates the default
  data folder `~/.interviewbudai/data` (0700) on first run; accurate
  `.env.example` (#55). Requires **Node.js ≥ 20.12** (built-in `.env`
  loading).
- The data-folder choice persists across restarts in
  `~/.interviewbudai/config.json` (#60).
- **Your data** page (`/data`, "Data" in the nav): shows the active folder,
  where it came from and its note count; check (dry run) and switch to an
  existing folder; and a one-click "Found previous data" recovery offer for
  the old cookie folder or `~/.ibai/data` (#62).
- A banner on Home and Analytics when the active folder has no notes (or
  previous notes were found), linking to `/data` (#62).
- JSON API for the data folder: `GET /api/data-dir`, `POST /api/data-dir`
  (with `dryRun`), `POST /api/data-dir/legacy/dismiss`, behind the same
  localhost protections as the rest of `/api` (#62).
- CSV import on **Your data** (`/data`): preview a Notion export matched to
  the catalog, choose skip / overwrite / merge per conflict, then import; the
  data folder is backed up to `<dataFolder>/.backups/` (last 5 kept) before
  anything is written (ADR 0009 D2/D3).
- `GET /api/guidance`: read-only "where you stand" per topic plus three
  concrete next-up problems (revisits, weak topics, continue / start) and a
  quiz nudge, derived from your notes and quiz results by the new core
  `deriveGuidance` (ADR 0007 amendment w2a). Next-up is ordered revisit →
  weak topic → continue → start. No on-disk change; nothing is written. The
  Home card that shows it lands separately.
- Home guidance card (Wave 2a): "Where you stand" topic chips (done/total,
  review count, and the same strength band color/label as Analytics) with a
  link to Analytics, up to three "Next up" problems (open-problem link,
  difficulty, reason, Notes link), a quiz nudge, and a "Start here" state for
  new data folders. Collapsible (remembered in this browser); refreshes after a
  status change and when you come back from Notes; a guidance error hides only
  the card.

### Changed

- **Tidier Your data and Analytics pages** (founder feedback 2026-10-04).
  On **Your data** (`/data`) the precedence of `--data-dir` /
  `IBAI_DATA_DIR` / `config.json` / default, the how-to-unpin steps and the
  Docker pinning details now sit in a collapsed **How this folder is chosen**
  disclosure, and **Use an existing notes folder** is collapsed while your
  folder has notes (it stays open when it has none, since it is then the way
  to recover them). The folder path, source, note count, the "pinned, can't be
  changed here" line, every warning, and the **Found previous data** prompt
  are always visible. **Analytics** gets more room: more space between
  sections, more padding in cards and tiles, plain section headings, larger
  donuts and rings, topic tiles that wrap their labels and drop to fewer
  columns on narrow screens instead of squeezing. No new data or charts; no
  behavior changes. Breaking changes: none.

- **Quiz prompt diet** (ADR 0012 D2). The grader prompt states each rule once
  and holds about half the fixed text (≈ 277 estimated tokens, was ≈ 497); the
  worst case incl. the retry is ≈ 1 979 (budget 2 000, was 3 000). After a
  nudge it now also sends that question's first answer (≤ 600 chars) and the
  probe (≤ 300). Caps: note 2 500 (was 4 000), statement 1 200 (was 2 000),
  answer 1 500 (was 2 000). Replies are capped at 256 tokens (was 512);
  feedback is at most 2 short sentences. Very long notes/answers are cut
  sooner (with a visible marker).
- **Analytics is simpler and tells you what to focus on** (ADR 0012 D3). The
  status bar chart is now a donut with counts, and per-topic completion is a
  grid of 13 small tiles with progress rings. After 2 quiz sessions the page
  adds **Focus next** (up to 3 topics and why), **Where you keep slipping**
  (your most common kinds of quiz slip and the topics they show up in) and
  **Strengths**. Before that it shows only your counts, the tiles and a link to
  take a quiz. The old bar charts and competency bars are gone.

- **Quiz prompts fit small local models** (ADR 0011 PR C). The Quiz Master
  instructions are shorter (same rules: never reveal the answer, at most one
  nudge, strict verdict JSON), the verdict is requested in JSON mode with at
  most 512 reply tokens, and long text is capped with a visible marker: your
  note at 4000 characters (its start is kept), a custom statement at 2000,
  your answer at 2000 (start and end kept). The worst-case prompt is now
  ~2650 estimated tokens (was ~840 fixed plus uncapped note/answer), so it
  fits a 4096-token context. Your own note stays the main reference; no
  answers are shipped.
- **Quiz API: "model unavailable" is `503`** (was `502` with a "Could not
  reach…" message): `POST /api/quiz/answer` answers `503 { error: "model
  unavailable", code: "model_unavailable", detail, hint }`. Auth errors and
  unreadable verdicts stay `502`.
- **Docker data-folder banner wording** (#78 review). It now says "Your
  `/setup` choice outside Docker is …" and notes that `npm start` ignores that
  choice when `IBAI_DATA_DIR` is set, instead of claiming your non-Docker
  setup uses it.
- **Topics are regrouped into 13 and always listed in learning order**
  (Arrays, Binary Search, Sorting, Hashing, Linked List, Stack & Queue, Heap, Recursion, Backtracking, Trees, Graphs, Greedy, Dynamic
  Programming) with readable labels on Home and Analytics. `arrays-2d`,
  `two-pointers` and `sliding-window` merge into `arrays`; `miscellaneous` is
  retired; its problems and the combination/permutation/subset problems (plus
  Word Search) are re-tagged in the catalog (every topic has problems). Existing quiz stats for merged topics are combined at read time;
  no data is rewritten and no migration is needed.
- Home "Where you stand" chips, next-up guidance reasons (e.g.
  "Dynamic Programming: 1/5 correct in quiz") and Analytics miss-pattern topics
  now show readable topic labels instead of raw ids; `/api/guidance` items and
  `/api/competency` patterns carry the labels (additive fields).
- Development-only catalog importer updated to the 13-topic taxonomy with
  per-problem overrides; a test checks it reproduces every catalog topic.
- The web app is the product; the CLI is frozen (ADR 0008, #57).
- Docs: ADR 0009 (data lifecycle — data page, CSV import, backups, format
  versioning, release strategy) and this changelog (#61). Releases will be
  prebuilt zips on tagged GitHub Releases, with these notes (ADR 0009 D5).
- `/setup` is now the no-JavaScript fallback and links to `/data`; in-app
  "no data folder" links go to `/data` (#62).
- Test and dependency hygiene: single `@testing-library/dom`, Home no longer
  re-filters on unchanged history navigation, catalog topic checks (#59).

### Fixed

- Quiz reliability: questions are presented from the catalog, not generated by
  the model, so the quiz no longer shows the wrong or a missing problem (#56).
- Time/space complexity values containing `"` or `\` now save and load
  exactly as typed; previously each save added a backslash in front of every
  `"`. Existing notes need no action: values damaged by the old bug are read
  back as intended where that is unambiguous (after an odd number of 3+ saves
  one stray `\` may remain — edit it away once). Multi-line complexity values
  are rejected (400) instead of silently joined. CSV import now keeps
  complexity text verbatim (no more `"` → `'`), and a `merge` that would
  change nothing is reported as skipped (`unchanged`) without touching the
  note. Not a breaking change (ADR 0009 D4): the file format is unchanged.
- Analytics no longer lists a recurring miss pattern whose only topic was the
  retired `miscellaneous`; a stored quiz topic without a last-seen date is
  ignored instead of passed on with a missing date (read-time only, nothing
  rewritten).
- Rare read difference from that fix: a complexity saved by an older version
  that ends in two (or any even number of) backslashes, e.g. `C:\\`, now reads
  with half of them (`C:\`). Re-type the value once if that matters.

### Removed

- The Reference approach (ADR 0014 D1): the Notes field, `referenceApproach`
  in `GET`/`POST /api/notes/:id` and in `POST /api/notes/:id/check`, the
  `marker_in_text` error, `truncated.reference`, the CSV reference role,
  `@ibai/storage`'s `reference-section` helpers and
  `IntuitionNote.referenceApproach`. Prompt budgets go back to quiz fixed
  ≤ 280 / worst ≤ 2 000 (measured 277 / 1 980) and coach fixed ≤ 250 /
  worst ≤ 1 500 (measured 236 / 1 371); the coach's Reference rule and
  Reference-overlap guard are gone, every other rule and guard stays.
- The unused `POST /api/chat` endpoint and its client helpers (#59, #60).
- Docs: ADR 0004 (built-in demo provider, superseded by ADR 0005 D6) deleted
  with founder approval; ADR numbers are not reused (see git history).

### Security

- Every `index.html` response now carries a fresh per-response style nonce
  (`style-src 'self' 'nonce-…'`, `script-src` unchanged) and
  `Cache-Control: no-store`, so the note editor can mount its styles without
  `'unsafe-inline'` (ADR 0014 D2).
- Localhost hardening: Host allowlist (DNS-rebinding defence), Origin /
  `Sec-Fetch-Site` checks, JSON content-type on API writes, CSRF token on
  `/setup` (#58).
- Other localhost pages can no longer redirect your notes into another folder
  via the old cookie (#60).
- Request bodies capped at 1 MiB with an early 413, cross-site uploads rejected
  before reading, and server timeouts set (#60).
