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

### Added

- **Reference approach on notes** (ADR 0013 D4, PR 1). Each note can hold an
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

- The unused `POST /api/chat` endpoint and its client helpers (#59, #60).
- Docs: ADR 0004 (built-in demo provider, superseded by ADR 0005 D6) deleted
  with founder approval; ADR numbers are not reused (see git history).

### Security

- Localhost hardening: Host allowlist (DNS-rebinding defence), Origin /
  `Sec-Fetch-Site` checks, JSON content-type on API writes, CSRF token on
  `/setup` (#58).
- Other localhost pages can no longer redirect your notes into another folder
  via the old cookie (#60).
- Request bodies capped at 1 MiB with an early 413, cross-site uploads rejected
  before reading, and server timeouts set (#60).
