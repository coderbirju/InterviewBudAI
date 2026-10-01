/**
 * Analytics v2 insights (ADR 0012 D3) — the PURE builder behind the
 * read-only `GET /api/insights`. The HTTP layer (`api.ts`) does the reads
 * (note statuses, competency signals, session list) and passes them in.
 *
 * Every `reason` and `label` is built from counts and fixed labels only — no
 * hints, no solutions (§6.2).
 */

import type {
  CompetencySignals,
  IsoTimestamp,
  MissCode,
  NoteStatus,
  TopicId,
  TopicStrength,
} from '@ibai/storage';
import { MISS_CODES } from '@ibai/storage';
import { TOPIC_ORDER, compareTopics, topicLabel } from '@ibai/curriculum';
import { deriveGuidance } from '@ibai/core';
import type { GuidanceNote, TopicStanding } from '@ibai/core';
import type { ProblemView } from './problems.js';
import { MISS_LABELS } from './miss-labels.js';

/** Counted quiz sessions needed before insights unlock (ADR 0012 D3). */
export const INSIGHTS_UNLOCK_SESSIONS = 2;
/** At most this many "Focus next" topics. */
export const INSIGHTS_MAX_FOCUS = 3;
/** At most this many slip codes. */
export const INSIGHTS_MAX_SLIPS = 3;
/** At most this many topics per slip. */
export const INSIGHTS_MAX_SLIP_TOPICS = 3;
/** At most this many strengths. */
export const INSIGHTS_MAX_STRENGTHS = 5;

/** `no_db`: no data folder; `locked`: < 2 counted sessions; else `unlocked`. */
export type InsightsState = 'no_db' | 'locked' | 'unlocked';

/** GET /api/insights response shape (ADR 0012 D3 — exact). */
export interface ApiInsightsResponse {
  readonly state: InsightsState;
  readonly generatedAt: IsoTimestamp;
  readonly sessions: { readonly counted: number; readonly required: number };
  readonly status: {
    readonly done: number;
    readonly toRevisit: number;
    readonly didNotUnderstand: number;
    readonly notStarted: number;
    readonly total: number;
  };
  /** Always the 13 topics, in `TOPIC_ORDER`. */
  readonly topics: readonly ApiInsightsTopic[];
  readonly focus: readonly ApiInsightsFocus[];
  readonly slips: readonly ApiInsightsSlip[];
  readonly strengths: readonly ApiInsightsStrength[];
}

export interface ApiInsightsTopic {
  readonly topicId: TopicId;
  readonly label: string;
  readonly done: number;
  /** Catalog + custom problems tagged with this topic. */
  readonly total: number;
}

export interface ApiInsightsFocus {
  readonly topicId: TopicId;
  readonly label: string;
  readonly band: TopicStrength;
  /** Counts only, e.g. "4 of 6 quiz answers missed · 2 to revisit". */
  readonly reason: string;
}

export interface ApiInsightsSlip {
  readonly code: MissCode;
  readonly label: string;
  readonly count: number;
  readonly lastSeen: IsoTimestamp;
  readonly topics: readonly {
    readonly topicId: TopicId;
    readonly label: string;
    readonly count: number;
  }[];
}

export interface ApiInsightsStrength {
  readonly topicId: TopicId;
  readonly label: string;
  readonly correct: number;
  readonly incorrect: number;
}

/** Inputs for {@link buildInsights} (all already read by the caller). */
export interface InsightsInput {
  /** Catalog + custom problems; `null` when there is no data folder. */
  readonly problems: readonly ProblemView[] | null;
  /** Saved notes (status + lastUpdated), one per problem with a note. */
  readonly notes: readonly GuidanceNote[];
  /**
   * Competency signals, already canonicalised (aliases folded); `null` when
   * missing or malformed — `focus`/`slips`/`strengths` are then empty.
   */
  readonly signals: CompetencySignals | null;
  /** Quiz sessions with ≥ 1 terminal answer. */
  readonly countedSessions: number;
  readonly now: IsoTimestamp;
}

/** Build the insights payload. Pure and deterministic. */
export function buildInsights(input: InsightsInput): ApiInsightsResponse {
  const { problems, now } = input;
  const statusById = new Map<string, NoteStatus>();
  for (const n of input.notes) statusById.set(n.problemId, n.status);
  const statusOf = (id: string): NoteStatus => statusById.get(id) ?? 'none';

  const list = problems ?? [];
  const status = {
    done: 0,
    toRevisit: 0,
    didNotUnderstand: 0,
    notStarted: 0,
    total: list.length,
  };
  for (const p of list) {
    const s = statusOf(p.id);
    if (s === 'done') status.done++;
    else if (s === 'to_revisit') status.toRevisit++;
    else if (s === 'did_not_understand') status.didNotUnderstand++;
    else status.notStarted++;
  }

  const topics: ApiInsightsTopic[] = TOPIC_ORDER.map((topicId) => {
    let done = 0;
    let total = 0;
    for (const p of list) {
      if (!p.topics.includes(topicId)) continue;
      total++;
      if (statusOf(p.id) === 'done') done++;
    }
    return { topicId, label: topicLabel(topicId), done, total };
  });

  const counted = Math.max(0, Math.floor(input.countedSessions));
  const state: InsightsState =
    problems === null
      ? 'no_db'
      : counted >= INSIGHTS_UNLOCK_SESSIONS
        ? 'unlocked'
        : 'locked';
  const base = {
    state,
    generatedAt: now,
    sessions: {
      counted: state === 'no_db' ? 0 : counted,
      required: INSIGHTS_UNLOCK_SESSIONS,
    },
    status,
    topics,
  };
  if (state !== 'unlocked' || input.signals === null) {
    return { ...base, focus: [], slips: [], strengths: [] };
  }

  const { standing } = deriveGuidance({
    problems: list,
    notes: input.notes,
    signals: input.signals,
    now,
    topicLabel,
  });
  const focusStanding = standing
    .filter((s) => s.band === 'weak' || s.needsReview)
    .slice(0, INSIGHTS_MAX_FOCUS);
  const focusIds = new Set(focusStanding.map((s) => s.topicId));
  const focus: ApiInsightsFocus[] = focusStanding.map((s) => ({
    topicId: s.topicId,
    label: topicLabel(s.topicId),
    band: s.band,
    reason: focusReason(s),
  }));

  const strengths: ApiInsightsStrength[] = standing
    .filter((s) => s.band === 'strong' && !focusIds.has(s.topicId))
    .sort(
      (a, b) =>
        b.quiz.correct - a.quiz.correct ||
        a.quiz.incorrect - b.quiz.incorrect ||
        compareTopics(a.topicId, b.topicId),
    )
    .slice(0, INSIGHTS_MAX_STRENGTHS)
    .map((s) => ({
      topicId: s.topicId,
      label: topicLabel(s.topicId),
      correct: s.quiz.correct,
      incorrect: s.quiz.incorrect,
    }));

  return { ...base, focus, slips: buildSlips(input.signals), strengths };
}

/** "4 of 6 quiz answers missed · 2 to revisit · 1 not understood". */
function focusReason(s: TopicStanding): string {
  const parts: string[] = [];
  const answered = s.quiz.correct + s.quiz.incorrect;
  if (answered > 0) {
    parts.push(`${s.quiz.incorrect} of ${answered} quiz answers missed`);
  }
  if (s.notes.toRevisit > 0) parts.push(`${s.notes.toRevisit} to revisit`);
  if (s.notes.didNotUnderstand > 0) {
    parts.push(`${s.notes.didNotUnderstand} not understood`);
  }
  return parts.join(' · ');
}

/** Top slip codes by count, then latest, then enum order. */
function buildSlips(signals: CompetencySignals): ApiInsightsSlip[] {
  const tallies = signals.misses ?? {};
  const ranked = MISS_CODES.flatMap((code) => {
    const t = tallies[code];
    return t ? [{ code, count: t.count, lastSeen: t.lastSeen }] : [];
  }).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    const ma = Date.parse(a.lastSeen);
    const mb = Date.parse(b.lastSeen);
    const va = Number.isNaN(ma) ? -Infinity : ma;
    const vb = Number.isNaN(mb) ? -Infinity : mb;
    return vb > va ? 1 : vb < va ? -1 : 0;
  });
  return ranked
    .slice(0, INSIGHTS_MAX_SLIPS)
    .map(({ code, count, lastSeen }) => {
      const byTopic = Object.values(signals.topics)
        .map((t) => ({ topicId: t.topicId, count: t.misses?.[code] ?? 0 }))
        .filter((t) => t.count > 0)
        .sort(
          (a, b) => b.count - a.count || compareTopics(a.topicId, b.topicId),
        )
        .slice(0, INSIGHTS_MAX_SLIP_TOPICS)
        .map((t) => ({
          topicId: t.topicId,
          label: topicLabel(t.topicId),
          count: t.count,
        }));
      return {
        code,
        label: MISS_LABELS[code],
        count,
        lastSeen,
        topics: byTopic,
      };
    });
}
