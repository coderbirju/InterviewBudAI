/**
 * @ibai/core — Assess engine job.
 *
 * Pure/stateless read-and-derive: reads user progress through the injected
 * StorageAdapter and produces a structured "where you stand" view.
 * Does NOT write, does NOT call an LLM, does NOT plan/coach.
 */

import type {
  StorageAdapter,
  CompetencyEntry,
  WeaknessEntry,
  TopicId,
  SessionId,
  IsoTimestamp,
} from '@ibai/storage';

// ---------------------------------------------------------------------------
// Core-owned output types
// ---------------------------------------------------------------------------

/** A ranked competency reference derived from the competency map. */
export interface TopicProficiency {
  readonly topicId: TopicId;
  readonly proficiency: number; // [0,1]
}

/** Light, non-LLM summary of the active session's context. */
export interface RecentSessionSummary {
  readonly sessionId: SessionId;
  readonly turnCount: number;
  readonly lastRole: 'user' | 'assistant' | 'system' | null; // null if no history
  readonly lastTimestamp: IsoTimestamp | null;
}

/** Structured 'where you stand' view produced by Assess. */
export interface AssessmentView {
  /** Total number of topics tracked in the competency map. */
  readonly topicsTracked: number;
  /** Top strengths: highest-proficiency topics, ranked desc. Bounded to top 5. */
  readonly topStrengths: readonly TopicProficiency[];
  /** Focus areas: lowest-proficiency topics, ranked asc. Bounded to top 5. */
  readonly focusAreas: readonly TopicProficiency[];
  /** Recurring weaknesses from the weakness register, ranked by occurrences desc. Bounded to top 10. */
  readonly recurringWeaknesses: readonly WeaknessEntry[];
  /** Light summary of the active session context, or null if no sessionId given / empty. */
  readonly recentSession: RecentSessionSummary | null;
}

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

/** Maximum number of top strengths to return. */
const MAX_STRENGTHS = 5;

/** Maximum number of focus areas to return. */
const MAX_FOCUS_AREAS = 5;

/** Maximum number of recurring weaknesses to return. */
const MAX_WEAKNESSES = 10;

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

/**
 * Comparator for sorting entries by proficiency descending, with topicId ascending tie-break.
 */
function compareProficiencyDesc(
  a: CompetencyEntry,
  b: CompetencyEntry,
): number {
  if (b.proficiency !== a.proficiency) {
    return b.proficiency - a.proficiency;
  }
  return a.topicId.localeCompare(b.topicId);
}

/**
 * Comparator for sorting entries by proficiency ascending, with topicId ascending tie-break.
 */
function compareProficiencyAsc(a: CompetencyEntry, b: CompetencyEntry): number {
  if (a.proficiency !== b.proficiency) {
    return a.proficiency - b.proficiency;
  }
  return a.topicId.localeCompare(b.topicId);
}

/**
 * Comparator for sorting weaknesses by occurrences descending, with topicId ascending tie-break.
 */
function compareWeaknessDesc(a: WeaknessEntry, b: WeaknessEntry): number {
  if (b.occurrences !== a.occurrences) {
    return b.occurrences - a.occurrences;
  }
  return a.topicId.localeCompare(b.topicId);
}

/**
 * Extract TopicProficiency from a CompetencyEntry.
 */
function toTopicProficiency(entry: CompetencyEntry): TopicProficiency {
  return {
    topicId: entry.topicId,
    proficiency: entry.proficiency,
  };
}

// ---------------------------------------------------------------------------
// Main assess function
// ---------------------------------------------------------------------------

/**
 * Assess the user's current standing based on their progress data.
 *
 * @param storage - Injected storage adapter (interface type only).
 * @param sessionId - Optional current/active session ID supplied by the front-end.
 *                    When provided, reads that session's context for the recent-session summary.
 *                    When omitted, the recent-session portion is null.
 * @returns A structured AssessmentView with proficiency rankings and session summary.
 */
export async function assess(
  storage: StorageAdapter,
  sessionId?: SessionId,
): Promise<AssessmentView> {
  // 1. Read competency map and derive strengths/focus areas
  const competencyMap = await storage.readCompetencyMap();
  const entries = Object.values(competencyMap.entries);
  const topicsTracked = entries.length;

  // Copy arrays before sorting to avoid mutating inputs
  const sortedByProficiencyDesc = [...entries].sort(compareProficiencyDesc);
  const sortedByProficiencyAsc = [...entries].sort(compareProficiencyAsc);

  const topStrengths = sortedByProficiencyDesc
    .slice(0, MAX_STRENGTHS)
    .map(toTopicProficiency);

  const focusAreas = sortedByProficiencyAsc
    .slice(0, MAX_FOCUS_AREAS)
    .map(toTopicProficiency);

  // 2. Read weakness register and derive recurring weaknesses
  const register = await storage.readWeaknessRegister();
  const sortedWeaknesses = [...register.entries].sort(compareWeaknessDesc);
  const recurringWeaknesses = sortedWeaknesses.slice(0, MAX_WEAKNESSES);

  // 3. Recent session summary
  let recentSession: RecentSessionSummary | null = null;

  if (sessionId !== undefined) {
    const ctx = await storage.readSessionContext(sessionId);
    const turnCount = ctx.history.length;

    if (turnCount === 0) {
      // Session exists but is empty
      recentSession = {
        sessionId,
        turnCount: 0,
        lastRole: null,
        lastTimestamp: null,
      };
    } else {
      // History is chronologically ordered; last entry is the most recent
      const lastEntry = ctx.history[turnCount - 1];
      if (lastEntry) {
        recentSession = {
          sessionId,
          turnCount,
          lastRole: lastEntry.role,
          lastTimestamp: lastEntry.timestamp,
        };
      }
    }
  }

  return {
    topicsTracked,
    topStrengths,
    focusAreas,
    recurringWeaknesses,
    recentSession,
  };
}
