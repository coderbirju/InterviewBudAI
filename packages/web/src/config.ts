import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the data directory path.
 * Precedence: --data-dir CLI flag > IBAI_DATA_DIR env > ~/.interviewbudai/data
 */
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  argv?: string[],
  homeDir?: string,
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
  return defaultDataDirFor(homeDir);
}

/**
 * The canonical default data directory: `<home>/.interviewbudai/data`.
 */
export function defaultDataDirFor(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.interviewbudai', 'data');
}

/**
 * True when the user chose a data directory explicitly (--data-dir flag or
 * IBAI_DATA_DIR env), as opposed to falling back to the default.
 */
export function isDataDirExplicit(
  env: NodeJS.ProcessEnv = process.env,
  argv?: string[],
): boolean {
  if (argv?.some((arg) => arg.startsWith('--data-dir='))) return true;
  return Boolean(env.IBAI_DATA_DIR);
}

export interface BootDataDir {
  /** Absolute data directory the server will use by default. */
  readonly dataDir: string;
  /** Chosen via --data-dir / IBAI_DATA_DIR (never auto-created). */
  readonly explicit: boolean;
  /** This boot created the default directory (first run). */
  readonly created: boolean;
  /** The directory exists after boot preparation. */
  readonly exists: boolean;
}

/**
 * Resolve the data directory at boot and, on first run, create the canonical
 * default (`~/.interviewbudai/data`, mode 0700) so the app is usable
 * immediately without visiting /setup.
 *
 * An EXPLICIT directory (--data-dir / IBAI_DATA_DIR) is never created here: a
 * typo in an explicit path must not silently create a stray directory. The
 * caller reports it as missing; /setup can still create it.
 */
export function prepareBootDataDir(
  env: NodeJS.ProcessEnv = process.env,
  argv?: string[],
  homeDir?: string,
): BootDataDir {
  const dataDir = resolveDataDir(env, argv, homeDir);
  const explicit = isDataDirExplicit(env, argv);

  if (directoryExists(dataDir)) {
    return { dataDir, explicit, created: false, exists: true };
  }
  if (explicit) {
    return { dataDir, explicit, created: false, exists: false };
  }

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // mkdir's mode is filtered by the umask; enforce owner-only explicitly.
  fs.chmodSync(dataDir, 0o700);
  return { dataDir, explicit, created: true, exists: true };
}

export type ProviderStatus =
  | { readonly kind: 'anthropic'; readonly model: string }
  | { readonly kind: 'ollama'; readonly model: string }
  | { readonly kind: 'none'; readonly hint?: string };

/**
 * Describe which provider the server will use, WITHOUT exposing secrets (the
 * API key is only checked for presence). Mirrors the selection order in
 * startServer: Anthropic (key + model) first, then Ollama (model).
 */
export function resolveProviderStatus(
  env: NodeJS.ProcessEnv = process.env,
): ProviderStatus {
  const hasKey = Boolean(resolveAnthropicApiKey(env));
  const anthropicModel = resolveAnthropicModel(env);
  const ollamaModel = resolveOllamaModel(env);

  if (hasKey && anthropicModel) {
    return { kind: 'anthropic', model: anthropicModel };
  }
  if (ollamaModel) {
    return { kind: 'ollama', model: ollamaModel };
  }
  if (hasKey) {
    return {
      kind: 'none',
      hint: 'an Anthropic API key is set but IBAI_ANTHROPIC_MODEL is missing',
    };
  }
  if (anthropicModel) {
    return {
      kind: 'none',
      hint: 'IBAI_ANTHROPIC_MODEL is set but ANTHROPIC_API_KEY is missing',
    };
  }
  return { kind: 'none' };
}

/**
 * The repo-root `.env` path. Fixed (not configurable) and independent of the
 * working directory: both `src/` and `dist/` sit at packages/web/<dir>/, so the
 * repo root is three levels up from this module.
 */
export const REPO_DOTENV_PATH = fileURLToPath(
  new URL('../../../.env', import.meta.url),
);

export type DotEnvResult =
  | { readonly status: 'loaded' | 'absent' | 'unsupported' }
  | { readonly status: 'invalid'; readonly error: string };

/**
 * Load the repo-root `.env` into the process environment using Node's built-in
 * `process.loadEnvFile` (Node >= 20.12; no dependency). Variables already set
 * in the shell take precedence over the file. No-op when the file is absent;
 * 'unsupported' when the API is missing; 'invalid' (never throws) when the
 * file cannot be read or parsed.
 */
export function loadDotEnv(
  file: string = REPO_DOTENV_PATH,
  proc: { loadEnvFile?: (p: string) => void } = process,
): DotEnvResult {
  if (!fs.existsSync(file)) return { status: 'absent' };
  if (typeof proc.loadEnvFile !== 'function') return { status: 'unsupported' };
  try {
    proc.loadEnvFile(file);
  } catch (err) {
    return {
      status: 'invalid',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { status: 'loaded' };
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

export type SetupPathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string };

/**
 * Validate a data-directory path submitted to `POST /setup` (untrusted input).
 * `~` is expanded; the result must then be absolute, contain no NUL bytes and
 * not be a filesystem root. It is returned normalized. An existing
 * non-directory at the path is rejected. Touches the filesystem only to `stat`.
 */
export function validateSetupPath(raw: string): SetupPathResult {
  if (raw.includes('\0')) {
    return { ok: false, error: 'Path must not contain NUL bytes.' };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Path must not be empty.' };
  }
  const expanded = expandTilde(trimmed);
  if (!path.isAbsolute(expanded)) {
    return {
      ok: false,
      error:
        'Path must be absolute (or start with ~/ for your home directory).',
    };
  }
  const normalized = path.resolve(expanded);
  if (path.parse(normalized).root === normalized) {
    return { ok: false, error: 'Path must not be a filesystem root.' };
  }
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(normalized);
  } catch {
    // Does not exist yet — fine, the caller creates it.
  }
  if (stat && !stat.isDirectory()) {
    return {
      ok: false,
      error: 'A file already exists at that path; choose a directory.',
    };
  }
  return { ok: true, path: normalized };
}

/**
 * Create a validated data directory with owner-only permissions (0700). An
 * already-existing directory is left as-is (its permissions are the user's).
 */
export function createDataDir(dir: string): void {
  const firstCreated = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (firstCreated !== undefined) {
    // mkdir's mode is filtered by the umask; enforce owner-only explicitly.
    fs.chmodSync(dir, 0o700);
  }
}
