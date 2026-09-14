# @ibai/curriculum

The shipped, generic, **read-only** problem catalog for InterviewBudAI.

## What This Package Contains

A static catalog of well-known interview problems with:

- **Links** to external problem sources (LeetCode, system design resources)
- **Difficulty** ratings (easy, medium, hard)
- **Topic tags** for categorization (arrays-hashing, two-pointers, trees, etc.)

## Product Rule (ADR 0003 / Charter §6.2)

**This catalog contains links + difficulty + minimal topic tags ONLY.**

It intentionally does **NOT** contain:

- Answers or solutions
- Hints or intuitions
- Walkthroughs or explanations
- Problem descriptions (use the external link)

Users keep their own notes, solutions, and progress in the Progress layer (their private storage), never here.

## ID Scheme

| Prefix | Source | Example |
| ------ | ------------- | ------------------- |
| `lc-` | LeetCode | `lc-1` (Two Sum) |
| `sysd-` | System Design | `sysd-url-shortener` |

## Usage

```typescript
import { createCatalogSource, CATALOG } from '@ibai/curriculum';

// Create a source over the shipped catalog (default)
const src = createCatalogSource();

// List all problems
const all = src.list();

// Get a specific problem by ID
const twoSum = src.getById('lc-1');

// Filter by difficulty
const easyProblems = src.filterByDifficulty('easy');

// Filter by topic
const treeProblems = src.filterByTopic('trees');
```

For testing, inject a custom fixture:

```typescript
const testSource = createCatalogSource([
  {
    id: 'test-1',
    title: 'Test Problem',
    url: 'https://example.com/test',
    difficulty: 'easy',
    topics: ['test-topic'],
  },
]);
```

## Adding a Problem (Community PR)

1. Append a `Problem` entry to the `CATALOG` array in `src/index.ts`
2. Follow the ID scheme: `lc-<number>` for LeetCode, `sysd-<slug>` for system design
3. Include only: `id`, `title`, `url`, `difficulty`, `topics`
4. **Do NOT add answers, hints, solutions, or descriptions**
5. Run `npm run verify` from the repo root to validate
6. Submit a PR

## Development

```bash
# From repo root
npm ci
npm run verify
```
