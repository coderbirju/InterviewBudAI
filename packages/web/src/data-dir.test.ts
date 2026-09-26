import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { createCoachHandler } from './handler.js';
import type {
  CoachHandlerDeps,
  HandlerRequest,
  HandlerResponse,
} from './handler.js';
import {
  defaultDataDirFor,
  localConfigPathFor,
  readLocalConfig,
  resolveServerDataDir,
  writeLocalConfig,
} from './config.js';
import { startServer } from './server.js';
import {
  EXPIRE_LEGACY_DATA_DIR_COOKIE,
  MAX_BODY_BYTES,
  hasLegacyDataDirCookie,
} from './security.js';

/**
 * ADR 0005 amendment (w2d): the SERVER owns the data directory. It is resolved
 * once (flag > env > ~/.interviewbudai/config.json > default), only /setup can
 * change it, and the legacy `ibai_data_dir` cookie is ignored + expired. Every
 * test injects a temp home dir — the real home is never touched.
 */

const PORT = 4173;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const CATALOG = createCatalogSource();
const PROBLEM_ID = CATALOG.list()[0]?.id ?? '';

let root: string;
let home: string;
let serverDir: string;
let otherDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-datadir-test-'));
  home = path.join(root, 'home');
  serverDir = path.join(root, 'server-data');
  otherDir = path.join(root, 'victim');
  fs.mkdirSync(home);
  fs.mkdirSync(serverDir);
  fs.mkdirSync(otherDir);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

type Handler = (req: HandlerRequest) => Promise<HandlerResponse>;

function makeHandler(overrides: Partial<CoachHandlerDeps> = {}): Handler {
  const inner = createCoachHandler({
    storage: new LocalFileStorageAdapter(serverDir),
    catalog: CATALOG,
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    homeDir: home,
    env: {},
    argv: [],
    port: PORT,
    warn: () => undefined,
    ...overrides,
  });
  return (req) =>
    inner({ ...req, headers: { host: HOST, origin: ORIGIN, ...req.headers } });
}

async function noteIn(dir: string): Promise<string | null> {
  const note = await new LocalFileStorageAdapter(dir).readIntuitionNote(
    PROBLEM_ID,
  );
  return note?.content ?? null;
}

function postNote(
  handler: Handler,
  content: string,
  headers: Record<string, string> = {},
): Promise<HandlerResponse> {
  return handler({
    method: 'POST',
    url: `/api/notes/${PROBLEM_ID}`,
    body: JSON.stringify({ content }),
    contentType: 'application/json',
    headers,
  });
}

async function setupToken(handler: Handler): Promise<string> {
  const res = await handler({ method: 'GET', url: '/setup' });
  const match = /name="csrfToken" value="([^"]+)"/.exec(res.body);
  if (!match?.[1]) throw new Error('no CSRF token in /setup form');
  return match[1];
}

async function postSetup(
  handler: Handler,
  dataDir: string,
): Promise<HandlerResponse> {
  return handler({
    method: 'POST',
    url: '/setup',
    body: new URLSearchParams({
      dataDir,
      csrfToken: await setupToken(handler),
    }).toString(),
    contentType: 'application/x-www-form-urlencoded',
  });
}

async function configDir(handler: Handler): Promise<string | undefined> {
  const res = await handler({ method: 'GET', url: '/api/config' });
  return (JSON.parse(res.body) as { dataDir?: string }).dataDir;
}

describe('legacy ibai_data_dir cookie', () => {
  const evilCookie = () => `ibai_data_dir=${encodeURIComponent(otherDir)}`;

  it('is IGNORED for writes: the note lands in the server dir, not the cookie dir', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const res = await postNote(handler, 'mine', { cookie: evilCookie() });
    expect(res.status).toBe(200);
    expect(await noteIn(serverDir)).toBe('mine');
    expect(await noteIn(otherDir)).toBeNull();
    expect(fs.readdirSync(otherDir)).toEqual([]);
  });

  it('is IGNORED for reads and /api/config', async () => {
    await new LocalFileStorageAdapter(otherDir).writeIntuitionNote({
      problemId: PROBLEM_ID,
      content: 'planted',
      lastUpdated: new Date().toISOString() as never,
    });
    const handler = makeHandler({ dataDir: serverDir });
    const note = await handler({
      method: 'GET',
      url: `/api/notes/${PROBLEM_ID}`,
      headers: { cookie: evilCookie() },
    });
    expect(JSON.parse(note.body)).not.toMatchObject({ content: 'planted' });
    const cfg = await handler({
      method: 'GET',
      url: '/api/config',
      headers: { cookie: evilCookie() },
    });
    expect(JSON.parse(cfg.body).dataDir).toBe(serverDir);
  });

  // ADR 0009 D1: the cookie is kept as a recovery hint (still never used to
  // select the dir) until the user switches folders or dismisses the prompt.
  it('is NOT expired on ordinary responses (kept as a recovery hint)', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    for (const req of [
      { method: 'GET', url: '/api/config' },
      { method: 'GET', url: '/setup' },
      { method: 'GET', url: '/' },
      { method: 'GET', url: '/api/data-dir' },
    ]) {
      const res = await handler({
        ...req,
        headers: { cookie: `other=1; ${evilCookie()}` },
      });
      expect(res.headers?.['Set-Cookie']).toBeUndefined();
    }
  });

  it('is expired (Max-Age=0, same attributes) by a /setup switch, a /api/data-dir switch, or a dismiss', async () => {
    expect(EXPIRE_LEGACY_DATA_DIR_COOKIE).toBe(
      'ibai_data_dir=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict',
    );
    const cookie = { cookie: `other=1; ${evilCookie()}` };
    const handler = makeHandler({ dataDir: serverDir });

    const form = await handler({ method: 'GET', url: '/setup' });
    const token = /name="csrfToken" value="([^"]+)"/.exec(form.body)?.[1] ?? '';
    const setup = await handler({
      method: 'POST',
      url: '/setup',
      body: new URLSearchParams({
        dataDir: path.join(root, 'via-setup'),
        csrfToken: token,
      }).toString(),
      contentType: 'application/x-www-form-urlencoded',
      headers: cookie,
    });
    expect(setup.status).toBe(200);
    expect(setup.headers?.['Set-Cookie']).toBe(EXPIRE_LEGACY_DATA_DIR_COOKIE);

    for (const [url, body] of [
      ['/api/data-dir', { path: path.join(root, 'via-api') }],
      ['/api/data-dir/legacy/dismiss', {}],
    ] as const) {
      const res = await handler({
        method: 'POST',
        url,
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: cookie,
      });
      expect(res.status).toBe(200);
      expect(res.headers?.['Set-Cookie']).toBe(EXPIRE_LEGACY_DATA_DIR_COOKIE);
    }
  });

  it('a failed or dry-run switch does not expire it', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    for (const body of [
      { path: 'relative' },
      { path: otherDir, dryRun: true },
    ]) {
      const res = await handler({
        method: 'POST',
        url: '/api/data-dir',
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: { cookie: evilCookie() },
      });
      expect(res.headers?.['Set-Cookie']).toBeUndefined();
    }
  });

  it('a malformed cookie value neither crashes nor redirects writes', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const res = await postNote(handler, 'still mine', {
      cookie: 'ibai_data_dir=%E0%A4%A',
    });
    expect(res.status).toBe(200);
    expect(await noteIn(serverDir)).toBe('still mine');
    const status = await handler({
      method: 'GET',
      url: '/api/data-dir',
      headers: { cookie: 'ibai_data_dir=%E0%A4%A' },
    });
    expect(status.status).toBe(200);
  });

  it('no Set-Cookie when the request carries no legacy cookie', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const res = await handler({
      method: 'GET',
      url: '/api/config',
      headers: { cookie: 'unrelated=1; ibai_data_dirx=2' },
    });
    expect(res.headers?.['Set-Cookie']).toBeUndefined();
    expect(hasLegacyDataDirCookie(undefined)).toBe(false);
    expect(hasLegacyDataDirCookie(' ibai_data_dir = x')).toBe(true);
  });
});

describe('/setup persists the choice server-side', () => {
  it('writes config.json atomically and switches the active dir immediately', async () => {
    fs.mkdirSync(defaultDataDirFor(home), { recursive: true });
    const handler = makeHandler();
    // Nothing persisted yet → the default under the injected home.
    expect(await configDir(handler)).toBe(defaultDataDirFor(home));

    const target = path.join(root, 'chosen');
    const res = await postSetup(handler, target);
    expect(res.status).toBe(200);
    expect(readLocalConfig(home)).toEqual({ status: 'ok', dataDir: target });
    // No stray temp files next to config.json.
    expect(
      fs
        .readdirSync(path.dirname(localConfigPathFor(home)))
        .filter((f) => f.startsWith('config.json')),
    ).toEqual(['config.json']);

    // Subsequent requests (from any "browser" — no cookie) use it.
    expect(await configDir(handler)).toBe(target);
    expect((await postNote(handler, 'after setup')).status).toBe(200);
    expect(await noteIn(target)).toBe('after setup');
  });

  it('a restarted server (new handler, same home) picks up config.json', async () => {
    const target = path.join(root, 'chosen');
    await postSetup(makeHandler(), target);

    const restarted = makeHandler();
    expect(await configDir(restarted)).toBe(target);
    await postNote(restarted, 'survives restart');
    expect(await noteIn(target)).toBe('survives restart');
  });

  it('without an injected createStorage, writes after a switch never reach the boot dir', async () => {
    const handler = makeHandler({
      dataDir: serverDir,
      // Boot storage points at the OLD dir; it must never be used.
      storage: new LocalFileStorageAdapter(serverDir),
      createStorage: undefined,
    });
    const target = path.join(root, 'switched');
    expect((await postSetup(handler, target)).status).toBe(200);
    expect((await postNote(handler, 'new dir only')).status).toBe(200);
    expect(await noteIn(target)).toBe('new dir only');
    expect(await noteIn(serverDir)).toBeNull();
  });

  it('a second /setup replaces the persisted choice', async () => {
    const handler = makeHandler();
    await postSetup(handler, path.join(root, 'first'));
    const second = path.join(root, 'second');
    expect((await postSetup(handler, second)).status).toBe(200);
    expect(readLocalConfig(home)).toEqual({ status: 'ok', dataDir: second });
    expect(await configDir(handler)).toBe(second);
  });

  it('does not switch when config.json cannot be written', async () => {
    // A FILE where the config directory should be → mkdir fails.
    fs.writeFileSync(path.join(home, '.interviewbudai'), 'blocker');
    const handler = makeHandler({ dataDir: serverDir });
    const res = await postSetup(handler, path.join(root, 'chosen'));
    expect(res.status).toBe(400);
    expect(res.body).toContain('Could not save your choice');
    expect(await configDir(handler)).toBe(serverDir);
  });
});

describe('a data dir pinned by flag/env', () => {
  const pinned = () => path.join(root, 'pinned');

  it.each([
    ['IBAI_DATA_DIR', 'IBAI_DATA_DIR'],
    ['--data-dir', '--data-dir'],
  ])('%s: /setup says so and refuses to change it (400)', async (_l, kind) => {
    fs.mkdirSync(pinned());
    const handler = makeHandler(
      kind === 'IBAI_DATA_DIR'
        ? { env: { IBAI_DATA_DIR: pinned() } }
        : { argv: [`--data-dir=${pinned()}`] },
    );
    const form = await handler({ method: 'GET', url: '/setup' });
    expect(form.body).toContain('pinned');
    expect(form.body).toContain(kind);

    const elsewhere = path.join(root, 'elsewhere');
    const res = await postSetup(handler, elsewhere);
    expect(res.status).toBe(400);
    expect(res.body).toContain('pinned');
    expect(res.body).toContain(kind);
    expect(fs.existsSync(elsewhere)).toBe(false);
    expect(fs.existsSync(localConfigPathFor(home))).toBe(false);
    expect(await configDir(handler)).toBe(pinned());
  });

  it('/setup may still CREATE the pinned dir (no config.json written)', async () => {
    const handler = makeHandler({ env: { IBAI_DATA_DIR: pinned() } });
    const res = await postSetup(handler, pinned());
    expect(res.status).toBe(200);
    expect(fs.statSync(pinned()).isDirectory()).toBe(true);
    expect(fs.existsSync(localConfigPathFor(home))).toBe(false);
    // The success page must not claim the choice was saved.
    expect(res.body).toContain(
      'pinned by the IBAI_DATA_DIR environment variable',
    );
    expect(res.body).toContain('created or verified');
    expect(res.body).not.toContain('has been saved');
  });

  it('flag/env win over config.json', () => {
    writeLocalConfig(home, path.join(root, 'saved'));
    expect(
      resolveServerDataDir({ IBAI_DATA_DIR: '/env/dir' }, [], home),
    ).toEqual({ dataDir: '/env/dir', source: 'env' });
    expect(
      resolveServerDataDir(
        { IBAI_DATA_DIR: '/env/dir' },
        ['--data-dir=/flag/dir'],
        home,
      ),
    ).toEqual({ dataDir: '/flag/dir', source: 'flag' });
    expect(resolveServerDataDir({}, [], home)).toEqual({
      dataDir: path.join(root, 'saved'),
      source: 'config',
    });
  });
});

describe('config.json is untrusted', () => {
  it.each([
    ['not JSON', '{nope'],
    ['a JSON array', '["/tmp/x"]'],
    ['a missing dataDir', '{}'],
    ['a non-string dataDir', '{"dataDir": 42}'],
    ['a relative dataDir', '{"dataDir": "relative/dir"}'],
    ['a NUL byte', JSON.stringify({ dataDir: '/tmp/ibai\u0000evil' })],
    ['a filesystem root', '{"dataDir": "/"}'],
  ])('%s → warn once and fall back to the default', async (_l, text) => {
    fs.mkdirSync(path.join(home, '.interviewbudai'));
    fs.writeFileSync(localConfigPathFor(home), text);
    expect(readLocalConfig(home).status).toBe('invalid');

    const warnings: string[] = [];
    const handler = makeHandler({ warn: (line) => warnings.push(line) });
    fs.mkdirSync(defaultDataDirFor(home));
    expect(await configDir(handler)).toBe(defaultDataDirFor(home));
    await handler({ method: 'GET', url: '/api/config' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ignoring invalid');
  });

  it('an absent config.json is silent', () => {
    expect(readLocalConfig(home)).toEqual({ status: 'absent' });
    expect(resolveServerDataDir({}, [], home)).toEqual({
      dataDir: defaultDataDirFor(home),
      source: 'default',
    });
  });

  it('writeLocalConfig writes 0600 in a 0700 dir', () => {
    writeLocalConfig(home, '/some/abs/dir');
    const file = localConfigPathFor(home);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      dataDir: '/some/abs/dir',
    });
  });
});

describe('request body cap', () => {
  const big = () => 'x'.repeat(MAX_BODY_BYTES + 1);

  it('an /api body over the cap → 413 JSON and no write', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const res = await postNote(handler, big());
    expect(res.status).toBe(413);
    expect(res.contentType).toContain('application/json');
    expect(JSON.parse(res.body)).toHaveProperty('error');
    expect(await noteIn(serverDir)).toBeNull();
  });

  it('a /setup body over the cap → 413 plain text and nothing created', async () => {
    const handler = makeHandler();
    const target = path.join(root, 'too-big');
    const res = await handler({
      method: 'POST',
      url: '/setup',
      body: `dataDir=${encodeURIComponent(target)}&csrfToken=${await setupToken(handler)}&pad=${big()}`,
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(res.status).toBe(413);
    expect(res.contentType).toContain('text/plain');
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(localConfigPathFor(home))).toBe(false);
  });

  it('the transport flag bodyTooLarge → 413', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${PROBLEM_ID}`,
      bodyTooLarge: true,
      contentType: 'application/json',
    });
    expect(res.status).toBe(413);
  });

  it('a body exactly at the cap is accepted (parsed normally)', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const prefix = '{"content":"';
    const suffix = '"}';
    const body =
      prefix +
      'y'.repeat(MAX_BODY_BYTES - prefix.length - suffix.length) +
      suffix;
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${PROBLEM_ID}`,
      body,
      contentType: 'application/json',
    });
    expect(res.status).not.toBe(413);
  });
});

describe('over a real loopback socket', () => {
  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => resolve(port));
      });
    });
  }

  function request(
    port: number,
    opts: {
      method: string;
      path: string;
      headers: Record<string, string>;
      body?: string;
    },
  ): Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: opts.method,
          path: opts.path,
          headers: opts.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(opts.body);
    });
  }

  it('ignores a malicious cookie and caps bodies (413)', async () => {
    const port = await freePort();
    const lines: string[] = [];
    const handle = await startServer({
      env: {},
      argv: [`--port=${port}`],
      homeDir: home,
      log: (line) => lines.push(line),
    });
    const host = `127.0.0.1:${port}`;
    const writeHeaders = {
      host,
      origin: `http://${host}`,
      'content-type': 'application/json',
    };
    try {
      // Boot resolved the default under the injected home.
      expect(lines.join('\n')).toContain(defaultDataDirFor(home));

      const evil = await request(port, {
        method: 'POST',
        path: `/api/notes/${PROBLEM_ID}`,
        headers: {
          ...writeHeaders,
          cookie: `ibai_data_dir=${encodeURIComponent(otherDir)}`,
        },
        body: JSON.stringify({ content: 'socket note' }),
      });
      expect(evil.status).toBe(200);
      // Kept as a recovery hint until a switch / dismiss (ADR 0009 D1).
      expect(evil.headers['set-cookie']).toBeUndefined();
      expect(await noteIn(defaultDataDirFor(home))).toBe('socket note');
      expect(fs.readdirSync(otherDir)).toEqual([]);

      const dismissed = await request(port, {
        method: 'POST',
        path: '/api/data-dir/legacy/dismiss',
        headers: {
          ...writeHeaders,
          cookie: `ibai_data_dir=${encodeURIComponent(otherDir)}`,
        },
        body: '{}',
      });
      expect(dismissed.status).toBe(200);
      expect(dismissed.headers['set-cookie']).toEqual([
        EXPIRE_LEGACY_DATA_DIR_COOKIE,
      ]);
    } finally {
      await handle.close();
    }
  });

  /**
   * Raw-socket exchange: send `head` (request line + headers), optionally
   * flood a chunked body, and collect whatever comes back until the server
   * closes the connection.
   */
  function rawExchange(
    port: number,
    head: string,
    flood: boolean,
  ): Promise<{ response: string; sent: number; ms: number }> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const socket = net.connect(port, '127.0.0.1');
      const chunks: Buffer[] = [];
      let sent = 0;
      let closed = false;
      const LIMIT = 16 * MAX_BODY_BYTES; // fail-safe: the server must cut us off
      const chunk = Buffer.alloc(64 * 1024, 'a');
      const frame = Buffer.concat([
        Buffer.from(`${chunk.length.toString(16)}\r\n`),
        chunk,
        Buffer.from('\r\n'),
      ]);
      const pump = () => {
        while (!closed && sent < LIMIT) {
          sent += chunk.length;
          if (!socket.write(frame)) {
            socket.once('drain', pump);
            return;
          }
        }
        if (!closed) reject(new Error('server never closed the upload'));
      };
      socket.on('data', (c: Buffer) => chunks.push(c));
      // A reset while we are still writing is an acceptable way to close.
      socket.on('error', () => undefined);
      socket.on('close', () => {
        closed = true;
        resolve({
          response: Buffer.concat(chunks).toString('utf8'),
          sent,
          ms: Date.now() - started,
        });
      });
      socket.write(head, () => {
        if (flood) pump();
      });
    });
  }

  it('a huge declared Content-Length gets 413 fast, without the upload', async () => {
    const port = await freePort();
    const handle = await startServer({
      env: {},
      argv: [`--port=${port}`],
      homeDir: home,
      log: () => undefined,
    });
    try {
      const host = `127.0.0.1:${port}`;
      const { response, ms } = await rawExchange(
        port,
        `POST /api/notes/${PROBLEM_ID} HTTP/1.1\r\nHost: ${host}\r\n` +
          `Origin: http://${host}\r\nContent-Type: application/json\r\n` +
          `Content-Length: ${10 * 1024 * 1024 * 1024}\r\n\r\n`,
        false,
      );
      expect(response.startsWith('HTTP/1.1 413')).toBe(true);
      expect(response.toLowerCase()).toContain('connection: close');
      expect(response).toContain('payload too large');
      expect(ms).toBeLessThan(5_000);
      expect(await noteIn(defaultDataDirFor(home))).toBeNull();
    } finally {
      await handle.close();
    }
  });

  it('a chunked upload over the limit is cut off (connection closed)', async () => {
    const port = await freePort();
    const handle = await startServer({
      env: {},
      argv: [`--port=${port}`],
      homeDir: home,
      log: () => undefined,
    });
    try {
      const host = `127.0.0.1:${port}`;
      const { response, sent } = await rawExchange(
        port,
        `POST /api/notes/${PROBLEM_ID} HTTP/1.1\r\nHost: ${host}\r\n` +
          `Origin: http://${host}\r\nContent-Type: application/json\r\n` +
          `Transfer-Encoding: chunked\r\n\r\n`,
        true,
      );
      // Closed long before the fail-safe; the 413 usually arrives first.
      expect(sent).toBeLessThan(16 * MAX_BODY_BYTES);
      if (response !== '') {
        expect(response.startsWith('HTTP/1.1 413')).toBe(true);
      }
      expect(await noteIn(defaultDataDirFor(home))).toBeNull();
    } finally {
      await handle.close();
    }
  });

  it('a cross-site POST is rejected (403) before its body is read', async () => {
    const port = await freePort();
    const handle = await startServer({
      env: {},
      argv: [`--port=${port}`],
      homeDir: home,
      log: () => undefined,
    });
    try {
      const host = `127.0.0.1:${port}`;
      const { response } = await rawExchange(
        port,
        `POST /api/notes/${PROBLEM_ID} HTTP/1.1\r\nHost: ${host}\r\n` +
          `Origin: http://evil.com\r\nContent-Type: application/json\r\n` +
          `Content-Length: ${10 * 1024 * 1024 * 1024}\r\n\r\n`,
        false,
      );
      expect(response.startsWith('HTTP/1.1 403')).toBe(true);
      expect(response.toLowerCase()).toContain('connection: close');
    } finally {
      await handle.close();
    }
  });

  it('warns once at boot on an invalid config.json and falls back', async () => {
    fs.mkdirSync(path.join(home, '.interviewbudai'));
    fs.writeFileSync(localConfigPathFor(home), '{"dataDir": "relative"}');
    const port = await freePort();
    const lines: string[] = [];
    const handle = await startServer({
      env: {},
      argv: [`--port=${port}`],
      homeDir: home,
      log: (line) => lines.push(line),
    });
    try {
      expect(lines.filter((l) => l.includes('ignoring invalid'))).toHaveLength(
        1,
      );
      const cfg = await request(port, {
        method: 'GET',
        path: '/api/config',
        headers: { host: `127.0.0.1:${port}` },
      });
      expect(JSON.parse(cfg.body).dataDir).toBe(defaultDataDirFor(home));
    } finally {
      await handle.close();
    }
  });
});
