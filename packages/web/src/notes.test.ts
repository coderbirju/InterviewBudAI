import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCoachHandler } from './handler.js';
import type { CoachHandlerDeps, HandlerRequest } from './handler.js';
import type { StorageAdapter } from '@ibai/storage';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { createCatalogSource } from '@ibai/curriculum';

// Mock storage adapter that does nothing (used when no storage needed)
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

describe('notes editor routes', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-notes-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('GET /notes/<known-id> with existing DB and NO note renders empty editor', async () => {
    // Create storage factory that uses temp dir
    const createStorage = (dataDir: string) =>
      new LocalFileStorageAdapter(dataDir);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      createStorage,
    };
    const handler = createCoachHandler(deps);

    // Set cookie to point to temp dir
    const req: HandlerRequest = {
      method: 'GET',
      url: '/notes/lc-3',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    // Should contain problem title (escaped)
    expect(res.body).toContain(
      'Longest Substring Without Repeating Characters',
    );
    // Should have LeetCode link
    expect(res.body).toContain('leetcode.com');
    expect(res.body).toContain('target="_blank"');
    expect(res.body).toContain('rel="noopener"');
    // Should have a form with textarea and save button
    expect(res.body).toContain('<form');
    expect(res.body).toContain('method="POST"');
    expect(res.body).toContain('action="/notes/lc-3"');
    expect(res.body).toContain('<textarea');
    expect(res.body).toContain('name="content"');
    expect(res.body).toContain('Save');
    // Textarea should be empty
    expect(res.body).toContain('></textarea>');
    // Should NOT have saved banner
    expect(res.body).not.toContain('Saved successfully');
  });

  it('GET /notes/<known-id> with pre-written note shows prefilled textarea', async () => {
    // First write a note directly via the adapter
    const adapter = new LocalFileStorageAdapter(tempDir);
    await adapter.writeIntuitionNote({
      problemId: 'lc-3',
      content: 'My sliding window approach notes',
      lastUpdated: new Date().toISOString(),
    });

    const createStorage = (dataDir: string) =>
      new LocalFileStorageAdapter(dataDir);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      createStorage,
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = {
      method: 'GET',
      url: '/notes/lc-3',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const res = await handler(req);

    expect(res.status).toBe(200);
    // Textarea should contain the pre-written content
    expect(res.body).toContain('My sliding window approach notes');
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
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const res = await handler(req);

    expect(res.status).toBe(404);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('404');
    expect(res.body).toContain('not found');
  });

  it('POST /notes/<id> saves content and shows Saved banner, GET shows saved content (round-trip)', async () => {
    const createStorage = (dataDir: string) =>
      new LocalFileStorageAdapter(dataDir);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      createStorage,
    };
    const handler = createCoachHandler(deps);

    // POST to save content
    const postReq: HandlerRequest = {
      method: 'POST',
      url: '/notes/lc-3',
      body: 'content=' + encodeURIComponent('My new intuition notes here'),
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const postRes = await handler(postReq);

    expect(postRes.status).toBe(200);
    expect(postRes.body).toContain('Saved successfully');
    expect(postRes.body).toContain('My new intuition notes here');

    // GET to verify content was saved
    const getReq: HandlerRequest = {
      method: 'GET',
      url: '/notes/lc-3',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const getRes = await handler(getReq);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toContain('My new intuition notes here');
  });

  it('no-database state: GET renders create database CTA and never throws', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      // Point to a nonexistent directory
      env: { IBAI_DATA_DIR: '/nonexistent/path/that/does/not/exist' },
    };
    const handler = createCoachHandler(deps);

    // No cookie and default data dir doesn't exist
    const req: HandlerRequest = {
      method: 'GET',
      url: '/notes/lc-3',
    };
    const res = await handler(req);

    // Should NOT throw, should return 200 with CTA
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('/setup');
    expect(res.body).toContain('Create Database');
    expect(res.body).toContain(
      'Longest Substring Without Repeating Characters',
    );
  });

  it('no-database state: POST renders create database CTA and never throws', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      env: { IBAI_DATA_DIR: '/nonexistent/path/that/does/not/exist' },
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = {
      method: 'POST',
      url: '/notes/lc-3',
      body: 'content=some+notes',
      contentType: 'application/x-www-form-urlencoded',
    };
    const res = await handler(req);

    // Should NOT throw, should return 200 with CTA
    expect(res.status).toBe(200);
    expect(res.body).toContain('/setup');
    expect(res.body).toContain('Create Database');
  });

  it('XSS: escapes script tags in content and title', async () => {
    // Create a catalog with XSS-attempt title
    const xssCatalog = createCatalogSource([
      {
        id: 'xss-test',
        title: '<script>alert("xss")</script>',
        url: 'https://leetcode.com/problems/xss-test',
        difficulty: 'easy',
        topics: ['test'],
      },
    ]);

    const createStorage = (dataDir: string) =>
      new LocalFileStorageAdapter(dataDir);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: xssCatalog,
      createStorage,
    };
    const handler = createCoachHandler(deps);

    // POST content with XSS attempt
    const postReq: HandlerRequest = {
      method: 'POST',
      url: '/notes/xss-test',
      body: 'content=' + encodeURIComponent('<script>alert("pwned")</script>'),
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const postRes = await handler(postReq);

    expect(postRes.status).toBe(200);
    // Script tags in content should be escaped
    expect(postRes.body).toContain('&lt;script&gt;');
    expect(postRes.body).not.toContain('<script>alert');

    // GET to verify title XSS is also escaped
    const getReq: HandlerRequest = {
      method: 'GET',
      url: '/notes/xss-test',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const getRes = await handler(getReq);

    // Title should be escaped
    expect(getRes.body).toContain('&lt;script&gt;');
    expect(getRes.body).not.toContain('<script>alert("xss")');
  });

  it('POST /notes/<unknown-id> returns 404', async () => {
    const createStorage = (dataDir: string) =>
      new LocalFileStorageAdapter(dataDir);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      createStorage,
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = {
      method: 'POST',
      url: '/notes/nonexistent-id',
      body: 'content=test',
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const res = await handler(req);

    expect(res.status).toBe(404);
  });

  it('PUT /notes/<id> returns 405 (method not allowed)', async () => {
    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
    };
    const handler = createCoachHandler(deps);

    const req: HandlerRequest = {
      method: 'PUT',
      url: '/notes/lc-3',
    };
    const res = await handler(req);

    expect(res.status).toBe(405);
  });
});
