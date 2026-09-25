#!/usr/bin/env node
/**
 * One-command start (`npm start` from the repo root).
 *
 * 1. Builds the server only if needed: `tsc --build` is incremental, so it is
 *    a fast no-op when dist/ is already up to date.
 * 2. Builds the React SPA only if dist-ui/ is missing or older than its
 *    sources (web-ui/).
 * 3. Starts the localhost-only server (packages/web/dist/server-bin.js).
 *
 * Node built-ins only; no runtime dependencies.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webDir, '..', '..');
const require = createRequire(path.join(repoRoot, 'package.json'));

function run(label, args, cwd) {
  console.log(`> ${label}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n${label} failed. Did you run \`npm ci\` first?`);
    process.exit(result.status ?? 1);
  }
}

/** Newest mtime (ms) of any file under `p` (file or directory). */
function newestMtime(p) {
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of fs.readdirSync(p)) {
    if (entry === 'node_modules') continue;
    newest = Math.max(newest, newestMtime(path.join(p, entry)));
  }
  return newest;
}

// 1. Server (and the packages it depends on): incremental tsc build.
run('tsc --build', [require.resolve('typescript/bin/tsc'), '--build'], repoRoot);

// 2. SPA bundle: rebuild only when missing or stale.
const uiBuilt = newestMtime(path.join(webDir, 'dist-ui', 'index.html'));
if (uiBuilt === 0 || newestMtime(path.join(webDir, 'web-ui')) > uiBuilt) {
  const viteBin = path.join(
    path.dirname(require.resolve('vite/package.json')),
    'bin',
    'vite.js',
  );
  run(
    'vite build (web UI)',
    [viteBin, 'build', '--config', 'web-ui/vite.config.ts'],
    webDir,
  );
}

// 3. Start the server in this process (Ctrl+C stops it).
await import(pathToFileURL(path.join(webDir, 'dist', 'server-bin.js')).href);
