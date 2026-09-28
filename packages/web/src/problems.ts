/**
 * The merged problem view (ADR 0010 D4): the shipped catalog plus the active
 * data dir's custom problems, behind the `CurriculumSource` method shape.
 *
 * Every problem-aware route builds one per request (custom problems live in
 * the data dir, which can change) and uses it instead of the bare catalog.
 * The curriculum types are untouched: `ProblemView` is web-local and only
 * relaxes `url` (custom problems may have none).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CurriculumSource,
  CurriculumTopicId,
  Difficulty,
  Problem,
} from '@ibai/curriculum';
import { TOPIC_ORDER, canonicalTopicId } from '@ibai/curriculum';
import type {
  CustomProblem,
  CustomTopicMapper,
  StorageAdapter,
} from '@ibai/storage';
import { isCustomProblemId, parseCustomProblem } from '@ibai/storage';

/** A catalog problem or a custom one (`custom: true`, optional `url`). */
export type ProblemView = Omit<Problem, 'url'> & {
  readonly url?: string;
  readonly custom?: true;
  readonly statement?: string;
};

/** `CurriculumSource`'s method shape over {@link ProblemView}. */
export interface ProblemSource {
  list(): readonly ProblemView[];
  getById(id: string): ProblemView | undefined;
  filterByDifficulty(difficulty: Difficulty): readonly ProblemView[];
  filterByTopic(topic: CurriculumTopicId): readonly ProblemView[];
}

/**
 * The curriculum topic rule for custom problems: canonicalise retired ids
 * (`TOPIC_ALIASES`), then keep only the 13 of `TOPIC_ORDER`. Used on write
 * (unknown ⇒ 400) and on read (unknown ⇒ dropped) alike.
 */
export const curriculumTopic: CustomTopicMapper = (topic) => {
  const id = canonicalTopicId(topic);
  return id !== null && TOPIC_ORDER.includes(id) ? id : null;
};

/**
 * A stored custom problem as a view, re-checked with the curriculum topic
 * rule (storage cannot know the 13 topics). `null` if no topic survives.
 */
export function customProblemView(problem: CustomProblem): ProblemView | null {
  const valid = parseCustomProblem(problem, { topic: curriculumTopic });
  if (valid === null) return null;
  return {
    id: valid.id,
    title: valid.title,
    ...(valid.url !== undefined && { url: valid.url }),
    ...(valid.statement !== undefined && { statement: valid.statement }),
    difficulty: valid.difficulty,
    topics: valid.topics,
    custom: true,
  };
}

/**
 * Merge: catalog first (catalog order), then custom problems in the order
 * given (storage sorts by `createdAt`, `id`). A custom id can never shadow a
 * catalog id (`u-` namespace; the catalog wins anyway).
 */
export function mergeProblemSource(
  catalog: CurriculumSource,
  custom: readonly CustomProblem[],
): ProblemSource {
  const customViews: ProblemView[] = [];
  const seen = new Set<string>();
  for (const problem of custom) {
    const view = customProblemView(problem);
    if (view === null || seen.has(view.id) || catalog.getById(view.id)) {
      continue;
    }
    seen.add(view.id);
    customViews.push(view);
  }
  const all: readonly ProblemView[] = [...catalog.list(), ...customViews];
  const byId = new Map(customViews.map((p) => [p.id, p]));
  return {
    list: () => all,
    getById: (id) => catalog.getById(id) ?? byId.get(id),
    filterByDifficulty: (d) => all.filter((p) => p.difficulty === d),
    filterByTopic: (t) => all.filter((p) => p.topics.includes(t)),
  };
}

/**
 * Build the merged source for one request. No storage (no data dir) or an
 * adapter without custom problems ⇒ catalog only; an unreadable store
 * degrades to catalog only (never throws).
 */
export async function loadProblemSource(
  catalog: CurriculumSource,
  storage: StorageAdapter | null,
): Promise<ProblemSource> {
  let custom: CustomProblem[] = [];
  if (storage?.listCustomProblems) {
    try {
      custom = await storage.listCustomProblems();
    } catch {
      custom = [];
    }
  }
  return mergeProblemSource(catalog, custom);
}

/**
 * Synchronous: does `<dir>/problems/<id>.json` exist and pass the same
 * validation as a read? For the data-dir known-id check (ADR 0010 D4).
 */
export function customProblemFileIsValid(dir: string, id: string): boolean {
  if (!isCustomProblemId(id)) return false;
  try {
    const raw = fs.readFileSync(
      path.join(dir, 'problems', `${id}.json`),
      'utf8',
    );
    return (
      parseCustomProblem(JSON.parse(raw) as unknown, {
        expectedId: id,
        topic: curriculumTopic,
      }) !== null
    );
  } catch {
    return false;
  }
}

/**
 * The known-id check for note counting: a catalog id, or a valid custom
 * problem in the folder being inspected (so every folder is judged by its own
 * custom problems — active dir, `/data` dry runs, legacy candidates).
 */
export function createKnownProblemIdCheck(
  catalog: CurriculumSource,
): (id: string, dir: string) => boolean {
  return (id, dir) =>
    catalog.getById(id) !== undefined || customProblemFileIsValid(dir, id);
}
