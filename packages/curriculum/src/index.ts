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

// Re-export the curated catalog from catalog.ts
export { CATALOG } from './catalog.js';

import { CATALOG } from './catalog.js';

/**
 * Factory function to create a CurriculumSource implementation.
 * Provides read-only access to the problem catalog with filtering capabilities.
 *
 * @param catalog - Optional custom catalog array. Defaults to the shipped CATALOG.
 * @returns A CurriculumSource implementation over the provided catalog.
 */
export function createCatalogSource(
  catalog: readonly Problem[] = CATALOG,
): CurriculumSource {
  // Build lookup maps for efficient access
  const byId = new Map<string, Problem>();
  const byDifficulty = new Map<Difficulty, Problem[]>();
  const byTopic = new Map<string, Problem[]>();

  for (const problem of catalog) {
    byId.set(problem.id, problem);

    const diffList = byDifficulty.get(problem.difficulty) ?? [];
    diffList.push(problem);
    byDifficulty.set(problem.difficulty, diffList);

    for (const topic of problem.topics) {
      const topicList = byTopic.get(topic) ?? [];
      topicList.push(problem);
      byTopic.set(topic, topicList);
    }
  }

  return {
    list: () => catalog,
    getById: (id: string) => byId.get(id),
    filterByDifficulty: (difficulty: Difficulty) =>
      byDifficulty.get(difficulty) ?? [],
    filterByTopic: (topic: CurriculumTopicId) => byTopic.get(topic) ?? [],
  };
}

export {
  TOPIC_ORDER,
  TOPIC_LABELS,
  TOPIC_ALIASES,
  canonicalTopicId,
  topicLabel,
  compareTopics,
  sortTopics,
} from './topic-order.js';
