/**
 * @ibai/core — the stateless engine.
 *
 * Responsibilities (see context-files/01-architecture.md): session
 * orchestration and the three jobs — Assess, Plan, Coach. It depends only on
 * the storage and LLM provider *interfaces*, never on a concrete adapter.
 */

/** Package name, exported so front-ends can confirm wiring during scaffold. */
export const PACKAGE_NAME = '@ibai/core';

/** Placeholder marker that the engine module is present and importable. */
export function engineReady(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Assess engine job
// ---------------------------------------------------------------------------

export { assess } from './assess.js';
export type {
  AssessmentView,
  TopicProficiency,
  RecentSessionSummary,
} from './assess.js';

// ---------------------------------------------------------------------------
// Plan engine job
// ---------------------------------------------------------------------------

export { plan } from './plan.js';
export type { SessionPlan, PlanTopic, PlanRole } from './plan.js';
