/**
 * @ibai/cli public API.
 *
 * Exports types and the run function for programmatic use/testing.
 */

export { run } from './cli.js';
export type { RunResult, RunDeps } from './cli.js';

export { resolveDataDir } from './config.js';
export type { ResolveDataDirOptions } from './config.js';

export { formatAssessment, formatPlan, formatCoach } from './format.js';
