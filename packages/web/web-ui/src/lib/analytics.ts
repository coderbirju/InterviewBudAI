/**
 * Pure presentation helpers for the M4 Analytics view (ADR 0006). Kept free of
 * React/DOM so the chart geometry (bar widths, counts, layout) is trivially
 * unit-testable and reused by the SVG chart components.
 *
 * The charts are hand-built inline SVG — no external chart library/CDN
 * (charter §6.4 local-first, §7.1 no new heavy deps). These helpers turn the M1
 * API shapes (`ProgressResponse.byStatus`, `CatalogResponse.topics`) into plain
 * numeric geometry; the components only map that geometry to `<rect>`/`<text>`.
 *
 * Colors map to the M0 Tailwind design tokens (ADR 0006 D1/D2):
 *   status.done=emerald  status.revisit=amber  status.blocked=red  none=slate
 */
import type { CatalogResponse, NoteStatus, StatusCounts } from './api';

/** A single status slice ready to render (label + count + fill color + share). */
export interface StatusSlice {
  readonly status: NoteStatus;
  readonly label: string;
  /** Absolute count of problems in this status. */
  readonly count: number;
  /** CSS color for the bar/segment fill (design-system token hex). */
  readonly color: string;
  /** Share of the tracked total in [0, 1]. 0 when the total is 0. */
  readonly fraction: number;
}

/** Design-system status colors (mirror `tailwind.config.cjs` tokens). */
export const STATUS_COLORS: Record<NoteStatus, string> = {
  done: '#22c55e', // status.done — emerald
  to_revisit: '#f59e0b', // status.revisit — amber
  did_not_understand: '#ef4444', // status.blocked — red
  none: '#64748b', // slate-500 — neutral / not started
};

/** Human-readable label for each status in the analytics charts. */
export const STATUS_CHART_LABELS: Record<NoteStatus, string> = {
  done: 'Done',
  to_revisit: 'To revisit',
  did_not_understand: "Didn't understand",
  none: 'Not started',
};

/** Fixed left-to-right order of statuses in the breakdown chart. */
export const STATUS_CHART_ORDER: readonly NoteStatus[] = [
  'done',
  'to_revisit',
  'did_not_understand',
  'none',
];

/** Sum of the four per-status counts. */
export function totalCount(counts: StatusCounts): number {
  return (
    counts.done + counts.to_revisit + counts.did_not_understand + counts.none
  );
}

/**
 * Build the ordered status slices (label + count + color + fraction) from the
 * M1 `byStatus` counts. `fraction` is each count over the tracked total, in
 * [0, 1]; when the total is 0 every fraction is 0 (no divide-by-zero).
 */
export function statusSlices(counts: StatusCounts): readonly StatusSlice[] {
  const total = totalCount(counts);
  return STATUS_CHART_ORDER.map((status) => {
    const count = counts[status];
    return {
      status,
      label: STATUS_CHART_LABELS[status],
      count,
      color: STATUS_COLORS[status],
      fraction: total > 0 ? count / total : 0,
    };
  });
}

/**
 * Scale a value to a bar length against a maximum and a full-scale length.
 * `maxValue <= 0` yields 0 (empty chart). The result is clamped to
 * `[0, axisLength]` so a stray value can never overflow the drawing area.
 */
export function barLength(
  value: number,
  maxValue: number,
  axisLength: number,
): number {
  if (maxValue <= 0 || axisLength <= 0) {
    return 0;
  }
  const raw = (value / maxValue) * axisLength;
  return Math.max(0, Math.min(axisLength, raw));
}

/** Per-topic completion row (done / total + a proportional bar length). */
export interface TopicCompletionBar {
  readonly topic: string;
  /** Display label (curriculum label, else the raw topic id). */
  readonly label: string;
  readonly done: number;
  readonly total: number;
  /** Completion fraction in [0, 1]; 0 when the topic has no problems. */
  readonly fraction: number;
  /** Emerald bar length in SVG user units for a given `axisLength`. */
  readonly length: number;
}

/**
 * Build per-topic completion bars from the catalog. Each topic's `done` counts
 * problems whose status is `done`; the bar length is the completion fraction
 * (done/total) times `axisLength`. Topics with no problems yield fraction 0.
 * Order is preserved from the catalog — the server emits the curriculum's
 * learning order (ADR 0003 amendment 2026-09-26); never re-sort here.
 */
export function topicCompletionBars(
  catalog: CatalogResponse,
  axisLength: number,
): readonly TopicCompletionBar[] {
  return catalog.topics.map((topic) => {
    const total = topic.problems.length;
    const done = topic.problems.filter((p) => p.status === 'done').length;
    const fraction = total > 0 ? done / total : 0;
    return {
      topic: topic.topic,
      label: topic.label ?? topic.topic,
      done,
      total,
      fraction,
      length: barLength(done, total, axisLength),
    };
  });
}

/**
 * Whether the analytics page has any tracked data to visualize. True when a DB
 * is configured AND at least one problem is tracked (total > 0). Used to pick
 * between the charts and the friendly empty state.
 */
export function hasTrackedData(
  dbConfigured: boolean,
  counts: StatusCounts,
): boolean {
  return dbConfigured && totalCount(counts) > 0;
}

/** Percentage (0–100, rounded) for a completed/total fraction. 0 total → 0. */
export function completionPercent(completed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  const pct = (completed / total) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}
