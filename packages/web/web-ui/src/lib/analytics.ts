/**
 * Pure presentation helpers for Analytics v2 (ADR 0012 D3). Kept free of
 * React/DOM so the donut / ring geometry and the label fallbacks are trivially
 * unit-testable; the components only map them to SVG `<circle>`s and text.
 *
 * Hand-built inline SVG — no chart library/CDN (charter §6.4, §7.1).
 *
 * Colors map to the Tailwind design tokens (ADR 0006 D1/D2):
 *   done=emerald  to revisit=amber  didn't understand=red  not started=slate
 */
import type { InsightsStatus, MissCode } from './api';

/** The four donut buckets, keyed like `InsightsStatus`. */
export type StatusKey =
  | 'done'
  | 'toRevisit'
  | 'didNotUnderstand'
  | 'notStarted';

/** Fixed order of the donut segments (and the legend). */
export const STATUS_ORDER: readonly StatusKey[] = [
  'done',
  'toRevisit',
  'didNotUnderstand',
  'notStarted',
];

/** Design-system status colors (mirror `tailwind.config.cjs` tokens). */
export const STATUS_COLORS: Record<StatusKey, string> = {
  done: '#22c55e', // status.done — emerald
  toRevisit: '#f59e0b', // status.revisit — amber
  didNotUnderstand: '#ef4444', // status.blocked — red
  notStarted: '#64748b', // slate-500 — neutral
};

/** Human-readable label per status bucket. */
export const STATUS_LABELS: Record<StatusKey, string> = {
  done: 'Done',
  toRevisit: 'To revisit',
  didNotUnderstand: "Didn't understand",
  notStarted: 'Not started',
};

/** One donut segment: `start` and `length` are fractions of the full circle. */
export interface DonutSegment {
  readonly key: StatusKey;
  readonly label: string;
  readonly color: string;
  readonly count: number;
  /** Where the segment starts, in [0, 1] (clockwise from 12 o'clock). */
  readonly start: number;
  /** Share of the circle in [0, 1]; all 0 when the total is 0. */
  readonly length: number;
}

/** A non-negative finite count (anything else reads as 0). */
function safeCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Donut segments from the status counts. The share is over the sum of the four
 * buckets (not `status.total`), so the lengths always add up to exactly 1 when
 * anything is counted and to 0 when nothing is — never a divide-by-zero.
 */
export function donutSegments(status: InsightsStatus): readonly DonutSegment[] {
  const counts = STATUS_ORDER.map((key) => safeCount(status[key]));
  const sum = counts.reduce((a, b) => a + b, 0);
  let start = 0;
  return STATUS_ORDER.map((key, i) => {
    const count = counts[i] ?? 0;
    const length = sum > 0 ? count / sum : 0;
    const seg = {
      key,
      label: STATUS_LABELS[key],
      color: STATUS_COLORS[key],
      count,
      start,
      length,
    };
    start += length;
    return seg;
  });
}

/** Clamp to [0, 1]; non-finite reads as 0. */
function unit(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/**
 * SVG stroke-dash props for an arc that starts at `start` and covers `length`
 * (both fractions of the circle) on a circle of circumference `c`. Pair with a
 * `-90deg` rotation so 0 sits at 12 o'clock.
 */
export function arcDash(
  start: number,
  length: number,
  c: number,
): { readonly dasharray: string; readonly dashoffset: number } {
  const len = unit(length) * c;
  return { dasharray: `${len} ${c - len}`, dashoffset: -unit(start) * c };
}

/** Completion fraction in [0, 1] for a progress ring; 0 total → 0. */
export function ringFraction(done: number, total: number): number {
  const t = safeCount(total);
  if (t === 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, safeCount(done) / t));
}

/** Screen-reader summary of the donut, e.g. "156 problems: 12 done, …". */
export function donutSummary(status: InsightsStatus): string {
  const parts = donutSegments(status).map(
    (s) => `${s.count} ${s.label.toLowerCase()}`,
  );
  return `${safeCount(status.total)} problems: ${parts.join(', ')}`;
}

/** Client fallback for miss-code labels (mirrors ADR 0012 D1 `MISS_LABELS`). */
export const MISS_LABELS: Record<MissCode, string> = {
  edge: 'Missed edge cases',
  complexity: 'Complexity analysis off',
  brute: 'Stopped at brute force',
  technique: 'Wrong technique',
  vague: 'Incomplete or vague',
  boundary: 'Off-by-one / boundaries',
  misread: 'Misread the problem',
};

/** Label shown for a miss code the client doesn't know and the API didn't label. */
export const UNKNOWN_MISS_LABEL = 'Other slip';

/**
 * Display label for a slip: the API's label when it's a non-empty string, else
 * the client map, else a generic fallback (an unknown code is never shown raw).
 */
export function missLabel(code: string, apiLabel: unknown): string {
  if (typeof apiLabel === 'string' && apiLabel.trim() !== '') {
    return apiLabel;
  }
  return Object.prototype.hasOwnProperty.call(MISS_LABELS, code)
    ? MISS_LABELS[code as MissCode]
    : UNKNOWN_MISS_LABEL;
}
