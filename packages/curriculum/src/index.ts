/**
 * @ibai/curriculum — the shipped, generic, READ-ONLY problem catalog.
 *
 * Curriculum ships links + difficulty (+ minimal topic tags) ONLY.
 * It NEVER contains answers, solutions, hints, walkthroughs, or intuitions.
 * Users keep their own problems/links/notes in the PROGRESS layer (their
 * private storage target), never here. See ADR 0003.
 */

/** Coarse ordinal difficulty. Ordering: easy < medium < hard. */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Topic/tag reference for minimal categorization. Aligns by CONVENTION with
 * `@ibai/storage`'s `TopicId` (also a string) so progress competency data can
 * cross-reference curriculum topics. Curriculum stays a zero-dependency leaf
 * and deliberately does NOT import from @ibai/storage (no dependency cycle).
 */
export type CurriculumTopicId = string;

/**
 * A single catalog entry. Links + difficulty + minimal tags ONLY.
 * There are intentionally NO fields for answers, solutions, hints, or
 * intuitions — that is an invariant of the curriculum layer (ADR 0003, charter §6.2).
 */
export interface Problem {
  /** Stable, unique id (slug or opaque). Stable across releases so progress can reference it. */
  readonly id: string;
  /** Human-readable problem name. */
  readonly title: string;
  /** External canonical link to the problem. Curriculum never hosts problem content itself. */
  readonly url: string;
  /** Coarse difficulty ranking. */
  readonly difficulty: Difficulty;
  /** Minimal topic tags for categorization/filtering. */
  readonly topics: readonly CurriculumTopicId[];
}

/**
 * Read-only access contract over the catalog. Consumers (front-ends, and
 * optionally the engine via DI) depend on THIS type, never on a concrete
 * dataset or loader — mirroring the storage/provider pattern (ADR 0002).
 * There are no create/update/delete methods: curriculum is improved only via
 * community PRs to the shipped data, never mutated at runtime.
 */
export interface CurriculumSource {
  /** All problems in the catalog. */
  list(): readonly Problem[];
  /** Look up a single problem by its stable id. */
  getById(id: string): Problem | undefined;
  /** All problems at a given difficulty. */
  filterByDifficulty(difficulty: Difficulty): readonly Problem[];
  /** All problems tagged with a given topic. */
  filterByTopic(topic: CurriculumTopicId): readonly Problem[];
}

/**
 * Create a read-only CurriculumSource over a problem list. Pure: no fs,
 * no network, no runtime mutation. Defaults to the shipped CATALOG so
 * front-ends get the real catalog while tests can inject a fixture.
 */
export function createCatalogSource(
  problems: readonly Problem[] = CATALOG,
): CurriculumSource {
  const items: readonly Problem[] = problems;
  return {
    list: () => items,
    getById: (id) => items.find((p) => p.id === id),
    filterByDifficulty: (difficulty) =>
      items.filter((p) => p.difficulty === difficulty),
    filterByTopic: (topic) => items.filter((p) => p.topics.includes(topic)),
  };
}

/**
 * Shipped seed catalog: verified well-known problems with links + difficulty + tags ONLY.
 * NO answers, hints, solutions, descriptions, or intuitions — per ADR 0003 / §6.2.
 */
export const CATALOG: readonly Problem[] = [
  // LeetCode problems (id = lc-<number>)
  {
    id: 'lc-1',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'easy',
    topics: ['arrays-hashing'],
  },
  {
    id: 'lc-217',
    title: 'Contains Duplicate',
    url: 'https://leetcode.com/problems/contains-duplicate/',
    difficulty: 'easy',
    topics: ['arrays-hashing'],
  },
  {
    id: 'lc-242',
    title: 'Valid Anagram',
    url: 'https://leetcode.com/problems/valid-anagram/',
    difficulty: 'easy',
    topics: ['arrays-hashing'],
  },
  {
    id: 'lc-49',
    title: 'Group Anagrams',
    url: 'https://leetcode.com/problems/group-anagrams/',
    difficulty: 'medium',
    topics: ['arrays-hashing'],
  },
  {
    id: 'lc-347',
    title: 'Top K Frequent Elements',
    url: 'https://leetcode.com/problems/top-k-frequent-elements/',
    difficulty: 'medium',
    topics: ['arrays-hashing', 'heap'],
  },
  {
    id: 'lc-125',
    title: 'Valid Palindrome',
    url: 'https://leetcode.com/problems/valid-palindrome/',
    difficulty: 'easy',
    topics: ['two-pointers'],
  },
  {
    id: 'lc-167',
    title: 'Two Sum II - Input Array Is Sorted',
    url: 'https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/',
    difficulty: 'medium',
    topics: ['two-pointers'],
  },
  {
    id: 'lc-15',
    title: '3Sum',
    url: 'https://leetcode.com/problems/3sum/',
    difficulty: 'medium',
    topics: ['two-pointers'],
  },
  {
    id: 'lc-11',
    title: 'Container With Most Water',
    url: 'https://leetcode.com/problems/container-with-most-water/',
    difficulty: 'medium',
    topics: ['two-pointers'],
  },
  {
    id: 'lc-121',
    title: 'Best Time to Buy and Sell Stock',
    url: 'https://leetcode.com/problems/best-time-to-buy-and-sell-stock/',
    difficulty: 'easy',
    topics: ['sliding-window'],
  },
  {
    id: 'lc-3',
    title: 'Longest Substring Without Repeating Characters',
    url: 'https://leetcode.com/problems/longest-substring-without-repeating-characters/',
    difficulty: 'medium',
    topics: ['sliding-window'],
  },
  {
    id: 'lc-424',
    title: 'Longest Repeating Character Replacement',
    url: 'https://leetcode.com/problems/longest-repeating-character-replacement/',
    difficulty: 'medium',
    topics: ['sliding-window'],
  },
  {
    id: 'lc-20',
    title: 'Valid Parentheses',
    url: 'https://leetcode.com/problems/valid-parentheses/',
    difficulty: 'easy',
    topics: ['stack'],
  },
  {
    id: 'lc-155',
    title: 'Min Stack',
    url: 'https://leetcode.com/problems/min-stack/',
    difficulty: 'medium',
    topics: ['stack'],
  },
  {
    id: 'lc-704',
    title: 'Binary Search',
    url: 'https://leetcode.com/problems/binary-search/',
    difficulty: 'easy',
    topics: ['binary-search'],
  },
  {
    id: 'lc-153',
    title: 'Find Minimum in Rotated Sorted Array',
    url: 'https://leetcode.com/problems/find-minimum-in-rotated-sorted-array/',
    difficulty: 'medium',
    topics: ['binary-search'],
  },
  {
    id: 'lc-206',
    title: 'Reverse Linked List',
    url: 'https://leetcode.com/problems/reverse-linked-list/',
    difficulty: 'easy',
    topics: ['linked-list'],
  },
  {
    id: 'lc-21',
    title: 'Merge Two Sorted Lists',
    url: 'https://leetcode.com/problems/merge-two-sorted-lists/',
    difficulty: 'easy',
    topics: ['linked-list'],
  },
  {
    id: 'lc-141',
    title: 'Linked List Cycle',
    url: 'https://leetcode.com/problems/linked-list-cycle/',
    difficulty: 'easy',
    topics: ['linked-list', 'two-pointers'],
  },
  {
    id: 'lc-226',
    title: 'Invert Binary Tree',
    url: 'https://leetcode.com/problems/invert-binary-tree/',
    difficulty: 'easy',
    topics: ['trees'],
  },
  {
    id: 'lc-104',
    title: 'Maximum Depth of Binary Tree',
    url: 'https://leetcode.com/problems/maximum-depth-of-binary-tree/',
    difficulty: 'easy',
    topics: ['trees'],
  },
  {
    id: 'lc-102',
    title: 'Binary Tree Level Order Traversal',
    url: 'https://leetcode.com/problems/binary-tree-level-order-traversal/',
    difficulty: 'medium',
    topics: ['trees', 'graphs-bfs-dfs'],
  },
  {
    id: 'lc-200',
    title: 'Number of Islands',
    url: 'https://leetcode.com/problems/number-of-islands/',
    difficulty: 'medium',
    topics: ['graphs-bfs-dfs'],
  },
  {
    id: 'lc-133',
    title: 'Clone Graph',
    url: 'https://leetcode.com/problems/clone-graph/',
    difficulty: 'medium',
    topics: ['graphs-bfs-dfs'],
  },
  {
    id: 'lc-207',
    title: 'Course Schedule',
    url: 'https://leetcode.com/problems/course-schedule/',
    difficulty: 'medium',
    topics: ['graphs-bfs-dfs'],
  },
  {
    id: 'lc-70',
    title: 'Climbing Stairs',
    url: 'https://leetcode.com/problems/climbing-stairs/',
    difficulty: 'easy',
    topics: ['dynamic-programming'],
  },
  {
    id: 'lc-322',
    title: 'Coin Change',
    url: 'https://leetcode.com/problems/coin-change/',
    difficulty: 'medium',
    topics: ['dynamic-programming'],
  },
  {
    id: 'lc-198',
    title: 'House Robber',
    url: 'https://leetcode.com/problems/house-robber/',
    difficulty: 'medium',
    topics: ['dynamic-programming'],
  },
  {
    id: 'lc-56',
    title: 'Merge Intervals',
    url: 'https://leetcode.com/problems/merge-intervals/',
    difficulty: 'medium',
    topics: ['intervals'],
  },
  {
    id: 'lc-57',
    title: 'Insert Interval',
    url: 'https://leetcode.com/problems/insert-interval/',
    difficulty: 'medium',
    topics: ['intervals'],
  },
  {
    id: 'lc-46',
    title: 'Permutations',
    url: 'https://leetcode.com/problems/permutations/',
    difficulty: 'medium',
    topics: ['backtracking'],
  },
  {
    id: 'lc-78',
    title: 'Subsets',
    url: 'https://leetcode.com/problems/subsets/',
    difficulty: 'medium',
    topics: ['backtracking'],
  },
  {
    id: 'lc-215',
    title: 'Kth Largest Element in an Array',
    url: 'https://leetcode.com/problems/kth-largest-element-in-an-array/',
    difficulty: 'medium',
    topics: ['heap'],
  },
  // System Design problems (id = sysd-<slug>)
  {
    id: 'sysd-url-shortener',
    title: 'Design a URL Shortener',
    url: 'https://github.com/donnemartin/system-design-primer',
    difficulty: 'medium',
    topics: ['system-design-scaling'],
  },
  {
    id: 'sysd-rate-limiter',
    title: 'Design a Rate Limiter',
    url: 'https://github.com/donnemartin/system-design-primer',
    difficulty: 'medium',
    topics: ['system-design-scaling'],
  },
];
