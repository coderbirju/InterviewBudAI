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

### Added

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

- **Topics are regrouped into 13 and always listed in learning order**
  (Arrays, Binary Search, Sorting, Hashing, Linked List, Stack & Queue, Heap, Recursion, Backtracking, Trees, Graphs, Greedy, Dynamic
  Programming) with readable labels on Home and Analytics. `arrays-2d`,
  `two-pointers` and `sliding-window` merge into `arrays`; `miscellaneous` is
  retired; its problems and the combination/permutation/subset problems (plus
  Word Search) are re-tagged in the catalog (every topic has problems). Existing quiz stats for merged topics are combined at read time;
  no data is rewritten and no migration is needed.
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
- Rare read difference from that fix: a complexity saved by an older version
  that ends in two (or any even number of) backslashes, e.g. `C:\\`, now reads
  with half of them (`C:\`). Re-type the value once if that matters.

### Removed

- The unused `POST /api/chat` endpoint and its client helpers (#59, #60).

### Security

- Localhost hardening: Host allowlist (DNS-rebinding defence), Origin /
  `Sec-Fetch-Site` checks, JSON content-type on API writes, CSRF token on
  `/setup` (#58).
- Other localhost pages can no longer redirect your notes into another folder
  via the old cookie (#60).
- Request bodies capped at 1 MiB with an early 413, cross-site uploads rejected
  before reading, and server timeouts set (#60).
