import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Resolve the data directory path.
 * Precedence: --data-dir CLI flag > IBAI_DATA_DIR env > ~/.interviewbudai/data
 */
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  argv?: string[],
): string {
  // Check CLI flag first
  if (argv) {
    for (const arg of argv) {
      if (arg.startsWith('--data-dir=')) {
        return path.resolve(arg.slice('--data-dir='.length));
      }
    }
  }

  // Check env var
  if (env.IBAI_DATA_DIR) {
    return path.resolve(env.IBAI_DATA_DIR);
  }

  // Default to homedir
  return path.join(os.homedir(), '.interviewbudai', 'data');
}

/**
 * Resolve the port number.
 * Precedence: --port CLI flag > IBAI_WEB_PORT env > 4173
 */
export function resolvePort(
  env: NodeJS.ProcessEnv = process.env,
  argv?: string[],
): number {
  let portStr: string | undefined;

  // Check CLI flag first
  if (argv) {
    for (const arg of argv) {
      if (arg.startsWith('--port=')) {
        portStr = arg.slice('--port='.length);
        break;
      }
    }
  }

  // Check env var
  if (!portStr && env.IBAI_WEB_PORT) {
    portStr = env.IBAI_WEB_PORT;
  }

  // Default
  if (!portStr) {
    return 4173;
  }

  const port = parseInt(portStr, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port "${portStr}": must be an integer between 1 and 65535`,
    );
  }

  return port;
}

/**
 * Resolve the host. Always 127.0.0.1 (localhost-only, not configurable).
 */
export function resolveHost(): string {
  return '127.0.0.1';
}

/**
 * Resolve the Ollama API endpoint URL.
 * Precedence: opts.endpoint > IBAI_OLLAMA_URL env > default http://127.0.0.1:11434
 */
export function resolveOllamaUrl(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { endpoint?: string },
): string {
  if (opts?.endpoint) {
    return opts.endpoint;
  }
  if (env.IBAI_OLLAMA_URL) {
    return env.IBAI_OLLAMA_URL;
  }
  return 'http://127.0.0.1:11434';
}

/**
 * Resolve the Ollama model name.
 * Precedence: opts.model > IBAI_OLLAMA_MODEL env
 * Returns undefined if not configured (caller must handle this).
 */
export function resolveOllamaModel(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { model?: string },
): string | undefined {
  if (opts?.model) {
    return opts.model;
  }
  if (env.IBAI_OLLAMA_MODEL) {
    return env.IBAI_OLLAMA_MODEL;
  }
  return undefined;
}
