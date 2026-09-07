/**
 * @ibai/cli — thin CLI front-end.
 *
 * Front-ends are thin over the engine: capabilities live in @ibai/core and the
 * CLI exposes them (front-end parity principle). At startup a front-end wires
 * concrete provider/storage adapters into the engine (dependency injection).
 */

export { run, type RunResult, type RunDeps } from './cli.js';
export { formatAssessment } from './format.js';
export { resolveDataDir, type ResolveDataDirOptions } from './config.js';
