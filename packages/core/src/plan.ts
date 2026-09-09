/**
 * @ibai/core — Plan engine job.
 *
 * Pure, stateless, synchronous derivation: takes an AssessmentView (produced by
 * assess()) and deterministically chooses the NEXT session's focus from
 * competency gaps.
 *
 * Design decision: plan(view) NOT plan(storage) — avoids duplicate storage
 * reads and duplicate ranking; keeps Plan a pure synchronous derivation.
 * The caller (Coach/orchestrator) already has the view or can call assess() once.
 *
 * Does NOT write, does NOT call an LLM, does NOT maintain cross-session state.
 */

import type { TopicId } from '@ibai/storage';
import type { AssessmentView } from './assess.js';

// ---------------------------------------------------------------------------
// Core-owned output types
// ---------------------------------------------------------------------------

/** The role a topic plays in a session plan. */
export type PlanRole = 'warmup' | 'focus' | 'twist';

/** A single topic entry in the session plan. */
export interface PlanTopic {
  readonly topicId: TopicId;
  readonly role: PlanRole;
  readonly proficiency: number; // from the source view (0 if unknown)
  readonly rationale: string; // MECHANICALLY derived from numbers
}

/** The session plan produced by the Plan engine job. */
export interface SessionPlan {
  readonly topics: readonly PlanTopic[]; // ordered: warmup -> focus... -> twist
  readonly summary: string; // mechanically derived one-liner
}

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

/** Maximum number of 'focus' entries drawn from focusAreas. */
const MAX_FOCUS_TOPICS = 3;

// ---------------------------------------------------------------------------
// Main plan function
// ---------------------------------------------------------------------------

/**
 * Plan the next session's focus based on the user's current standing.
 *
 * Algorithm (deterministic):
 * 1. Warm-up (a strength): if topStrengths.length > 0, take topStrengths[0].
 *    Skip if it also appears as the primary focus (avoid duplicate).
 * 2. Focus topics (gaps): take first up-to-MAX_FOCUS_TOPICS entries of focusAreas.
 * 3. Twist / stretch: pick recurringWeaknesses[0] (most occurrences) whose
 *    topicId is NOT already in the plan; if none qualifies, omit.
 * 4. De-dup by topicId across the whole plan. Precedence: focus > warmup > twist.
 *    A topicId appears at most once; earliest role wins per precedence.
 * 5. Empty/new user: if topicsTracked === 0 and all arrays empty => minimal plan.
 *
 * Ordering of returned topics array: warmup (0 or 1) -> focus (0..MAX_FOCUS_TOPICS) -> twist (0 or 1).
 *
 * @param view - The AssessmentView produced by assess().
 * @returns A SessionPlan with selected topics and mechanical summary.
 */
export function plan(view: AssessmentView): SessionPlan {
  // Handle empty/new user case
  if (
    view.topicsTracked === 0 &&
    view.topStrengths.length === 0 &&
    view.focusAreas.length === 0 &&
    view.recurringWeaknesses.length === 0
  ) {
    return {
      topics: [],
      summary: 'No history yet — start with a broad baseline session.',
    };
  }

  const result: PlanTopic[] = [];
  const usedTopicIds = new Set<TopicId>();

  // Helper to check if a topicId is already used
  const isUsed = (topicId: TopicId): boolean => usedTopicIds.has(topicId);

  // Helper to mark a topicId as used
  const markUsed = (topicId: TopicId): void => {
    usedTopicIds.add(topicId);
  };

  // Helper to find weakness entry for a topic (for rationale enrichment)
  const findWeaknessOccurrences = (topicId: TopicId): number | null => {
    const entry = view.recurringWeaknesses.find((w) => w.topicId === topicId);
    return entry ? entry.occurrences : null;
  };

  // ---------------------------------------------------------------------------
  // Step 2 FIRST: Focus topics (gaps) — these have highest precedence
  // ---------------------------------------------------------------------------
  // Precedence order: focus > warmup > twist
  // We select focus topics first to establish what's in the focus set,
  // then warmup only if not conflicting, then twist only if not conflicting.

  const focusTopics: PlanTopic[] = [];
  for (const entry of view.focusAreas) {
    if (focusTopics.length >= MAX_FOCUS_TOPICS) break;
    if (isUsed(entry.topicId)) continue;

    const pct = Math.round(entry.proficiency * 100);
    const weaknessOccurrences = findWeaknessOccurrences(entry.topicId);
    let rationale = `lowest proficiency (${pct}%)`;
    if (weaknessOccurrences !== null) {
      rationale += ` with ${weaknessOccurrences} recurring miss${weaknessOccurrences === 1 ? '' : 'es'}`;
    }

    focusTopics.push({
      topicId: entry.topicId,
      role: 'focus',
      proficiency: entry.proficiency,
      rationale,
    });
    markUsed(entry.topicId);
  }

  // ---------------------------------------------------------------------------
  // Step 1: Warm-up (a strength)
  // ---------------------------------------------------------------------------
  // Skip if topStrengths[0] is already in focus set

  let warmupTopic: PlanTopic | null = null;
  const strongest = view.topStrengths[0];
  if (strongest !== undefined && !isUsed(strongest.topicId)) {
    const pct = Math.round(strongest.proficiency * 100);
    warmupTopic = {
      topicId: strongest.topicId,
      role: 'warmup',
      proficiency: strongest.proficiency,
      rationale: `strongest area (${pct}%) — warm up here`,
    };
    markUsed(strongest.topicId);
  }

  // ---------------------------------------------------------------------------
  // Step 3: Twist / stretch (recurring weakness not already in plan)
  // ---------------------------------------------------------------------------

  let twistTopic: PlanTopic | null = null;
  for (const weakness of view.recurringWeaknesses) {
    if (!isUsed(weakness.topicId)) {
      // Find proficiency from focusAreas or topStrengths, default to 0
      let proficiency = 0;
      const inFocusAreas = view.focusAreas.find(
        (f) => f.topicId === weakness.topicId,
      );
      const inStrengths = view.topStrengths.find(
        (s) => s.topicId === weakness.topicId,
      );
      if (inFocusAreas) {
        proficiency = inFocusAreas.proficiency;
      } else if (inStrengths) {
        proficiency = inStrengths.proficiency;
      }

      twistTopic = {
        topicId: weakness.topicId,
        role: 'twist',
        proficiency,
        rationale: `recurring weakness: ${weakness.occurrences} miss${weakness.occurrences === 1 ? '' : 'es'} — stretch`,
      };
      markUsed(weakness.topicId);
      break; // Only take the first qualifying weakness
    }
  }

  // ---------------------------------------------------------------------------
  // Step 4: Assemble in order: warmup -> focus -> twist
  // ---------------------------------------------------------------------------

  if (warmupTopic) {
    result.push(warmupTopic);
  }
  result.push(...focusTopics);
  if (twistTopic) {
    result.push(twistTopic);
  }

  // ---------------------------------------------------------------------------
  // Step 5: Build mechanical summary
  // ---------------------------------------------------------------------------

  const summaryParts: string[] = [];

  if (focusTopics.length > 0) {
    summaryParts.push(
      `Focus on ${focusTopics.length} gap topic${focusTopics.length === 1 ? '' : 's'}`,
    );
  }
  if (warmupTopic) {
    summaryParts.push(`warm up on ${warmupTopic.topicId}`);
  }
  if (twistTopic) {
    summaryParts.push(`stretch on ${twistTopic.topicId}`);
  }

  const summary =
    summaryParts.length > 0
      ? summaryParts.join('; ') + '.'
      : 'No topics selected.';

  return {
    topics: result,
    summary,
  };
}
