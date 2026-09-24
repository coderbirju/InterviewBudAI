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

  it('GET /notes/<id> with empty note renders status selector (None selected) and empty complexity inputs', async () => {
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
    // Should have a status selector with all tag options
    expect(res.body).toContain('name="status"');
    expect(res.body).toContain('<select');
    expect(res.body).toContain('value="none"');
    expect(res.body).toContain('value="done"');
    expect(res.body).toContain('value="to_revisit"');
    // Empty note -> None selected
    expect(res.body).toMatch(/value="none"[^>]*selected/);
    // Should have complexity inputs with empty values
    expect(res.body).toContain('name="timeComplexity"');
    expect(res.body).toContain('name="spaceComplexity"');
    expect(res.body).toContain('value=""');
  });

  it('GET /notes/<id> with completed note pre-selects Done (back-compat from completed)', async () => {
    const adapter = new LocalFileStorageAdapter(tempDir);
    await adapter.writeIntuitionNote({
      problemId: 'lc-3',
      content: 'Completed solution',
      lastUpdated: new Date().toISOString(),
      completed: true,
      timeComplexity: 'O(n)',
      spaceComplexity: 'O(1)',
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
    // Done option should be selected
    expect(res.body).toMatch(/value="done"[^>]*selected/);
    // Complexity inputs should have values
    expect(res.body).toContain('value="O(n)"');
    expect(res.body).toContain('value="O(1)"');
  });

  it('GET /notes/<id> with to_revisit note pre-selects To revisit', async () => {
    const adapter = new LocalFileStorageAdapter(tempDir);
    await adapter.writeIntuitionNote({
      problemId: 'lc-3',
      content: 'Need another look',
      lastUpdated: new Date().toISOString(),
      status: 'to_revisit',
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
    expect(res.body).toMatch(/value="to_revisit"[^>]*selected/);
  });

  it('POST /notes/<id> saves status=done + complexity and round-trips via GET (completed stays true)', async () => {
    const createStorage = (dataDir: string) =>
      new LocalFileStorageAdapter(dataDir);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      createStorage,
    };
    const handler = createCoachHandler(deps);

    // POST with status=done and complexity values
    const postBody = new URLSearchParams({
      content: 'My solution notes',
      status: 'done',
      timeComplexity: 'O(n log n)',
      spaceComplexity: 'O(n)',
    }).toString();

    const postReq: HandlerRequest = {
      method: 'POST',
      url: '/notes/lc-3',
      body: postBody,
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const postRes = await handler(postReq);

    expect(postRes.status).toBe(200);
    expect(postRes.body).toContain('Saved successfully');
    // POST response should show the values
    expect(postRes.body).toMatch(/value="done"[^>]*selected/);
    expect(postRes.body).toContain('value="O(n log n)"');
    expect(postRes.body).toContain('value="O(n)"');

    // GET to verify values were persisted
    const getReq: HandlerRequest = {
      method: 'GET',
      url: '/notes/lc-3',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const getRes = await handler(getReq);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toContain('My solution notes');
    expect(getRes.body).toMatch(/value="done"[^>]*selected/);
    expect(getRes.body).toContain('value="O(n log n)"');
    expect(getRes.body).toContain('value="O(n)"');

    // Also verify via adapter directly: status persisted and completed kept consistent
    const adapter = new LocalFileStorageAdapter(tempDir);
    const note = await adapter.readIntuitionNote('lc-3');
    expect(note).not.toBeNull();
    expect(note!.status).toBe('done');
    expect(note!.completed).toBe(true);
    expect(note!.timeComplexity).toBe('O(n log n)');
    expect(note!.spaceComplexity).toBe('O(n)');
  });

  it('POST /notes/<id> saves status=to_revisit and round-trips (completed false)', async () => {
    const createStorage = (dataDir: string) =>
      new LocalFileStorageAdapter(dataDir);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      createStorage,
    };
    const handler = createCoachHandler(deps);

    const postBody = new URLSearchParams({
      content: 'Come back to this',
      status: 'to_revisit',
    }).toString();

    const postReq: HandlerRequest = {
      method: 'POST',
      url: '/notes/lc-3',
      body: postBody,
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const postRes = await handler(postReq);
    expect(postRes.status).toBe(200);
    expect(postRes.body).toMatch(/value="to_revisit"[^>]*selected/);

    const adapter = new LocalFileStorageAdapter(tempDir);
    const note = await adapter.readIntuitionNote('lc-3');
    expect(note!.status).toBe('to_revisit');
    expect(note!.completed).toBe(false);
  });

  it('POST /notes/<id> with status=none clears a previously-done note (completed false)', async () => {
    // First write a done note
    const adapter = new LocalFileStorageAdapter(tempDir);
    await adapter.writeIntuitionNote({
      problemId: 'lc-3',
      content: 'Was done',
      lastUpdated: new Date().toISOString(),
      status: 'done',
    });

    const createStorage = (dataDir: string) =>
      new LocalFileStorageAdapter(dataDir);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      createStorage,
    };
    const handler = createCoachHandler(deps);

    // POST with status=none
    const postReq: HandlerRequest = {
      method: 'POST',
      url: '/notes/lc-3',
      body: new URLSearchParams({
        content: 'Not done anymore',
        status: 'none',
      }).toString(),
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    await handler(postReq);

    const note = await adapter.readIntuitionNote('lc-3');
    expect(note!.status).toBeUndefined();
    expect(note!.completed).toBe(false);
  });

  it('XSS: escapes script tags in complexity fields', async () => {
    const createStorage = (dataDir: string) =>
      new LocalFileStorageAdapter(dataDir);

    const deps: CoachHandlerDeps = {
      storage: createMockStorage(),
      catalog: createCatalogSource(),
      createStorage,
    };
    const handler = createCoachHandler(deps);

    // POST with XSS in complexity fields
    const postBody = new URLSearchParams({
      content: 'Normal content',
      timeComplexity: '<script>alert(1)</script>',
      spaceComplexity: '" onmouseover="alert(2)"',
    }).toString();

    const postReq: HandlerRequest = {
      method: 'POST',
      url: '/notes/lc-3',
      body: postBody,
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        cookie: `ibai_data_dir=${encodeURIComponent(tempDir)}`,
      },
    };
    const postRes = await handler(postReq);

    expect(postRes.status).toBe(200);
    // Script tags should be escaped (no raw <script> tags)
    expect(postRes.body).toContain('&lt;script&gt;');
    expect(postRes.body).not.toContain('<script>alert');
    // Quote should be escaped to prevent attribute breakout
    // The &quot; prevents the value from breaking out of the value attribute
    expect(postRes.body).toContain('&quot;');
    // Verify the dangerous pattern " onmouseover=" is escaped - the leading quote is escaped
    // so it can't break out of the value attribute context
    expect(postRes.body).not.toContain('" onmouseover="');
  });
});
