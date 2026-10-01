/**
 * Strength-band presentation shared by Analytics (Focus next) and the Home
 * guidance card, so both show the same color + label for a band.
 *
 * The design-system status tokens are reused (mirror `analytics.ts`):
 *   weak=red  improving=amber  strong=emerald  unknown=slate
 */
import type { TopicStrength } from './api';

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
