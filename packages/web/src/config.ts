import * as fs from 'node:fs';
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

/**
 * Parse a Cookie header string into a map of key-value pairs.
 * Node built-ins only, no external dependencies.
 */
export function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) {
      // URL decode the value and rejoin any '=' that were in the value
      cookies[key] = decodeURIComponent(rest.join('='));
    }
  }
  return cookies;
}

/**
 * Expand ~ to home directory in a path.
 */
export function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Check if a directory exists.
 */
export function directoryExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve data directory with cookie support.
 * Precedence: cookie ibai_data_dir (if set AND exists) > CLI flag > env > default
 */
export function resolveDataDirWithCookie(
  cookieDataDir: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  argv?: string[],
  defaultDir?: string,
): string {
  // Cookie takes highest precedence IF the directory exists
  if (cookieDataDir) {
    const expanded = expandTilde(cookieDataDir);
    const resolved = path.resolve(expanded);
    if (directoryExists(resolved)) {
      return resolved;
    }
  }

  // Fall back to standard resolution, using explicit default if provided
  if (defaultDir !== undefined) {
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
    // Use the explicitly provided default
    return path.resolve(defaultDir);
  }

  return resolveDataDir(env, argv);
}

/**
 * Resolve the Anthropic API key.
 * Precedence: IBAI_ANTHROPIC_API_KEY env > ANTHROPIC_API_KEY env
 * Returns undefined if not configured (caller must handle this).
 */
export function resolveAnthropicApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.IBAI_ANTHROPIC_API_KEY) {
    return env.IBAI_ANTHROPIC_API_KEY;
  }
  if (env.ANTHROPIC_API_KEY) {
    return env.ANTHROPIC_API_KEY;
  }
  return undefined;
}

/**
 * Resolve the Anthropic model name.
 * Precedence: IBAI_ANTHROPIC_MODEL env
 * Returns undefined if not configured (caller must handle this).
 */
export function resolveAnthropicModel(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.IBAI_ANTHROPIC_MODEL) {
    return env.IBAI_ANTHROPIC_MODEL;
  }
  return undefined;
}
