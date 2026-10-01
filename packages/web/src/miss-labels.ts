/**
 * Display labels for quiz miss codes (ADR 0012 D1). The UI calls them
 * "slips". Generic and fixed: they describe HOW the user slipped, never WHAT
 * the answer is (§6.2). Dependency-free (type-only import) so the SPA can
 * import it too.
 */

import type { MissCode } from '@ibai/storage';

export const MISS_LABELS: Readonly<Record<MissCode, string>> = {
  edge: 'Missed edge cases',
  complexity: 'Complexity analysis off',
  brute: 'Settled for brute force',
  technique: 'Wrong technique',
  vague: 'Incomplete or vague',
  boundary: 'Off-by-one / boundaries',
  misread: 'Misread the problem',
};
