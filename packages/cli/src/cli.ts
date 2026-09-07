#!/usr/bin/env node
/**
 * @ibai/cli — CLI entry point and composition root.
 *
 * This is the composition root: it reads user config, constructs concrete
 * adapters, injects them into core's assess(), and renders output.
 *
 * NO derivation logic here — all assessment logic stays in @ibai/core.
 */

import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { assess } from '@ibai/core';
import {
  LocalFileStorageAdapter,
  type StorageAdapter,
  type SessionId,
} from '@ibai/storage';
import { resolveDataDir } from './config.js';
import { formatAssessment } from './format.js';

/** Result of running the CLI. */
export interface RunResult {
  readonly output: string;
  readonly exitCode: number;
}

/** Dependencies that can be injected for testing. */
export interface RunDeps {
  readonly storage?: StorageAdapter;
  readonly env?: Record<string, string | undefined>;
  readonly home?: string;
}

const HELP_TEXT = `
ibai - InterviewBudAI CLI

Usage: ibai <command> [options]

Commands:
  assess    Show your current standing (strengths, focus areas, weaknesses)

Options:
  --data-dir <path>   Data directory (default: ~/.ibai/data, or IBAI_DATA_DIR env)
  --session <id>      Session ID for recent session context
  --help              Show this help message

Examples:
  ibai assess
  ibai assess --data-dir /path/to/data
  ibai assess --session my-session-123
`.trim();

const ARGS_CONFIG = {
  strict: false as const,
  allowPositionals: true,
  options: {
    'data-dir': { type: 'string' as const },
    session: { type: 'string' as const },
    help: { type: 'boolean' as const, default: false },
  },
};

/**
 * Main run function — testable entry point.
 *
 * @param argv - Command line arguments (without node and script path)
 * @param deps - Injected dependencies for testing
 * @returns Run result with output and exit code
 */
export async function run(
  argv: string[],
  deps: RunDeps = {},
): Promise<RunResult> {
  try {
    const { values, positionals } = parseArgs({ args: argv, ...ARGS_CONFIG });

    // Handle --help
    if (values.help) {
      return { output: HELP_TEXT, exitCode: 0 };
    }

    const command = positionals[0];

    // No command or unknown command
    if (!command) {
      return {
        output: `Error: No command specified.\n\n${HELP_TEXT}`,
        exitCode: 1,
      };
    }

    if (command !== 'assess') {
      return {
        output: `Error: Unknown command '${command}'.\n\n${HELP_TEXT}`,
        exitCode: 1,
      };
    }

    // Resolve data directory
    const dataDir = resolveDataDir({
      flag: values['data-dir'] as string | undefined,
      env: deps.env?.IBAI_DATA_DIR ?? process.env.IBAI_DATA_DIR,
      home: deps.home ?? homedir(),
    });

    // Use injected storage or create real adapter
    const storage = deps.storage ?? new LocalFileStorageAdapter(dataDir);

    // Get optional session ID
    const sessionId = values.session as SessionId | undefined;

    // Run assess
    const view = await assess(storage, sessionId);

    // Format and return
    return { output: formatAssessment(view), exitCode: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Error: ${message}`, exitCode: 1 };
  }
}

/**
 * Entry point when run as a script.
 */
async function main(): Promise<void> {
  const result = await run(process.argv.slice(2));
  if (result.exitCode === 0) {
    process.stdout.write(result.output + '\n');
  } else {
    process.stderr.write(result.output + '\n');
  }
  process.exitCode = result.exitCode;
}

// Run if this is the main module
const isMain =
  process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('cli.ts');
if (isMain) {
  main().catch((err) => {
    process.stderr.write(
      `Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
