import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCoachHandler } from './handler.js';
import type { CoachHandlerDeps } from './handler.js';
import type {
  ApiCatalogResponse,
  ApiProgressResponse,
  ApiNoteResponse,
  ApiConfigResponse,
} from './api.js';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import type { IsoTimestamp } from '@ibai/storage';

// A real, temp-dir-backed data directory + storage factory, exercised end to
// end (no network, no mocks for persistence). Each test gets a fresh dir.
let tmpDir: string;

function makeDeps(overrides: Partial<CoachHandlerDeps> = {}): CoachHandlerDeps {
  return {
    // The default `storage` is never used for these routes when createStorage
    // is provided, but the handler type requires it.
    storage: new LocalFileStorageAdapter(tmpDir),
    catalog: createCatalogSource(),
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    defaultDataDir: tmpDir,
    providerLabel: 'Using Ollama: test-model',
    // Empty env so cookie>env>default resolves to defaultDataDir.
    env: {},
    argv: [],
    ...overrides,
  };
}

/** Deps pointing at a NON-existent dir so the DB is treated as unconfigured. */
function makeNoDbDeps(): CoachHandlerDeps {
  const missing = path.join(tmpDir, 'does-not-exist');
  return {
    storage: new LocalFileStorageAdapter(missing),
    catalog: createCatalogSource(),
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    defaultDataDir: missing,
    providerLabel: 'No model configured',
    env: {},
    argv: [],
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-api-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// A valid catalog id we rely on across tests. Confirm it exists so the tests
// fail loudly if the seed catalog changes rather than silently mis-testing.
const CATALOG = createCatalogSource();
const FIRST_ID = CATALOG.list()[0]?.id ?? '';
const SECOND_ID = CATALOG.list()[1]?.id ?? '';

describe('api catalog', () => {
  it('GET /api/catalog returns topics + problems + totals (empty DB → all none)', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/catalog' });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const body = JSON.parse(res.body) as ApiCatalogResponse;
    expect(Array.isArray(body.topics)).toBe(true);
    expect(body.topics.length).toBeGreaterThan(0);
    // Topics are sorted alphabetically.
    const topicNames = body.topics.map((t) => t.topic);
    expect([...topicNames].sort()).toEqual(topicNames);
    // Each problem has the required shape + status/completed.
    const first = body.topics[0]!.problems[0]!;
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('url');
    expect(first).toHaveProperty('difficulty');
    expect(first.status).toBe('none');
    expect(first.completed).toBe(false);
    // Totals reflect the full catalog with everything 'none'.
    expect(body.totals.total).toBe(CATALOG.list().length);
    expect(body.totals.byStatus.none).toBe(CATALOG.list().length);
    expect(body.totals.byStatus.done).toBe(0);
  });

  it('GET /api/catalog reflects seeded statuses per problem', async () => {
    // Seed one done + one to_revisit via the real adapter.
    const adapter = new LocalFileStorageAdapter(tmpDir);
    await adapter.writeIntuitionNote({
      problemId: FIRST_ID,
      content: 'solved it',
      lastUpdated: new Date().toISOString() as IsoTimestamp,
      status: 'done',
      completed: true,
    });
    await adapter.writeIntuitionNote({
      problemId: SECOND_ID,
      content: 'come back',
      lastUpdated: new Date().toISOString() as IsoTimestamp,
      status: 'to_revisit',
    });

    const handler = createCoachHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/catalog' });
    const body = JSON.parse(res.body) as ApiCatalogResponse;

    const allProblems = body.topics.flatMap((t) => t.problems);
    const firstMatches = allProblems.filter((p) => p.id === FIRST_ID);
    const secondMatches = allProblems.filter((p) => p.id === SECOND_ID);
    expect(firstMatches.length).toBeGreaterThan(0);
    for (const p of firstMatches) {
      expect(p.status).toBe('done');
      expect(p.completed).toBe(true);
    }
    for (const p of secondMatches) {
      expect(p.status).toBe('to_revisit');
      expect(p.completed).toBe(false);
    }
    expect(body.totals.byStatus.done).toBe(1);
    expect(body.totals.byStatus.to_revisit).toBe(1);
  });

  it('GET /api/catalog is safe with no DB configured (all none)', async () => {
    const handler = createCoachHandler(makeNoDbDeps());
    const res = await handler({ method: 'GET', url: '/api/catalog' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiCatalogResponse;
    expect(body.totals.byStatus.none).toBe(body.totals.total);
  });

  it('POST /api/catalog → 405 JSON', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({ method: 'POST', url: '/api/catalog' });
    expect(res.status).toBe(405);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });
});

describe('api progress', () => {
  it('GET /api/progress counts reflect the seed', async () => {
    const adapter = new LocalFileStorageAdapter(tmpDir);
    await adapter.writeIntuitionNote({
      problemId: FIRST_ID,
      content: 'x',
      lastUpdated: new Date().toISOString() as IsoTimestamp,
      status: 'done',
      completed: true,
    });
    await adapter.writeIntuitionNote({
      problemId: SECOND_ID,
      content: 'y',
      lastUpdated: new Date().toISOString() as IsoTimestamp,
      status: 'to_revisit',
    });

    const handler = createCoachHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/progress' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiProgressResponse;
    expect(body.total).toBe(CATALOG.list().length);
    expect(body.completed).toBe(1);
    expect(body.byStatus.done).toBe(1);
    expect(body.byStatus.to_revisit).toBe(1);
    expect(body.byStatus.none).toBe(CATALOG.list().length - 2);
  });

  it('GET /api/progress is safe empty with no DB', async () => {
    const handler = createCoachHandler(makeNoDbDeps());
    const res = await handler({ method: 'GET', url: '/api/progress' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiProgressResponse;
    expect(body.completed).toBe(0);
    expect(body.byStatus.none).toBe(body.total);
  });
});

describe('api notes GET', () => {
  it('returns a saved note', async () => {
    const adapter = new LocalFileStorageAdapter(tmpDir);
    await adapter.writeIntuitionNote({
      problemId: FIRST_ID,
      content: 'my intuition',
      lastUpdated: new Date().toISOString() as IsoTimestamp,
      status: 'done',
      completed: true,
      timeComplexity: 'O(n)',
      spaceComplexity: 'O(1)',
    });

    const handler = createCoachHandler(makeDeps());
    const res = await handler({
      method: 'GET',
      url: `/api/notes/${FIRST_ID}`,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiNoteResponse;
    expect(body.problemId).toBe(FIRST_ID);
    expect(body.content).toBe('my intuition');
    expect(body.status).toBe('done');
    expect(body.completed).toBe(true);
    expect(body.timeComplexity).toBe('O(n)');
    expect(body.spaceComplexity).toBe('O(1)');
    expect(body.lastUpdated).toBeTruthy();
  });

  it('returns an empty note when none saved (valid id, DB configured)', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({
      method: 'GET',
      url: `/api/notes/${FIRST_ID}`,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiNoteResponse;
    expect(body.problemId).toBe(FIRST_ID);
    expect(body.content).toBe('');
    expect(body.status).toBe('none');
    expect(body.completed).toBe(false);
    expect(body.lastUpdated).toBeNull();
  });

  it('404 JSON for unknown problem id', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({
      method: 'GET',
      url: '/api/notes/not-a-real-id',
    });
    expect(res.status).toBe(404);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('returns { dbConfigured: false } when no DB (valid id)', async () => {
    const handler = createCoachHandler(makeNoDbDeps());
    const res = await handler({
      method: 'GET',
      url: `/api/notes/${FIRST_ID}`,
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ dbConfigured: false });
  });
});

describe('api notes POST', () => {
  it('persists via the real adapter and round-trips through GET', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${SECOND_ID}`,
      body: JSON.stringify({ status: 'to_revisit', content: 'later' }),
      contentType: 'application/json',
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(res.body) as ApiNoteResponse;
    expect(saved.status).toBe('to_revisit');
    expect(saved.completed).toBe(false);
    expect(saved.content).toBe('later');

    // Round-trip: a fresh GET reflects the persisted state.
    const getRes = await handler({
      method: 'GET',
      url: `/api/notes/${SECOND_ID}`,
    });
    const got = JSON.parse(getRes.body) as ApiNoteResponse;
    expect(got.status).toBe('to_revisit');
    expect(got.content).toBe('later');

    // And it landed on disk via a brand-new adapter instance.
    const fresh = new LocalFileStorageAdapter(tmpDir);
    const onDisk = await fresh.readIntuitionNote(SECOND_ID);
    expect(onDisk?.status).toBe('to_revisit');
  });

  it("keeps completed consistent with status 'done'", async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${FIRST_ID}`,
      body: JSON.stringify({ status: 'done' }),
    });
    const saved = JSON.parse(res.body) as ApiNoteResponse;
    expect(saved.status).toBe('done');
    expect(saved.completed).toBe(true);
  });

  it('malformed JSON body → 400 JSON', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${FIRST_ID}`,
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('invalid status → 400 JSON', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${FIRST_ID}`,
      body: JSON.stringify({ status: 'bogus' }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('unknown problem id → 404 JSON', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({
      method: 'POST',
      url: '/api/notes/not-a-real-id',
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('no DB configured → 400 JSON, does not crash', async () => {
    const handler = createCoachHandler(makeNoDbDeps());
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${FIRST_ID}`,
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'no database configured' });
  });
});

describe('api config', () => {
  it('dbConfigured true when the data dir exists', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/config' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiConfigResponse;
    expect(body.dbConfigured).toBe(true);
    expect(body.dataDir).toBe(tmpDir);
    expect(body.provider).toBe('Using Ollama: test-model');
  });

  it('dbConfigured false when the data dir does not exist (no dataDir leaked)', async () => {
    const handler = createCoachHandler(makeNoDbDeps());
    const res = await handler({ method: 'GET', url: '/api/config' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiConfigResponse;
    expect(body.dbConfigured).toBe(false);
    expect(body.dataDir).toBeUndefined();
    expect(body.provider).toBe('No model configured');
  });
});

describe('api routing', () => {
  it('unknown /api path → 404 JSON', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/nope' });
    expect(res.status).toBe(404);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('wrong method on /api/config → 405 JSON', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({ method: 'POST', url: '/api/config' });
    expect(res.status).toBe(405);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('DELETE on /api/notes/:id → 405 JSON', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({
      method: 'DELETE',
      url: `/api/notes/${FIRST_ID}`,
    });
    expect(res.status).toBe(405);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('does not disrupt existing routes: GET / still 200', async () => {
    const handler = createCoachHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/' });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/html');
  });
});
