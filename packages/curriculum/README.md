# @ibai/curriculum

The curated, read-only problem catalog for InterviewBudAI.

## Overview

This package provides a **curated set of interview preparation problems** with identity data only:
- Problem ID (e.g., `lc-42`)
- Title
- URL (canonical LeetCode link)
- Difficulty (easy/medium/hard)
- Topic tags

**This package intentionally contains NO:**
- Solutions or answers
- Hints or walkthroughs
- Intuitions or explanations
- User progress data

This constraint is mandated by the project charter (§6.2) to keep the curriculum layer clean and focused on problem identity only. Users keep their own notes and progress in the PROGRESS layer (private, local storage).

## Usage

```typescript
import { CATALOG, createCatalogSource } from '@ibai/curriculum';

// Direct access to the catalog array
console.log(`${CATALOG.length} problems available`);

// Create a source for filtering/lookup
const source = createCatalogSource();

// Get a specific problem
const problem = source.getById('lc-42');

// Filter by difficulty
const hardProblems = source.filterByDifficulty('hard');

// Filter by topic
const dpProblems = source.filterByTopic('dynamic-programming');

// List all
const all = source.list();
```

## API

### Types

```typescript
type Difficulty = 'easy' | 'medium' | 'hard';
type CurriculumTopicId = string;

interface Problem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly difficulty: Difficulty;
  readonly topics: readonly CurriculumTopicId[];
}

interface CurriculumSource {
  list(): readonly Problem[];
  getById(id: string): Problem | undefined;
  filterByDifficulty(difficulty: Difficulty): readonly Problem[];
  filterByTopic(topic: CurriculumTopicId): readonly Problem[];
}
```

### Exports

- `CATALOG` - The curated problem array (readonly)
- `createCatalogSource(catalog?)` - Factory to create a CurriculumSource

## Topics

The catalog includes problems tagged with these 13 topics, listed in learning
order (`TOPIC_ORDER` in `src/topic-order.ts`, labels in `TOPIC_LABELS`):
- `arrays` - Arrays, including 2D arrays, two pointers and sliding window
- `binary-search` - Binary search algorithms
- `sorting` - Sorting algorithms
- `hashing` - Hash-based solutions
- `linked-list` - Linked list problems
- `stack` - Stack and queue problems
- `heap` - Heap/priority queue problems
- `recursion` - Recursive solutions
- `backtracking` - Backtracking (combinations, permutations, subsets, grid search)
- `trees` - Tree and trie problems
- `graphs` - Graph algorithms
- `greedy` - Greedy algorithms
- `dynamic-programming` - DP problems (including hard DP)

Legacy ids `arrays-2d`, `two-pointers` and `sliding-window` are aliases of
`arrays` (`TOPIC_ALIASES`); `miscellaneous` was retired and its problems re-tagged.

## Regenerating the Catalog

The catalog is derived from the founder's curated Notion export. To regenerate:

```bash
npx tsx packages/curriculum/scripts/import-catalog.ts /path/to/notion/export
```

The import script:
- Reads ONLY filenames (never file contents)
- Parses problem numbers and titles
- Maps folders to topic IDs
- Outputs derived catalog data

**Note:** The import script is in `scripts/` (outside `src/`) and is NOT shipped with the library. It's a development-only tool for catalog maintenance.

## See Also

- `IMPORT-MANIFEST.md` - Audit record of imported problems and skipped items
- Project charter §6.2 - Curriculum content rules
- ADR 0003 - Curriculum layer design
