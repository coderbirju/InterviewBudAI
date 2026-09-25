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
 * Read the full request body from an IncomingMessage.
 */
function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
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

  // First run: create the canonical default data dir so the app is usable
  // immediately. Explicit --data-dir / IBAI_DATA_DIR paths are not created.
  const bootData = prepareBootDataDir(env, argv, opts?.homeDir);
  const dataDir = bootData.dataDir;
  const port = resolvePort(env, argv);
  const host = resolveHost();

  // Resolve provider config (Anthropic first, then Ollama)
  const anthropicApiKey = resolveAnthropicApiKey(env);
  const anthropicModel = resolveAnthropicModel(env);
  const ollamaUrl = resolveOllamaUrl(env);
  const ollamaModel = resolveOllamaModel(env);

  // Create storage adapter (default for routes that don't use cookie)
  const storage = new LocalFileStorageAdapter(dataDir);

  // Create storage factory for per-request cookie-aware storage resolution
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
    defaultDataDir: dataDir,
    env,
    argv,
  });

  const server = http.createServer(async (req, res) => {
    try {
      // Read request body for POST requests
      let body: string | undefined;
      if (req.method === 'POST') {
        body = await readRequestBody(req);
      }

      const result = await handler({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        body,
        contentType: req.headers['content-type'],
        headers: req.headers as Record<string, string | string[] | undefined>,
      });

      const responseHeaders: Record<string, string> = {
        'Content-Type': result.contentType,
        ...result.headers,
      };
      res.writeHead(result.status, responseHeaders);
      res.end(result.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Internal server error';
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
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
