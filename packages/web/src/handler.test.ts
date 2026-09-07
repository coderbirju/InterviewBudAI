import { describe, it, expect } from 'vitest';
import type {
  StorageAdapter,
  SessionId,
  SessionContext,
  SessionSummary,
  CompetencyMap,
  WeaknessRegister,
} from '@ibai/storage';
import { createAssessHandler } from './handler.js';

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
  const createFakeHandler = () => {
    const storage = new FakeStorageAdapter();
    const handler = createAssessHandler({ storage });
    return { storage, handler };
  };

  describe('GET / (HTML)', () => {
    it('returns 200 with HTML content type', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/' });
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('text/html; charset=utf-8');
    });

    it('body contains page title', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/' });
      expect(res.body).toContain('Where You Stand');
    });

    it('shows friendly placeholder for empty state', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/' });
      expect(res.body).toContain('No strengths identified yet');
    });
  });

  describe('GET /assess (HTML)', () => {
    it('returns 200 with HTML', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/assess' });
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('Where You Stand');
    });
  });

  describe('GET /assess.json (JSON)', () => {
    it('returns 200 with JSON content type', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/assess.json' });
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('application/json; charset=utf-8');
    });

    it('body parses to AssessmentView shape', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/assess.json' });
      const view = JSON.parse(res.body);
      expect(view).toHaveProperty('topicsTracked');
      expect(view).toHaveProperty('topStrengths');
      expect(view).toHaveProperty('focusAreas');
      expect(view).toHaveProperty('recurringWeaknesses');
      expect(view).toHaveProperty('recentSession');
    });
  });

  describe('populated state', () => {
    it('renders competency data', async () => {
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

      const res = await handler({ method: 'GET', url: '/' });
      expect(res.body).toContain('arrays');
    });
  });

  describe('sessionId query param', () => {
    it('accepts sessionId in query', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setSessionContext('test-session', {
        sessionId: 'test-session',
        history: [
          { role: 'user', content: 'Hello', timestamp: '2026-09-06T12:00:00Z' },
        ],
      });

      const res = await handler({
        method: 'GET',
        url: '/assess?sessionId=test-session',
      });
      expect(res.status).toBe(200);
    });
  });

  describe('404 for unknown paths', () => {
    it('returns 404 for unknown path', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'GET', url: '/unknown' });
      expect(res.status).toBe(404);
      expect(res.body).toContain('Not found');
    });
  });

  describe('405 for non-GET methods', () => {
    it('returns 405 for POST', async () => {
      const { handler } = createFakeHandler();
      const res = await handler({ method: 'POST', url: '/' });
      expect(res.status).toBe(405);
      expect(res.body).toContain('Method not allowed');
    });
  });

  describe('error handling', () => {
    it('returns 500 with readable message on storage error', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setShouldThrow(true);

      const res = await handler({ method: 'GET', url: '/' });
      expect(res.status).toBe(500);
      expect(res.body).toContain('Storage error');
    });

    it('returns JSON error for JSON endpoint', async () => {
      const { storage, handler } = createFakeHandler();
      storage.setShouldThrow(true);

      const res = await handler({ method: 'GET', url: '/assess.json' });
      expect(res.status).toBe(500);
      expect(res.contentType).toBe('application/json; charset=utf-8');
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Storage error');
    });
  });
});
