import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { createCoachHandler } from './handler.js';
import type { HandlerRequest, HandlerResponse } from './handler.js';
import { startServer } from './server.js';
import {
  allowedHostsFor,
  checkSameOrigin,
  isAllowedHost,
  mediaType,
  tokensEqual,
  SPA_CSP,
  SERVER_PAGE_CSP,
} from './security.js';

/**
 * Localhost hardening (Host allowlist, same-origin check, JSON-only API
 * writes, /setup CSRF token + path validation, security headers). Handler-level
 * tests use a real temp data dir so "no write happened" is asserted on disk.
 */

const PORT = 4173;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const CATALOG = createCatalogSource();
const PROBLEM_ID = CATALOG.list()[0]?.id ?? '';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-sec-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeHandler(): (req: HandlerRequest) => Promise<HandlerResponse> {
  return createCoachHandler({
    storage: new LocalFileStorageAdapter(tmpDir),
    catalog: CATALOG,
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    defaultDataDir: tmpDir,
    env: {},
    argv: [],
    port: PORT,
  });
}

/** POST a note with the given extra headers / content type. */
function postNote(
  handler: (req: HandlerRequest) => Promise<HandlerResponse>,
  content: string,
  opts: {
    headers?: Record<string, string>;
    contentType?: string;
  } = {},
): Promise<HandlerResponse> {
  return handler({
    method: 'POST',
    url: `/api/notes/${PROBLEM_ID}`,
    body: JSON.stringify({ content }),
    contentType: opts.contentType ?? 'application/json',
    headers: { host: HOST, ...opts.headers },
  });
}

/** The saved note content on disk (via the real adapter), or null. */
async function savedContent(): Promise<string | null> {
  const note = await new LocalFileStorageAdapter(tmpDir).readIntuitionNote(
    PROBLEM_ID,
  );
  return note?.content ?? null;
}

describe('security helpers', () => {
  const allowed = allowedHostsFor(PORT);

  it('allows only loopback hosts on the bound port', () => {
    expect(isAllowedHost('127.0.0.1:4173', allowed)).toBe(true);
    expect(isAllowedHost('LOCALHOST:4173', allowed)).toBe(true);
    expect(isAllowedHost('[::1]:4173', allowed)).toBe(true);
    expect(isAllowedHost('127.0.0.1', allowed)).toBe(false);
    expect(isAllowedHost('127.0.0.1:9999', allowed)).toBe(false);
    expect(isAllowedHost('evil.com:4173', allowed)).toBe(false);
    expect(isAllowedHost(undefined, allowed)).toBe(false);
  });

  it('checks Origin, then Sec-Fetch-Site, else allows non-browser clients', () => {
    expect(checkSameOrigin({ origin: ORIGIN }, allowed).ok).toBe(true);
    expect(
      checkSameOrigin({ origin: 'https://127.0.0.1:4173' }, allowed).ok,
    ).toBe(false);
    expect(checkSameOrigin({ origin: 'http://evil.com' }, allowed).ok).toBe(
      false,
    );
    expect(checkSameOrigin({ origin: 'null' }, allowed).ok).toBe(false);
    expect(
      checkSameOrigin({ 'sec-fetch-site': 'same-origin' }, allowed).ok,
    ).toBe(true);
    expect(checkSameOrigin({ 'sec-fetch-site': 'none' }, allowed).ok).toBe(
      true,
    );
    expect(checkSameOrigin({ 'sec-fetch-site': 'same-site' }, allowed).ok).toBe(
      false,
    );
    expect(
      checkSameOrigin({ 'sec-fetch-site': 'cross-site' }, allowed).ok,
    ).toBe(false);
    expect(checkSameOrigin({}, allowed).ok).toBe(true);
  });

  it('Origin: null (our no-referrer form post) defers to Sec-Fetch-Site', () => {
    const verdict = (site?: string) =>
      checkSameOrigin(
        site ? { origin: 'null', 'sec-fetch-site': site } : { origin: 'null' },
        allowed,
      ).ok;
    expect(verdict('same-origin')).toBe(true);
    expect(verdict('cross-site')).toBe(false);
    expect(verdict()).toBe(false);
  });

  it('parses media types and compares tokens safely', () => {
    expect(mediaType('Application/JSON; charset=utf-8')).toBe(
      'application/json',
    );
    expect(mediaType(undefined)).toBe('');
    expect(tokensEqual('abc', 'abc')).toBe(true);
    expect(tokensEqual('abc', 'abd')).toBe(false);
    expect(tokensEqual('abc', 'ab')).toBe(false);
    expect(tokensEqual('abc', null)).toBe(false);
  });
});

describe('Host allowlist (DNS rebinding)', () => {
  it('rejects a foreign Host on the SPA (plain text 421)', async () => {
    const res = await makeHandler()({
      method: 'GET',
      url: '/',
      headers: { host: 'evil.com' },
    });
    expect(res.status).toBe(421);
    expect(res.contentType).toContain('text/plain');
  });

  it('rejects a rebinding Host on /api (JSON 421), even with the right port', async () => {
    const res = await makeHandler()({
      method: 'GET',
      url: '/api/catalog',
      headers: { host: `evil.com:${PORT}` },
    });
    expect(res.status).toBe(421);
    expect(res.contentType).toContain('application/json');
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('rejects a missing Host and a wrong port', async () => {
    const handler = makeHandler();
    expect((await handler({ method: 'GET', url: '/api/config' })).status).toBe(
      421,
    );
    const wrongPort = await handler({
      method: 'GET',
      url: '/api/config',
      headers: { host: '127.0.0.1:1' },
    });
    expect(wrongPort.status).toBe(421);
  });

  it('rejects a foreign-Host write and writes nothing', async () => {
    const res = await postNote(makeHandler(), 'pwned', {
      headers: { host: 'evil.com', origin: 'http://evil.com' },
    });
    expect(res.status).toBe(421);
    expect(await savedContent()).toBeNull();
  });

  it('accepts localhost and [::1] on the bound port', async () => {
    const handler = makeHandler();
    for (const host of [`localhost:${PORT}`, `[::1]:${PORT}`, HOST]) {
      const res = await handler({
        method: 'GET',
        url: '/api/config',
        headers: { host },
      });
      expect(res.status).toBe(200);
    }
  });
});

describe('CSRF on /api writes', () => {
  it('same-origin JSON POST → 200 and persists', async () => {
    const res = await postNote(makeHandler(), 'mine', {
      headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
    });
    expect(res.status).toBe(200);
    expect(await savedContent()).toBe('mine');
  });

  it('cross-site Origin POST → 403 and the on-disk note is unchanged', async () => {
    const handler = makeHandler();
    expect(
      (await postNote(handler, 'original', { headers: { origin: ORIGIN } }))
        .status,
    ).toBe(200);

    const res = await postNote(handler, 'pwned', {
      headers: { origin: 'http://evil.com' },
    });
    expect(res.status).toBe(403);
    expect(res.contentType).toContain('application/json');
    expect(await savedContent()).toBe('original');
  });

  it('text/plain POST (the audit repro) → 415 and no write', async () => {
    const res = await postNote(makeHandler(), 'pwned', {
      contentType: 'text/plain',
    });
    expect(res.status).toBe(415);
    expect(await savedContent()).toBeNull();
  });

  it('form-encoded and missing Content-Type → 415', async () => {
    const handler = makeHandler();
    const form = await postNote(handler, 'x', {
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(form.status).toBe(415);
    const none = await handler({
      method: 'POST',
      url: '/api/quiz/end',
      headers: { host: HOST },
    });
    expect(none.status).toBe(415);
    expect(await savedContent()).toBeNull();
  });

  it('DELETE without a JSON Content-Type → 415', async () => {
    const res = await makeHandler()({
      method: 'DELETE',
      url: '/api/quiz/session/abc',
      headers: { host: HOST, origin: ORIGIN },
    });
    expect(res.status).toBe(415);
  });

  it('no Origin and no Sec-Fetch-Site (curl-style) JSON POST → allowed', async () => {
    const res = await postNote(makeHandler(), 'from curl');
    expect(res.status).toBe(200);
    expect(await savedContent()).toBe('from curl');
  });

  it('Sec-Fetch-Site: cross-site / same-site without Origin → 403, no write', async () => {
    const handler = makeHandler();
    for (const site of ['cross-site', 'same-site']) {
      const res = await postNote(handler, 'pwned', {
        headers: { 'sec-fetch-site': site },
      });
      expect(res.status).toBe(403);
    }
    expect(await savedContent()).toBeNull();
  });

  it('a cross-site Origin wins over a spoofed same-origin Sec-Fetch-Site', async () => {
    const res = await postNote(makeHandler(), 'pwned', {
      headers: { origin: 'http://evil.com', 'sec-fetch-site': 'same-origin' },
    });
    expect(res.status).toBe(403);
  });

  it('GET reads are unaffected by Origin (no state change)', async () => {
    const res = await makeHandler()({
      method: 'GET',
      url: '/api/catalog',
      headers: { host: HOST, origin: 'http://evil.com' },
    });
    expect(res.status).toBe(200);
  });
});

describe('/setup CSRF token + path validation', () => {
  async function token(
    handler: (req: HandlerRequest) => Promise<HandlerResponse>,
  ): Promise<string> {
    const res = await handler({
      method: 'GET',
      url: '/setup',
      headers: { host: HOST },
    });
    const match = /name="csrfToken" value="([^"]+)"/.exec(res.body);
    expect(match?.[1]).toBeTruthy();
    return match![1]!;
  }

  function postSetup(
    handler: (req: HandlerRequest) => Promise<HandlerResponse>,
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<HandlerResponse> {
    return handler({
      method: 'POST',
      url: '/setup',
      body: new URLSearchParams(fields).toString(),
      contentType: 'application/x-www-form-urlencoded',
      headers: { host: HOST, origin: ORIGIN, ...headers },
    });
  }

  it('rejects a missing or wrong token with 403 and creates nothing', async () => {
    const handler = makeHandler();
    const target = path.join(tmpDir, 'db');
    expect((await postSetup(handler, { dataDir: target })).status).toBe(403);
    expect(
      (await postSetup(handler, { dataDir: target, csrfToken: 'nope' })).status,
    ).toBe(403);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('a token from a different process (handler) is rejected', async () => {
    const other = await token(makeHandler());
    const target = path.join(tmpDir, 'db');
    const res = await postSetup(makeHandler(), {
      dataDir: target,
      csrfToken: other,
    });
    expect(res.status).toBe(403);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('rejects a cross-site Origin even with a valid token', async () => {
    const handler = makeHandler();
    const target = path.join(tmpDir, 'db');
    const res = await postSetup(
      handler,
      { dataDir: target, csrfToken: await token(handler) },
      { origin: 'http://evil.com' },
    );
    expect(res.status).toBe(403);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('a good token creates the directory with mode 0700 and a strict cookie', async () => {
    const handler = makeHandler();
    const target = path.join(tmpDir, 'nested', 'db');
    const res = await postSetup(handler, {
      dataDir: target,
      csrfToken: await token(handler),
    });
    expect(res.status).toBe(200);
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(fs.statSync(target).mode & 0o777).toBe(0o700);
    const cookie = res.headers?.['Set-Cookie'] ?? '';
    expect(cookie).toContain(`ibai_data_dir=${encodeURIComponent(target)}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });

  it('accepts a real browser form post (Origin: null + Sec-Fetch-Site: same-origin)', async () => {
    const handler = makeHandler();
    const target = path.join(tmpDir, 'browser-db');
    const res = await postSetup(
      handler,
      { dataDir: target, csrfToken: await token(handler) },
      { origin: 'null', 'sec-fetch-site': 'same-origin' },
    );
    expect(res.status).toBe(200);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('accepts an older-browser form post (same-origin Origin, no Sec-Fetch-Site)', async () => {
    const handler = makeHandler();
    const target = path.join(tmpDir, 'old-browser-db');
    const res = await handler({
      method: 'POST',
      url: '/setup',
      body: new URLSearchParams({
        dataDir: target,
        csrfToken: await token(handler),
      }).toString(),
      contentType: 'application/x-www-form-urlencoded',
      // Exactly what Safari <16.4 / Firefox <90 send from a same-origin page.
      headers: { host: HOST, origin: ORIGIN },
    });
    expect(res.status).toBe(200);
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(res.headers?.['Set-Cookie']).toContain('ibai_data_dir=');
  });

  it.each([
    ['a relative path', 'relative/db'],
    ['a filesystem root', '/'],
    ['a NUL byte', '/tmp/ibai\0evil'],
    ['an empty path', '   '],
  ])('rejects %s with 400 and no cookie', async (_label, dataDir) => {
    const handler = makeHandler();
    const res = await postSetup(handler, {
      dataDir,
      csrfToken: await token(handler),
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain('Could not create the database directory');
    expect(res.headers?.['Set-Cookie']).toBeUndefined();
  });

  it('rejects an existing file at the path', async () => {
    const handler = makeHandler();
    const file = path.join(tmpDir, 'afile');
    fs.writeFileSync(file, 'keep me');
    const res = await postSetup(handler, {
      dataDir: file,
      csrfToken: await token(handler),
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain('A file already exists');
    expect(fs.readFileSync(file, 'utf8')).toBe('keep me');
  });

  it('rejects a non-form Content-Type with 415', async () => {
    const handler = makeHandler();
    const res = await handler({
      method: 'POST',
      url: '/setup',
      body: new URLSearchParams({
        dataDir: path.join(tmpDir, 'x'),
        csrfToken: await token(handler),
      }).toString(),
      contentType: 'text/plain',
      headers: { host: HOST },
    });
    expect(res.status).toBe(415);
  });
});

describe('security headers', () => {
  it('are present on SPA, API, setup, and rejection responses', async () => {
    const handler = makeHandler();
    const responses = await Promise.all([
      handler({ method: 'GET', url: '/', headers: { host: HOST } }),
      handler({ method: 'GET', url: '/api/config', headers: { host: HOST } }),
      handler({ method: 'GET', url: '/setup', headers: { host: HOST } }),
      handler({ method: 'GET', url: '/', headers: { host: 'evil.com' } }),
    ]);
    for (const res of responses) {
      expect(res.headers?.['X-Content-Type-Options']).toBe('nosniff');
      expect(['no-referrer', 'same-origin']).toContain(
        res.headers?.['Referrer-Policy'],
      );
      expect(res.headers?.['X-Frame-Options']).toBe('DENY');
      expect(res.headers?.['Content-Security-Policy']).toContain(
        "frame-ancestors 'none'",
      );
    }
    const [spa, api, setup] = responses;
    expect(spa?.headers?.['Referrer-Policy']).toBe('no-referrer');
    expect(api?.headers?.['Referrer-Policy']).toBe('no-referrer');
    // Server-rendered pages: same-origin, so the /setup form post carries a
    // real Origin (not `null`) in browsers without Sec-Fetch-Site.
    expect(setup?.headers?.['Referrer-Policy']).toBe('same-origin');
  });

  it('uses the strict SPA CSP for the API and the script-free CSP for /setup', async () => {
    const handler = makeHandler();
    const api = await handler({
      method: 'GET',
      url: '/api/config',
      headers: { host: HOST },
    });
    expect(api.headers?.['Content-Security-Policy']).toBe(SPA_CSP);
    expect(SPA_CSP).toContain("script-src 'self'");
    expect(SPA_CSP).not.toContain('unsafe-inline');
    const setup = await handler({
      method: 'GET',
      url: '/setup',
      headers: { host: HOST },
    });
    expect(setup.headers?.['Content-Security-Policy']).toBe(SERVER_PAGE_CSP);
    expect(SERVER_PAGE_CSP).toContain("script-src 'none'");
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

  it('pins the Host allowlist to the bound port and blocks cross-site writes', async () => {
    const port = await freePort();
    const handle = await startServer({
      env: { IBAI_DATA_DIR: tmpDir },
      argv: [`--port=${port}`],
      homeDir: tmpDir,
      log: () => undefined,
    });
    try {
      const host = `127.0.0.1:${port}`;
      const ok = await request(port, {
        method: 'GET',
        path: '/api/config',
        headers: { host },
      });
      expect(ok.status).toBe(200);
      expect(ok.headers['x-content-type-options']).toBe('nosniff');

      const rebind = await request(port, {
        method: 'GET',
        path: '/api/config',
        headers: { host: `evil.com:${port}` },
      });
      expect(rebind.status).toBe(421);

      const body = JSON.stringify({ content: 'pwned' });
      const csrf = await request(port, {
        method: 'POST',
        path: `/api/notes/${PROBLEM_ID}`,
        headers: {
          host,
          origin: 'http://evil.com',
          'content-type': 'text/plain',
        },
        body,
      });
      expect(csrf.status).toBe(403);
      expect(await savedContent()).toBeNull();

      const good = await request(port, {
        method: 'POST',
        path: `/api/notes/${PROBLEM_ID}`,
        headers: {
          host,
          origin: `http://${host}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ content: 'mine' }),
      });
      expect(good.status).toBe(200);
      expect(await savedContent()).toBe('mine');
    } finally {
      await handle.close();
    }
  });
});
