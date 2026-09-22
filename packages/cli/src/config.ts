/**
 * Configuration utilities for the CLI.
 *
 * Resolves data directory from CLI flag, environment variable, or default.
 * Pure functions for testability.
 */

import { normalize, join } from 'node:path';

/** Options for resolving the data directory. */
export interface ResolveDataDirOptions {
  /** CLI --data-dir flag value */
  readonly flag?: string;
  /** IBAI_DATA_DIR environment variable value */
  readonly env?: string;
  /** User's home directory (for default path) */
  readonly home?: string;
}

/**
 * Resolves the data directory path.
 *
 * Precedence: CLI flag > env var > default (~/.ibai/data)
 *
 * @param opts - Resolution options
 * @returns Resolved, normalized path
 * @throws Error if resolved value is empty/whitespace
 */
export function resolveDataDir(opts: ResolveDataDirOptions): string {
  const { flag, env, home } = opts;

  // Check flag first (highest precedence)
  if (flag !== undefined) {
    const trimmed = flag.trim();
    if (trimmed === '') {
      throw new Error('--data-dir value cannot be empty');
    }
    return normalize(trimmed);
  }

  // Check env var second
  if (env !== undefined) {
    const trimmed = env.trim();
    if (trimmed === '') {
      throw new Error('IBAI_DATA_DIR environment variable cannot be empty');
    }
    return normalize(trimmed);
  }

  // Default: ~/.ibai/data
  if (home === undefined || home.trim() === '') {
    throw new Error('Cannot determine home directory for default data path');
  }
  return normalize(join(home.trim(), '.ibai', 'data'));
}
