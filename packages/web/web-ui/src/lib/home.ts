/**
 * Pure presentation helpers for the Home view. Kept free of React/DOM so they
 * are trivially unit-testable and reused by multiple components.
 *
 * Colors map to the M0 Tailwind design tokens (ADR 0006 D1/D2):
 *   status.done=emerald  status.revisit=amber  status.blocked=red  none=slate
 *   difficulty.easy=green difficulty.medium=amber difficulty.hard=red
 */
import type {
  CatalogProblem,
  CatalogTopic,
  Difficulty,
  NoteStatus,
} from './api';

/** Human-readable label for each of the four note statuses. */
export const STATUS_LABELS: Record<NoteStatus, string> = {
  none: 'Not started',
  done: 'Done',
  to_revisit: 'To revisit',
  did_not_understand: "Didn't understand",
};

/** The status values a user can pick, in the cycle/menu order. */
export const STATUS_ORDER: readonly NoteStatus[] = [
  'none',
  'done',
  'to_revisit',
  'did_not_understand',
];

/**
 * Tailwind classes for a status pill/dot. Uses the M0 theme tokens so colors
 * stay consistent with the rest of the app. `none` is neutral slate.
 */
export function statusPillClasses(status: NoteStatus): string {
  switch (status) {
    case 'done':
      return 'bg-status-done/15 text-status-done';
    case 'to_revisit':
      return 'bg-status-revisit/15 text-status-revisit';
    case 'did_not_understand':
      return 'bg-status-blocked/15 text-status-blocked';
    case 'none':
    default:
      return 'bg-slate-700/40 text-slate-300';
  }
}

/** Tailwind text color for a small status dot indicator. */
export function statusDotClasses(status: NoteStatus): string {
  switch (status) {
    case 'done':
      return 'bg-status-done';
    case 'to_revisit':
      return 'bg-status-revisit';
    case 'did_not_understand':
      return 'bg-status-blocked';
    case 'none':
    default:
      return 'bg-slate-500';
  }
}

/** Tailwind classes for a difficulty badge (strict Easy/Medium/Hard colors). */
export function difficultyBadgeClasses(difficulty: Difficulty): string {
  switch (difficulty) {
    case 'Easy':
      return 'bg-difficulty-easy/15 text-difficulty-easy';
    case 'Medium':
      return 'bg-difficulty-medium/15 text-difficulty-medium';
    case 'Hard':
      return 'bg-difficulty-hard/15 text-difficulty-hard';
    default:
      return 'bg-slate-700/40 text-slate-300';
  }
}

/** Format a completed/total fraction as e.g. "12 / 175". */
export function formatFraction(completed: number, total: number): string {
  return `${completed} / ${total}`;
}

/** Percentage (0–100, clamped) for a progress bar width. 0 total → 0%. */
export function percent(completed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  const pct = (completed / total) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** How many problems in a topic are `done`, and the topic size. */
export function topicCompletion(topic: CatalogTopic): {
  done: number;
  total: number;
} {
  const total = topic.problems.length;
  const done = topic.problems.filter((p) => p.status === 'done').length;
  return { done, total };
}

// ---------------------------------------------------------------------------
// Catalog search + filter (W3). Pure: no React/DOM, so it is unit-tested and
// the Home view only wires state → these helpers → rendering.
// ---------------------------------------------------------------------------

/** The difficulties a user can filter by, in display order. */
export const DIFFICULTY_ORDER: readonly Difficulty[] = [
  'Easy',
  'Medium',
  'Hard',
];

/**
 * The Home catalog filter. Empty arrays mean "no constraint" for that facet;
 * multiple selected values within a facet are OR-ed, facets are AND-ed.
 */
export interface CatalogFilter {
  /** Free-text search: case-insensitive substring of the title or the id. */
  readonly query: string;
  readonly difficulties: readonly Difficulty[];
  readonly statuses: readonly NoteStatus[];
}

/** No search, no chips selected — the unfiltered catalog. */
export const EMPTY_FILTER: CatalogFilter = {
  query: '',
  difficulties: [],
  statuses: [],
};

/** True when any search text or chip is active. Whitespace-only is inactive. */
export function isFilterActive(filter: CatalogFilter): boolean {
  return (
    filter.query.trim().length > 0 ||
    filter.difficulties.length > 0 ||
    filter.statuses.length > 0
  );
}

/** Does a single problem satisfy the filter? */
export function matchesFilter(
  problem: CatalogProblem,
  filter: CatalogFilter,
): boolean {
  const q = filter.query.trim().toLowerCase();
  if (
    q.length > 0 &&
    !problem.title.toLowerCase().includes(q) &&
    !problem.id.toLowerCase().includes(q)
  ) {
    return false;
  }
  if (
    filter.difficulties.length > 0 &&
    !filter.difficulties.includes(problem.difficulty)
  ) {
    return false;
  }
  if (filter.statuses.length > 0 && !filter.statuses.includes(problem.status)) {
    return false;
  }
  return true;
}

/** One topic after filtering: the original topic plus its matching problems. */
export interface FilteredTopic {
  readonly topic: CatalogTopic;
  readonly matches: readonly CatalogProblem[];
}

/** The result of filtering a whole catalog. */
export interface FilteredCatalog {
  /** Topics with at least one match (all topics when the filter is inactive). */
  readonly topics: readonly FilteredTopic[];
  /** Distinct matching problems (a problem may sit under several topics). */
  readonly matched: number;
}

/**
 * Filter a catalog's topics. Topics with no matches are dropped; problem order
 * within a topic is preserved. `matched` counts distinct problem ids so a
 * problem listed under two topics is counted once (matching the API's
 * de-duplicated `totals.total`).
 *
 * `pinned` ids stay visible even if they no longer match: Home pins a row
 * whose status the user just changed under an active filter, so it doesn't
 * vanish (taking keyboard focus with it) until the filter itself changes.
 * Pinned rows count toward `matched`, so the count always equals what's shown.
 */
export function filterCatalog(
  topics: readonly CatalogTopic[],
  filter: CatalogFilter,
  pinned: ReadonlySet<string> = new Set(),
): FilteredCatalog {
  const ids = new Set<string>();
  const out: FilteredTopic[] = [];
  for (const topic of topics) {
    const matches = topic.problems.filter(
      (p) => pinned.has(p.id) || matchesFilter(p, filter),
    );
    for (const p of matches) {
      ids.add(p.id);
    }
    if (matches.length > 0) {
      out.push({ topic, matches });
    }
  }
  return { topics: out, matched: ids.size };
}

/** Toggle a value in a facet list, keeping the canonical `order`. */
export function toggleValue<T>(
  values: readonly T[],
  value: T,
  order: readonly T[],
): T[] {
  const next = values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
  return order.filter((v) => next.includes(v));
}

/** URL query-param keys used to persist the filter. */
const PARAM_QUERY = 'q';
const PARAM_DIFFICULTY = 'difficulty';
const PARAM_STATUS = 'status';

function parseList<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): T[] {
  if (!raw) {
    return [];
  }
  const parts = raw.split(',').map((s) => s.trim().toLowerCase());
  // Case-insensitive (hand-edited `difficulty=easy` works); unknown values are
  // dropped; canonical order, no duplicates.
  return allowed.filter((v) => parts.includes(v.toLowerCase()));
}

/**
 * Read a filter from a URL search string (e.g. `?q=sum&difficulty=Easy,Hard
 * &status=to_revisit`). Unknown values are ignored so a hand-edited or stale
 * URL degrades to "fewer constraints" instead of an error.
 */
export function filterFromSearch(search: string): CatalogFilter {
  const params = new URLSearchParams(search);
  return {
    query: params.get(PARAM_QUERY) ?? '',
    difficulties: parseList(params.get(PARAM_DIFFICULTY), DIFFICULTY_ORDER),
    statuses: parseList(params.get(PARAM_STATUS), STATUS_ORDER),
  };
}

/**
 * Write a filter into a URL search string, preserving any unrelated params.
 * Empty facets are removed so an unfiltered Home has a clean `/` URL. Returns
 * `''` or a string starting with `?`.
 */
export function searchWithFilter(
  currentSearch: string,
  filter: CatalogFilter,
): string {
  const params = new URLSearchParams(currentSearch);
  const setOrDelete = (key: string, value: string): void => {
    if (value.length > 0) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  };
  setOrDelete(PARAM_QUERY, filter.query.trim().length > 0 ? filter.query : '');
  setOrDelete(PARAM_DIFFICULTY, filter.difficulties.join(','));
  setOrDelete(PARAM_STATUS, filter.statuses.join(','));
  // Commas are valid in a query string; keep list values readable
  // (`difficulty=Easy,Hard`, not `Easy%2CHard`). Parsing decodes either form.
  const out = params.toString().replace(/%2C/gi, ',');
  return out.length > 0 ? `?${out}` : '';
}
