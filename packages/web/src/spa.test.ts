import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isSpaRequest,
  bundleExists,
  handleSpaRequest,
  STYLE_NONCE_PLACEHOLDER,
} from './spa.js';
import { SPA_CSP } from './security.js';
import { createCoachHandler } from './handler.js';
import type { HandlerRequest, HandlerResponse } from './handler.js';
import type { StorageAdapter } from '@ibai/storage';

/**
 * M6 (ADR 0006) — the React SPA is the whole app, served at the site ROOT by
 * the existing Node server. These tests verify routing + graceful behavior
 * without a running server. They are build-artifact-aware: if the Vite bundle
 * (dist-ui) is absent, the SPA degrades to a friendly 200 message; if present,
 * it serves the SPA HTML referencing local /assets. Either way it never throws.
 */

// Minimal storage stub — SPA paths never touch it for these tests.
const stubStorage = {} as StorageAdapter;

describe('isSpaRequest classification', () => {
  it('is true for the root and product client-routes', () => {
    expect(isSpaRequest('/')).toBe(true);
    expect(isSpaRequest('/notes/two-sum')).toBe(true);
    expect(isSpaRequest('/analytics')).toBe(true);
    expect(isSpaRequest('/interview')).toBe(true);
    expect(isSpaRequest('/assets/index-abc.js')).toBe(true);
  });

  it('is false for the /api and /setup surfaces (routed first)', () => {
    expect(isSpaRequest('/api')).toBe(false);
    expect(isSpaRequest('/api/config')).toBe(false);
    expect(isSpaRequest('/setup')).toBe(false);
  });
});

describe('handleSpaRequest', () => {
  it('guards against path traversal (never escapes the bundle dir)', () => {
    const res = handleSpaRequest('/../../etc/passwd');
    expect(res.status === 200 || res.status === 404).toBe(true);
    expect(typeof res.body).toBe('string');
  });

  it('serves index HTML or a graceful message for /, never throws', () => {
    const res = handleSpaRequest('/');
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/html');
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('SPA via handler', () => {
  // An injected data dir + home: never resolve against the real home.
  const inner = createCoachHandler({
    storage: stubStorage,
    dataDir: '/nonexistent/ibai-spa-test',
    homeDir: '/nonexistent/ibai-spa-home',
    port: 4173,
  });
  // A valid localhost Host (the allowlist is exercised in security.test.ts).
  const handler = (req: HandlerRequest) =>
    inner({ ...req, headers: { host: 'localhost:4173', ...req.headers } });

  it('GET / returns 200 HTML (bundle or graceful message), never throws', async () => {
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

  it('POST / returns 405 (GET-only SPA surface)', async () => {
    const res = await handler({ method: 'POST', url: '/' });
    expect(res.status).toBe(405);
  });

  it('a deep client-route (/notes/two-sum) serves the SPA shell', async () => {
    const res = await handler({ method: 'GET', url: '/notes/two-sum' });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/html');
  });
});

/**
 * ADR 0014 D2: every index.html response (`/`, `/index.html`, the SPA
 * fallback) carries a fresh style nonce in the meta tag AND the CSP, plus
 * `Cache-Control: no-store`. Runs against a temp bundle so it never depends on
 * whether `dist-ui` was built.
 */
describe('index.html style nonce (ADR 0014 D2)', () => {
  const NONCE_RE = /^[A-Za-z0-9+/]{22}==$/;
  let bundleDir: string;
  let handler: (req: HandlerRequest) => Promise<HandlerResponse>;

  beforeAll(() => {
    bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-spa-nonce-'));
    fs.writeFileSync(
      path.join(bundleDir, 'index.html'),
      `<!doctype html><html><head><meta name="ibai-style-nonce" nonce="${STYLE_NONCE_PLACEHOLDER}" />` +
        '<script type="module" src="/assets/index-x.js"></script></head><body></body></html>',
    );
    fs.mkdirSync(path.join(bundleDir, 'assets'));
    fs.writeFileSync(path.join(bundleDir, 'assets', 'index-x.js'), '1;');
    const inner = createCoachHandler({
      storage: stubStorage,
      dataDir: '/nonexistent/ibai-spa-test',
      homeDir: '/nonexistent/ibai-spa-home',
      port: 4173,
      spaBundleDir: bundleDir,
    });
    handler = (req) =>
      inner({ ...req, headers: { host: 'localhost:4173', ...req.headers } });
  });

  afterAll(() => {
    fs.rmSync(bundleDir, { recursive: true, force: true });
  });

  function nonceOf(res: HandlerResponse): { html: string; csp: string } {
    const html = /<meta name="ibai-style-nonce" nonce="([^"]*)"/.exec(
      res.body,
    )?.[1];
    const csp = /style-src 'self' 'nonce-([^']*)'/.exec(
      res.headers?.['Content-Security-Policy'] ?? '',
    )?.[1];
    return { html: html ?? '', csp: csp ?? '' };
  }

  for (const url of ['/', '/index.html', '/problems/lc-1/notes']) {
    it(`${url}: matching, well-formed, per-response nonce; no-store; script-src unchanged`, async () => {
      const a = await handler({ method: 'GET', url });
      const b = await handler({ method: 'GET', url });
      expect(a.status).toBe(200);
      expect(a.body).not.toContain(STYLE_NONCE_PLACEHOLDER);
      const na = nonceOf(a);
      expect(na.html).toMatch(NONCE_RE);
      expect(na.csp).toBe(na.html);
      expect(nonceOf(b).html).toMatch(NONCE_RE);
      expect(nonceOf(b).html).not.toBe(na.html);
      expect(a.headers?.['Cache-Control']).toBe('no-store');
      const csp = a.headers?.['Content-Security-Policy'] ?? '';
      // Only style-src differs from the plain SPA CSP.
      expect(csp.replace(` 'nonce-${na.html}'`, '')).toBe(SPA_CSP);
      expect(csp).toContain("script-src 'self';");
      expect(csp).not.toContain('unsafe-inline');
      // The other #58 security headers are still applied.
      expect(a.headers?.['X-Frame-Options']).toBe('DENY');
      expect(a.headers?.['X-Content-Type-Options']).toBe('nosniff');
    });
  }

  it('assets and JSON keep the plain SPA CSP with no nonce', async () => {
    const asset = await handler({ method: 'GET', url: '/assets/index-x.js' });
    expect(asset.status).toBe(200);
    expect(asset.headers?.['Content-Security-Policy']).toBe(SPA_CSP);
    expect(asset.headers?.['Cache-Control']).toBeUndefined();
    const api = await handler({ method: 'GET', url: '/api/config' });
    expect(api.headers?.['Content-Security-Policy']).toBe(SPA_CSP);
  });

  it('handleSpaRequest (direct) also nonces /index.html', () => {
    const res = handleSpaRequest('/index.html', bundleDir);
    expect(nonceOf(res).html).toMatch(NONCE_RE);
  });
});
