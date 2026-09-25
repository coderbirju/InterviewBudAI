#!/usr/bin/env node
/**
 * Runnable entry point for the web server.
 * Usage: node ./dist/server-bin.js [--data-dir=<path>] [--port=<port>]
 *
 * If a `.env` file exists in the current working directory it is loaded with
 * Node's built-in `process.loadEnvFile` (no dependency). Variables already
 * exported in your shell win over the file.
 */

import { loadDotEnv } from './config.js';
import { startServer } from './server.js';

if (loadDotEnv() === 'unsupported') {
  console.warn(
    'Found .env but this Node version cannot load it (needs Node >= 20.12); export the variables in your shell instead.',
  );
}

startServer({ argv: process.argv }).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
