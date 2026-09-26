import { describe, it, expect } from 'vitest';
import { isSpaRequest, bundleExists, handleSpaRequest } from './spa.js';
import { createCoachHandler } from './handler.js';
import type { HandlerRequest } from './handler.js';
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
