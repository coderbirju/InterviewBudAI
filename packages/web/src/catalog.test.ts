import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCoachHandler } from './handler.js';
import type { CoachHandlerDeps, HandlerRequest } from './handler.js';
import type { StorageAdapter } from '@ibai/storage';
import {
  parseCookies,
  expandTilde,
  resolveDataDirWithCookie,
} from './config.js';
import { createCatalogSource } from '@ibai/curriculum';

// Mock storage adapter that does nothing
function createMockStorage(): StorageAdapter {
  return {
    readSessionContext: async () => ({ sessionId: 'test', history: [] }),
    writeSessionSummary: async () => {},
    readCompetencyMap: async () => ({ entries: {} }),
    updateCompetencyMap: async () => {},
    readWeaknessRegister: async () => ({ entries: [] }),
    updateWeaknessRegister: async () => {},
  };
}

describe('catalog route', () => {
  it('GET /catalog returns 200 with HTML containing topic headings', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'GET', url: '/catalog' };
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('Problem Catalog');
    // Should contain topic headings (we know arrays-2d, binary-search, etc exist)
    expect(res.body).toContain('dynamic-programming');
    expect(res.body).toContain('binary-search');
  });

  it('GET /catalog renders problem rows with LeetCode links (target=_blank rel=noopener)', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'GET', url: '/catalog' };
    const res = await handler(req);

    expect(res.body).toContain('target="_blank"');
    expect(res.body).toContain('rel="noopener"');
    expect(res.body).toContain('>LeetCode</a>');
    expect(res.body).toContain('leetcode.com');
  });

  it('GET /catalog renders Notes links (/notes/<id>)', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'GET', url: '/catalog' };
    const res = await handler(req);

    expect(res.body).toContain('/notes/lc-');
    expect(res.body).toContain('>Notes</a>');
  });

  it('GET /catalog renders difficulty badges', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'GET', url: '/catalog' };
    const res = await handler(req);

    expect(res.body).toContain('difficulty-badge');
    expect(res.body).toContain('easy');
    expect(res.body).toContain('medium');
    expect(res.body).toContain('hard');
  });

  it('GET /catalog shows create database CTA when no cookie', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'GET', url: '/catalog' };
    const res = await handler(req);

    expect(res.body).toContain('Create your database');
    expect(res.body).toContain('/setup');
  });

  it('XSS: escapes malicious title content', async () => {
    // Create a custom catalog with XSS attempt
    const xssCatalog = createCatalogSource([
      {
        id: 'xss-test',
        title: '<script>alert("xss")</script>',
        url: 'https://example.com/"><script>alert(1)</script>',
        difficulty: 'easy',
        topics: ['test-topic'],
      },
    ]);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: xssCatalog,
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'GET', url: '/catalog' };
    const res = await handler(req);

    // Should not contain raw script tags
    expect(res.body).not.toContain('<script>');
    // Should contain escaped versions
    expect(res.body).toContain('&lt;script&gt;');
  });
});

describe('notes route', () => {
  it('GET /notes/<known-id> without DB shows create database CTA', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      // No cookie and default dir doesn't exist = no DB
      env: { IBAI_DATA_DIR: '/nonexistent/path/that/does/not/exist' },
    };
    const handler = createCoachHandler(deps);

    // Use a real problem ID from the catalog
    const req: HandlerRequest = { method: 'GET', url: '/notes/lc-3' };
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain(
      'Longest Substring Without Repeating Characters',
    );
    // Should show setup CTA, not 'coming soon'
    expect(res.body).toContain('/setup');
    expect(res.body).toContain('Create Database');
    expect(res.body).toContain('/catalog');
  });

  it('GET /notes/<unknown-id> returns 404', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = {
      method: 'GET',
      url: '/notes/nonexistent-problem-id',
    };
    const res = await handler(req);

    expect(res.status).toBe(404);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('404');
  });
});

describe('setup route', () => {
  it('GET /setup returns 200 with form', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'GET', url: '/setup' };
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('<form');
    expect(res.body).toContain('dataDir');
    expect(res.body).toContain('.interviewbudai/data');
  });

  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('POST /setup creates directory and sets cookie with HttpOnly, SameSite=Strict, Path=/', async () => {
    // Use a unique temp directory path
    tempDir = path.join(
      os.tmpdir(),
      `ibai-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = {
      method: 'POST',
      url: '/setup',
      body: `dataDir=${encodeURIComponent(tempDir)}`,
      contentType: 'application/x-www-form-urlencoded',
    };
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');

    // Directory should exist
    expect(fs.existsSync(tempDir)).toBe(true);

    // Cookie should be set with required attributes
    expect(res.headers).toBeDefined();
    expect(res.headers?.['Set-Cookie']).toBeDefined();
    const cookie = res.headers?.['Set-Cookie'] ?? '';
    expect(cookie).toContain('ibai_data_dir=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });
});

describe('cookie parsing', () => {
  it('parseCookies parses simple cookies', () => {
    const result = parseCookies('name=value; other=test');
    expect(result).toEqual({ name: 'value', other: 'test' });
  });

  it('parseCookies handles URL-encoded values', () => {
    const result = parseCookies('path=%2Fhome%2Fuser%2Fdata');
    expect(result.path).toBe('/home/user/data');
  });

  it('parseCookies returns empty object for undefined', () => {
    const result = parseCookies(undefined);
    expect(result).toEqual({});
  });
});

describe('dataDir precedence', () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-precedence-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('cookie value (existing dir) takes precedence over env', () => {
    const env = { IBAI_DATA_DIR: '/env/path' };
    const result = resolveDataDirWithCookie(tempDir!, env);
    expect(result).toBe(tempDir);
  });

  it('env takes precedence over default when no cookie', () => {
    const env = { IBAI_DATA_DIR: '/env/path' };
    const result = resolveDataDirWithCookie(undefined, env);
    expect(result).toBe('/env/path');
  });

  it('cookie for non-existent dir falls back to env', () => {
    const env = { IBAI_DATA_DIR: '/env/path' };
    const result = resolveDataDirWithCookie('/nonexistent/cookie/path', env);
    expect(result).toBe('/env/path');
  });
});

describe('expandTilde', () => {
  it('expands ~ to home directory', () => {
    const result = expandTilde('~/data');
    expect(result).toBe(path.join(os.homedir(), 'data'));
  });

  it('leaves absolute paths unchanged', () => {
    const result = expandTilde('/absolute/path');
    expect(result).toBe('/absolute/path');
  });
});

describe('onboarding routing', () => {
  it('GET / without cookie returns home page with empty state', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'GET', url: '/' };
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(res.body).toContain('InterviewBudAI');
    expect(res.body).toContain('Create your database');
  });

  it('GET / with cookie returns home page with action buttons', async () => {
    // Create a temp dir for the cookie to point to
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-cookie-'));

    try {
      const deps: CoachHandlerDeps = {
        storage: createMockStorage(),
        createStorage: () => createMockStorage(),
      };
      const handler = createCoachHandler(deps);

      const req: HandlerRequest = {
        method: 'GET',
        url: '/',
        headers: {
          cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
        },
      };
      const res = await handler(req);

      expect(res.status).toBe(200);
      expect(res.contentType).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('Continue practicing');
      expect(res.body).toContain('Interview with AI');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('existing routes preserved', () => {
  it('GET /assess.json returns JSON', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
    };
    const handler = createCoachHandler(deps);

    // Need a cookie for / and /assess to work
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-assess-'));

    try {
      const req: HandlerRequest = {
        method: 'GET',
        url: '/assess.json',
        headers: { cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}` },
      };
      const res = await handler(req);

      expect(res.status).toBe(200);
      expect(res.contentType).toBe('application/json; charset=utf-8');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('unknown path returns 404', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'GET', url: '/nonexistent' };
    const res = await handler(req);

    expect(res.status).toBe(404);
  });

  it('POST on GET-only route returns 405', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = { method: 'POST', url: '/assess.json' };
    const res = await handler(req);

    expect(res.status).toBe(405);
  });
});
