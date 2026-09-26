import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { StorageAdapter } from '@ibai/storage';
import { createCoachHandler } from './handler.js';
import type { HandlerRequest } from './handler.js';
import { bundleExists } from './spa.js';

/**
 * Handler tests for M6 (ADR 0006) — the React SPA is the whole app.
 *
 * The server surface is intentionally small:
 *   - `/api/*`  — JSON API (delegated to api.ts; smoke-tested here)
 *   - `/setup`  — the one remaining server-rendered page (create-database +
 *                 persisted server-side config.json)
 *   - everything else (GET) — the SPA bundle/assets with an index.html fallback
 *
 * These tests are bundle-artifact-aware: the SPA-at-/ assertions adapt to
 * whether the Vite bundle (dist-ui) has been built. `/api` and `/setup` never
 * depend on the bundle.
 */

// Minimal storage stub — /setup and SPA paths never touch it.
const stubStorage = {} as StorageAdapter;

describe('createCoachHandler (M6 server surface)', () => {
  let testDataDir: string | null = null;

  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-test-'));
  });

  afterEach(() => {
    if (testDataDir && fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
      testDataDir = null;
    }
  });

  // Requests carry a valid localhost Host (the Host allowlist is exercised in
  // security.test.ts).
  const createHandler = () => {
    const handler = createCoachHandler({
      storage: stubStorage,
      dataDir: '/nonexistent/path/that/does/not/exist',
      // config.json goes to the temp dir, never the real home.
      homeDir: testDataDir!,
      env: {},
      argv: [],
      port: 4173,
    });
    return (req: HandlerRequest) =>
      handler({ ...req, headers: { host: '127.0.0.1:4173', ...req.headers } });
  };

  /** Fetch the per-process CSRF token embedded in the GET /setup form. */
  const setupToken = async (
    handler: ReturnType<typeof createHandler>,
  ): Promise<string> => {
    const res = await handler({ method: 'GET', url: '/setup' });
    const match = /name="csrfToken" value="([^"]+)"/.exec(res.body);
    if (!match?.[1]) throw new Error('no CSRF token in /setup form');
    return match[1];
  };

  describe('SPA at the site root', () => {
    it('GET / serves the SPA (bundle HTML or graceful not-built message)', async () => {
      const handler = createHandler();
      const res = await handler({ method: 'GET', url: '/' });
      expect(res.status).toBe(200);
      expect(res.contentType).toContain('text/html');
      expect(res.body.length).toBeGreaterThan(0);

      if (bundleExists()) {
        // Built SPA references local, root-relative assets — NO external CDN.
        expect(res.body).toContain('/assets/');
        expect(res.body).not.toMatch(/src="https?:\/\//);
        expect(res.body).not.toMatch(/href="https?:\/\//);
      } else {
        expect(res.body).toContain('build:ui');
      }
    });

    it('GET a client-side route (/analytics) falls back to the SPA (not old HTML)', async () => {
      const handler = createHandler();
      const res = await handler({ method: 'GET', url: '/analytics' });
      expect(res.status).toBe(200);
      expect(res.contentType).toContain('text/html');
      // The retired server-rendered analytics markers must be gone.
      expect(res.body).not.toContain('Where You Stand');
      expect(res.body).not.toContain('Your Next Session');
    });

    it('GET a retired page path (/coach) no longer serves the old HTML', async () => {
      const handler = createHandler();
      const res = await handler({ method: 'GET', url: '/coach' });
      // Either the SPA shell (200) or the not-built message — never the old page.
      expect(res.status).toBe(200);
      expect(res.body).not.toContain('interview coach');
      expect(res.body).not.toContain('provider-banner');
    });

    it('GET /catalog no longer serves the old catalog table', async () => {
      const handler = createHandler();
      const res = await handler({ method: 'GET', url: '/catalog' });
      expect(res.status).toBe(200);
      expect(res.body).not.toContain('catalog-table');
    });

    it('POST to a SPA path returns 405 (GET-only surface)', async () => {
      const handler = createHandler();
      const res = await handler({ method: 'POST', url: '/' });
      expect(res.status).toBe(405);
      expect(res.contentType).toContain('application/json');
    });
  });

  describe('/api handoff', () => {
    it('GET /api/config returns 200 JSON with dbConfigured=false (no dir)', async () => {
      const handler = createHandler();
      const res = await handler({ method: 'GET', url: '/api/config' });
      expect(res.status).toBe(200);
      expect(res.contentType).toContain('application/json');
      const body = JSON.parse(res.body);
      expect(body.dbConfigured).toBe(false);
    });

    it('GET /api/config ignores a legacy cookie dir and expires the cookie', async () => {
      const handler = createHandler();
      const res = await handler({
        method: 'GET',
        url: '/api/config',
        headers: {
          cookie: `ibai_data_dir=${encodeURIComponent(testDataDir!)}`,
        },
      });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      // The server's (missing) dir wins; the cookie's existing dir is ignored.
      expect(body.dbConfigured).toBe(false);
      expect(body.dataDir).toBeUndefined();
      expect(res.headers?.['Set-Cookie']).toBe(
        'ibai_data_dir=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict',
      );
    });

    it('GET /api/catalog and /api/progress return 200 JSON', async () => {
      const handler = createHandler();
      const cat = await handler({ method: 'GET', url: '/api/catalog' });
      const prog = await handler({ method: 'GET', url: '/api/progress' });
      expect(cat.status).toBe(200);
      expect(cat.contentType).toContain('application/json');
      expect(prog.status).toBe(200);
      expect(prog.contentType).toContain('application/json');
    });

    it('unknown /api path 404s as JSON (not the SPA)', async () => {
      const handler = createHandler();
      const res = await handler({ method: 'GET', url: '/api/nope' });
      expect(res.status).toBe(404);
      expect(res.contentType).toContain('application/json');
    });
  });

  describe('/setup (create-database flow)', () => {
    it('GET /setup returns 200 HTML with the create form', async () => {
      const handler = createHandler();
      const res = await handler({ method: 'GET', url: '/setup' });
      expect(res.status).toBe(200);
      expect(res.contentType).toContain('text/html');
      expect(res.body).toContain('action="/setup"');
      expect(res.body).toContain('Create Database');
    });

    it('POST /setup creates the directory and persists config.json (no cookie)', async () => {
      const handler = createHandler();
      const target = path.join(testDataDir!, 'nested-db');
      const res = await handler({
        method: 'POST',
        url: '/setup',
        body: `dataDir=${encodeURIComponent(target)}&csrfToken=${await setupToken(handler)}`,
        contentType: 'application/x-www-form-urlencoded',
      });

      expect(res.status).toBe(200);
      // Directory was created.
      expect(fs.existsSync(target)).toBe(true);
      // The choice is persisted server-side, not in a browser cookie.
      const configFile = path.join(
        testDataDir!,
        '.interviewbudai',
        'config.json',
      );
      expect(JSON.parse(fs.readFileSync(configFile, 'utf8'))).toEqual({
        dataDir: target,
      });
      expect(res.headers?.['Set-Cookie']).toBeUndefined();
      // Success page links back to the SPA root.
      expect(res.body).toContain('href="/"');
    });

    it('create-db then GET /api/config (no cookie) reports dbConfigured', async () => {
      const handler = createHandler();
      const target = path.join(testDataDir!, 'created');
      await handler({
        method: 'POST',
        url: '/setup',
        body: `dataDir=${encodeURIComponent(target)}&csrfToken=${await setupToken(handler)}`,
        contentType: 'application/x-www-form-urlencoded',
      });

      const config = await handler({ method: 'GET', url: '/api/config' });
      const body = JSON.parse(config.body);
      expect(body.dbConfigured).toBe(true);
      expect(body.dataDir).toBe(target);
    });

    it('POST /setup with an uncreatable path returns the error page', async () => {
      const handler = createHandler();
      // A path under an existing FILE cannot be created as a directory.
      const filePath = path.join(testDataDir!, 'afile');
      fs.writeFileSync(filePath, 'x');
      const res = await handler({
        method: 'POST',
        url: '/setup',
        body: `dataDir=${encodeURIComponent(path.join(filePath, 'sub'))}&csrfToken=${await setupToken(handler)}`,
        contentType: 'application/x-www-form-urlencoded',
      });
      expect(res.status).toBe(400);
      expect(res.body).toContain('Could not create the database directory');
      // Nothing persisted on failure.
      expect(res.headers?.['Set-Cookie']).toBeUndefined();
      expect(
        fs.existsSync(path.join(testDataDir!, '.interviewbudai', 'config.json')),
      ).toBe(false);
    });

    it('DELETE /setup returns 405', async () => {
      const handler = createHandler();
      const res = await handler({ method: 'DELETE', url: '/setup' });
      expect(res.status).toBe(405);
    });
  });
});
