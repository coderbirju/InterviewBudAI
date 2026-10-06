import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPENAI_DEFAULT_TIMEOUT_MS,
  normalizeOpenAIBaseUrl,
  openAIKeyTransportAllowed,
} from '@ibai/providers';

/**
 * Resolve the data directory path.
 * Precedence: --data-dir CLI flag > IBAI_DATA_DIR env > ~/.interviewbudai/data
 *
 * Ignores the persisted config.json; the web server resolves its data dir with
 * {@link resolveServerDataDir} (flag > env > config.json > default).
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

/** Where the active data directory came from (highest precedence first). */
export type DataDirSource = 'flag' | 'env' | 'config' | 'default';

/**
 * True when the data dir is pinned by the operator (--data-dir / IBAI_DATA_DIR)
 * and therefore must not be changed through /setup.
 */
export function isPinnedSource(source: DataDirSource): boolean {
  return source === 'flag' || source === 'env';
}

export interface ResolvedDataDir {
  /** Absolute, normalized data directory. */
  readonly dataDir: string;
  readonly source: DataDirSource;
  /** Set when config.json exists but was ignored (invalid). Never a secret. */
  readonly warning?: string;
}

/** `<home>/.interviewbudai` — holds config.json and the default data dir. */
export function localConfigDirFor(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.interviewbudai');
}

/** `<home>/.interviewbudai/config.json` — the persisted data-dir choice. */
export function localConfigPathFor(homeDir: string = os.homedir()): string {
  return path.join(localConfigDirFor(homeDir), 'config.json');
}

/** config.json is tiny; anything larger is treated as invalid. */
export const MAX_LOCAL_CONFIG_BYTES = 64 * 1024;

export type LocalConfigRead =
  | { readonly status: 'absent' }
  | { readonly status: 'ok'; readonly dataDir: string }
  | { readonly status: 'invalid'; readonly error: string };

/**
 * Read the persisted local config (`{ "dataDir": "<abs path>" }`). The file is
 * UNTRUSTED input: it must parse as a JSON object whose `dataDir` is an
 * absolute string without NUL bytes that is not a filesystem root. Never
 * throws; anything else is `invalid` (the caller warns and falls back).
 */
export function readLocalConfig(
  homeDir: string = os.homedir(),
): LocalConfigRead {
  const file = localConfigPathFor(homeDir);
  let text: string;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      return { status: 'invalid', error: 'not a regular file' };
    }
    if (stat.size > MAX_LOCAL_CONFIG_BYTES) {
      return { status: 'invalid', error: 'file is too large' };
    }
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'absent' };
    }
    return {
      status: 'invalid',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return parseLocalConfigText(text);
}

/**
 * Validate the TEXT of a config.json (untrusted): a JSON object whose
 * `dataDir` is a non-empty absolute string without NUL bytes that is not a
 * filesystem root. `pathApi` picks the path flavour (the container reads a
 * host file whose path may be POSIX or Windows — `container.ts`). Never throws.
 */
export function parseLocalConfigText(
  text: string,
  pathApi: path.PlatformPath = path,
): LocalConfigRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 'invalid', error: 'not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'invalid', error: 'expected a JSON object' };
  }
  const dataDir = (parsed as Record<string, unknown>).dataDir;
  if (typeof dataDir !== 'string' || dataDir === '') {
    return { status: 'invalid', error: '"dataDir" must be a non-empty string' };
  }
  if (dataDir.includes('\0')) {
    return { status: 'invalid', error: '"dataDir" must not contain NUL bytes' };
  }
  if (!pathApi.isAbsolute(dataDir)) {
    return { status: 'invalid', error: '"dataDir" must be an absolute path' };
  }
  const normalized = pathApi.resolve(dataDir);
  if (pathApi.parse(normalized).root === normalized) {
    return {
      status: 'invalid',
      error: '"dataDir" must not be a filesystem root',
    };
  }
  return { status: 'ok', dataDir: normalized };
}

/**
 * Persist the data-dir choice to `<home>/.interviewbudai/config.json`
 * atomically: write a 0600 temp file in the same directory, then rename over
 * the target. The config directory is created 0700 if missing. The file holds
 * no secrets.
 */
export function writeLocalConfig(homeDir: string, dataDir: string): void {
  const dir = localConfigDirFor(homeDir);
  const firstCreated = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (firstCreated !== undefined) {
    // mkdir's mode is filtered by the umask; enforce owner-only explicitly.
    fs.chmodSync(dir, 0o700);
  }
  const file = localConfigPathFor(homeDir);
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    // 'wx' refuses to reuse anything already at the temp path.
    fs.writeFileSync(tmp, `${JSON.stringify({ dataDir }, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Resolve the server's data directory ONCE (at boot). Precedence:
 * `--data-dir` flag > `IBAI_DATA_DIR` env > persisted config.json > default
 * `<home>/.interviewbudai/data`. An invalid config.json is ignored with a
 * `warning` (never throws). The browser has no say in this.
 */
export function resolveServerDataDir(
  env: NodeJS.ProcessEnv = process.env,
  argv?: string[],
  homeDir: string = os.homedir(),
): ResolvedDataDir {
  const flag = argv?.find((arg) => arg.startsWith('--data-dir='));
  if (flag !== undefined) {
    return {
      dataDir: path.resolve(flag.slice('--data-dir='.length)),
      source: 'flag',
    };
  }
  if (env.IBAI_DATA_DIR) {
    return { dataDir: path.resolve(env.IBAI_DATA_DIR), source: 'env' };
  }
  const config = readLocalConfig(homeDir);
  if (config.status === 'ok') {
    return { dataDir: config.dataDir, source: 'config' };
  }
  const dataDir = defaultDataDirFor(homeDir);
  if (config.status === 'invalid') {
    return {
      dataDir,
      source: 'default',
      warning: `ignoring invalid ${localConfigPathFor(homeDir)} (${config.error}); using the default data directory`,
    };
  }
  return { dataDir, source: 'default' };
}

export interface BootDataDir {
  /** Absolute data directory the server will use. */
  readonly dataDir: string;
  /** Where it came from (flag > env > config > default). */
  readonly source: DataDirSource;
  /** Chosen via --data-dir / IBAI_DATA_DIR (pinned; never auto-created). */
  readonly explicit: boolean;
  /** This boot created the default directory (first run). */
  readonly created: boolean;
  /** The directory exists after boot preparation. */
  readonly exists: boolean;
  /** An invalid config.json was ignored (warned once at boot). */
  readonly warning?: string;
}

/**
 * Resolve the data directory at boot and, on first run, create the canonical
 * default (`~/.interviewbudai/data`, mode 0700) so the app is usable
 * immediately without visiting /setup.
 *
 * Only the DEFAULT is ever created here. An explicit directory (--data-dir /
 * IBAI_DATA_DIR) or one persisted in config.json is not: a typo, or a
 * directory the user has since removed, must not silently reappear. The
 * caller reports it as missing; /setup can still create it.
 */
export function prepareBootDataDir(
  env: NodeJS.ProcessEnv = process.env,
  argv?: string[],
  homeDir?: string,
): BootDataDir {
  const resolved = resolveServerDataDir(env, argv, homeDir);
  const { dataDir, source } = resolved;
  const base = {
    dataDir,
    source,
    explicit: isPinnedSource(source),
    ...(resolved.warning !== undefined ? { warning: resolved.warning } : {}),
  };

  if (directoryExists(dataDir)) {
    return { ...base, created: false, exists: true };
  }
  if (source !== 'default') {
    return { ...base, created: false, exists: false };
  }

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // mkdir's mode is filtered by the umask; enforce owner-only explicitly.
  fs.chmodSync(dataDir, 0o700);
  return { ...base, created: true, exists: true };
}

/**
 * `hint` on an ACTIVE provider explains an OpenAI-compatible config that is
 * set but not used (ignored because Anthropic wins, or rejected); on `none`
 * it explains why no provider is active.
 */
export type ProviderStatus =
  | {
      readonly kind: 'anthropic';
      readonly model: string;
      readonly hint?: string;
    }
  | { readonly kind: 'openai'; readonly model: string }
  | { readonly kind: 'ollama'; readonly model: string; readonly hint?: string }
  | { readonly kind: 'none'; readonly hint?: string };

/** Hint when an OpenAI-compatible key would travel over plain HTTP. */
export const OPENAI_INSECURE_KEY_HINT =
  'IBAI_OPENAI_API_KEY is set but IBAI_OPENAI_BASE_URL is plain http to a non-loopback host; use https (or drop the key)';

/** Hint when `IBAI_OPENAI_BASE_URL` carries credentials (URL never echoed). */
export const OPENAI_USERINFO_HINT =
  'IBAI_OPENAI_BASE_URL must not contain a username/password (use IBAI_OPENAI_API_KEY)';

/** Hint when an OpenAI-compatible config is set but Anthropic wins (ADR 0011 D1). */
export const OPENAI_IGNORED_HINT =
  'IBAI_OPENAI_* is also set; ignored because Anthropic is configured';

/** True when a (parseable) URL carries a username or password. */
function hasUserinfo(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.username !== '' || url.password !== '';
  } catch {
    return false;
  }
}

/**
 * Why a fully set OpenAI-compatible config (base URL + model) is rejected, or
 * undefined when it is usable: userinfo in the base URL, or a key that would
 * travel over plain http to a non-loopback host (ADR 0011 D1 key-transport
 * rule).
 */
function openAIRejection(
  env: NodeJS.ProcessEnv,
  baseUrl: string,
): string | undefined {
  if (hasUserinfo(baseUrl)) return OPENAI_USERINFO_HINT;
  if (!openAIKeyTransportAllowed(baseUrl, Boolean(resolveOpenAIApiKey(env)))) {
    return OPENAI_INSECURE_KEY_HINT;
  }
  return undefined;
}

/**
 * Describe which provider the server will use, WITHOUT exposing secrets (API
 * keys are only checked for presence). The ONE shared precedence (ADR 0011
 * D1) used by startServer (`selectProvider`), `/api/config` and settings —
 * first match wins:
 *
 *  1. Anthropic — an API key AND `IBAI_ANTHROPIC_MODEL`
 *  2. OpenAI-compatible — `IBAI_OPENAI_BASE_URL` AND `IBAI_OPENAI_MODEL`
 *     (key optional; with a key the URL must be https or loopback http; no
 *     username/password in the URL)
 *  3. Ollama — `IBAI_OLLAMA_MODEL`
 *  4. none — with a hint when a config is half-set (or the key rule fails)
 */
export function resolveProviderStatus(
  env: NodeJS.ProcessEnv = process.env,
): ProviderStatus {
  const hasKey = Boolean(resolveAnthropicApiKey(env));
  const anthropicModel = resolveAnthropicModel(env);
  const openaiBaseUrl = resolveOpenAIBaseUrl(env);
  const openaiModel = resolveOpenAIModel(env);
  const ollamaModel = resolveOllamaModel(env);

  if (hasKey && anthropicModel) {
    return {
      kind: 'anthropic',
      model: anthropicModel,
      ...((openaiBaseUrl || openaiModel) && { hint: OPENAI_IGNORED_HINT }),
    };
  }
  const rejection =
    openaiBaseUrl && openaiModel
      ? openAIRejection(env, openaiBaseUrl)
      : undefined;
  if (openaiBaseUrl && openaiModel && rejection === undefined) {
    return { kind: 'openai', model: openaiModel };
  }
  if (ollamaModel) {
    return {
      kind: 'ollama',
      model: ollamaModel,
      ...(rejection !== undefined && {
        hint: `${rejection}; using Ollama instead`,
      }),
    };
  }
  if (rejection !== undefined) {
    return { kind: 'none', hint: rejection };
  }
  if (openaiBaseUrl) {
    return {
      kind: 'none',
      hint: 'IBAI_OPENAI_BASE_URL is set but IBAI_OPENAI_MODEL is missing',
    };
  }
  if (openaiModel) {
    return {
      kind: 'none',
      hint: 'IBAI_OPENAI_MODEL is set but IBAI_OPENAI_BASE_URL is missing',
    };
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

/** OpenAI-compatible base URL (`IBAI_OPENAI_BASE_URL`, trimmed); undefined if unset/blank. */
export function resolveOpenAIBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.IBAI_OPENAI_BASE_URL?.trim() || undefined;
}

/** OpenAI-compatible model id (`IBAI_OPENAI_MODEL`, trimmed); undefined if unset/blank. */
export function resolveOpenAIModel(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.IBAI_OPENAI_MODEL?.trim() || undefined;
}

/** The official OpenAI API host — the only one `OPENAI_API_KEY` is sent to. */
export const OFFICIAL_OPENAI_HOST = 'api.openai.com';

/**
 * True when the NORMALIZED base URL is `https://api.openai.com…` (exact host,
 * default port, no userinfo). Unparseable → false.
 */
export function isOfficialOpenAIBaseUrl(raw: string): boolean {
  try {
    const url = new URL(normalizeOpenAIBaseUrl(raw));
    return (
      url.protocol === 'https:' &&
      url.host === OFFICIAL_OPENAI_HOST &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * OPTIONAL OpenAI-compatible bearer key. `IBAI_OPENAI_API_KEY` is the
 * explicit opt-in and is used for any base URL. The ambient `OPENAI_API_KEY`
 * is used ONLY when the base URL is `https://api.openai.com` — a shell-wide
 * OpenAI key must never reach Docker Model Runner, LM Studio or any other
 * server. A secret: only ever passed to the adapter or checked for presence —
 * never logged or returned.
 */
export function resolveOpenAIApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.IBAI_OPENAI_API_KEY) return env.IBAI_OPENAI_API_KEY;
  const baseUrl = resolveOpenAIBaseUrl(env);
  if (env.OPENAI_API_KEY && baseUrl && isOfficialOpenAIBaseUrl(baseUrl)) {
    return env.OPENAI_API_KEY;
  }
  return undefined;
}

/** Bounds for `IBAI_OPENAI_TIMEOUT_MS` (ADR 0011 D1). */
export const OPENAI_TIMEOUT_MIN_MS = 5_000;
export const OPENAI_TIMEOUT_MAX_MS = 600_000;

/**
 * OpenAI-compatible request deadline: `IBAI_OPENAI_TIMEOUT_MS` (integer ms,
 * clamped to 5 000–600 000); unset or not a number → the adapter default
 * (120 000).
 */
export function resolveOpenAITimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.IBAI_OPENAI_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return OPENAI_DEFAULT_TIMEOUT_MS;
  return Math.min(
    OPENAI_TIMEOUT_MAX_MS,
    Math.max(OPENAI_TIMEOUT_MIN_MS, Math.round(n)),
  );
}

/**
 * Set to `true` by the release bundle build (esbuild `--define`, ADR 0016 D2).
 * Undeclared, hence `undefined`, everywhere else (tsc, tests, `npm start`).
 */
declare const __IBAI_BUNDLED__: boolean | undefined;

/** True only inside the release bundle (`dist/server.js` in the zip). */
export const IS_BUNDLED: boolean =
  typeof __IBAI_BUNDLED__ !== 'undefined' && __IBAI_BUNDLED__ === true;

/**
 * Where the server reads `.env` from (ADR 0016 D2). Unbundled, both `src/`
 * and `dist/` sit at packages/web/<dir>/, so the repo root is three levels up.
 * Bundled, the module is `interviewbudai-vX.Y.Z/dist/server.js`, so the
 * unzipped folder is one level up.
 */
export function resolveDotenvPath(
  bundled: boolean,
  moduleUrl: string = import.meta.url,
): string {
  return fileURLToPath(
    new URL(bundled ? '../.env' : '../../../.env', moduleUrl),
  );
}

/**
 * The `.env` path. Fixed (not configurable) and independent of the working
 * directory: the repo root when run from the source tree, the unzipped
 * release folder when run from the release zip.
 */
export const REPO_DOTENV_PATH = resolveDotenvPath(IS_BUNDLED);

export type DotEnvResult =
  | { readonly status: 'loaded' | 'absent' | 'unsupported' }
  | { readonly status: 'invalid'; readonly error: string };

/**
 * Load the repo-root `.env` into the process environment using Node's built-in
 * `process.loadEnvFile` (no dependency). Variables already set in the shell take
 * precedence over the file. No-op when the file is absent;
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

/** Bind hosts accepted anywhere (loopback only). */
const LOOPBACK_BIND_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1']);

/** The all-interfaces bind, accepted ONLY inside a container. */
export const CONTAINER_BIND_HOST = '0.0.0.0';

/** True when `IBAI_CONTAINER=1` (set by the Dockerfile, ADR 0011 D2). */
export function isContainer(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.IBAI_CONTAINER?.trim() === '1';
}

/**
 * Resolve the bind host (`IBAI_BIND_HOST`, ADR 0011 D2). Default and normal
 * value `127.0.0.1`; `::1` is also accepted. `0.0.0.0` is accepted ONLY with
 * `IBAI_CONTAINER=1` (inside a container loopback is unreachable from the
 * published port; LAN isolation then comes from Compose's `127.0.0.1:`
 * publish). Anything else throws, so the server refuses to start.
 */
export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.IBAI_BIND_HOST?.trim();
  if (!raw) return '127.0.0.1';
  if (LOOPBACK_BIND_HOSTS.has(raw)) return raw;
  if (raw === CONTAINER_BIND_HOST) {
    if (isContainer(env)) return raw;
    throw new Error(
      'IBAI_BIND_HOST=0.0.0.0 is only allowed inside the Docker image (IBAI_CONTAINER=1); outside Docker, leave IBAI_BIND_HOST unset (127.0.0.1)',
    );
  }
  throw new Error(
    'Invalid IBAI_BIND_HOST: use 127.0.0.1 (default) or ::1 (0.0.0.0 only inside the Docker image)',
  );
}

/**
 * The port the BROWSER uses (`IBAI_PUBLIC_PORT`, ADR 0011 D2): Compose
 * publishes the container's listen port on another host port, and the Host /
 * Origin allowlist must match what the browser sends. Defaults to the listen
 * port; an invalid value throws (refuse to start).
 */
export function resolvePublicPort(
  env: NodeJS.ProcessEnv,
  listenPort: number,
): number {
  const raw = env.IBAI_PUBLIC_PORT?.trim();
  if (!raw) return listenPort;
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      'Invalid IBAI_PUBLIC_PORT: must be an integer between 1 and 65535',
    );
  }
  return port;
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
      // URL decode the value and rejoin any '=' that were in the value. The
      // header is untrusted: a malformed escape keeps the raw value.
      const raw = rest.join('=');
      try {
        cookies[key] = decodeURIComponent(raw);
      } catch {
        cookies[key] = raw;
      }
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
