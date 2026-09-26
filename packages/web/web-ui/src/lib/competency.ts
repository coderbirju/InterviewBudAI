/**
 * Pure presentation helpers for the Analytics COMPETENCY section (ADR 0007 Q4).
 *
 * Kept free of React/DOM so the geometry (bar widths, tallies, grouping) is
 * trivially unit-testable and reused by the hand-built inline-SVG competency
 * component — no external chart library/CDN (charter §6.4 local-first, §7.1 no
 * new heavy deps). These helpers turn the `GET /api/competency` shape
 * (`CompetencyResponse`) into plain numeric/label geometry; the component only
 * maps that geometry to `<rect>`/`<text>` and list rows.
 *
 * The design-system status tokens are reused (mirror `analytics.ts`):
 *   weak=red  improving=amber  strong=emerald  unknown=slate
 */
import type { CompetencyResponse, CompetencyTopic, TopicStrength } from './api';
import { barLength } from './analytics';

/** Design-system colors per strength band (mirror `STATUS_COLORS`). */
export const STRENGTH_COLORS: Record<TopicStrength, string> = {
  strong: '#22c55e', // emerald — status.done
  improving: '#f59e0b', // amber — status.revisit
  weak: '#ef4444', // red — status.blocked
  unknown: '#64748b', // slate-500 — too little data
};

/** Human-readable label per strength band. */
export const STRENGTH_LABELS: Record<TopicStrength, string> = {
  strong: 'Strong',
  improving: 'Improving',
  weak: 'Weak',
  unknown: 'Not enough data',
};

/**
 * A per-topic competency bar ready to render: the raw tallies, the derived
 * strength band + its color/label, the total attempts, the correct-ratio
 * fraction in [0, 1], and a proportional bar length (correct out of total)
 * scaled to `axisLength`.
 */
export interface CompetencyBar {
  readonly topicId: string;
  /** Topic display label (curriculum label, else the raw topic id). */
  readonly topicLabel: string;
  readonly correct: number;
  readonly incorrect: number;
  readonly total: number;
  readonly strength: TopicStrength;
  readonly color: string;
  readonly label: string;
  /** Correct ratio in [0, 1]; 0 when there are no attempts. */
  readonly fraction: number;
  /** Bar length in SVG user units (correct out of total) for `axisLength`. */
  readonly length: number;
}

/**
 * Build per-topic competency bars from the `GET /api/competency` topics.
 *
 * The bar length encodes the correct ratio (correct / total) so a longer bar
 * means stronger; the fill color encodes the derived strength band. Order is
 * PRESERVED from the response (the server already sorts weak→strong then by
 * most misses), so the list reads worst-first and stays scannable. A topic
 * with no attempts yields fraction 0 and length 0.
 */
export function competencyBars(
  topics: readonly CompetencyTopic[],
  axisLength: number,
): readonly CompetencyBar[] {
  return topics.map((t) => {
    const total = t.correct + t.incorrect;
    const fraction = total > 0 ? t.correct / total : 0;
    return {
      topicId: t.topicId,
      topicLabel: t.label ?? t.topicId,
      correct: t.correct,
      incorrect: t.incorrect,
      total,
      strength: t.strength,
      color: STRENGTH_COLORS[t.strength],
      label: STRENGTH_LABELS[t.strength],
      fraction,
      length: barLength(t.correct, total, axisLength),
    };
  });
}

/** The topics grouped into weak / improving / strong / unknown buckets. */
export interface CompetencyGroups {
  readonly weak: readonly CompetencyTopic[];
  readonly improving: readonly CompetencyTopic[];
  readonly strong: readonly CompetencyTopic[];
  readonly unknown: readonly CompetencyTopic[];
}

/**
 * Group topics by their derived strength band, preserving the response order
 * within each bucket. Lets the UI show explicit "Weak topics" / "Strong topics"
 * lists side by side.
 */
export function groupByStrength(
  topics: readonly CompetencyTopic[],
): CompetencyGroups {
  const groups: {
    weak: CompetencyTopic[];
    improving: CompetencyTopic[];
    strong: CompetencyTopic[];
    unknown: CompetencyTopic[];
  } = { weak: [], improving: [], strong: [], unknown: [] };
  for (const topic of topics) {
    groups[topic.strength].push(topic);
  }
  return groups;
}

/**
 * Whether the competency section has anything to visualize: at least one topic
 * tally OR one recurring pattern. Used to pick between the charts and the
 * friendly "take a quiz session" empty state.
 */
export function hasCompetencyData(data: CompetencyResponse): boolean {
  return data.topics.length > 0 || data.patterns.length > 0;
}
