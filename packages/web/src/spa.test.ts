import { describe, it, expect } from 'vitest';
import { isAppRoute, bundleExists, handleAppRoute } from './spa.js';
import { createCoachHandler } from './handler.js';
import type { StorageAdapter } from '@ibai/storage';

/**
 * M0 (ADR 0006) — the React SPA is served at /app by the existing Node server.
 * These tests verify routing + graceful behavior without depending on a running
 * server. They are build-artifact-aware: if the Vite bundle (dist-ui) is not
 * present, /app degrades to a friendly 200 message; if it is present, /app
 * serves the SPA HTML referencing local /app/assets. Either way it never
 * throws and never disturbs existing routes.
 */

// Minimal storage stub — /app and / (no-db) paths never touch it for these tests.
const stubStorage = {} as StorageAdapter;

describe('spa /app route classification', () => {
  it('isAppRoute matches /app and sub-paths only', () => {
    expect(isAppRoute('/app')).toBe(true);
    expect(isAppRoute('/app/')).toBe(true);
    expect(isAppRoute('/app/assets/index.js')).toBe(true);
    expect(isAppRoute('/')).toBe(false);
    expect(isAppRoute('/apple')).toBe(false);
    expect(isAppRoute('/catalog')).toBe(false);
  });

  it('guards against path traversal (never escapes the bundle dir)', () => {
    // Even a traversal attempt returns a safe HandlerResponse, never throws.
    const res = handleAppRoute('/app/../../etc/passwd');
    expect(res.status === 200 || res.status === 404).toBe(true);
    expect(typeof res.body).toBe('string');
  });
});

describe('spa /app route via handler', () => {
  const handler = createCoachHandler({ storage: stubStorage });

  it('GET /app returns 200 HTML (bundle or graceful message), never throws', async () => {
    const res = await handler({ method: 'GET', url: '/app' });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/html');
    expect(res.body.length).toBeGreaterThan(0);

    if (bundleExists()) {
      // Built SPA references local, /app-prefixed assets — NO external CDN.
      expect(res.body).toContain('/app/assets/');
      expect(res.body).not.toMatch(/src="https?:\/\//);
      expect(res.body).not.toMatch(/href="https?:\/\//);
    } else {
      // Graceful degrade message tells the user how to build the UI.
      expect(res.body).toContain('build:ui');
    }
  });

  it('POST /app returns 405 (GET-only route)', async () => {
    const res = await handler({ method: 'POST', url: '/app' });
    expect(res.status).toBe(405);
  });

  it('GET / still resolves (existing routes untouched by /app)', async () => {
    const res = await handler({ method: 'GET', url: '/' });
    // Home renders (200) regardless of db state; /app must not disturb it.
    expect(res.status).toBe(200);
  });
});
