import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCoachHandler } from './handler.js';
import type {
  CoachHandlerDeps,
  HandlerRequest,
  HandlerResponse,
} from './handler.js';
import type {
  ApiCatalogResponse,
  ApiProgressResponse,
  ApiNoteResponse,
  ApiConfigResponse,
  ApiCompetencyResponse,
} from './api.js';
import { TOPIC_ORDER, createCatalogSource, sortTopics } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import type { IsoTimestamp } from '@ibai/storage';
import type {
  LlmProvider,
  CompletionRequest,
  CompletionResponse,
} from '@ibai/providers';

// A real, temp-dir-backed data directory + storage factory, exercised end to
// end (no network, no mocks for persistence). Each test gets a fresh dir.
let tmpDir: string;

const TEST_PORT = 4173;

/**
 * Build a handler whose requests look like the real SPA's: a valid localhost
 * `Host` and `Content-Type: application/json` on writes (the SPA always sends
 * it). The security checks themselves are exercised in security.test.ts.
 */
function makeHandler(
  deps: CoachHandlerDeps,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  const handler = createCoachHandler({ port: TEST_PORT, ...deps });
  return (req) =>
    handler({
      contentType: req.method === 'GET' ? undefined : 'application/json',
      ...req,
      headers: { host: `127.0.0.1:${TEST_PORT}`, ...req.headers },
    });
}

function makeDeps(overrides: Partial<CoachHandlerDeps> = {}): CoachHandlerDeps {
  return {
    // The default `storage` is never used for these routes when createStorage
    // is provided, but the handler type requires it.
    storage: new LocalFileStorageAdapter(tmpDir),
    catalog: createCatalogSource(),
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    dataDir: tmpDir,
    providerLabel: 'Using Ollama: test-model',
    // Empty env: the injected dataDir is the server state.
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
    dataDir: missing,
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
    const handler = makeHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/catalog' });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const body = JSON.parse(res.body) as ApiCatalogResponse;
    expect(Array.isArray(body.topics)).toBe(true);
    expect(body.topics.length).toBeGreaterThan(0);
    // Topics follow the curriculum learning order, each with its label.
    const topicNames = body.topics.map((t) => t.topic);
    expect(sortTopics(topicNames)).toEqual(topicNames);
    expect(body.topics[0]!.label).toBeTruthy();
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

    const handler = makeHandler(makeDeps());
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
    const handler = makeHandler(makeNoDbDeps());
    const res = await handler({ method: 'GET', url: '/api/catalog' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiCatalogResponse;
    expect(body.totals.byStatus.none).toBe(body.totals.total);
  });

  it('POST /api/catalog → 405 JSON', async () => {
    const handler = makeHandler(makeDeps());
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

    const handler = makeHandler(makeDeps());
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
    const handler = makeHandler(makeNoDbDeps());
    const res = await handler({ method: 'GET', url: '/api/progress' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiProgressResponse;
    expect(body.completed).toBe(0);
    expect(body.byStatus.none).toBe(body.total);
  });
});

describe('api catalog topic order', () => {
  it('GET /api/catalog lists topics in curriculum order, unknown topics last alphabetically', async () => {
    const mk = (id: string, topics: string[]) => ({
      id,
      title: id,
      url: `https://leetcode.com/problems/${id}/`,
      difficulty: 'easy' as const,
      topics,
    });
    const catalog = createCatalogSource([
      mk('lc-1', ['zeta-topic']),
      mk('lc-2', ['dynamic-programming']),
      mk('lc-3', ['alpha-topic', 'trees']),
      mk('lc-4', ['arrays']),
      mk('lc-5', ['stack']),
    ]);
    const handler = makeHandler(makeDeps({ catalog }));
    const res = await handler({ method: 'GET', url: '/api/catalog' });
    const body = JSON.parse(res.body) as ApiCatalogResponse;
    expect(body.topics.map((t) => t.topic)).toEqual([
      'arrays',
      'stack',
      'trees',
      'dynamic-programming',
      'alpha-topic',
      'zeta-topic',
    ]);
    expect(body.topics.map((t) => t.label)).toEqual([
      'Arrays',
      'Stack & Queue',
      'Trees',
      'Dynamic Programming',
      'alpha-topic',
      'zeta-topic',
    ]);
    // Every known topic id precedes every unknown one.
    const known = body.topics.filter((t) => TOPIC_ORDER.includes(t.topic));
    expect(body.topics.slice(0, known.length)).toEqual(known);
  });
});

describe('api competency', () => {
  it('GET /api/competency folds retired topic ids via TOPIC_ALIASES at read time (no rewrite)', async () => {
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const t1 = '2026-09-20T12:00:00.000Z' as IsoTimestamp;
    const t2 = '2026-09-24T12:00:00.000Z' as IsoTimestamp;
    const stored = {
      topics: {
        'arrays-2d': {
          topicId: 'arrays-2d',
          correct: 2,
          incorrect: 1,
          lastSeen: t1,
          strength: 'unknown' as const,
        },
        'sliding-window': {
          topicId: 'sliding-window',
          correct: 1,
          incorrect: 3,
          lastSeen: t2,
          strength: 'weak' as const,
        },
        'two-pointers': {
          topicId: 'two-pointers',
          correct: 0,
          incorrect: 1,
          lastSeen: t1,
          strength: 'unknown' as const,
        },
        miscellaneous: {
          topicId: 'miscellaneous',
          correct: 9,
          incorrect: 9,
          lastSeen: t2,
          strength: 'improving' as const,
        },
        trees: {
          topicId: 'trees',
          correct: 4,
          incorrect: 0,
          lastSeen: t1,
          strength: 'strong' as const,
        },
      },
      patterns: [
        {
          id: 'miss:lc-209',
          description: 'Missed "Minimum Size Subarray Sum".',
          topics: ['arrays-2d', 'sliding-window', 'miscellaneous'],
          occurrences: 2,
          lastObserved: t2,
        },
        {
          id: 'miss:misc-only',
          description: 'Missed a problem that was only miscellaneous.',
          topics: ['miscellaneous'],
          occurrences: 5,
          lastObserved: t2,
        },
        {
          id: 'miss:no-topics',
          description: 'Missed a problem with no topic.',
          topics: [],
          occurrences: 1,
          lastObserved: t1,
        },
      ],
      lastUpdated: t2,
    };
    await adapter.writeCompetencySignals(stored);

    const handler = makeHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/competency' });
    const body = JSON.parse(res.body) as ApiCompetencyResponse;
    const byId = new Map(body.topics.map((t) => [t.topicId, t]));
    expect([...byId.keys()].sort()).toEqual(['arrays', 'trees']);
    const arrays = byId.get('arrays')!;
    expect(arrays.correct).toBe(3);
    expect(arrays.incorrect).toBe(5);
    expect(arrays.lastSeen).toBe(t2);
    expect(arrays.label).toBe('Arrays');
    expect(arrays.strength).toBe('weak');
    expect(body.patterns[0]!.topics).toEqual(['arrays']);
    expect(body.patterns[0]!.topicLabels).toEqual(['Arrays']);
    // A pattern that lost ALL its topics to aliasing is dropped; one that
    // never had topics is kept unchanged.
    expect(body.patterns.map((p) => p.id)).toEqual([
      'miss:lc-209',
      'miss:no-topics',
    ]);
    expect(body.patterns[1]!).toMatchObject({ topics: [], topicLabels: [] });

    // Read-time only: the stored dataset is untouched.
    expect(await adapter.readCompetencySignals()).toEqual(stored);
  });

  it('GET /api/competency returns seeded signals (topics sorted weak-first + patterns)', async () => {
    // Seed the competency-signals store via the real adapter.
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const at = '2026-09-24T12:00:00.000Z' as IsoTimestamp;
    await adapter.writeCompetencySignals({
      topics: {
        'Arrays & Hashing': {
          topicId: 'Arrays & Hashing',
          correct: 5,
          incorrect: 1,
          lastSeen: at,
          strength: 'strong',
        },
        'Dynamic Programming': {
          topicId: 'Dynamic Programming',
          correct: 1,
          incorrect: 4,
          lastSeen: at,
          strength: 'weak',
        },
      },
      patterns: [
        {
          id: 'miss:lc-322',
          description: 'Missed "Coin Change".',
          topics: ['Dynamic Programming'],
          occurrences: 3,
          lastObserved: at,
        },
      ],
      lastUpdated: at,
    });

    const handler = makeHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/competency' });
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const body = JSON.parse(res.body) as ApiCompetencyResponse;

    // Two topics, sorted weak-first.
    expect(body.topics).toHaveLength(2);
    expect(body.topics[0]!.topicId).toBe('Dynamic Programming');
    expect(body.topics[0]!.strength).toBe('weak');
    expect(body.topics[0]!.correct).toBe(1);
    expect(body.topics[0]!.incorrect).toBe(4);
    expect(body.topics[1]!.topicId).toBe('Arrays & Hashing');
    expect(body.topics[1]!.strength).toBe('strong');

    // The recurring pattern is surfaced verbatim (user's own words, no solution).
    expect(body.patterns).toHaveLength(1);
    expect(body.patterns[0]!.id).toBe('miss:lc-322');
    expect(body.patterns[0]!.occurrences).toBe(3);
    expect(body.patterns[0]!.description).toContain('Coin Change');
  });

  it('GET /api/competency is safe empty when no signals exist yet', async () => {
    const handler = makeHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/competency' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiCompetencyResponse;
    expect(body).toEqual({ topics: [], patterns: [] });
  });

  it('GET /api/competency is safe empty with no DB configured', async () => {
    const handler = makeHandler(makeNoDbDeps());
    const res = await handler({ method: 'GET', url: '/api/competency' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiCompetencyResponse;
    expect(body).toEqual({ topics: [], patterns: [] });
  });

  it('POST /api/competency → 405 JSON (read-only)', async () => {
    const handler = makeHandler(makeDeps());
    const res = await handler({ method: 'POST', url: '/api/competency' });
    expect(res.status).toBe(405);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toHaveProperty('error');
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

    const handler = makeHandler(makeDeps());
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
    const handler = makeHandler(makeDeps());
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
    const handler = makeHandler(makeDeps());
    const res = await handler({
      method: 'GET',
      url: '/api/notes/not-a-real-id',
    });
    expect(res.status).toBe(404);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('returns { dbConfigured: false } when no DB (valid id)', async () => {
    const handler = makeHandler(makeNoDbDeps());
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
    const handler = makeHandler(makeDeps());
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

  it('complexity values with quotes/backslashes round-trip through POST → GET, stable across saves', async () => {
    const handler = makeHandler(makeDeps());
    const time = 'O(n) "amortized" \\log n: #1 \'x\' Θ ';
    const space = '  O(1)\\';
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${SECOND_ID}`,
      body: JSON.stringify({
        content: 'c',
        timeComplexity: time,
        spaceComplexity: space,
      }),
    });
    expect(res.status).toBe(200);
    for (let i = 0; i < 3; i++) {
      const got = JSON.parse(
        (await handler({ method: 'GET', url: `/api/notes/${SECOND_ID}` })).body,
      ) as ApiNoteResponse;
      expect(got.timeComplexity).toBe(time);
      expect(got.spaceComplexity).toBe(space);
      // The editor re-saves the fields it loaded (no accumulation).
      await handler({
        method: 'POST',
        url: `/api/notes/${SECOND_ID}`,
        body: JSON.stringify({
          content: `c${i}`,
          timeComplexity: got.timeComplexity,
          spaceComplexity: got.spaceComplexity,
        }),
      });
    }
  });

  it('a multi-line complexity → 400 JSON, nothing written', async () => {
    const handler = makeHandler(makeDeps());
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${SECOND_ID}`,
      body: JSON.stringify({ timeComplexity: 'O(n)\nO(1)' }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'timeComplexity must be a single line',
    });
    expect(
      await new LocalFileStorageAdapter(tmpDir).readIntuitionNote(SECOND_ID),
    ).toBeNull();
  });

  it("keeps completed consistent with status 'done'", async () => {
    const handler = makeHandler(makeDeps());
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
    const handler = makeHandler(makeDeps());
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
    const handler = makeHandler(makeDeps());
    const res = await handler({
      method: 'POST',
      url: `/api/notes/${FIRST_ID}`,
      body: JSON.stringify({ status: 'bogus' }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('unknown problem id → 404 JSON', async () => {
    const handler = makeHandler(makeDeps());
    const res = await handler({
      method: 'POST',
      url: '/api/notes/not-a-real-id',
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('no DB configured → 400 JSON, does not crash', async () => {
    const handler = makeHandler(makeNoDbDeps());
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
    const handler = makeHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/config' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiConfigResponse;
    expect(body.dbConfigured).toBe(true);
    expect(body.dataDir).toBe(tmpDir);
    expect(body.provider).toBe('Using Ollama: test-model');
  });

  it('dbConfigured false when the data dir does not exist (no dataDir leaked)', async () => {
    const handler = makeHandler(makeNoDbDeps());
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
    const handler = makeHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/api/nope' });
    expect(res.status).toBe(404);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('wrong method on /api/config → 405 JSON', async () => {
    const handler = makeHandler(makeDeps());
    const res = await handler({ method: 'POST', url: '/api/config' });
    expect(res.status).toBe(405);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('DELETE on /api/notes/:id → 405 JSON', async () => {
    const handler = makeHandler(makeDeps());
    const res = await handler({
      method: 'DELETE',
      url: `/api/notes/${FIRST_ID}`,
    });
    expect(res.status).toBe(405);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });

  it('does not disrupt existing routes: GET / still 200', async () => {
    const handler = makeHandler(makeDeps());
    const res = await handler({ method: 'GET', url: '/' });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/html');
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat was removed (dead since the Quiz Master replaced the generic
// interview chat, ADR 0008 D4). It is now an ordinary unknown /api path.
// ---------------------------------------------------------------------------

/** A provider that records calls; /api/chat must never reach it. */
class CountingProvider implements LlmProvider {
  calls = 0;
  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    this.calls += 1;
    return { content: 'x' };
  }
}

describe('removed POST /api/chat', () => {
  it.each(['POST', 'GET'])(
    '%s /api/chat → 404 JSON, provider untouched',
    async (method) => {
      const provider = new CountingProvider();
      const handler = makeHandler({ ...makeDeps(), provider });
      const res = await handler({
        method,
        url: '/api/chat',
        body:
          method === 'POST'
            ? JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
            : undefined,
      });
      expect(res.status).toBe(404);
      expect(res.contentType).toBe('application/json; charset=utf-8');
      expect(JSON.parse(res.body)).toHaveProperty('error');
      expect(provider.calls).toBe(0);
    },
  );
});
