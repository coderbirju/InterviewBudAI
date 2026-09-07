import * as http from 'node:http';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { resolveDataDir, resolvePort, resolveHost } from './config.js';
import { createAssessHandler } from './handler.js';

export interface ServerHandle {
  readonly url: string;
  close: () => Promise<void>;
}

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
}

/**
 * Start the web server. Composition root: resolves config, constructs adapter, builds handler.
 */
export async function startServer(
  opts?: StartServerOptions,
): Promise<ServerHandle> {
  const env = opts?.env ?? process.env;
  const argv = opts?.argv;

  const dataDir = resolveDataDir(env, argv);
  const port = resolvePort(env, argv);
  const host = resolveHost();

  const storage = new LocalFileStorageAdapter(dataDir);
  const handler = createAssessHandler({ storage });

  const server = http.createServer(async (req, res) => {
    try {
      const result = await handler({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
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
