import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  StorageAdapter,
  SessionId,
  SessionContext,
  SessionSummary,
  CompetencyMap,
  WeaknessRegister,
} from '@ibai/storage';
import { createCoachHandler } from './handler.js';
import type { HandlerRequest } from './handler.js';

/**
 * In-memory fake storage adapter for testing.
 */
class FakeStorageAdapter implements StorageAdapter {
  private competencyMap: CompetencyMap = { entries: {} };
  private weaknessRegister: WeaknessRegister = { entries: [] };
  private sessionContexts: Map<string, SessionContext> = new Map();
  private shouldThrow = false;

  setCompetencyMap(map: CompetencyMap): void {
    this.competencyMap = map;
  }

  setWeaknessRegister(register: WeaknessRegister): void {
    this.weaknessRegister = register;
  }

  setSessionContext(sessionId: string, context: SessionContext): void {
    this.sessionContexts.set(sessionId, context);
  }

  setShouldThrow(should: boolean): void {
    this.shouldThrow = should;
  }

  async readSessionContext(sessionId: SessionId): Promise<SessionContext> {
    if (this.shouldThrow) throw new Error('Storage error');
    return this.sessionContexts.get(sessionId) ?? { sessionId, history: [] };
  }

  async writeSessionSummary(_summary: SessionSummary): Promise<void> {
    if (this.shouldThrow) throw new Error('Storage error');
  }

  async readCompetencyMap(): Promise<CompetencyMap> {
    if (this.shouldThrow) throw new Error('Storage error');
    return this.competencyMap;
  }

  async updateCompetencyMap(map: CompetencyMap): Promise<void> {
    if (this.shouldThrow) throw new Error('Storage error');
    this.competencyMap = map;
  }

  async readWeaknessRegister(): Promise<WeaknessRegister> {
    if (this.shouldThrow) throw new Error('Storage error');
    return this.weaknessRegister;
  }

  async updateWeaknessRegister(register: WeaknessRegister): Promise<void> {
    if (this.shouldThrow) throw new Error('Storage error');
    this.weaknessRegister = register;
  }
}

describe('createAssessHandler', () => {
  // Temp directory for tests that need a cookie
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

  const createFakeHandler = () => {
    const storage = new FakeStorageAdapter();
    // Use createCoachHandler with createStorage factory to support per-request storage
    const handler = createCoachHandler({
      storage,
      createStorage: () => storage, // Always return the same storage for testing
    });
    return { storage, handler };
  };

  // Helper to create a request with cookie
  const withCookie = (req: HandlerRequest): HandlerRequest => ({
    ...req,
    headers: { cookie: `ibai_data_dir=${encodeURIComponent(testDataDir!)}` },
  });

  describe('GET / (Home)', () => {
    it('returns 200 with HTML content type', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(withCookie({ method: 'GET', url: '/' }));
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('text/html; charset=utf-8');
    });

    it('returns 200 even without cookie (empty state)', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/' });
      expect(res.status).toBe(200);
      expect(res.body).toContain('InterviewBudAI');
    });

    it('body contains page title', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(withCookie({ method: 'GET', url: '/' }));
      expect(res.body).toContain('InterviewBudAI');
    });

    it('shows action buttons for catalog and interview', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(withCookie({ method: 'GET', url: '/' }));
      expect(res.body).toContain('Continue practicing');
      expect(res.body).toContain('href="/catalog"');
      expect(res.body).toContain('Interview with AI');
      expect(res.body).toContain('href="/coach"');
    });

    it('does NOT show dashboard sections on home page', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(withCookie({ method: 'GET', url: '/' }));
      expect(res.body).not.toContain('Where You Stand');
      expect(res.body).not.toContain('Your Next Session');
    });

    it('shows empty state CTA when no data', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/' });
      expect(res.body).toContain('Create your database');
      expect(res.body).toContain('href="/setup"');
    });

    it('shows progress when data exists', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setCompetencyMap({
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.9,
            lastUpdated: '2026-09-06T12:00:00Z',
          },
        },
      });
      const res = await handler(withCookie({ method: 'GET', url: '/' }));
      expect(res.body).toContain('Topics tracked');
      expect(res.body).toContain('arrays');
    });

    it('includes navigation with Home active', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(withCookie({ method: 'GET', url: '/' }));
      expect(res.body).toContain('class="main-nav"');
      expect(res.body).toContain('href="/"');
      expect(res.body).toContain('aria-current="page"');
    });
  });

  describe('GET /dashboard', () => {
    it('returns 200 with HTML content type when cookie is set', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/dashboard' }),
      );
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('text/html; charset=utf-8');
    });

    it('shows Where You Stand section', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/dashboard' }),
      );
      expect(res.body).toContain('Where You Stand');
    });

    it('shows Your Next Session section', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/dashboard' }),
      );
      expect(res.body).toContain('Your Next Session');
    });

    it('shows friendly placeholder for empty state', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/dashboard' }),
      );
      expect(res.body).toContain('No strengths identified yet');
    });

    it('includes navigation with Dashboard active', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/dashboard' }),
      );
      expect(res.body).toContain('class="main-nav"');
      expect(res.body).toContain('href="/dashboard"');
    });
  });

  describe('GET /assess (HTML)', () => {
    it('returns 200 with HTML when cookie is set', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(withCookie({ method: 'GET', url: '/assess' }));
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('Where You Stand');
    });

    it('returns 200 with dashboard content (same as /dashboard)', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(withCookie({ method: 'GET', url: '/assess' }));
      expect(res.body).toContain('Your Next Session');
    });
  });

  describe('GET /assess.json (JSON)', () => {
    it('returns 200 with JSON content type', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/assess.json' }),
      );
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('application/json; charset=utf-8');
    });

    it('body parses to AssessmentView shape', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/assess.json' }),
      );
      const view = JSON.parse(res.body);
      expect(view).toHaveProperty('topicsTracked');
      expect(view).toHaveProperty('topStrengths');
      expect(view).toHaveProperty('focusAreas');
      expect(view).toHaveProperty('recurringWeaknesses');
      expect(view).toHaveProperty('recentSession');
    });
  });

  describe('GET /plan.json (JSON)', () => {
    it('returns 200 with JSON content type', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/plan.json' }),
      );
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('application/json; charset=utf-8');
    });

    it('body parses to SessionPlan shape', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/plan.json' }),
      );
      const plan = JSON.parse(res.body);
      expect(plan).toHaveProperty('topics');
      expect(plan).toHaveProperty('summary');
      expect(Array.isArray(plan.topics)).toBe(true);
    });

    it('returns empty plan for new user', async () => {
      const { handler } = createFakeHandler();
      const res = await handler(
        withCookie({ method: 'GET', url: '/plan.json' }),
      );
      const plan = JSON.parse(res.body);
      expect(plan.topics).toEqual([]);
      expect(plan.summary).toContain('No history yet');
    });

    it('returns populated plan with topics', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setCompetencyMap({
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.9,
            lastUpdated: '2026-09-06T12:00:00Z',
          },
          graphs: {
            topicId: 'graphs',
            proficiency: 0.3,
            lastUpdated: '2026-09-06T12:00:00Z',
          },
          trees: {
            topicId: 'trees',
            proficiency: 0.4,
            lastUpdated: '2026-09-06T12:00:00Z',
          },
        },
      });

      const res = await handler(
        withCookie({ method: 'GET', url: '/plan.json' }),
      );
      const plan = JSON.parse(res.body);
      expect(plan.topics.length).toBeGreaterThan(0);
      // Should have focus topics from low proficiency areas
      const focusTopics = plan.topics.filter(
        (t: { role: string }) => t.role === 'focus',
      );
      expect(focusTopics.length).toBeGreaterThan(0);
    });
  });

  describe('populated state', () => {
    it('renders competency data in HTML', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setCompetencyMap({
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.9,
            lastUpdated: '2026-09-06T12:00:00Z',
          },
          graphs: {
            topicId: 'graphs',
            proficiency: 0.3,
            lastUpdated: '2026-09-06T12:00:00Z',
          },
        },
      });
      storage.setWeaknessRegister({
        entries: [
          {
            topicId: 'dp',
            note: 'Struggles with memoization',
            occurrences: 3,
            lastObserved: '2026-09-06T12:00:00Z',
          },
        ],
      });

      const res = await handler(withCookie({ method: 'GET', url: '/' }));
      expect(res.body).toContain('arrays');
    });

    it('renders plan data in HTML with topic cards', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setCompetencyMap({
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.9,
            lastUpdated: '2026-09-06T12:00:00Z',
          },
          graphs: {
            topicId: 'graphs',
            proficiency: 0.3,
            lastUpdated: '2026-09-06T12:00:00Z',
          },
        },
      });

      const res = await handler(withCookie({ method: 'GET', url: '/' }));
      // Should show topic cards with roles
      expect(res.body).toContain('topic-card');
      expect(res.body).toContain('role-badge');
    });
  });

  describe('sessionId query param', () => {
    it('accepts sessionId in query for HTML', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setSessionContext('test-session', {
        sessionId: 'test-session',
        history: [
          { role: 'user', content: 'Hello', timestamp: '2026-09-06T12:00:00Z' },
        ],
      });

      const res = await handler(
        withCookie({
          method: 'GET',
          url: '/assess?sessionId=test-session',
        }),
      );
      expect(res.status).toBe(200);
    });

    it('accepts sessionId in query for /plan.json', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setSessionContext('test-session', {
        sessionId: 'test-session',
        history: [
          { role: 'user', content: 'Hello', timestamp: '2026-09-06T12:00:00Z' },
        ],
      });

      const res = await handler(
        withCookie({
          method: 'GET',
          url: '/plan.json?sessionId=test-session',
        }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe('404 for unknown paths', () => {
    it('returns 404 for unknown path', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/unknown' });
      expect(res.status).toBe(404);
      // 404 page is HTML, contains 404 code
      expect(res.body).toContain('404');
    });
  });

  describe('405 for non-GET methods', () => {
    it('returns 405 for POST to /', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'POST', url: '/' });
      expect(res.status).toBe(405);
      expect(res.body).toContain('Method not allowed');
    });

    it('returns 405 for POST to /plan.json', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'POST', url: '/plan.json' });
      expect(res.status).toBe(405);
      expect(res.body).toContain('Method not allowed');
    });

    it('returns 405 for POST to /dashboard', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'POST', url: '/dashboard' });
      expect(res.status).toBe(405);
      expect(res.body).toContain('Method not allowed');
    });
  });

  describe('error handling', () => {
    it('returns 200 with empty state on home page when storage errors', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setShouldThrow(true);

      const res = await handler(withCookie({ method: 'GET', url: '/' }));
      expect(res.status).toBe(200);
      expect(res.body).toContain('Create your database');
    });

    it('returns 500 with readable message on storage error for dashboard', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setShouldThrow(true);

      const res = await handler(
        withCookie({ method: 'GET', url: '/dashboard' }),
      );
      expect(res.status).toBe(500);
      expect(res.body).toContain('Storage error');
    });

    it('returns JSON error for /assess.json endpoint', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setShouldThrow(true);

      const res = await handler(
        withCookie({ method: 'GET', url: '/assess.json' }),
      );
      expect(res.status).toBe(500);
      expect(res.contentType).toBe('application/json; charset=utf-8');
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Storage error');
    });

    it('returns JSON error for /plan.json endpoint', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setShouldThrow(true);

      const res = await handler(
        withCookie({ method: 'GET', url: '/plan.json' }),
      );
      expect(res.status).toBe(500);
      expect(res.contentType).toBe('application/json; charset=utf-8');
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Storage error');
    });
  });

  describe('dashboard completed problems', () => {
    it('shows completed problems when notes marked complete', async () => {
      const { LocalFileStorageAdapter } = await import('@ibai/storage');
      const { createCatalogSource } = await import('@ibai/curriculum');

      const adapter = new LocalFileStorageAdapter(testDataDir!);
      // Mark a problem as complete (lc-3 is the first problem in the catalog)
      await adapter.writeIntuitionNote({
        problemId: 'lc-3',
        content: 'My solution',
        lastUpdated: new Date().toISOString(),
        completed: true,
      });

      const handler = createCoachHandler({
        storage: adapter,
        catalog: createCatalogSource(),
        createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
      });

      const res = await handler({
        method: 'GET',
        url: '/dashboard',
        headers: {
          cookie: `ibai_data_dir=${encodeURIComponent(testDataDir!)}`,
        },
      });

      expect(res.status).toBe(200);
      expect(res.body).toContain('Completed (1)');
      expect(res.body).toContain(
        'Longest Substring Without Repeating Characters',
      ); // Problem title for lc-3
    });

    it('shows empty state when no problems completed', async () => {
      const { handler } = createFakeHandler();

      const res = await handler(
        withCookie({ method: 'GET', url: '/dashboard' }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toContain('Completed (0)');
      expect(res.body).toContain('No problems marked as complete yet');
    });
  });

  describe('catalog done marker', () => {
    it('shows done marker for completed problems', async () => {
      const { LocalFileStorageAdapter } = await import('@ibai/storage');
      const { createCatalogSource } = await import('@ibai/curriculum');

      const adapter = new LocalFileStorageAdapter(testDataDir!);
      // Mark a problem as complete (lc-3 is the first problem in the catalog)
      await adapter.writeIntuitionNote({
        problemId: 'lc-3',
        content: 'My solution',
        lastUpdated: new Date().toISOString(),
        completed: true,
      });

      const handler = createCoachHandler({
        storage: adapter,
        catalog: createCatalogSource(),
        createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
      });

      const res = await handler({
        method: 'GET',
        url: '/catalog',
        headers: {
          cookie: `ibai_data_dir=${encodeURIComponent(testDataDir!)}`,
        },
      });

      expect(res.status).toBe(200);
      expect(res.body).toContain('done-marker');
      expect(res.body).toContain('\u2713 done');
    });

    it('does not show done marker when no notes', async () => {
      const { handler } = createFakeHandler();

      const res = await handler({ method: 'GET', url: '/catalog' });

      expect(res.status).toBe(200);
      // Check that no actual done marker spans are rendered (CSS class in styles is OK)
      expect(res.body).not.toContain('\u2713 done');
    });
  });

  describe('home route cookie resolution (CHANGE 4 regression)', () => {
    it('home reflects cookie-specified data dir (not stale boot-time dir)', async () => {
      const { LocalFileStorageAdapter } = await import('@ibai/storage');

      // Create a storage adapter for the temp dir
      const adapter = new LocalFileStorageAdapter(testDataDir!);

      // Write some competency data so assess() returns non-empty view
      await adapter.updateCompetencyMap({
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.8,
            lastUpdated: new Date().toISOString(),
          },
        },
      });

      // Create handler WITH createStorage factory (simulating boot fix)
      const handler = createCoachHandler({
        storage: adapter, // Default storage (like boot-time)
        createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
        defaultDataDir: '/some/other/default/path',
        env: {},
        argv: [],
      });

      // Request with cookie pointing to temp dir
      const res = await handler({
        method: 'GET',
        url: '/',
        headers: {
          cookie: `ibai_data_dir=${encodeURIComponent(testDataDir!)}`,
        },
      });

      expect(res.status).toBe(200);
      // The view should reflect the data in the cookie dir, not empty
      // Check for topicsTracked > 0 indicator or the topic name in strengths
      expect(res.body).toContain('arrays');
    });

    it('home shows empty state when no cookie and default dir does not exist', async () => {
      const { LocalFileStorageAdapter } = await import('@ibai/storage');

      // Create handler with factory but default dir that doesn't exist
      const handler = createCoachHandler({
        storage: new LocalFileStorageAdapter('/nonexistent/path'),
        createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
        defaultDataDir: '/nonexistent/path/that/does/not/exist',
        env: {},
        argv: [],
      });

      // Request without cookie
      const res = await handler({
        method: 'GET',
        url: '/',
      });

      expect(res.status).toBe(200);
      // Empty state should show the CTA
      expect(res.body).toContain('Create your database');
    });
  });

  describe('cookie persistence (regression tests)', () => {
    it('POST /setup sets persistent cookie with Max-Age', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({
        method: 'POST',
        url: '/setup',
        body: `dataDir=${encodeURIComponent(testDataDir!)}`,
        contentType: 'application/x-www-form-urlencoded',
      });

      expect(res.status).toBe(200);
      expect(res.headers).toBeDefined();
      const setCookie = res.headers!['Set-Cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain('ibai_data_dir=');
      expect(setCookie).toContain('Max-Age=31536000');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Strict');
      // Should NOT have Secure (localhost http)
      expect(setCookie).not.toContain('Secure');
    });

    it('GET / with cookie shows progress state (not empty state)', async () => {
      const { LocalFileStorageAdapter } = await import('@ibai/storage');

      // Create storage with data in temp dir
      const adapter = new LocalFileStorageAdapter(testDataDir!);
      await adapter.updateCompetencyMap({
        entries: {
          'linked-lists': {
            topicId: 'linked-lists',
            proficiency: 0.75,
            lastUpdated: new Date().toISOString(),
          },
        },
      });

      const handler = createCoachHandler({
        storage: adapter,
        createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
      });

      const res = await handler({
        method: 'GET',
        url: '/',
        headers: {
          cookie: `ibai_data_dir=${encodeURIComponent(testDataDir!)}`,
        },
      });

      expect(res.status).toBe(200);
      // Should show progress data, not empty state CTA
      expect(res.body).toContain('linked-lists');
      expect(res.body).not.toContain('Create your database');
    });

    it('GET / without cookie shows empty state', async () => {
      const { LocalFileStorageAdapter } = await import('@ibai/storage');

      const handler = createCoachHandler({
        storage: new LocalFileStorageAdapter('/nonexistent/path'),
        createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
        defaultDataDir: '/nonexistent/default',
        env: {},
        argv: [],
      });

      const res = await handler({
        method: 'GET',
        url: '/',
      });

      expect(res.status).toBe(200);
      expect(res.body).toContain('Create your database');
    });
  });
});
