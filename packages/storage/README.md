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
```

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
