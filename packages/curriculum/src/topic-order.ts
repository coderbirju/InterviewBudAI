import type { CurriculumTopicId } from './index.js';

/**
 * The curriculum's topic taxonomy, in learning order. Topic ids, their display
 * order, labels and aliases are part of the curriculum (ADR 0003 amendment,
 * 2026-09-26): every surface that lists topics as sections follows this order.
 * Topics not listed here sort after these, alphabetically.
 */
export const TOPIC_ORDER: readonly CurriculumTopicId[] = [
  'arrays',
  'binary-search',
  'sorting',
  'hashing',
  'linked-list',
  'stack',
  'heap',
  'recursion',
  'backtracking',
  'trees',
  'graphs',
  'greedy',
  'dynamic-programming',
];

/** Human-readable label per topic id. Unknown ids fall back to the raw id. */
export const TOPIC_LABELS: Readonly<Record<CurriculumTopicId, string>> = {
  arrays: 'Arrays',
  'binary-search': 'Binary Search',
  sorting: 'Sorting',
  hashing: 'Hashing',
  'linked-list': 'Linked List',
  stack: 'Stack & Queue',
  heap: 'Heap',
  recursion: 'Recursion',
  backtracking: 'Backtracking',
  trees: 'Trees',
  graphs: 'Graphs',
  greedy: 'Greedy',
  'dynamic-programming': 'Dynamic Programming',
};

/**
 * Retired topic ids → their current id (`null` = retired with no successor;
 * data keyed by it is dropped). Applied at READ time to stored progress keyed
 * by topic id, so existing user data needs no on-disk migration (ADR 0009 D4).
 */
export const TOPIC_ALIASES: Readonly<
  Record<CurriculumTopicId, CurriculumTopicId | null>
> = {
  'arrays-2d': 'arrays',
  'two-pointers': 'arrays',
  'sliding-window': 'arrays',
  miscellaneous: null,
};

/** Resolve a (possibly retired) topic id to its current id; `null` = drop. */
export function canonicalTopicId(
  id: CurriculumTopicId,
): CurriculumTopicId | null {
  return Object.prototype.hasOwnProperty.call(TOPIC_ALIASES, id)
    ? TOPIC_ALIASES[id] ?? null
    : id;
}

/** Display label for a topic id (raw id when unknown). */
export function topicLabel(id: CurriculumTopicId): string {
  return (
    (Object.prototype.hasOwnProperty.call(TOPIC_LABELS, id) &&
      TOPIC_LABELS[id]) ||
    id
  );
}

const RANK = new Map<CurriculumTopicId, number>(
  TOPIC_ORDER.map((id, i) => [id, i]),
);

/** Comparator: curriculum order first, then unknown topics alphabetically. */
export function compareTopics(
  a: CurriculumTopicId,
  b: CurriculumTopicId,
): number {
  const ra = RANK.get(a) ?? TOPIC_ORDER.length;
  const rb = RANK.get(b) ?? TOPIC_ORDER.length;
  if (ra !== rb) return ra - rb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Returns a new array of topic ids in curriculum order (input is not mutated). */
export function sortTopics(
  ids: readonly CurriculumTopicId[],
): CurriculumTopicId[] {
  return [...ids].sort(compareTopics);
}
