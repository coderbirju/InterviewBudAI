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
import { assess, plan, coach } from '@ibai/core';
import type { CoachInput, TopicAnswer } from '@ibai/core';
import {
  LocalFileStorageAdapter,
  type StorageAdapter,
  type SessionId,
  type IsoTimestamp,
} from '@ibai/storage';
import {
  AnthropicProvider,
  OllamaProvider,
  type LlmProvider,
} from '@ibai/providers';
import { resolveDataDir } from './config.js';
import { formatAssessment, formatPlan, formatCoach } from './format.js';

/** Result of running the CLI. */
export interface RunResult {
  readonly output: string;
  readonly exitCode: number;
}

/** Dependencies that can be injected for testing. */
export interface RunDeps {
  readonly storage?: StorageAdapter;
  readonly provider?: LlmProvider;
  readonly env?: Record<string, string | undefined>;
  readonly home?: string;
}

const HELP_TEXT = `
ibai - InterviewBudAI CLI

Usage: ibai <command> [options]

Commands:
  assess    Show your current standing (strengths, focus areas, weaknesses)
  plan      Show your recommended next session plan
  coach     Run a coaching session with AI-powered feedback

Options:
  --data-dir <path>   Data directory (default: ~/.ibai/data, or IBAI_DATA_DIR env)
  --session <id>      Session ID for recent session context
  --ollama-url <url>  Ollama endpoint (default: http://127.0.0.1:11434, or IBAI_OLLAMA_URL env)
  --model <name>      Ollama model name (or IBAI_OLLAMA_MODEL env)
  --provider <name>   Provider: 'anthropic' or 'ollama' (default: auto-detect from env)
  --answer <text>     Answer text for single-topic quick coach (repeatable for multi-topic)
  --help              Show this help message

Environment variables:
  IBAI_ANTHROPIC_API_KEY  Anthropic API key (or ANTHROPIC_API_KEY)
  IBAI_ANTHROPIC_MODEL    Anthropic model name (e.g., claude-sonnet-4-20250514)
  IBAI_OLLAMA_MODEL       Ollama model name (e.g., llama3)
  IBAI_OLLAMA_URL         Ollama endpoint URL

Examples:
  ibai assess
  ibai assess --data-dir /path/to/data
  ibai assess --session my-session-123
  ibai plan
  ibai coach --model llama3 --answer "I would use a hash map"
`.trim();

const ARGS_CONFIG = {
  strict: false as const,
  allowPositionals: true,
  options: {
    'data-dir': { type: 'string' as const },
    session: { type: 'string' as const },
    'ollama-url': { type: 'string' as const },
    model: { type: 'string' as const },
    provider: { type: 'string' as const },
    answer: { type: 'string' as const, multiple: true },
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

    if (command !== 'assess' && command !== 'plan' && command !== 'coach') {
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

    // Run assess (both commands need the assessment view)
    const view = await assess(storage, sessionId);

    if (command === 'assess') {
      return { output: formatAssessment(view), exitCode: 0 };
    }

    // command === 'plan'
    const sessionPlan = plan(view);

    if (command === 'plan') {
      return { output: formatPlan(sessionPlan), exitCode: 0 };
    }

    // command === 'coach'
    const env = deps.env ?? process.env;
    const coachSessionId =
      (values.session as SessionId | undefined) ??
      (`cli-${Date.now()}` as SessionId);

    // Build provider (real) unless injected
    let provider = deps.provider;
    if (!provider) {
      const providerChoice = values.provider as string | undefined;
      const anthropicKey = env.IBAI_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY;
      const anthropicModel = env.IBAI_ANTHROPIC_MODEL;
      const ollamaEndpoint =
        (values['ollama-url'] as string | undefined) ??
        env.IBAI_OLLAMA_URL ??
        'http://127.0.0.1:11434';
      const ollamaModel =
        (values.model as string | undefined) ?? env.IBAI_OLLAMA_MODEL;

      // Provider selection: explicit choice > auto-detect from env
      if (
        providerChoice === 'anthropic' ||
        (!providerChoice && anthropicKey && anthropicModel)
      ) {
        if (!anthropicKey || !anthropicModel) {
          throw new Error(
            'Anthropic provider requires IBAI_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) and IBAI_ANTHROPIC_MODEL',
          );
        }
        provider = new AnthropicProvider({
          apiKey: anthropicKey,
          model: anthropicModel,
        });
      } else if (
        providerChoice === 'ollama' ||
        (!providerChoice && ollamaModel)
      ) {
        if (!ollamaModel || ollamaModel.trim() === '') {
          throw new Error(
            '--model (or IBAI_OLLAMA_MODEL) is required for Ollama provider',
          );
        }
        provider = new OllamaProvider({
          endpoint: ollamaEndpoint,
          model: ollamaModel,
        });
      } else {
        throw new Error(
          'Configure a model (Anthropic or Ollama) to run coach command.\n' +
            'Set IBAI_ANTHROPIC_API_KEY + IBAI_ANTHROPIC_MODEL for Anthropic,\n' +
            'or IBAI_OLLAMA_MODEL (or --model) for Ollama.',
        );
      }
    }

    // Build answers from --answer flags
    const answerValues = values.answer as string[] | undefined;
    const planTopics = sessionPlan.topics;

    if (!answerValues || answerValues.length === 0) {
      // No answers provided - give helpful message
      return {
        output:
          `Error: The coach command requires answers via --answer flags.\n\n` +
          `Your session plan has ${planTopics.length} topic(s):\n` +
          planTopics.map((t, i) => `  ${i + 1}. ${t.topicId}`).join('\n') +
          '\n\n' +
          `Provide an answer for each topic with --answer "your answer text"\n` +
          `Example: ibai coach --answer "Use hash map for O(1)" --answer "BFS for shortest path"`,
        exitCode: 1,
      };
    }

    // Map answers to topics (in order)
    const answers: TopicAnswer[] = planTopics
      .slice(0, answerValues.length)
      .map((topic, i) => ({
        topicId: topic.topicId,
        answer: answerValues[i] ?? '',
      }));

    if (answers.length < planTopics.length) {
      return {
        output:
          `Warning: Only ${answers.length} answer(s) provided for ${planTopics.length} topic(s).\n` +
          `Proceeding with partial answers.`,
        exitCode: 0,
      };
    }

    const input: CoachInput = {
      sessionId: coachSessionId,
      plan: sessionPlan,
      answers,
      assessment: view,
      completedAt: new Date().toISOString() as IsoTimestamp,
    };

    const result = await coach({ storage, provider }, input);
    return {
      output: formatCoach(coachSessionId, sessionPlan, result),
      exitCode: 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Friendly Ollama-down error
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return {
        output: `Error: could not reach the LLM. Is Ollama running? Start it with 'ollama serve' (or set --ollama-url).`,
        exitCode: 1,
      };
    }
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
