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

The catalog includes problems tagged with these topics:
- `arrays-2d` - 2D array problems
- `binary-search` - Binary search algorithms
- `dynamic-programming` - DP problems (including hard DP)
- `graphs` - Graph algorithms
- `greedy` - Greedy algorithms
- `hashing` - Hash-based solutions
- `heap` - Heap/priority queue problems
- `linked-list` - Linked list problems
- `miscellaneous` - General problems
- `recursion` - Recursive solutions
- `sliding-window` - Sliding window technique
- `sorting` - Sorting algorithms
- `stack` - Stack and queue problems
- `trees` - Tree problems
- `two-pointers` - Two pointer technique

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
