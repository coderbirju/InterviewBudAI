/**
 * Pure presentation helpers for the Home view. Kept free of React/DOM so they
 * are trivially unit-testable and reused by multiple components.
 *
 * Colors map to the M0 Tailwind design tokens (ADR 0006 D1/D2):
 *   status.done=emerald  status.revisit=amber  status.blocked=red  none=slate
 *   difficulty.easy=green difficulty.medium=amber difficulty.hard=red
 */
import type { CatalogTopic, Difficulty, NoteStatus } from './api';

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
