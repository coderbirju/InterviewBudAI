/**
 * Pure competency helpers — side-effect free, no runtime imports.
 *
 * Exposed as the `@ibai/storage/competency` subpath so runtime consumers
 * (notably `@ibai/core`) can use the shared derivation rules without loading
 * the package root, which re-exports the concrete `LocalFileStorageAdapter`.
 * The root index re-exports everything here, so `@ibai/storage` imports keep
 * working.
 */

import type { TopicStrength } from './index.js';

/**
 * Derive a {@link TopicStrength} band from correct/incorrect tallies.
 *
 * Rules (deliberately simple and stable):
 *  - fewer than 3 total observations → `'unknown'`.
 *  - correct ratio ≥ 0.75 → `'strong'`.
 *  - correct ratio ≤ 0.40 → `'weak'`.
 *  - otherwise → `'improving'`.
 *
 * Exported so front-ends/Analytics share one derivation rule.
 */
export function deriveTopicStrength(
  correct: number,
  incorrect: number,
): TopicStrength {
  const total = correct + incorrect;
  if (total < 3) {
    return 'unknown';
  }
  const ratio = correct / total;
  if (ratio >= 0.75) {
    return 'strong';
  }
  if (ratio <= 0.4) {
    return 'weak';
  }
  return 'improving';
}
