/**
 * Notion-folder -> topic mapping for the ONE-OFF catalog importer
 * (`import-catalog.ts`). Development only, NOT shipped (outside src/).
 *
 * Pure and side-effect free so it can be tested in isolation against the
 * current catalog (src/import-mapping.test.ts) without the founder's Notion
 * export: running this mapping over each problem's source folder(s) must
 * reproduce the catalog's `topics` exactly (13-topic taxonomy, ADR 0003
 * amendment 2026-09-26; re-tag approved by the founder in PR #69).
 *
 * Identity data only: folder names and problem ids. No notes, intuitions or
 * answers (charter §6.2).
 */

/**
 * Notion export folder name -> topic id (13-topic taxonomy). A folder mapped
 * to `null` has no topic of its own: every problem in it MUST have an entry in
 * {@link PROBLEM_TOPIC_OVERRIDES}, otherwise it is reported and skipped.
 */
export const FOLDER_TOPIC_MAP: Readonly<Record<string, string | null>> = {
  'Arrays 2D': 'arrays',
  'Two Pointers': 'arrays',
  'Sliding Window': 'arrays',
  'Binary Search': 'binary-search',
  Sorting: 'sorting',
  Hashing: 'hashing',
  'Linked List': 'linked-list',
  'Stack and Queue': 'stack',
  Heap: 'heap',
  Recursion: 'recursion',
  Trees: 'trees',
  Graphs: 'graphs',
  Greedy: 'greedy',
  DP: 'dynamic-programming',
  'DP - HARD': 'dynamic-programming',
  // The former `miscellaneous` bucket: retired, no successor topic.
  Problems: null,
};

/**
 * Per-problem topic overrides for moves a folder mapping cannot express
 * (founder-approved re-tag, PR #69). An override REPLACES the folder-derived
 * topics for that problem.
 */
export const PROBLEM_TOPIC_OVERRIDES: Readonly<
  Record<string, readonly string[]>
> = {
  // Recursion folder -> backtracking.
  'lc-17': ['backtracking'],
  'lc-39': ['backtracking'],
  'lc-46': ['backtracking'],
  'lc-47': ['backtracking'],
  'lc-77': ['backtracking'],
  'lc-78': ['backtracking'],
  // Trees folder -> backtracking.
  'lc-79': ['backtracking'],
  // Problems (former miscellaneous) folder -> a real topic.
  'lc-4': ['binary-search'],
  'lc-1351': ['binary-search'],
  'lc-31': ['arrays'],
  'lc-728': ['arrays'],
  'lc-493': ['sorting'],
  'lc-3532': ['graphs'],
};

/** Result of mapping one problem's source folders to topics. */
export type TopicMapping =
  | { readonly ok: true; readonly topics: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: 'unknown-topic-folder' | 'needs-override';
      readonly folder: string;
    };

/**
 * Map a problem (by id) found in one or more Notion folders to its catalog
 * topics: the override if one exists, else each folder's topic, de-duplicated
 * in first-seen order. An unknown folder, or a topic-less folder (`Problems`)
 * without an override, is an error the importer reports.
 */
export function mapTopics(
  problemId: string,
  folders: readonly string[],
): TopicMapping {
  const override = Object.prototype.hasOwnProperty.call(
    PROBLEM_TOPIC_OVERRIDES,
    problemId,
  )
    ? PROBLEM_TOPIC_OVERRIDES[problemId]
    : undefined;
  if (override) return { ok: true, topics: [...override] };
  const topics: string[] = [];
  for (const folder of folders) {
    if (!Object.prototype.hasOwnProperty.call(FOLDER_TOPIC_MAP, folder)) {
      return { ok: false, reason: 'unknown-topic-folder', folder };
    }
    const topic = FOLDER_TOPIC_MAP[folder];
    if (topic === null || topic === undefined) {
      return { ok: false, reason: 'needs-override', folder };
    }
    if (!topics.includes(topic)) topics.push(topic);
  }
  return { ok: true, topics };
}
