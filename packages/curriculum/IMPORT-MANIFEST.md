# Import Manifest

Audit record of the curated catalog import from founder's Notion export.

## Summary

- **Total problems imported**: 175
- **Topics covered**: 13 (after the founder-approved re-tag below; 15 at import)
- **Duplicates merged**: 1 at import (lc-209 appeared in arrays-2d and sliding-window; now single-topic `arrays`)
- **Multi-topic problems**: 0
- **Unknown difficulty (skipped)**: 0

## Difficulty Breakdown

- Easy: 38
- Medium: 106
- Hard: 31

## Topic Breakdown

Counts after the re-tag, in learning order (`TOPIC_ORDER`):

| Topic | Count |
|-------|-------|
| arrays | 23 |
| binary-search | 16 |
| sorting | 5 |
| hashing | 8 |
| linked-list | 14 |
| stack | 15 |
| heap | 6 |
| recursion | 2 |
| backtracking | 7 |
| trees | 25 |
| graphs | 20 |
| greedy | 6 |
| dynamic-programming | 28 |

## Topic Re-tag (13-topic taxonomy, PR #69)

Founder-approved change to `topics` only; ids, titles, urls and difficulty are unchanged.

- All 21 `arrays-2d`, `two-pointers` and `sliding-window` problems -> `arrays`
  (lc-209 `arrays-2d, sliding-window` -> `arrays`, de-duplicated).
- recursion -> backtracking: lc-17, lc-39, lc-46, lc-47, lc-77, lc-78
- trees -> backtracking: lc-79
- miscellaneous -> binary-search: lc-4, lc-1351
- miscellaneous -> arrays: lc-31, lc-728
- miscellaneous -> sorting: lc-493
- miscellaneous -> graphs: lc-3532

Kept deliberately: lc-212 (trees, trie), lc-132 (dynamic-programming), lc-36 (hashing).

`scripts/import-catalog.ts` reproduces this re-tag: `scripts/topic-mapping.ts` maps Notion
folders to the 13 topics (Arrays 2D / Two Pointers / Sliding Window -> arrays; `Problems` has no
topic) and `PROBLEM_TOPIC_OVERRIDES` carries the per-id moves above. `src/import-mapping.test.ts`
checks the mapping reproduces all 175 catalog `topics`.

## Merged Duplicates

Problems appearing in multiple topic folders at import (topics merged):

- **lc-209** Minimum Size Subarray Sum: arrays-2d, sliding-window (re-tagged to `arrays`)

## Skipped Items

Items excluded from the catalog with reasons:

### Section Headers (no problem number)

- DP/Knapsack Problems
- DP/LCS Problems
- DP/LIS Problems

### Untitled/Empty Files

- Binary Search/Untitled
- DP - HARD/Untitled (x2)
- DP/Untitled
- Graphs/Untitled
- Greedy/Untitled (x2)
- Linked List/Untitled (x2)
- Problems/Untitled (x7)
- Recursion/Untitled
- Sorting/Untitled
- Trees/Untitled

### Review Markers

- Stack and Queue/^ This Needs another review

### Non-LeetCode / No Number

- Graphs/Directed Graph Cycle
- Graphs/Undirected Graph Cycle
- Greedy/Assign Mice Holes
- Problems/LeetCode Richest Customer Wealth
- Problems/Problem
- Problems/Two Sum (unnumbered dup of lc-1)
- Recursion/Combination Sum III (unnumbered dup of lc-216)
- Sorting/Binary Array Sorting
- Sorting/K Closest Points to Origin (unnumbered dup of lc-973)
- Trees/Binary Tree Zigzag Level Order Traversal (unnumbered dup of lc-103)

---

*This manifest contains identity data only. No notes, intuitions, or answers.*
