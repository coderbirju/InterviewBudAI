#!/usr/bin/env node
/**
 * Runnable entry point for the web server.
 * Usage: node ./dist/server-bin.js [--data-dir=<path>] [--port=<port>]
 *
 * If a `.env` file exists at the repo root it is loaded with Node's built-in
 * `process.loadEnvFile` (no dependency), whatever the working directory.
 * Variables already exported in your shell win over the file.
 */

import { loadDotEnv, REPO_DOTENV_PATH } from './config.js';
import { startServer } from './server.js';

const dotenv = loadDotEnv();
if (dotenv.status === 'unsupported') {
  console.warn(
    'Found .env but this Node version cannot load it (needs Node >= 20.12); export the variables in your shell instead.',
  );
} else if (dotenv.status === 'invalid') {
  console.warn(
    `Warning: could not load ${REPO_DOTENV_PATH} (${dotenv.error}); continuing without it.`,
  );
}

startServer({ argv: process.argv }).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
