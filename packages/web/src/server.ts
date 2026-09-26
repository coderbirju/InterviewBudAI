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
import { createCoachHandler } from './handler.js';
import { securityHeaders, MAX_BODY_BYTES } from './security.js';

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

/**
 * Read the request body, buffering at most `limit` bytes. Resolves `null` as
 * soon as the declared `Content-Length` or the bytes received exceed the cap;
 * the rest of the body is discarded, never buffered.
 */
export function readRequestBody(
  req: http.IncomingMessage,
  limit: number = MAX_BODY_BYTES,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let done = false;
    const onData = (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) {
        done = true;
        chunks.length = 0;
        req.off('data', onData);
        req.resume();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!done) reject(err);
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

  const server = http.createServer(async (req, res) => {
    try {
      // Read request body for POST requests (capped at MAX_BODY_BYTES).
      let body: string | undefined;
      let bodyTooLarge = false;
      if (req.method === 'POST') {
        const read = await readRequestBody(req);
        if (read === null) {
          bodyTooLarge = true;
        } else {
          body = read;
        }
      }

      const result = await handler({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        body,
        bodyTooLarge,
        contentType: req.headers['content-type'],
        headers: req.headers as Record<string, string | string[] | undefined>,
      });

      const responseHeaders: Record<string, string> = {
        'Content-Type': result.contentType,
        ...result.headers,
        // Unread body bytes were discarded; don't reuse this connection.
        ...(bodyTooLarge ? { Connection: 'close' } : {}),
      };
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
