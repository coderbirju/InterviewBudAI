/**
 * Pure competency helpers — side-effect free, no runtime imports.
 *
 * Exposed as the `@ibai/storage/competency` subpath so runtime consumers
 * (notably `@ibai/core`) can use the shared derivation rules without loading
 * the package root, which re-exports the concrete `LocalFileStorageAdapter`.
 * The root index re-exports everything here, so `@ibai/storage` imports keep
 * working.
 */

import type {
  IsoTimestamp,
  MissCode,
  MissTally,
  TopicStrength,
} from './index.js';

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

/** Every {@link MissCode}, in display order (ADR 0012 D1). */
export const MISS_CODES: readonly MissCode[] = [
  'edge',
  'complexity',
  'brute',
  'technique',
  'vague',
  'boundary',
  'misread',
];

const MISS_CODE_SET: ReadonlySet<string> = new Set(MISS_CODES);

/** True when `value` is exactly one of {@link MISS_CODES}. */
export function isMissCode(value: unknown): value is MissCode {
  return typeof value === 'string' && MISS_CODE_SET.has(value);
}

function isCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0
  );
}

/**
 * Keep only valid global miss tallies (known code, positive integer `count`,
 * string `lastSeen`); `undefined` when none survive. Data on disk is
 * untrusted: unknown codes and malformed entries are ignored (ADR 0012 D1).
 */
export function sanitizeMisses(
  value: unknown,
): Partial<Record<MissCode, MissTally>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const out: Partial<Record<MissCode, MissTally>> = {};
  let any = false;
  for (const code of MISS_CODES) {
    const t: unknown = (value as Record<string, unknown>)[code];
    if (typeof t !== 'object' || t === null) continue;
    const { count, lastSeen } = t as Record<string, unknown>;
    if (!isCount(count) || typeof lastSeen !== 'string') continue;
    out[code] = { count, lastSeen: lastSeen as IsoTimestamp };
    any = true;
  }
  return any ? out : undefined;
}

/**
 * Keep only valid per-topic miss counts (known code, positive integer);
 * `undefined` when none survive.
 */
export function sanitizeTopicMisses(
  value: unknown,
): Partial<Record<MissCode, number>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const out: Partial<Record<MissCode, number>> = {};
  let any = false;
  for (const code of MISS_CODES) {
    const n: unknown = (value as Record<string, unknown>)[code];
    if (!isCount(n)) continue;
    out[code] = n;
    any = true;
  }
  return any ? out : undefined;
}
