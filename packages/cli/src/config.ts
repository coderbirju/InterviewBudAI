/**
 * Configuration utilities for the CLI.
 *
 * Resolves data directory from CLI flag, environment variable, or default.
 * Pure functions for testability.
 */

import { normalize, join } from 'node:path';
import type { TopicOutcome } from '@ibai/core';

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

/**
 * Parse --outcome flag values into TopicOutcome array.
 *
 * Format: topicId:pass|fail[:note]
 * - topicId: the topic identifier
 * - result: must be exactly 'pass' or 'fail'
 * - note: optional, may contain ':' characters
 *
 * @param values - Array of outcome strings from CLI
 * @returns Array of TopicOutcome objects
 * @throws Error if format is invalid
 */
export function parseOutcomes(values: string[] | undefined): TopicOutcome[] {
  if (!values || values.length === 0) {
    return [];
  }

  return values.map((raw) => {
    const parts = raw.split(':');
    if (parts.length < 2) {
      throw new Error(
        `invalid --outcome '${raw}'; expected topicId:pass|fail[:note]`,
      );
    }

    const topicId = parts[0] as string;
    const result = parts[1] as string;

    if (!topicId || topicId.trim() === '') {
      throw new Error(
        `invalid --outcome '${raw}'; expected topicId:pass|fail[:note]`,
      );
    }

    if (result !== 'pass' && result !== 'fail') {
      throw new Error(
        `invalid --outcome '${raw}'; expected topicId:pass|fail[:note]`,
      );
    }

    // Join remaining parts as note (note may contain ':')
    const note = parts.length > 2 ? parts.slice(2).join(':') : undefined;

    return {
      topicId,
      succeeded: result === 'pass',
      ...(note !== undefined && { note }),
    };
  });
}
