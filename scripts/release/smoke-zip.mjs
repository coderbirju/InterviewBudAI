#!/usr/bin/env node
/**
 * Smoke-test the release zip (ADR 0016 D2 step 4).
 *
 *   node scripts/release/smoke-zip.mjs --zip <dir>/interviewbudai-vX.Y.Z.zip
 *
 * Unzips into a temp folder, writes `IBAI_WEB_PORT=<free port>` to the
 * unzipped folder's `.env` (so a 200 also proves the bundle reads that
 * `.env`), starts `dist/server.js` with a temp data dir and a temp HOME,
 * checks `GET /` and `GET /api/catalog` return 200 and `/api/settings`
 * reports the release version, then stops it.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TIMEOUT_MS = 30_000;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function getStatus(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 0, body: '' };
  }
}

export async function smokeZip(zipFile) {
  const m = /interviewbudai-v(\d+\.\d+\.\d+)\.zip$/.exec(
    path.basename(zipFile),
  );
  if (!m) throw new Error(`unexpected zip name ${path.basename(zipFile)}`);
  const version = m[1];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-release-smoke-'));
  let child;
  try {
    const unzip = spawnSync('unzip', ['-q', path.resolve(zipFile), '-d', tmp], {
      stdio: 'inherit',
    });
    if (unzip.error) throw unzip.error;
    if (unzip.status !== 0)
      throw new Error(`unzip exited with ${unzip.status}`);
    const appDir = path.join(tmp, `interviewbudai-v${version}`);
    for (const f of [
      'dist/server.js',
      'dist-ui/index.html',
      'package.json',
      '.env.example',
    ]) {
      if (!fs.existsSync(path.join(appDir, f)))
        throw new Error(`zip is missing ${f}`);
    }
    if (fs.existsSync(path.join(appDir, '.env')))
      throw new Error('zip must not contain .env');

    const port = await freePort();
    fs.writeFileSync(path.join(appDir, '.env'), `IBAI_WEB_PORT=${port}\n`);
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    let output = '';
    child = spawn(
      process.execPath,
      [
        path.join(appDir, 'dist', 'server.js'),
        `--data-dir=${path.join(tmp, 'data')}`,
      ],
      {
        cwd: tmp,
        // A clean env: no provider keys, no IBAI_* from the caller, temp HOME.
        env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));

    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + TIMEOUT_MS;
    let root = { status: 0 };
    while (Date.now() < deadline && child.exitCode === null) {
      root = await getStatus(`${base}/`);
      if (root.status === 200) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (root.status !== 200) {
      throw new Error(
        `GET / did not return 200 on port ${port} from .env (got ${root.status})\n${output}`,
      );
    }
    const catalog = await getStatus(`${base}/api/catalog`);
    if (catalog.status !== 200)
      throw new Error(`GET /api/catalog returned ${catalog.status}`);
    const settings = await getStatus(`${base}/api/settings`);
    const reported =
      settings.status === 200
        ? JSON.parse(settings.body)?.app?.version
        : undefined;
    if (reported !== version) {
      throw new Error(
        `/api/settings reports version ${JSON.stringify(reported)}, want ${version}`,
      );
    }
    console.log(
      `Smoke test OK: ${path.basename(zipFile)} serves / and /api/catalog (v${version}).`,
    );
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--zip');
  smokeZip(i === -1 ? '' : args[i + 1]).catch((err) => {
    console.error(
      `::error::${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
