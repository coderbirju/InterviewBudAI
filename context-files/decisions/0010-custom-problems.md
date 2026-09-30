# ADR 0010 — User-added (custom) problems

- **Status:** Proposed — pending founder approval
- **Date:** 2026-09-27
- **Deciders:** Founder, Architect
- **Supersedes:** —
- **Amends:** ADR 0002 (additive optional `StorageAdapter` methods); ADR 0007
  A1/A8 ("questions from the catalog" now means the merged source, D4); ADR
  0009 D2 matching step 4 ("Future: create a custom problem") is scheduled
  (D4). Answers ADR 0008 Wave 2(b) "needs its own storage-interface ADR first".

## Context

`00-project-context.md` puts "user-added problems/links/questions" in v1 core,
and places custom problems in the **progress** layer (user-owned, never
shipped). Today every problem-aware path (`/api/catalog`, `/api/progress`,
`/api/notes/:id`, quiz deck, `deriveGuidance`, Analytics, CSV matching,
`countNotes`' known-id check from #64) resolves ids only through the read-only
`CurriculumSource` (`deps.catalog`). CSV import (#65) lists unmatched rows but
cannot keep them. Constraints: charter §5.2 (interface change ⇒ ADR), §6.1
(progress data never committed), §6.2 (curriculum = links + difficulty only),
§7.3 (inputs untrusted); ADR 0009 D4 (additive format changes do not bump
`formatVersion`); the #58/#60 `/api` protections.

## Decisions

### D1 — Where and on-disk shape

- Custom problems live in the **progress layer**: `<dataDir>/problems/<id>.json`,
  **one JSON file per problem** (pretty-printed, trailing newline). Never in
  `@ibai/curriculum`, never in the repo.
- Chosen over a single `custom-problems.json`: per-file edits diff cleanly in a
  version-controlled data dir, a write or delete touches only one problem (no
  read-modify-write race across the whole list), and it mirrors
  `quiz-sessions/<id>.json`. JSON, not `.md`: the record is structured; the
  user's thinking stays in `notes/<id>.md`.
- **Atomic writes:** write `<id>.json.tmp-<random>` in the same dir, then
  `rename` over the target (dir 0700, created on demand). **Create never
  overwrites:** creation reserves the id with an exclusive open (`'wx'`) and
  retries with a new random suffix on `EEXIST`. Delete = `unlink`.
- **Additive under ADR 0009 D4:** a new directory older code never reads ⇒
  **no `formatVersion` bump**, no migration; CHANGELOG `### Added` only.
- **Downgrade** (older build on a dir with custom problems) — nothing is
  rewritten or deleted, but:
  - `problems/` is ignored; `notes/u-*.md` are not listed, `GET /api/notes/u-…`
    is 404, and they are not counted (#64) — a folder holding **only** `u-*`
    notes counts **0** there (zero-notes banner shows; `/data` dry run says 0).
  - An active quiz whose **next** card is custom is **force-completed** by the
    older build on answer (its "next id unknown" path); one whose *current*
    card is custom cannot be presented (end/delete it). Outcomes already
    recorded are kept.
  - D3 backups copy `problems/` like any other file. Upgrading again restores
    everything (except a quiz the old build completed).

### D2 — Schema and ids

```ts
// @ibai/storage (progress layer)
interface CustomProblem {
  readonly id: string;               // 'u-<slug>-<rand6>', server-generated
  readonly title: string;            // 1–200 chars, single line
  readonly url?: string;             // http(s) only, ≤ 2048 chars
  readonly statement?: string;       // see Q1 — plain text, ≤ 2000 chars
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly topics: readonly TopicId[]; // 1–3, each in TOPIC_ORDER (canonicalized)
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
```

- **No answer/solution/hint field** (§6.2 spirit). Unknown request fields ⇒
  400; unknown fields in a file are dropped on read.
- **Id:** `u-` + slug of the title at creation (`[a-z0-9]` runs joined by `-`,
  ≤ 40 chars, `problem` if empty) + `-` + 6 base36 chars from
  `crypto.randomInt` (not `Math.random`). Must match
  `^u-[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64 chars — path-safe by construction.
  **Immutable** (title edits never rename it) and **never reused**. A
  curriculum test pins **"no catalog id starts with `u-`"** (catalog ids are
  `lc-N`), so the namespaces cannot collide.
- **Already in the catalog?** On create/edit the server runs the #65
  `createCatalogMatcher` (LeetCode URL slug, `NNN.` number, normalized title)
  against the catalog **and** existing custom problems. Slug or number match ⇒
  409 `{ duplicate: { problemId, title, custom } }` → UI "Open the existing
  one" (no override: same problem, one note). Title-only match ⇒ 409 with
  `overridable: true`; the client may resend with `allowSimilarTitle: true`.
- **Files are untrusted:** every file read from disk is validated with the
  **same rules as a write** (id regex + filename = id, title/statement limits
  and control-char stripping, `url` scheme http(s) — a `javascript:` or other
  url is dropped, topics filtered to the 13, difficulty enum, timestamps
  parseable). Invalid required fields ⇒ file skipped (never throw), like quiz
  sessions.

### D3 — Storage interface (optional, additive)

Per the ADR 0002/0007 optional-method pattern, `StorageAdapter` gains:

```ts
listCustomProblems?(): Promise<CustomProblem[]>;          // sorted by createdAt, id
readCustomProblem?(id: string): Promise<CustomProblem | null>;
createCustomProblem?(problem: CustomProblem): Promise<void>; // exclusive; EEXIST ⇒ throws
writeCustomProblem?(problem: CustomProblem): Promise<void>;  // replace existing, atomic
deleteCustomProblem?(id: string): Promise<void>;             // missing ⇒ no-op
```

> **Amendment (2026-09-27, PR 1 review):** two more optional methods, so the web never owns the note layout — `hasIntuitionNote?(problemId): Promise<boolean>` (any stored entry, even unparseable) and `deleteIntuitionNote?(problemId): Promise<void>` (missing ⇒ no-op); `DELETE /api/problems/:id` answers `501` when the adapter lacks `deleteIntuitionNote` rather than risk orphaning a note.

`LocalFileStorageAdapter` implements them (strict id regex + `safeJoin`).
Request validation (limits, duplicates, topics) lives in the web layer; the
adapter re-validates on read (D2). `@ibai/core` stays interface-only;
`@ibai/curriculum` is **unchanged** (its `Problem.url` stays required).

### D4 — Merging into the product

- **`ProblemView` (web-local).** `packages/web` defines
  `ProblemView = Omit<Problem, 'url'> & { url?: string; custom?: true;
  statement?: string }` and a per-request **merged source** with the
  `CurriculumSource` method shape over `ProblemView` = shipped catalog + custom
  problems. It replaces `deps.catalog` in every problem-aware route; curriculum
  types are untouched.
- **API types that become `url`-optional** (additive for clients; the SPA must
  render a missing link): `ApiCatalogProblem` (+ `custom?: true`),
  `ApiQuizQuestion` (+ `custom?: true`). `ApiCatalogProblem` also gains
  `statement?` (Notes finds its problem via the catalog; `ApiNoteResponse` is
  unchanged). The UI shows the title without a link when `url` is absent.
- **Consumers on the merged source:**
  - `/api/catalog`: grouped per topic in `TOPIC_ORDER`; within a topic, catalog
    order first, then custom by `createdAt`; totals include custom.
  - `/api/progress`, `/api/guidance` (`deriveGuidance` input) and Analytics
    counts include custom.
  - Notes: identical — `notes/<id>.md`, same `/api/notes/:id` route.
  - Quiz (ADR 0007 A1/A8 "from the catalog" ⇒ from the merged source): done
    custom problems are dealt like catalog ones; the card uses title +
    difficulty + url (none ⇒ title only). On answer, an unresolved next id
    (deleted problem) is **skipped forward** to the next resolvable one; the
    session completes only when none remains (replaces today's force-complete).
    `presentCurrent` likewise skips a deleted *current* card before presenting.
  - CSV import routes (PR 1) match against the merged source, so a row can
    match an existing custom problem; the stateless commit re-analysis uses
    the same source, and a mismatch with `previewHash` ⇒ 409 as today.
- **Known-id check becomes `(id, dir) => boolean`**: catalog id **or** a valid
  `u-` id whose `<dir>/problems/<id>.json` exists and validates. Threaded
  through `countNotes(dir, isKnown)` and `DataDirControl` (active dir, `/data`
  dry runs of another folder, **and** legacy-candidate eligibility "≥ 1
  parseable note"), so each folder is judged by its own custom problems.
- **CSV "Add as custom problem" (ADR 0009 D2 step 4):** an unmatched row may
  take `{ rowKey, action: 'add-custom', difficulty, topics }`; commit creates
  the problem (server id) then its note, after the D3 backup; `previewHash`
  also covers chosen unmatched rows' mapped fields. Ships in **PR 2** (changes
  the preview/commit contract and needs per-row difficulty/topic UI).

### D5 — API and UI

| Method + path | Body | Result |
|---|---|---|
| `POST /api/problems` | `{ title, url?, statement?, difficulty, topics, allowSimilarTitle? }` | 201 `{ problem }`; 409 duplicate (D2) |
| `PATCH /api/problems/:id` | any of `title, url, statement` (`null` clears), `difficulty, topics` | 200 `{ problem }`; `updatedAt` bumped |
| `DELETE /api/problems/:id` | `{ deleteNote?: boolean }` | 200 `{ deleted, noteDeleted, backup? }` |

- **Body reading:** `server.ts` today reads a request body **only for POST**.
  PR 1 extends it to **PATCH and DELETE** with the same order — header-only
  prechecks (Host, Origin / `Sec-Fetch-Site`, JSON content-type) first, then
  the early-413 declared-length check, then the 1 MiB-capped read. Chosen over
  POST sub-routes (`/api/problems/:id/delete`) because REST verbs match the
  table and `security.ts` already treats PATCH/DELETE as mutating; only the
  body reader lagged. Read-only dir ⇒ 409 (ADR 0009 D4).
- Only `u-` ids are editable/deletable: catalog id ⇒ 403 "catalog problems are
  read-only"; unknown `u-` id ⇒ 404.
- **Limits:** title 1–200 chars (trimmed; all C0 controls incl. newlines
  stripped — one line); statement ≤ 2000 chars (C0 except `\t` `\n`
  stripped); url parsed with `URL`, `http:`/`https:` only, ≤ 2048; 1–3 of the
  13 topics; **≤ 1,000 custom problems** per data dir (⇒ 400). All text is
  rendered via React escaping (no `dangerouslySetInnerHTML`); links
  `target="_blank" rel="noopener noreferrer"`.
- **Grading prompt:** a custom title stays on its single `- Title:` line
  (newlines already stripped); a statement goes inside its own `"""`-delimited
  block labelled as the candidate's problem statement (untrusted, not
  instructions), with any `"""` in it neutralised — same treatment as the note
  and answer blocks today.
- **Delete semantics:** if `notes/<id>.md` exists and `deleteNote` is not
  `true` ⇒ 409 `{ hasNote: true }`; the UI confirms ("This also deletes your
  note"). With `deleteNote: true` the server takes an ADR 0009 D3 backup first
  (failure ⇒ nothing deleted), then deletes note and problem. No note ⇒ no
  backup. Quiz transcripts and competency signals are **kept** (id as text;
  unresolved ids skipped, D4).
- **UI:** "Add problem" at the top of Home plus a "+" in each topic accordion
  header (pre-selects that topic) → small form (title, url, statement,
  difficulty, topics); duplicate 409 shows "Open the existing one". "Custom"
  badge on custom rows (Home, Notes header); statement shown escaped on Notes;
  Edit / Delete on the Notes page.

### D6 — Out of scope

Sharing/exporting custom problems; custom topics (topics stay the 13 of
`TOPIC_ORDER`); bulk import other than CSV unmatched rows; converting a custom
problem into a catalog one (a community PR to curriculum, §6.2); archiving
(`archivedAt?` possible later, additive); system-design custom problems.

## Consequences

- **Positive:** v1 core gap closed; CSV users stop losing unmatched rows;
  notes, quiz, guidance and analytics work on custom problems via one merged
  source, not per-feature branches.
- **Tradeoff:** each problem-aware request reads `problems/` (≤ 1,000 small
  files); fine locally; a data-dir-keyed cache can come later with no
  interface change.
- **Tradeoff:** more mutating surface (3 routes, body reading for PATCH/DELETE)
  — mitigated by the #58/#60 checks, server-generated ids, strict validation
  on write and read, and backups before note deletion.
- **Risk:** downgrade hides (never deletes) custom notes and may complete a
  quiz early (D1) — called out in the CHANGELOG `### Added` entry.

## Roadmap (small serial PRs, each with a `code-review` pass)

| PR | Scope | Depends on |
|---|---|---|
| 1 | Storage types + optional methods + `LocalFileStorageAdapter` (exclusive create, atomic writes, validated reads); `u-` invariant test; `server.ts` body reading for PATCH/DELETE; web `ProblemView` + merged source; `/api/problems`; catalog/progress/guidance/notes/quiz (skip-forward)/import on the merged source; `(id, dir)` known-id check; CHANGELOG `### Added` | this ADR accepted |
| 2 | SPA: Add-problem form (Home top + per-topic "+"), Custom badge, missing-url rendering, statement on Notes, edit/delete on Notes; CSV "Add as custom problem" (preview/commit + `previewHash` extension) | 1 |

## Open questions for the founder

The Architect's **RECOMMENDED** answers are already reflected above, **pending
founder confirmation**:

1. **Problem statement field?** *Recommended:* yes — an optional plain-text
   `statement` (≤ 2000 chars), the user's own problem statement for problems
   with no URL (book, interview). Not an answer. Shown escaped on Notes, passed
   to the quiz grader as delimited context.
2. **Delete when a note exists?** *Recommended:* allowed, with confirm + D3
   backup; ids are never reused and quiz history is kept. Archiving
   (`archivedAt?`) can be added later if wanted.

Any change to these decisions requires a new ADR.
