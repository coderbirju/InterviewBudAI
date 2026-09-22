import * as http from 'node:http';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { AnthropicProvider, OllamaProvider } from '@ibai/providers';
import type { LlmProvider } from '@ibai/providers';
import {
  resolveDataDir,
  resolvePort,
  resolveHost,
  resolveOllamaUrl,
  resolveOllamaModel,
  resolveAnthropicApiKey,
  resolveAnthropicModel,
} from './config.js';
import { createCoachHandler } from './handler.js';

export interface ServerHandle {
  readonly url: string;
  close: () => Promise<void>;
}

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
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

  const dataDir = resolveDataDir(env, argv);
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

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      console.log(`InterviewBudAI web server running at ${url}`);
      console.log(`Provider: ${providerLabel}`);

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
