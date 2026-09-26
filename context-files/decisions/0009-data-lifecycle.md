# ADR 0009 — Data lifecycle: onboarding, import, format versioning, and releases

- **Status:** Accepted (D1–D5; D5 amended "d5-zip" 2026-09-25)
- **Date:** 2026-09-25
- **Deciders:** Founder, Architect
- **Supersedes:** —
- **Amends:** ADR 0005 D2 w2d amendment — the legacy cookie is expired only
  after the user accepts/dismisses the recovery prompt (not on every request),
  and its value may be shown as a confirm-to-use *suggestion* (still never
  trusted to choose the dir) (D1); ADR 0005 D2 "bulk-import … FUTURE" is now
  scheduled (D2); `skills/code-review.md` rubric (one line, D4). Answers ADR 0008 D5 #5
  "Distribution" (D5, amendment d5-zip: GitHub Release zip; no npm/`npx` for
  now).

## Context

PR #60 (ADR 0005 w2d amendment) made the server own the data directory and
stopped honoring the legacy `ibai_data_dir` cookie. That was the right security
call, but it shipped **with no migration and no release note**: a user who had
picked a custom folder through the cookie-era `/setup` restarted, got the
default `~/.interviewbudai/data`, and saw an empty app. The founder's 25 `done`
problems "disappeared" — the files were intact in the cookie-chosen folder,
never moved or deleted, just no longer looked at. Worse, #60 expires the
cookie on the first request, so the browser no longer remembers where the old
folder was.

Founder direction (2026-09-25):

1. "For future reference we should explicitly call out breaking changes like
   this to users during a release."
2. Data setup belongs in the React UI, with a visible entry point from Home.
3. The setup page lets the user EITHER point at an existing folder of notes OR
   import CSV files. CSV (Notion exports) first.

Constraints that still hold: local-first, no telemetry, progress data never
committed (charter §6); inputs from files and the network are untrusted
(§7.3); new deps pinned and justified (§7.1); the `/api` protections from #58
(Host allowlist, Origin / `Sec-Fetch-Site` check, JSON content-type on
mutations) and #60 (server-owned dir, 1 MiB body cap, early 413).

Current on-disk format (called **format v1** below), from
`packages/storage/src/local-file-adapter.ts`:

```
<dataDir>/notes/<problemId>.md             frontmatter (id, lastUpdated,
                                           attempts?, status?, completed?,
                                           timeComplexity?, spaceComplexity?)
                                           + markdown body
<dataDir>/quiz-sessions/<id>.json, active.json
<dataDir>/competency-signals.json
<dataDir>/sessions/, summaries/, competency.json, weaknesses.json
```

## Decisions

### D1 — Data onboarding in the SPA (`/data`)

A React route **`/data`** ("Your data") becomes the primary data-setup UX. The
server-rendered `/setup` stays as the **no-JS fallback** with its current
security (CSRF token, path validation, pinned-dir refusal) and behavior.

**Entry points**

- **Banner** on Home and Analytics when the active dir has **0 tracked
  notes** (0 parseable `notes/*.md`): "Don't see your solved problems? Point
  InterviewBudAI at your existing folder or import a CSV → Your data". Not
  dismissible while the count is 0 — it is the recovery path for exactly the
  #60 failure.
- **Nav link** "Data" (always visible), next to the existing nav items.

**Page sections**

1. *Active folder* — path, where it came from (flag / env / config / default),
   note count. If pinned by flag/env: read-only, with the same explanation
   `/setup` gives.
2. *Use an existing folder* — a path field. "Check" does a dry run and shows
   what is there ("25 notes, 3 quiz sessions"); "Use this folder" switches.
   Hints: if the path ends in `/notes` and its parent looks like a data dir,
   suggest the parent; if the folder has `.md` files but no recognised
   `notes/<id>.md`, say it is not in InterviewBudAI format and point to CSV
   import (importing foreign markdown folders is future scope).
3. *Import CSV* — D2.
4. *Found previous data* — the legacy-recovery prompt (below), only when a
   candidate exists.

**JSON API** (all under `/api`, all behind the #58 checks; mutations require
`Content-Type: application/json` and pass the Origin / `Sec-Fetch-Site` check —
the SPA equivalent of `/setup`'s CSRF token)

| Method + path | Body | Result |
|---|---|---|
| `GET /api/data-dir` | — | `{ dataDir, source: 'flag'\|'env'\|'config'\|'default', pinned, exists, noteCount, formatVersion, readOnly?, legacyCandidates: [{ path, noteCount, origin: 'cookie'\|'legacy-default' }] }` |
| `POST /api/data-dir` | `{ path, dryRun?: boolean }` | dry run: `{ path, exists, noteCount, … }` (no writes). Otherwise: validate exactly like `POST /setup` (`validateSetupPath`), create 0700 if missing, write `config.json` atomically, switch the running server, return the new `GET` shape. Pinned → 400 with the `/setup` message. |
| `POST /api/data-dir/legacy/dismiss` | `{}` | Expires the legacy cookie; the prompt stops appearing. |

`GET /api/config` keeps its shape (#60).

**Legacy recovery (the one-time "Found previous data at X — use it?")**

- **Candidates:** (a) the value of the legacy `ibai_data_dir` cookie, if the
  request still carries it; (b) `~/.ibai/data` (the default documented in
  ADR 0005 D2 and still used by the frozen CLI, so a likely manual choice). A candidate is offered only if it
  passes `validateSetupPath`, is an existing directory, differs from the active
  dir, and contains **≥ 1 parseable note**.
- **Never trusted silently.** The cookie is attacker-settable from any
  localhost port (the reason for #60), so it is only ever a *suggestion*: the
  server never reads or writes through it. Accepting is an explicit click that
  sends a normal same-origin `POST /api/data-dir { path }` — re-validated from
  scratch, identical to typing the path. The prompt shows the full path and
  note count and says "use it only if you recognise this folder".
- **Cookie expiry changes:** the server stops expiring the cookie on every
  request; it expires it after the user accepts or dismisses (or on a
  successful `POST /api/data-dir` / `POST /setup`). The cookie still never
  affects which dir is used.
- Browsers that already visited a #60 build have lost the cookie; for them the
  path field plus the `~/.ibai/data` candidate plus the CHANGELOG note are the
  recovery path.

### D2 — CSV import (Notion exports first)

**Endpoints** (same `/api` protections; body JSON, within the existing 1 MiB
cap — early 413 unchanged)

- `POST /api/import/csv/preview` — `{ files: [{ name, text }], defaultStatus? }`
  → per-row results, **no writes**:
  `{ previewHash, rows: [{ key, file, line, title, match: { problemId, title,
  by: 'url'|'number'|'title' } | null, existing: 'none'|'note', fields:
  { status, lastUpdated, timeComplexity?, spaceComplexity?, bodyPreview },
  warnings[] }], unmatched[], duplicatesCollapsed, errors[] }`.
- `POST /api/import/csv/commit` — `{ files, previewHash, defaultStatus,
  decisions: { [problemId]: { action: 'create'|'skip'|'overwrite'|'merge',
  status? } } }`. The server **re-parses and re-matches** the same files
  (no server-side import state); if the recomputed hash differs from
  `previewHash`, or the data dir changed since preview → 409 "re-run preview".
  `previewHash` = SHA-256 over: the active data dir path, `defaultStatus`,
  every file's `name` + exact `text`, and for every resolved row its
  `problemId`, mapped fields (title, body, notes, date, complexities) and its
  **"note exists" flag** — so a `create` whose note appeared after preview
  (flag flipped) → 409, never a silent overwrite.
  Problem ids come **only** from server-side catalog matching; the client only
  chooses an action and a status for ids the preview produced. Then: D3 backup
  → write notes via `writeIntuitionNote` → `{ created, overwritten, merged,
  skipped, failed[], backup }`.

**Parser.** A small in-repo RFC 4180 parser (web package, pure, unit-tested) —
**no new dependency**: the needed subset (comma delimiter, `"` quoting, `""`
escapes, quoted multiline cells, CRLF/LF, optional UTF-8 BOM) is ~100 lines and
fully testable; a pinned dep would add supply-chain surface for no gain.
Unterminated quote or ragged rows beyond the header width → file-level error,
nothing from that file is imported.

**Column mapping** (observed Notion schema). Headers and cells are trimmed of
**Unicode whitespace** (incl. NBSP `U+00A0` and BOM); known headers are
matched case-insensitively after trimming, in any column order.

| Column | Use |
|---|---|
| **Title** = `Problem` if present, **else the FIRST column** (Notion's title property is user-named, e.g. `Arrays - 1D`) | Problem title. May contain a URL. |
| `URL` | Problem link (optional). |
| **Body** = `Intuition` if present, else `Property` | Note body (markdown, as-is). |
| `Notes` | Appended under a `## Notes` heading. |
| `Last Visited on` \| `Last Visited` | `lastUpdated` if parseable, else import time. |
| any other non-empty text column | Appended as a `## <Header>` section, in column order. |

Notion's per-row page bodies (the `.md` files beside the CSV in an export) are
**not imported** — future scope.

**Matching** (first hit wins)

1. **LeetCode slug** from the `URL` cell, else a URL inside the Title cell:
   host `leetcode.com` / `www.leetcode.com`, path `/problems/<slug>/…`; trailing
   segments (`/description/`, `/editorial/`, `/solutions/…`), query and hash
   are ignored → equal to the slug of a catalog entry's `url`.
2. **Leading number** `NNN.` in the title → `lc-NNN` if that id is in the
   catalog.
3. **Normalized title equality** (lowercase, strip a leading `NNN.`, drop
   punctuation, collapse whitespace) against catalog titles.
4. Otherwise **unmatched** — listed in the preview, never written. (Future:
   create a custom problem once Wave 2(b)'s storage ADR lands.)

Blank rows (every cell empty after trim) are skipped and counted in the
preview. A row with a blank title still goes through URL matching (step 1,
`URL` cell); only if that fails is it unmatched.

**Field rules**

- Body = the Body column; if `Notes` is non-empty, append
  `\n\n## Notes\n\n<Notes>`; then any other text columns as `## <Header>`.
- Complexity: best-effort **tokeniser over the whole text** (body + notes; not
  line-anchored), case-insensitive: a label `TC` \| `Time` (optionally
  `Time complexity`) or `SC` \| `Space` (optionally `Space complexity`), then
  optional whitespace, an **optional** separator (`:` `=` `-`), optional
  whitespace, then an `O(` expression read to its **balanced** closing `)` —
  i.e. `(TC|Time|SC|Space)\s*[:=\-]?\s*O(...)`. `TC: O(n), Space: O(1)` → time
  `O(n)`, space `O(1)`; `TC O(n)` → `O(n)`; `Time: O(n log(n))` → `O(n log(n))`. First match per kind
  wins; capped at 100 chars; unbalanced → ignored. The raw text stays in the
  body too.
- `Last Visited`: ISO 8601, Notion's `Month D, YYYY` (optionally with
  `h:mm AM/PM`), and `YYYY-MM-DD` / `YYYY/MM/DD`. Ambiguous numeric
  `NN/NN/YYYY` is **not guessed** (→ import time, with a warning).
- Status: the user picks a default in the preview (default **`done`**), with a
  per-row override; any `NoteStatus` value.
- **De-duplication:** Notion exports `X.csv` and `X_all.csv` with the same
  rows but possibly different columns or order, so rows are de-duplicated by
  **mapped fields** — resolved problem id (or normalized title if unmatched)
  plus normalized title, body, notes and date — never by cell positions;
  duplicates collapse to one (count reported). Distinct rows that match the **same** problem are flagged in the
  preview; the user picks one (default: the most recent `Last Visited`).

**Conflict policy** (a conflict = a note file already exists for that id)

- `skip` (default for conflicts) — leave it untouched.
- `overwrite` — replace body, complexities, status and `lastUpdated` with the
  imported values.
- `merge` — keep the existing body and append
  `\n\n## Imported <YYYY-MM-DD>\n\n<imported body>`; keep existing status unless
  the user picked one; fill complexities only where empty; `lastUpdated` =
  the later of the two.
- No conflict → `create` (default) or `skip`.

**CSV is untrusted**

- Nothing is evaluated: no formula handling, no HTML rendering. Text is stored
  as markdown source and shown through React's escaping (no
  `dangerouslySetInnerHTML`), in the preview and in Notes. Any future CSV
  *export* must neutralise cells starting with `= + - @` (formula injection).
- Limits: ≤ 64 files, ≤ 5,000 rows total, ≤ 64 columns, ≤ 64 KiB per cell,
  all inside the single 1 MiB request-body cap; over-limit → 413/400 with a clear message, no
  partial import. NUL and other C0 controls except `\t` `\n` are stripped;
  CRLF → LF.
- File names from the client are display-only, never used as paths. Writes go
  only through `writeIntuitionNote` (existing `safeJoin` path safety) with ids
  from the catalog.

### D3 — Backups before destructive-ish writes

Before any **import commit** (D2) or **format migration** (D4), copy the data
dir to `<dataDir>/.backups/<timestamp>/`:

- `<timestamp>` = UTC ISO 8601 basic format, `YYYYMMDDTHHMMSSZ` (no `:` so it
  is a valid Windows filename); a numeric suffix if it already exists.
- Copies everything except `.backups/` itself; no symlinks followed; dirs
  0700.
- Keep the **last 5**; prune older ones, touching only entries under
  `.backups/` whose names match the timestamp pattern.
- Write `.backups/.gitignore` containing `*` so a user who git-tracks their
  data dir does not commit backups.
- If the backup fails, the import/migration **does not run**.
- The backup path is returned to the UI ("Backup saved to …"). Restore is
  manual for now (copy back); a restore button is future scope.
- These are safety snapshots only; this does **not** decide ADR 0008 Wave 3
  "backup/export" (still pending founder).

### D4 — Data format versioning

- `<dataDir>/manifest.json`: `{ "formatVersion": 1, "createdBy": "<app
  version>" }`. **Absent ⇒ v1** (today's format), so every existing folder is
  valid as-is. The app writes the manifest the first time it writes to a dir
  that lacks one.
- The manifest is untrusted: it must parse, `formatVersion` must be a positive
  integer. Invalid → **read-only** with a clear message (never guess).
- On boot and on every switch (D1):
  - `formatVersion < current` → D3 backup, then run **ordered, idempotent**
    migrations `vN → vN+1` up to current, then write the manifest. A failed
    migration leaves the dir read-only and points at the backup.
  - `formatVersion > current` (data from a newer app) → **refuse writes**
    (read-only; mutating `/api` calls return 409 "This folder was written by a
    newer InterviewBudAI (format vN). Upgrade to edit it."). Reads still work.
  - equal → nothing.
- `GET /api/data-dir` reports `formatVersion` and `readOnly`.

**What bumps `formatVersion`.** Additive, back-compatible changes (a new
optional frontmatter key, or a new file older code ignores and newer code
tolerates missing) do **not** bump it and need no migration — a CHANGELOG
`### Added`/`### Changed` entry, and at most a minor app-version bump. A
**breaking** format change (renamed/moved files, changed meaning or type of an
existing field, anything older code would misread) **bumps `formatVersion`**
and ships a migration plus a `### Breaking changes` entry.

**Rule for every future PR.** Any PR that changes **where data lives, how the
data dir is resolved, or makes a BREAKING on-disk format change** (as defined
above; additive, back-compatible format changes are exempt) MUST include a
migration (or, for
location/resolution changes, a recovery path such as D1's legacy prompt) **and**
a `CHANGELOG.md` `### Breaking changes` entry. `code-review` MUST mark a PR
missing either a migration/recovery path or a CHANGELOG breaking-change entry
as blocking (`NEEDS_CHANGES`); the rubric in
`skills/code-review.md` carries a one-line pointer to this rule.

### D5 — Release strategy — **Accepted (amendment d5-zip, 2026-09-25)**

> **Amendment (d5-zip, 2026-09-25).** Founder decision: *"no need for npx
> based installation for now, GitHub-only zip is fine."* The earlier proposal
> (stable channel = tagged GitHub Releases **+ npm**, `npx interviewbudai@latest`)
> is replaced by the GitHub-only zip below. npm publishing / `npx` is **not**
> done now; it stays a possible future ring (needs a new ADR amendment). This
> answers ADR 0008 D5 #5 "Distribution".

- **Versioning:** SemVer `0.x.y` while pre-1.0. A breaking change bumps the
  minor (`0.x → 0.x+1`), anything else the patch. A release is a tag
  `v0.x.y`.
- **Development channel = `main`.** Contributors: `git pull && npm ci &&
  npm start` (`npm start` already rebuilds what is stale). Unchanged.
- **Stable channel = tagged GitHub Releases with a prebuilt zip asset**
  (e.g. `interviewbudai-v0.x.y.zip`). The zip contains the compiled server,
  the built SPA, and either production `node_modules` or a single bundled
  server file (PR D picks; any new build dep is pinned and justified there per
  §7.1). Nothing is built on the user's machine and no `npm install` is
  needed. Users unzip it and run it with **Node ≥ 20.12** via one documented
  command (e.g. `node interviewbudai/server.js`, or a bundled `start` script
  that does the same). PR D fixes the exact command and prints it in the
  release notes and README.
- **`CHANGELOG.md`** at the repo root, [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
  format, with an `## [Unreleased]` section and a mandatory
  `### Breaking changes` section in every release (write "None." if empty).
  At release, `[Unreleased]` is renamed to the version; that section is the
  GitHub Release notes (Release body, and included in the zip).
- **Packaging notes for PR D:** the `@ibai/*` workspaces are private and
  unpublished; bundling (e.g. esbuild, pinned) or copying the compiled
  workspaces plus production `node_modules` are both acceptable, since nothing
  is published to a registry. `spa.ts` resolves the SPA as `../dist-ui`
  relative to the compiled server module, so the zip layout must keep that
  shape (or make it configurable). `react`, `react-dom` and `lucide-react` are
  needed only to *build* the SPA and must not ship as runtime dependencies.
  `REPO_DOTENV_PATH` resolves relative to the compiled server; PR D documents
  where the zip build reads `.env` from (the unzipped folder and/or a
  user-level file such as `~/.interviewbudai/.env`).
- **Release automation (PR D):** a GitHub Action triggered by pushing a `v*`
  tag checks out the tag, runs `npm ci` and `npm run verify`, builds and zips
  the artefact, and creates the GitHub Release with the zip attached and the
  matching CHANGELOG section as notes. It uses only the workflow's built-in
  `GITHUB_TOKEN` (`contents: write`) — **no `NPM_TOKEN` or npm account is
  needed.**
- **Deferred rings:** npm publishing / `npx interviewbudai@latest`;
  standalone binaries (Node SEA / `bun compile`) — needs per-OS builds and code
  signing.
- **Release tags (founder decision, 2026-09-25):** the founder pushes `v*`
  tags by hand after merging the release PR; agents never push tags
  (consistent with charter §2.5 — shipping is the founder's action).
- **Scheduling (founder decision, 2026-09-25):** release work (PR D) is
  **deferred** — the decision above stands, but it is not scheduled. Current
  focus is CSV import (PR B) and getting the data setup (`/data`, #62
  hardening) right.

## Consequences

- **Positive:** A user whose data "disappeared" has a visible, one-click path
  back, and the founder can import their Notion history instead of re-typing
  it. Users learn about breaking changes from the CHANGELOG and release notes,
  and future format changes cannot silently strand data.
- **Decided:** Distribution (ADR 0008 D5 #5) — clone for contributors, a
  prebuilt zip from tagged GitHub Releases for users; no npm/`npx` for now
  (D5, amendment d5-zip). The founder pushes release tags by hand; PR D is
  deferred.
- **Tradeoff:** More server surface (`/api/data-dir*`, `/api/import/csv/*`) —
  mitigated by reusing #58/#60 protections and validation, and server-side
  matching so the client never supplies ids or paths to write.
- **Tradeoff:** Backups use disk inside the data dir (bounded to 5).
- **Tradeoff:** The legacy cookie lives a little longer (until accepted or
  dismissed); it is still never trusted.
- **Follow-up for PR D:** where the zip build reads `.env` from
  (`REPO_DOTENV_PATH` is relative to the compiled server) — the unzipped
  folder and/or a user-level file (e.g. `~/.interviewbudai/.env`) — decided in
  PR D.

## Roadmap (small serial PRs, each with a `code-review` pass)

| PR | Scope | Depends on |
|---|---|---|
| A | `/data` page + nav link + zero-notes banner; `GET/POST /api/data-dir` (+ dry run); legacy-cookie / `~/.ibai/data` recovery prompt + dismiss; cookie-expiry change; CHANGELOG entry (landed in #63) | — |
| B | CSV parser + Notion mapping/matching; `/api/import/csv/preview` + `/commit`; import UI on `/data`; D3 backups | A |
| C | `manifest.json` + migration framework (v1 baseline, no-op registry, read-only on newer/invalid) | B (reuses backups) |
| D | Release packaging (D5 d5-zip): prebuilt zip (compiled server + built SPA + production `node_modules` or a bundled server), documented `node …` start command, `.env` location; tag-triggered GitHub Action: `npm ci` → `verify` → build → zip → create GitHub Release with the zip + CHANGELOG section as notes (built-in `GITHUB_TOKEN`, no `NPM_TOKEN`) | **Deferred** (founder, 2026-09-25) — D5 accepted, not scheduled |

Any change to these decisions requires a new ADR.
