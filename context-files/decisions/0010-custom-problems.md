# ADR 0010 — User-added (custom) problems

- **Status:** Proposed — pending founder approval
- **Date:** 2026-09-27
- **Deciders:** Founder, Architect
- **Supersedes:** —
- **Amends:** ADR 0002 (additive optional `StorageAdapter` methods); ADR 0009
  D2 matching step 4 ("Future: create a custom problem") is scheduled (D4).
  Answers ADR 0008 Wave 2(b) "needs its own storage-interface ADR first".

## Context

`00-project-context.md` puts "user-added problems/links/questions" in v1 core,
and places custom problems in the **progress** layer (user-owned, never
shipped). Today every problem-aware path (`/api/catalog`, `/api/notes/:id`,
quiz deck, `deriveGuidance`, Analytics, CSV matching, `countNotes`'
known-id check from #64) resolves ids only through the read-only
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
  git-tracked data dir, a write or delete touches only one problem (no
  read-modify-write race across the whole list), and it mirrors
  `quiz-sessions/<id>.json`. JSON, not `.md`: the record is purely structured
  (no body — the user's thinking stays in `notes/<id>.md`).
- **Atomic writes:** write `<id>.json.tmp-<random>` in the same dir, then
  `rename` over the target (dir 0700, created on demand). Delete = `unlink`.
- **Additive under ADR 0009 D4:** a new directory older code never reads ⇒
  **no `formatVersion` bump**, no migration; CHANGELOG `### Added` only.
  **Downgrade check** (older build on a dir with custom problems): `problems/`
  is ignored; `notes/u-*.md` are not listed (catalog-driven views), not counted
  (#64 known-id filter) and `GET /api/notes/u-…` returns 404 — nothing is
  rewritten or deleted; D3 backups copy `problems/` like any other file. An
  active quiz whose *current* card is a custom problem hits the existing
  "problem not in catalog" null path (question unavailable) — the user can end
  or delete that session; no data loss. Upgrading again restores everything.

### D2 — Schema and ids

```ts
// @ibai/storage (progress layer; structurally a curriculum Problem + audit)
interface CustomProblem {
  readonly id: string;               // 'u-<slug>-<rand6>', server-generated
  readonly title: string;            // 1–200 chars after trim
  readonly url?: string;             // http(s) only, ≤ 2048 chars
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly topics: readonly TopicId[]; // 1–3, each in TOPIC_ORDER (canonicalized)
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
```

- **Links + difficulty only** (§6.2 spirit, even though this is progress
  data): no answer/solution/hint field. Unknown request fields ⇒ 400; unknown
  fields in a file are dropped on read.
- **Id:** `u-` + slug of the title at creation (lowercase ASCII `[a-z0-9]`,
  runs joined by `-`, ≤ 40 chars, `problem` if empty) + `-` + 6 random base36
  chars. Must match `^u-[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64 chars — path-safe by
  construction, validated on every API call and every file read (filename must
  equal `id`). **Immutable:** editing the title never renames the id (the note
  and quiz history keep pointing at it). Catalog ids are `lc-N`; a curriculum
  test pins the invariant **"no catalog id starts with `u-`"**, so the
  namespaces can never collide.
- **Already in the catalog?** On create/edit the server runs the existing
  `createCatalogMatcher` (#65: LeetCode URL slug, `NNN.` number, normalized
  title) against the catalog **and** existing custom problems. URL-slug or
  number match ⇒ 409 `{ duplicate: { problemId, title, custom } }` — the UI
  offers "Open the existing one" (no override: same problem, one note).
  Title-only match ⇒ 409 with `overridable: true`; the UI can resend with
  `allowSimilarTitle: true`.
- Files are untrusted on read: malformed / invalid / id-mismatched files are
  skipped (never throw), like quiz sessions.

### D3 — Storage interface (optional, additive)

Per the ADR 0002/0007 optional-method pattern, `StorageAdapter` gains:

```ts
listCustomProblems?(): Promise<CustomProblem[]>;          // sorted by createdAt, id
readCustomProblem?(id: string): Promise<CustomProblem | null>;
writeCustomProblem?(problem: CustomProblem): Promise<void>; // create or replace, atomic
deleteCustomProblem?(id: string): Promise<void>;            // missing ⇒ no-op
```

`LocalFileStorageAdapter` implements them (strict id regex + `safeJoin`).
Validation of *requests* (limits, duplicates, topics) lives in the web layer;
the adapter re-validates shape on read. `@ibai/core` stays interface-only; the
curriculum package is unchanged (still read-only, zero-dep).

### D4 — Merging into the product

- **One merged problem source per request.** The web layer builds a
  `CurriculumSource`-shaped view = shipped catalog + `listCustomProblems()`
  (custom entries carry `custom: true`) and passes it where `deps.catalog` is
  used today. Every consumer then sees custom problems with no special cases:
  - `/api/catalog`: grouped per topic in `TOPIC_ORDER`; within a topic,
    catalog order first, then custom by `createdAt`. `ApiCatalogProblem` gains
    optional `custom?: true` (+ `url` may be absent). Totals include them.
  - Notes: identical — `notes/<id>.md`, same `/api/notes/:id` route.
  - Known-id checks (#64): `isKnownProblemId` becomes "catalog id **or** a valid
    `u-` id whose `problems/<id>.json` exists **in the directory being
    inspected**" (so `/data` dry runs of another folder count its custom notes).
  - Quiz deck: done custom problems are dealt like catalog ones; the card is
    built from title + difficulty + url (no url ⇒ title only). A deck id that no
    longer resolves (problem deleted) is skipped when advancing.
  - `deriveGuidance` input problems and Analytics counts include them.
- **CSV import (ADR 0009 D2 step 4):** an unmatched row may take a new decision
  `{ rowKey, action: 'add-custom', difficulty, topics }`; commit creates the
  custom problem (server-generated id) then its note, after the D3 backup.
  `previewHash` extends to cover chosen unmatched rows' mapped fields. Ships in
  **PR 2**, not PR 1 (it touches the stateless preview/commit contract and
  needs the UI to collect difficulty + topic per row).

### D5 — API and UI

| Method + path | Body | Result |
|---|---|---|
| `POST /api/problems` | `{ title, url?, difficulty, topics, allowSimilarTitle? }` | 201 `{ problem }`; 409 duplicate (D2) |
| `PATCH /api/problems/:id` | any of `title, url (null clears), difficulty, topics` | 200 `{ problem }`; `updatedAt` bumped |
| `DELETE /api/problems/:id` | `{ deleteNote?: boolean }` | 200 `{ deleted, noteDeleted, backup? }` |

- Same prechecks as every mutating `/api` route (Host allowlist, Origin /
  `Sec-Fetch-Site`, JSON content-type — `security.ts` already treats
  PATCH/DELETE as mutating; 1 MiB cap; read-only dir ⇒ 409 per ADR 0009 D4).
- Only `u-` ids are editable/deletable; a catalog id ⇒ 403 "catalog problems
  are read-only"; unknown `u-` id ⇒ 404.
- **Limits:** title 1–200 chars (trimmed, C0 controls stripped); url parsed
  with `URL`, scheme `http:`/`https:` only, ≤ 2048; 1–3 topics from the 13;
  **≤ 1,000 custom problems** per data dir (⇒ 400). Rendered via React
  escaping; links `target="_blank" rel="noopener noreferrer"`.
- **Delete semantics:** if `notes/<id>.md` exists and `deleteNote` is not
  `true` ⇒ 409 `{ hasNote: true }`; the UI shows a confirm ("This also deletes
  your note"). With `deleteNote: true` the server takes an ADR 0009 D3 backup
  first (backup failure ⇒ nothing deleted), then deletes note and problem.
  Deleting a problem without a note needs no backup. Quiz transcripts and
  competency signals are history and are **kept** (they reference the id as
  text; unresolved ids are skipped).
- **UI:** "Add problem" button at the top of Home plus a "+" in each topic
  accordion header (pre-selects that topic) opening a small form (title, url,
  difficulty, topics); duplicate 409 shows "Open the existing one". A "Custom"
  badge on custom rows (Home, Notes header). Edit / Delete for custom problems
  on the Notes page.

### D6 — Out of scope

Sharing/exporting custom problems; custom topics (topics stay the 13 of
`TOPIC_ORDER`); bulk import other than CSV unmatched rows; converting a custom
problem into a catalog one (that is a community PR to curriculum, §6.2);
system-design custom problems (no system-design topics yet).

## Consequences

- **Positive:** v1 core gap closed; CSV users stop losing unmatched rows;
  every feature (notes, quiz, guidance, analytics) works on custom problems via
  one merged source, not per-feature branches.
- **Tradeoff:** each problem-aware request now reads `problems/` (≤ 1,000 small
  files); acceptable locally, and a later in-memory cache keyed on the data dir
  is possible without an interface change.
- **Tradeoff:** more mutating surface (3 routes) — mitigated by reusing the
  #58/#60 checks, server-generated ids, strict validation and backups before
  note deletion.
- **Risk:** downgrade hides (never deletes) custom notes — covered by a
  CHANGELOG `### Added` line noting older versions do not show them.

## Roadmap (small serial PRs, each with a `code-review` pass)

| PR | Scope | Depends on |
|---|---|---|
| 1 | Storage types + optional methods + `LocalFileStorageAdapter` (atomic writes, tolerant reads); `u-` invariant test; merged problem source in web; `/api/catalog` merge + `custom` flag; `/api/problems` POST/PATCH/DELETE; known-id check, quiz, guidance, analytics on the merged source; CHANGELOG `### Added` | this ADR accepted |
| 2 | SPA: Add-problem form (Home top + per-topic "+"), Custom badge, edit/delete on Notes; CSV "Add as custom problem" for unmatched rows (preview/commit + `previewHash` extension) | 1 |

## Open questions for the founder

1. Is a custom problem **"links + difficulty only"** right, or do you want a
   free-text prompt/description field (e.g. for problems from a book or an
   interview with no URL)? The ADR says no — your own words go in the note.
2. Should delete be allowed at all when a note exists (confirm + backup, as
   proposed), or should custom problems only be archivable (hidden, never
   deleted)?

Any change to these decisions requires a new ADR.
