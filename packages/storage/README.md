# @ibai/storage

Pluggable storage layer for InterviewBudAI progress persistence.

## Overview

This package defines the `StorageAdapter` interface and provides
`LocalFileStorageAdapter` for file-based persistence.

## On-disk Layout

```
${basePath}/
  sessions/${sessionId}.json      -> SessionContext
  summaries/${sessionId}.json     -> SessionSummary
  competency.json                 -> CompetencyMap
  weaknesses.json                 -> WeaknessRegister
  notes/${problemId}.md           -> IntuitionNote
  quiz-sessions/${sessionId}.json -> QuizSession (ADR 0007)
  quiz-sessions/active.json       -> active-session pointer (ADR 0007)
  competency-signals.json         -> CompetencySignals (ADR 0007)
  problems/${id}.json             -> CustomProblem (ADR 0010)
```

## Custom problems (ADR 0010)

User-added problems (progress layer, never shipped or committed), one
pretty-printed JSON file per problem under `problems/` (dir 0700, files 0600):

```json
{
  "id": "u-rotate-the-ring-buffer-k3x9q1",
  "title": "Rotate the ring buffer",
  "url": "https://example.com/ring",
  "statement": "Plain text, the user's own problem statement.",
  "difficulty": "medium",
  "topics": ["arrays"],
  "createdAt": "2026-09-27T12:00:00.000Z",
  "updatedAt": "2026-09-27T12:00:00.000Z"
}
```

Optional `StorageAdapter` methods: `listCustomProblems()` (sorted by
`createdAt`, `id`), `readCustomProblem(id)`, `createCustomProblem(p)`,
`writeCustomProblem(p)`, `deleteCustomProblem(id)`.

- **Ids** `u-<slug>-<rand6>` (`crypto.randomInt`), `^u-[a-z0-9]+(-[a-z0-9]+)*$`,
  ≤ 64 chars: path-safe by construction; anything else is refused / reads
  `null`. No catalog id starts with `u-` (curriculum test).
- **Create never overwrites:** the id is reserved with an exclusive `'wx'`
  open (`EEXIST` ⇒ throws; the caller picks a new id), then the content is
  written to a temp file and renamed over it. `writeCustomProblem` replaces
  an existing file the same atomic way (`ENOENT` if missing).
- **Files are untrusted:** every read applies the write rules
  (`parseCustomProblem`, exported with the field helpers): id regex and
  filename = id, title 1–200 (C0 controls stripped), statement ≤ 2000, `url`
  `http(s)` only ≤ 2048 (a `javascript:` url is dropped), difficulty enum,
  1–3 slug topics, parseable timestamps; unknown fields dropped. An invalid
  required field skips the file (never throws). Topic membership (the 13
  curriculum topics) is applied by the web layer, which passes its topic rule
  to the same parser.

## Intuition Notes

The adapter stores per-problem intuition notes at `${basePath}/notes/<problemId>.md`.

Each file uses YAML-style frontmatter followed by free-text markdown content:

```markdown
---
id: lc-1
lastUpdated: 2026-09-13T10:00:00.000Z
attempts: 3
status: done
completed: true
timeComplexity: "O(n)"
spaceComplexity: "O(1)"
---

Your intuition notes here...
```

### Frontmatter Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Problem ID (e.g., `lc-1`) |
| `lastUpdated` | ISO timestamp | When the note was last saved |
| `attempts` | number (optional) | Number of practice attempts |
| `status` | `NoteStatus` (optional) | Status tag: `none` \| `done` \| `to_revisit` \| `did_not_understand`. **Primary** completion signal. |
| `completed` | boolean (optional) | Legacy completion flag, kept for back-compat |
| `timeComplexity` | string (optional) | Time complexity (e.g., "O(n log n)") |
| `spaceComplexity` | string (optional) | Space complexity (e.g., "O(1)") |

All optional fields are omitted from the file when undefined. Complexity values
are quoted in the frontmatter to safely handle special characters.

### Status vs. completed

`status` (`NoteStatus`) is the primary signal going forward; `completed` is
retained for back-compat with existing completed-based UI. The adapter keeps
them consistent on write — `status: 'done'` ⇔ `completed: true`, any other
status ⇒ `completed: false`. On read it is tolerant:

- A valid `status` value wins.
- A legacy note with `completed: true` and no `status` resolves to
  `status: 'done'`.
- An unknown/malformed `status` value is ignored (reads as `undefined`); the
  adapter never throws on malformed frontmatter.

Content is user-owned and lives only in the runtime data directory (never
committed to the repo).

### Reference approach section (ADR 0013 D4)

`IntuitionNote.referenceApproach?` — the user's OWN write-up of how they solved
the problem (optional, private; grounding for the quiz grader, never shipped)
— is stored as a marked trailing section of the body, not in frontmatter:

```markdown
…the user's note…

<!-- ibai:reference-approach -->
## Reference approach

…the user's reference text…
```

- **One split/join**: `splitReferenceSection` / `joinReferenceSection`
  (exported) are the only code that knows this layout; the adapter's read and
  write use them, and any future Markdown importer must too.
- **Read**: the LAST line equal to the marker after trimming a trailing `\r`
  and spaces/tabs (CRLF-tolerant) splits the body; after it, one leading
  `## Reference approach` heading and surrounding blank lines are dropped.
  `content` never includes the section. No marker ⇒ `referenceApproach` is
  `undefined` and the body reads unchanged (every older note).
- **Write**: the section is written only when the trimmed reference is
  non-empty (an empty marker is also written when `content` itself holds a
  marker line, so that content still round-trips). A marker line inside the
  reference is a `RangeError` (callers validate first).
- **Older builds** show the section, marker included, as part of the body
  text and save it back verbatim — nothing is lost. Additive: no
  `formatVersion` bump.
- **Writers must carry it over**: any code that rebuilds an `IntuitionNote`
  must copy `existing.referenceApproach` (prefer `{ ...existing, … }`), or the
  next write drops it.

## Quiz Master storage (ADR 0007)

The Quickfire Quiz Master persists two additive, PROGRESS-layer datasets
(user-owned, never committed). Both sets of adapter methods are **optional** on
the `StorageAdapter` interface and implemented concretely by
`LocalFileStorageAdapter` with the same path-traversal safety and tolerant
parsing as notes.

### Quiz sessions (resumable)

A `QuizSession` is a shuffled, no-repeat deck of the user's `done`-set problem
IDs with a running transcript and one-shot outcomes:

```jsonc
// quiz-sessions/<sessionId>.json
{
  "sessionId": "quiz-1",
  "createdAt": "2026-09-24T10:00:00.000Z",
  "deck": ["lc-1", "lc-42", "lc-53"],   // shuffled once, no repeats
  "currentIndex": 1,                      // next unanswered problem
  "answered": [{ "problemId": "lc-1", "verdict": "correct", "at": "…" }],
  "transcript": [{ "role": "assistant", "content": "…", "at": "…" }],
  "status": "active"                      // 'active' | 'complete'
}
```

Resumability uses an active-session pointer at `quiz-sessions/active.json`
(`{ "sessionId": "quiz-1" }`). Writing an `active` session updates the pointer;
writing a `complete` session clears it (so a fresh deck is started next).
Completed sessions stay readable by id.

| Method | Behaviour |
|--------|-----------|
| `readActiveQuizSession()` | Returns the active session, or `null` (tolerant: missing/malformed/dangling → `null`). |
| `readQuizSession(id)` | Returns a session by id, or `null`. |
| `writeQuizSession(session)` | Persists the session and maintains the active pointer. |
| `listQuizSessions()` | Summaries of all sessions, newest first, with an `isActive` flag (skips `active.json` and malformed files). |
| `deleteQuizSession(id)` | Deletes a session (idempotent); clears the active pointer if it was active. |

### Competency signals (weak/strong topics + patterns)

`CompetencySignals` is the quiz-derived signal source that feeds Analytics —
per-topic tallies plus recurring miss patterns. It is kept **separate** from the
Coach-owned `CompetencyMap` (normalised proficiency) and `WeaknessRegister`.

```jsonc
// competency-signals.json
{
  "topics": {
    "arrays": { "topicId": "arrays", "correct": 5, "incorrect": 1,
                "lastSeen": "…", "strength": "strong" }
  },
  "patterns": [
    { "id": "off-by-one", "description": "Recurring off-by-one at loop bounds",
      "topics": ["arrays"], "occurrences": 3, "lastObserved": "…" }
  ],
  "lastUpdated": "2026-09-24T10:00:00.000Z"
}
```

`strength` is derived from the tallies via the exported
`deriveTopicStrength(correct, incorrect)` (`< 3` obs → `unknown`; ratio `≥ 0.75`
→ `strong`; `≤ 0.40` → `weak`; else `improving`).

| Method | Behaviour |
|--------|-----------|
| `readCompetencySignals()` | Returns the dataset, or an empty one (tolerant: missing/malformed → empty). |
| `writeCompetencySignals(signals)` | Persists the dataset as human-readable/diffable JSON. |

Every field records the user's OWN outcomes/patterns/intuition references — the
project ships NO canonical answers/solutions (charter §6.2).
