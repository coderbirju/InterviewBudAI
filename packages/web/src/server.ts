import * as http from 'node:http';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { AnthropicProvider, OllamaProvider } from '@ibai/providers';
import type { LlmProvider } from '@ibai/providers';
import {
  prepareBootDataDir,
  resolveProviderStatus,
  resolvePort,
  resolveHost,
  resolveOllamaUrl,
  resolveOllamaModel,
  resolveAnthropicApiKey,
  resolveAnthropicModel,
} from './config.js';
import type { BootDataDir, ProviderStatus } from './config.js';
import { createCoachHandler, precheckRequest } from './handler.js';
import {
  allowedHostsFor,
  securityHeaders,
  MAX_BODY_BYTES,
} from './security.js';

export interface ServerHandle {
  readonly url: string;
  close: () => Promise<void>;
}

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  /** Home directory for the default data dir (tests inject a temp dir). */
  homeDir?: string;
  /** Sink for the startup banner lines (default: console.log). */
  log?: (line: string) => void;
}

/** Shown when no provider is configured (the quiz needs one). */
export const NO_PROVIDER_MESSAGE =
  'no model configured — quiz disabled; set ANTHROPIC_API_KEY + IBAI_ANTHROPIC_MODEL or IBAI_OLLAMA_MODEL';

/**
 * Build the human-readable startup banner. Pure; never includes secrets (the
 * provider status carries only the provider kind and model name).
 */
export function formatStartupBanner(input: {
  url: string;
  data: BootDataDir;
  provider: ProviderStatus;
}): string[] {
  const { url, data, provider } = input;

  let dataLine = `  Data:     ${data.dataDir}`;
  if (data.created) {
    dataLine += ' (created on first run)';
  } else if (!data.exists) {
    dataLine +=
      ' (does not exist yet — create it, or choose a location at /setup)';
  }

  let providerLine: string;
  if (provider.kind === 'anthropic') {
    providerLine = `  Provider: Anthropic (model: ${provider.model})`;
  } else if (provider.kind === 'ollama') {
    providerLine = `  Provider: Ollama (model: ${provider.model})`;
  } else {
    providerLine = `  Provider: ${NO_PROVIDER_MESSAGE}`;
    if (provider.hint) providerLine += ` (${provider.hint})`;
  }

  return [
    `InterviewBudAI is running at ${url}/`,
    dataLine,
    providerLine,
    '  Press Ctrl+C to stop.',
  ];
}

/** Server timeouts: whole request, headers, idle keep-alive (ms). */
/** Methods whose request body is read (capped at `MAX_BODY_BYTES`). */
const BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PATCH', 'DELETE']);

export const REQUEST_TIMEOUT_MS = 30_000;
export const HEADERS_TIMEOUT_MS = 10_000;
export const KEEP_ALIVE_TIMEOUT_MS = 5_000;

/** True when the declared `Content-Length` already exceeds `limit`. */
export function declaresTooLarge(
  req: http.IncomingMessage,
  limit: number = MAX_BODY_BYTES,
): boolean {
  const declared = Number(req.headers['content-length']);
  return Number.isFinite(declared) && declared > limit;
}

/**
 * Read the request body, buffering at most `limit` bytes. Resolves `null` as
 * soon as more than `limit` bytes arrive (the caller answers 413 and closes).
 * Bytes after that are discarded, never buffered; once `2 × limit` bytes have
 * arrived in total the socket is destroyed so an endless (chunked) upload
 * cannot keep it open.
 */
export function readRequestBody(
  req: http.IncomingMessage,
  limit: number = MAX_BODY_BYTES,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (settled) {
        if (received > 2 * limit) req.destroy();
        return;
      }
      if (received > limit) {
        settled = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * Start the web server. Composition root: resolves config, constructs adapters,
 * builds handler, and starts HTTP server.
 *
 * The server binds to localhost (127.0.0.1) only. No external network access.
 *
 * Provider is now REQUIRED for coach operations (ADR 0005 D6):
 * - If Anthropic key AND model set → AnthropicProvider
 * - Else if Ollama model set → OllamaProvider
 * - Else provider = undefined (coach will return provider-required error)
 */
export async function startServer(
  opts?: StartServerOptions,
): Promise<ServerHandle> {
  const env = opts?.env ?? process.env;
  const argv = opts?.argv;
  const log = opts?.log ?? ((line: string) => console.log(line));

  // Resolve the server's data dir ONCE (flag > env > config.json > default).
  // First run: create the canonical default so the app is usable immediately;
  // explicit or persisted paths are not created.
  const bootData = prepareBootDataDir(env, argv, opts?.homeDir);
  if (bootData.warning !== undefined) {
    log(`Warning: ${bootData.warning}`);
  }
  const dataDir = bootData.dataDir;
  const port = resolvePort(env, argv);
  const host = resolveHost();

  // Resolve provider config (Anthropic first, then Ollama)
  const anthropicApiKey = resolveAnthropicApiKey(env);
  const anthropicModel = resolveAnthropicModel(env);
  const ollamaUrl = resolveOllamaUrl(env);
  const ollamaModel = resolveOllamaModel(env);

  // Storage adapter for the boot data dir (the handler requires one).
  const storage = new LocalFileStorageAdapter(dataDir);

  // Storage factory for the server's CURRENT data dir (/setup can switch it).
  const createStorage = (dir: string) => new LocalFileStorageAdapter(dir);

  // Create provider: Anthropic if key+model, else Ollama if model, else undefined (NO demo fallback)
  let provider: LlmProvider | undefined;
  let providerLabel: string;

  if (anthropicApiKey && anthropicModel) {
    provider = new AnthropicProvider({
      apiKey: anthropicApiKey,
      model: anthropicModel,
    });
    providerLabel = `Using Anthropic: ${anthropicModel}`;
  } else if (ollamaModel) {
    provider = new OllamaProvider({ endpoint: ollamaUrl, model: ollamaModel });
    providerLabel = `Using Ollama: ${ollamaModel}`;
  } else {
    provider = undefined;
    providerLabel = 'No model configured';
  }

  // Create handler with storage, provider, label, and per-request factory
  const handler = createCoachHandler({
    storage,
    provider,
    providerLabel,
    createStorage,
    // The server owns the data dir: resolved once above, never per request.
    dataDir,
    dataDirSource: bootData.source,
    homeDir: opts?.homeDir,
    env,
    argv,
    // The Host allowlist is pinned to the port we actually bind.
    port,
  });

  const allowedHosts = allowedHostsFor(port);

  const server = http.createServer(async (req, res) => {
    try {
      const base = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        contentType: req.headers['content-type'],
        headers: req.headers as Record<string, string | string[] | undefined>,
      };

      // Read the body only for POST / PATCH / DELETE (ADR 0010 D5), and only
      // after the header-only checks (Host / Origin / Content-Type) pass and
      // the declared length fits.
      let body: string | undefined;
      let bodyTooLarge = false;
      // The body was not (fully) read: don't reuse the connection.
      let closeAfter = false;
      if (BODY_METHODS.has(req.method ?? '')) {
        if (precheckRequest(base, allowedHosts) !== null) {
          closeAfter = true;
        } else if (declaresTooLarge(req)) {
          bodyTooLarge = true;
          closeAfter = true;
        } else {
          const read = await readRequestBody(req);
          if (read === null) {
            bodyTooLarge = true;
            closeAfter = true;
          } else {
            body = read;
          }
        }
      }

      const result = await handler({ ...base, body, bodyTooLarge });

      const responseHeaders: Record<string, string> = {
        'Content-Type': result.contentType,
        ...result.headers,
        ...(closeAfter ? { Connection: 'close' } : {}),
      };
      if (bodyTooLarge) {
        // Stop reading the oversized upload once the 413 is flushed. (Other
        // unread bodies are small; Node drains them and honours
        // `Connection: close` gracefully.)
        res.once('finish', () => req.destroy());
      }
      res.writeHead(result.status, responseHeaders);
      res.end(result.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Internal server error';
      res.writeHead(500, {
        ...securityHeaders(),
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end(message);
    }
  });

  // Explicit timeouts so slow or stalled clients cannot hold sockets open.
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    // Surface bind failures (e.g. port already in use) instead of hanging.
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const url = `http://${host}:${port}`;
      for (const line of formatStartupBanner({
        url,
        data: bootData,
        provider: resolveProviderStatus(env),
      })) {
        log(line);
      }

      resolve({
        url,
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
