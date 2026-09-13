import * as http from 'node:http';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { EchoDemoProvider, OllamaProvider } from '@ibai/providers';
import type { LlmProvider } from '@ibai/providers';
import {
  resolveDataDir,
  resolvePort,
  resolveHost,
  resolveOllamaUrl,
  resolveOllamaModel,
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
 * For coach operations, the server requires IBAI_OLLAMA_MODEL to be set.
 * If not set, GET /coach will show the form but POST /coach will return an error.
 */
export async function startServer(
  opts?: StartServerOptions,
): Promise<ServerHandle> {
  const env = opts?.env ?? process.env;
  const argv = opts?.argv;

  const dataDir = resolveDataDir(env, argv);
  const port = resolvePort(env, argv);
  const host = resolveHost();

  // Resolve Ollama config (provider is optional - only needed for coach)
  const ollamaUrl = resolveOllamaUrl(env);
  const ollamaModel = resolveOllamaModel(env);

  // Create storage adapter
  const storage = new LocalFileStorageAdapter(dataDir);

  // Create provider: OllamaProvider if model configured, EchoDemoProvider otherwise
  const provider: LlmProvider = ollamaModel
    ? new OllamaProvider({ endpoint: ollamaUrl, model: ollamaModel })
    : new EchoDemoProvider();

  const providerLabel = ollamaModel
    ? `Using Ollama: ${ollamaModel}`
    : 'Demo interviewer (no LLM configured)';

  // Create handler with storage, provider, and label
  const handler = createCoachHandler({ storage, provider, providerLabel });

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
      });

      res.writeHead(result.status, { 'Content-Type': result.contentType });
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
