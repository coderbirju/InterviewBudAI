#!/usr/bin/env node
/**
 * Runnable entry point for the web server.
 * Usage: node ./dist/server-bin.js [--data-dir=<path>] [--port=<port>]
 */

import { startServer } from './server.js';

startServer({ argv: process.argv }).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
