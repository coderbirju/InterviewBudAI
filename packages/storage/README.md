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
---

Your intuition notes here...
```

The `attempts` field is omitted when undefined. Content is user-owned and lives
only in the runtime data directory (never committed to the repo).
