/**
 * Settings / provider status (ADR 0008 Wave 2(c-lite)).
 *
 *   GET  /api/settings                — which provider is active, the data dir,
 *                                       app/Node versions and the env vars the
 *                                       app reads (set ✓/✗ only)
 *   POST /api/settings/test-provider  — one health check against the
 *                                       user-configured provider
 *
 * Keys stay env-only (founder decision D5.2 pending): nothing here accepts,
 * stores or returns a secret. Secrets are only ever checked for PRESENCE; the
 * Ollama endpoint is reduced to its origin (no userinfo/path/query); provider
 * errors are mapped to fixed, sanitized text and never echoed.
 *
 * The only outbound call is to the provider the user configured (§6.4), and
 * only on an explicit POST.
 */

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnthropicProvider } from '@ibai/providers';
import {
  resolveAnthropicApiKey,
  resolveAnthropicModel,
  resolveOllamaUrl,
  resolveProviderStatus,
} from './config.js';
import type { DataDirSource } from './config.js';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type SettingsProviderKind = 'anthropic' | 'ollama' | 'none';

export interface ApiSettingsProvider {
  readonly kind: SettingsProviderKind;
  readonly model: string | null;
  /** Ollama origin (scheme://host:port) only; null for other kinds. */
  readonly endpoint: string | null;
  /** True when an Anthropic API key is present in the environment. */
  readonly keyConfigured: boolean;
  /** Why no provider is active, when a config is half-set. */
  readonly hint?: string;
}

export interface ApiSettingsEnvVar {
  readonly var: string;
  readonly purpose: string;
  readonly set: boolean;
}

/** GET /api/settings response shape. */
export interface ApiSettingsResponse {
  readonly provider: ApiSettingsProvider;
  readonly dataDir: {
    readonly path: string;
    readonly source: DataDirSource;
    readonly pinned: boolean;
  };
  readonly app: { readonly version: string; readonly node: string };
  readonly envHelp: readonly ApiSettingsEnvVar[];
}

/** POST /api/settings/test-provider response shape (200). */
export interface ApiProviderTestResponse {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------

/** The env vars the app actually reads (config.ts / server.ts). */
const ENV_VARS: readonly { readonly name: string; readonly purpose: string }[] =
  [
    {
      name: 'ANTHROPIC_API_KEY',
      purpose: 'Anthropic API key (secret)',
    },
    {
      name: 'IBAI_ANTHROPIC_API_KEY',
      purpose: 'Anthropic API key; wins over ANTHROPIC_API_KEY (secret)',
    },
    {
      name: 'IBAI_ANTHROPIC_MODEL',
      purpose: 'Anthropic model name (needed with a key)',
    },
    {
      name: 'IBAI_OLLAMA_MODEL',
      purpose: 'Ollama model name (used when Anthropic is not configured)',
    },
    {
      name: 'IBAI_OLLAMA_URL',
      purpose: 'Ollama server URL (default http://127.0.0.1:11434)',
    },
    { name: 'IBAI_DATA_DIR', purpose: 'Pins the data folder' },
    { name: 'IBAI_WEB_PORT', purpose: 'Web server port (default 4173)' },
  ];

/**
 * Reduce a user-supplied URL to `scheme://host[:port]` — drops userinfo, path,
 * query and fragment. Unparseable → null (never echo the raw string).
 */
export function sanitizeEndpoint(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** `packages/web/package.json` version; src/ and dist/ both sit one level down. */
function readAppVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

let cachedVersion: string | undefined;

/** Describe the active provider WITHOUT secrets (mirrors startServer). */
export function settingsProvider(env: NodeJS.ProcessEnv): ApiSettingsProvider {
  const status = resolveProviderStatus(env);
  const keyConfigured = Boolean(resolveAnthropicApiKey(env));
  if (status.kind === 'ollama') {
    return {
      kind: 'ollama',
      model: status.model,
      endpoint: sanitizeEndpoint(resolveOllamaUrl(env)),
      keyConfigured,
    };
  }
  if (status.kind === 'anthropic') {
    return {
      kind: 'anthropic',
      model: status.model,
      endpoint: null,
      keyConfigured,
    };
  }
  return {
    kind: 'none',
    model: null,
    endpoint: null,
    keyConfigured,
    ...(status.hint !== undefined && { hint: status.hint }),
  };
}

export function buildSettingsResponse(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly dataDir: {
    readonly path: string;
    readonly source: DataDirSource;
    readonly pinned: boolean;
  };
}): ApiSettingsResponse {
  cachedVersion ??= readAppVersion();
  return {
    provider: settingsProvider(input.env),
    dataDir: input.dataDir,
    app: { version: cachedVersion, node: process.version },
    envHelp: ENV_VARS.map(({ name, purpose }) => ({
      var: name,
      purpose,
      set: Boolean(input.env[name]),
    })),
  };
}

// ---------------------------------------------------------------------------
// POST /api/settings/test-provider
// ---------------------------------------------------------------------------

/** Minimum gap between two tests (in-process). */
export const TEST_MIN_INTERVAL_MS = 5_000;
/** Deadline for a whole provider test (request AND body read). */
export const TEST_TIMEOUT_MS = 5_000;

export interface ProviderTesterOptions {
  readonly env: NodeJS.ProcessEnv;
  /** Injected in tests (no real network in CI). Default: global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Monotonic-ish ms clock (default `Date.now`). */
  readonly clock?: () => number;
  readonly timeoutMs?: number;
  readonly minIntervalMs?: number;
}

export type ProviderTestOutcome =
  | { readonly status: 200; readonly body: ApiProviderTestResponse }
  | { readonly status: 400 | 429; readonly body: { readonly error: string } };

class TimeoutError extends Error {}

/**
 * A fetch wrapper that attaches the test's single abort signal and records the
 * HTTP status. The deadline itself lives in the tester (it covers the whole
 * operation, body reads included), not here.
 */
function guardedFetch(
  base: typeof fetch,
  signal: AbortSignal,
  seen: { status?: number; errorType?: string },
): typeof fetch {
  return async (input, init) => {
    const res = await base(input, { ...init, signal });
    seen.status = res.status;
    if (!res.ok) {
      seen.errorType = await errorTypeOf(res.clone());
    }
    return res;
  };
}

/** Anthropic-style `{ error: { type } }`, only if it is a plain identifier. */
async function errorTypeOf(res: Response): Promise<string | undefined> {
  try {
    const data = (await res.json()) as { error?: { type?: unknown } };
    const type = data?.error?.type;
    return typeof type === 'string' && /^[a-z_]{1,40}$/.test(type)
      ? type
      : undefined;
  } catch {
    return undefined;
  }
}

/** Fixed, sanitized text for an HTTP status — never the provider's body. */
function describeStatus(
  provider: 'Anthropic' | 'Ollama',
  status: number,
  errorType?: string,
): string {
  const suffix = errorType ? ` (${errorType})` : '';
  if (status === 401) {
    return `${provider} rejected the API key (HTTP 401)${suffix}. Check the key in your environment.`;
  }
  if (status === 403) {
    return `${provider} refused the request (HTTP 403)${suffix}. Check the key's permissions.`;
  }
  if (status === 404) {
    return `${provider} could not find the model or endpoint (HTTP 404)${suffix}. Check the model name.`;
  }
  if (status === 400) {
    return `${provider} rejected the request (HTTP 400)${suffix}. Check the model name.`;
  }
  if (status === 429) {
    return `${provider} is rate limiting or out of credit (HTTP 429)${suffix}.`;
  }
  if (status >= 500) {
    return `${provider} had a server error (HTTP ${status})${suffix}. Try again later.`;
  }
  return `${provider} answered HTTP ${status}${suffix}.`;
}

/** Fixed detail when IBAI_OLLAMA_URL carries credentials (URL never echoed). */
export const OLLAMA_USERINFO_DETAIL =
  'Ollama URL must not contain a username/password';

function hasUserinfo(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.username !== '' || url.password !== '';
  } catch {
    return false;
  }
}

/** Does Ollama's `/api/tags` list the configured model? (`llama3` ≡ `llama3:latest`) */
function ollamaHasModel(data: unknown, model: string): boolean | null {
  if (typeof data !== 'object' || data === null) return null;
  const models = (data as { models?: unknown }).models;
  if (!Array.isArray(models)) return null;
  const wanted = new Set([model]);
  if (!model.includes(':')) wanted.add(`${model}:latest`);
  return models.some((m) => {
    if (typeof m !== 'object' || m === null) return false;
    const { name, model: id } = m as { name?: unknown; model?: unknown };
    return (
      (typeof name === 'string' && wanted.has(name)) ||
      (typeof id === 'string' && wanted.has(id))
    );
  });
}

/**
 * One tester per server process: holds the rate-limit state. The key and the
 * raw Ollama URL are read from `env` at call time and never leave this module.
 */
export function createProviderTester(
  opts: ProviderTesterOptions,
): () => Promise<ProviderTestOutcome> {
  const clock = opts.clock ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? TEST_TIMEOUT_MS;
  const minIntervalMs = opts.minIntervalMs ?? TEST_MIN_INTERVAL_MS;
  let lastStartedAt: number | undefined;
  let inFlight = false;

  return async () => {
    const env = opts.env;
    const provider = settingsProvider(env);
    if (provider.kind === 'none') {
      return { status: 400, body: { error: 'no model configured' } };
    }
    const startedAt = clock();
    if (
      inFlight ||
      (lastStartedAt !== undefined && startedAt - lastStartedAt < minIntervalMs)
    ) {
      return {
        status: 429,
        body: {
          error: `please wait ${Math.ceil(minIntervalMs / 1000)} s between connection tests`,
        },
      };
    }
    lastStartedAt = startedAt;
    inFlight = true;
    const base = opts.fetchImpl ?? globalThis.fetch;
    const seen: { status?: number; errorType?: string } = {};
    // ONE controller + deadline for the whole test (fetch AND body reads): a
    // provider that sends headers then stalls the body still ends at the
    // deadline, and `inFlight` is released then (outer `finally`).
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, rejectDeadline) => {
      timer = setTimeout(() => {
        controller.abort();
        rejectDeadline(new TimeoutError('timeout'));
      }, timeoutMs);
    });
    const fetchImpl = guardedFetch(base, controller.signal, seen);
    const done = (ok: boolean, detail: string): ProviderTestOutcome => ({
      status: 200,
      body: {
        ok,
        latencyMs: Math.max(0, Math.round(clock() - startedAt)),
        detail,
      },
    });
    const label = provider.kind === 'anthropic' ? 'Anthropic' : 'Ollama';

    const run = async (): Promise<ProviderTestOutcome> => {
      if (provider.kind === 'ollama') {
        const model = provider.model ?? '';
        const rawUrl = resolveOllamaUrl(env);
        if (hasUserinfo(rawUrl)) {
          // fetch refuses such URLs (and its error text contains the URL).
          return done(false, OLLAMA_USERINFO_DETAIL);
        }
        // Same URL shape as OllamaProvider (`${endpoint}/api/chat`).
        const res = await fetchImpl(`${rawUrl}/api/tags`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return done(false, describeStatus('Ollama', res.status));
        let data: unknown;
        try {
          data = await res.json();
        } catch {
          return done(
            false,
            'Ollama answered, but not with the expected JSON.',
          );
        }
        const found = ollamaHasModel(data, model);
        if (found === null) {
          return done(false, 'Ollama answered, but not with a model list.');
        }
        return found
          ? done(true, `Ollama is reachable and has the model "${model}".`)
          : done(
              false,
              `Ollama is reachable, but the model "${model}" is not pulled. Run: ollama pull ${model}`,
            );
      }

      // Anthropic: one minimal, billable 1-token call through the same adapter
      // the quiz uses (same endpoint + headers).
      const apiKey = resolveAnthropicApiKey(env) ?? '';
      const model = resolveAnthropicModel(env) ?? '';
      const client = new AnthropicProvider({ apiKey, model, fetchImpl });
      await client.complete({
        messages: [{ role: 'user', content: 'ping' }],
        options: { maxTokens: 1 },
      });
      return done(true, `Anthropic accepted the key and the model "${model}".`);
    };

    try {
      return await Promise.race([run(), deadline]);
    } catch (error) {
      if (error instanceof TimeoutError) {
        return done(
          false,
          `${label} did not answer within ${Math.round(timeoutMs / 1000)} s.`,
        );
      }
      if (
        seen.status !== undefined &&
        (seen.status < 200 || seen.status > 299)
      ) {
        return done(false, describeStatus(label, seen.status, seen.errorType));
      }
      if (seen.status !== undefined) {
        return done(
          false,
          `${label} answered, but not with the expected response.`,
        );
      }
      const where =
        provider.kind === 'ollama' && provider.endpoint
          ? ` at ${provider.endpoint}`
          : '';
      return done(
        false,
        `Could not reach ${label}${where}. ${provider.kind === 'ollama' ? 'Is Ollama running?' : 'Check your network connection.'}`,
      );
    } finally {
      clearTimeout(timer);
      inFlight = false;
    }
  };
}
