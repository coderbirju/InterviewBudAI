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
| `completed` | boolean (optional) | Whether the problem is marked as complete |
| `timeComplexity` | string (optional) | Time complexity (e.g., "O(n log n)") |
| `spaceComplexity` | string (optional) | Space complexity (e.g., "O(1)") |

All optional fields are omitted from the file when undefined. Complexity values
are quoted in the frontmatter to safely handle special characters.

Content is user-owned and lives only in the runtime data directory (never
committed to the repo).
