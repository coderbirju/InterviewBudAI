# @ibai/storage

Pluggable storage layer for InterviewBudAI progress persistence.

## Overview

This package defines the `StorageAdapter` interface and provides
`LocalFileStorageAdapter` for file-based persistence.

## On-disk Layout

```
${basePath}/
  sessions/${sessionId}.json    -> SessionContext
  summaries/${sessionId}.json   -> SessionSummary
  competency.json               -> CompetencyMap
  weaknesses.json               -> WeaknessRegister
  notes/${problemId}.md         -> IntuitionNote
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
