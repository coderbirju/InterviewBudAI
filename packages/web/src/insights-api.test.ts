/**
 * GET /api/insights (ADR 0012 D3) — end to end over a temp-dir data folder,
 * plus the pure builder and alias folding of slip tallies.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  TOPIC_ORDER,
  TOPIC_LABELS,
  createCatalogSource,
} from '@ibai/curriculum';
import { LocalFileStorageAdapter, deriveTopicStrength } from '@ibai/storage';
import type {
  CompetencySignals,
  IsoTimestamp,
  MissCode,
  MissTally,
  NoteStatus,
  QuizSession,
  StorageAdapter,
  TopicCompetency,
} from '@ibai/storage';
import { canonicalizeSignals, handleApiRoute } from './api.js';
import type { ApiDeps } from './api.js';
import { INSIGHTS_UNLOCK_SESSIONS, buildInsights } from './insights.js';
import type { ApiInsightsResponse } from './insights.js';
import { MISS_LABELS } from './miss-labels.js';
// The SPA's client boundary (dependency-free) — the integration check below
// feeds the real server JSON through it.
import { normalizeInsights } from '../web-ui/src/lib/api.js';
import type { InsightsResponse } from '../web-ui/src/lib/api.js';
import { MISS_LABELS as UI_MISS_LABELS } from '../web-ui/src/lib/analytics.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const AT = '2026-09-29T18:00:00.000Z' as IsoTimestamp;
const EARLIER = '2026-09-20T18:00:00.000Z' as IsoTimestamp;
const CATALOG = createCatalogSource();

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-insights-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function deps(extra: Partial<ApiDeps> = {}): ApiDeps {
  return {
    catalog: CATALOG,
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    storage: new LocalFileStorageAdapter(tmpDir),
    dataDir: tmpDir,
    now: () => NOW,
    ...extra,
  };
}

async function getInsights(d: ApiDeps = deps()): Promise<ApiInsightsResponse> {
  const res = await handleApiRoute('GET', '/api/insights', d, undefined);
  expect(res.status).toBe(200);
  expect(res.contentType).toBe('application/json; charset=utf-8');
  return JSON.parse(res.body) as ApiInsightsResponse;
}

const adapter = (): LocalFileStorageAdapter =>
  new LocalFileStorageAdapter(tmpDir);

async function writeNote(problemId: string, status: NoteStatus) {
  await adapter().writeIntuitionNote({
    problemId,
    content: `my notes for ${problemId}`,
    lastUpdated: EARLIER,
    status,
    completed: status === 'done',
  });
}

async function writeSession(
  sessionId: string,
  answered: number,
  status: QuizSession['status'] = 'complete',
) {
  const deck = CATALOG.list()
    .slice(0, 3)
    .map((p) => p.id);
  await adapter().writeQuizSession({
    sessionId,
    createdAt: EARLIER,
    deck,
    currentIndex: answered,
    answered: deck
      .slice(0, answered)
      .map((problemId) => ({ problemId, verdict: 'correct' as const, at: AT })),
    transcript: [],
    status,
  });
}

function topic(
  topicId: string,
  correct: number,
  incorrect: number,
  misses?: Partial<Record<MissCode, number>>,
): TopicCompetency {
  return {
    topicId,
    correct,
    incorrect,
    lastSeen: AT,
    strength: deriveTopicStrength(correct, incorrect),
    ...(misses && { misses }),
  };
}

async function writeSignals(
  topics: TopicCompetency[],
  misses?: Partial<Record<MissCode, MissTally>>,
) {
  const signals: CompetencySignals = {
    topics: Object.fromEntries(topics.map((t) => [t.topicId, t])),
    patterns: [],
    lastUpdated: AT,
    ...(misses && { misses }),
  };
  await adapter().writeCompetencySignals(signals);
}

/** A folder with weak graphs, revisits in trees, strong arrays, slips. */
async function seedRich() {
  const trees = CATALOG.filterByTopic('trees');
  await writeNote(trees[0]!.id, 'to_revisit');
  await writeNote(trees[1]!.id, 'to_revisit');
  await writeNote(trees[2]!.id, 'done');
  await writeNote(CATALOG.filterByTopic('arrays')[0]!.id, 'done');
  await writeNote(
    CATALOG.filterByTopic('dynamic-programming')[0]!.id,
    'did_not_understand',
  );
  await writeSignals(
    [
      topic('graphs', 2, 4, { edge: 3, complexity: 1 }),
      topic('arrays', 7, 1, { edge: 1 }),
      topic('heap', 6, 0),
      topic('trees', 1, 1, { edge: 2, vague: 1 }),
    ],
    {
      edge: { count: 6, lastSeen: AT },
      complexity: { count: 1, lastSeen: EARLIER },
      vague: { count: 1, lastSeen: AT },
      boundary: { count: 1, lastSeen: EARLIER },
    },
  );
}

describe('GET /api/insights (ADR 0012 D3)', () => {
  it('405 for any other method', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await handleApiRoute(m, '/api/insights', deps(), '{}');
      expect(res.status).toBe(405);
    }
  });

  it('no_db: zero counts, all 13 topics, empty lists', async () => {
    const body = await getInsights(
      deps({ dataDir: path.join(tmpDir, 'missing') }),
    );
    expect(body).toEqual({
      state: 'no_db',
      generatedAt: NOW.toISOString(),
      sessions: { counted: 0, required: 2 },
      status: {
        done: 0,
        toRevisit: 0,
        didNotUnderstand: 0,
        notStarted: 0,
        total: 0,
      },
      topics: TOPIC_ORDER.map((topicId) => ({
        topicId,
        label: TOPIC_LABELS[topicId],
        done: 0,
        total: 0,
      })),
      focus: [],
      slips: [],
      strengths: [],
    });
  });

  it('locked: status + 13 topic tiles, empty insight lists, read-only', async () => {
    await seedRich();
    await writeSession('quiz-a', 1);
    const before = fs.readdirSync(tmpDir, { recursive: true }).sort();
    const body = await getInsights();
    expect(fs.readdirSync(tmpDir, { recursive: true }).sort()).toEqual(before);
    expect(body.state).toBe('locked');
    expect(body.sessions).toEqual({ counted: 1, required: 2 });
    const total = CATALOG.list().length;
    expect(body.status).toEqual({
      done: 2,
      toRevisit: 2,
      didNotUnderstand: 1,
      notStarted: total - 5,
      total,
    });
    expect(body.topics.map((t) => t.topicId)).toEqual([...TOPIC_ORDER]);
    const trees = body.topics.find((t) => t.topicId === 'trees')!;
    expect(trees).toEqual({
      topicId: 'trees',
      label: 'Trees',
      done: 1,
      total: CATALOG.filterByTopic('trees').length,
    });
    expect(body.focus).toEqual([]);
    expect(body.slips).toEqual([]);
    expect(body.strengths).toEqual([]);
  });

  it('counted sessions: any status incl. the active one, only with ≥ 1 terminal answer', async () => {
    await writeSession('quiz-empty', 0);
    expect((await getInsights()).sessions.counted).toBe(0);
    await writeSession('quiz-active', 1, 'active');
    expect((await getInsights()).sessions.counted).toBe(1);
    await writeSession('quiz-done', 3);
    const body = await getInsights();
    expect(body.sessions.counted).toBe(2);
    expect(body.state).toBe('unlocked');
  });

  it('unlocked: focus, slips and strengths built from counts and fixed labels', async () => {
    await seedRich();
    await writeSession('quiz-a', 1);
    await writeSession('quiz-b', 2);
    const body = await getInsights();
    expect(body.state).toBe('unlocked');
    // Focus: deriveGuidance order — weak first, then by most misses.
    expect(body.focus).toEqual([
      {
        topicId: 'graphs',
        label: 'Graphs',
        band: 'weak',
        reason: '4 of 6 quiz answers missed',
      },
      {
        topicId: 'trees',
        label: 'Trees',
        band: 'unknown',
        reason: '1 of 2 quiz answers missed · 2 to revisit',
      },
      {
        topicId: 'dynamic-programming',
        label: TOPIC_LABELS['dynamic-programming'],
        band: 'unknown',
        reason: '1 not understood',
      },
    ]);
    // Slips: by count, then latest; up to 3 topics each.
    expect(body.slips).toEqual([
      {
        code: 'edge',
        label: 'Missed edge cases',
        count: 6,
        lastSeen: AT,
        topics: [
          { topicId: 'graphs', label: 'Graphs', count: 3 },
          { topicId: 'trees', label: 'Trees', count: 2 },
          { topicId: 'arrays', label: 'Arrays', count: 1 },
        ],
      },
      {
        code: 'vague',
        label: MISS_LABELS.vague,
        count: 1,
        lastSeen: AT,
        topics: [{ topicId: 'trees', label: 'Trees', count: 1 }],
      },
      {
        code: 'complexity',
        label: MISS_LABELS.complexity,
        count: 1,
        lastSeen: EARLIER,
        topics: [{ topicId: 'graphs', label: 'Graphs', count: 1 }],
      },
    ]);
    // Strengths: strong topics, most correct first.
    expect(body.strengths).toEqual([
      { topicId: 'arrays', label: 'Arrays', correct: 7, incorrect: 1 },
      { topicId: 'heap', label: TOPIC_LABELS.heap, correct: 6, incorrect: 0 },
    ]);
  });

  it('a focus topic never appears in strengths (focus wins)', async () => {
    const arrays = CATALOG.filterByTopic('arrays');
    await writeNote(arrays[0]!.id, 'to_revisit');
    await writeSignals([topic('arrays', 9, 1)]);
    await writeSession('quiz-a', 1);
    await writeSession('quiz-b', 1);
    const body = await getInsights();
    expect(body.focus.map((f) => [f.topicId, f.band])).toEqual([
      ['arrays', 'strong'],
    ]);
    expect(body.strengths).toEqual([]);
  });

  it('pre-ADR data: unlocked with no slips (empty state)', async () => {
    await writeSignals([topic('graphs', 0, 3)]);
    await writeSession('quiz-a', 1);
    await writeSession('quiz-b', 1);
    const body = await getInsights();
    expect(body.state).toBe('unlocked');
    expect(body.slips).toEqual([]);
    expect(body.focus.map((f) => f.topicId)).toEqual(['graphs']);
  });

  it('locks again when sessions are deleted, unlocks when re-earned', async () => {
    await seedRich();
    await writeSession('quiz-a', 1);
    await writeSession('quiz-b', 1);
    expect((await getInsights()).state).toBe('unlocked');
    const del = await handleApiRoute(
      'POST',
      '/api/quiz/delete',
      deps(),
      JSON.stringify({ sessionId: 'quiz-b' }),
    );
    expect(del.status).toBe(200);
    const locked = await getInsights();
    expect(locked.state).toBe('locked');
    expect(locked.sessions.counted).toBe(1);
    expect(locked.focus).toEqual([]);
    expect(locked.slips).toEqual([]);
    expect(locked.strengths).toEqual([]);
    await writeSession('quiz-c', 2);
    expect((await getInsights()).state).toBe('unlocked');
  });

  it('custom problems count in their topics and in the totals', async () => {
    const created = await handleApiRoute(
      'POST',
      '/api/problems',
      deps(),
      JSON.stringify({
        title: 'Rotate the ring buffer',
        difficulty: 'medium',
        topics: ['arrays'],
      }),
    );
    expect(created.status).toBe(201);
    const id = (JSON.parse(created.body) as { problem: { id: string } }).problem
      .id;
    await writeNote(id, 'done');
    const body = await getInsights();
    expect(body.status.total).toBe(CATALOG.list().length + 1);
    expect(body.status.done).toBe(1);
    expect(body.topics.find((t) => t.topicId === 'arrays')).toEqual({
      topicId: 'arrays',
      label: 'Arrays',
      done: 1,
      total: CATALOG.filterByTopic('arrays').length + 1,
    });
  });

  it('state depends only on sessions: malformed signals empty the lists but stay unlocked', async () => {
    await writeSession('quiz-a', 1);
    await writeSession('quiz-b', 1);
    fs.writeFileSync(path.join(tmpDir, 'competency-signals.json'), '{nope');
    const body = await getInsights();
    expect(body.state).toBe('unlocked');
    expect(body.slips).toEqual([]);
    expect(body.strengths).toEqual([]);

    // An adapter whose signal read throws, and one without listQuizSessions.
    const real = adapter();
    const proxy = (overrides: Partial<StorageAdapter>): StorageAdapter =>
      new Proxy(real, {
        get(target, prop, receiver) {
          if (prop in overrides) {
            return overrides[prop as keyof StorageAdapter];
          }
          const value: unknown = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as StorageAdapter;
    await writeSignals([topic('arrays', 9, 0)]);
    const throwing = await getInsights(
      deps({
        createStorage: () =>
          proxy({
            readCompetencySignals: () => Promise.reject(new Error('boom')),
          }),
      }),
    );
    expect(throwing.state).toBe('unlocked');
    expect(throwing.strengths).toEqual([]);
    const noList = await getInsights(
      deps({ createStorage: () => proxy({ listQuizSessions: undefined }) }),
    );
    expect(noList.state).toBe('locked');
    expect(noList.sessions.counted).toBe(0);
  });

  it('labels fall back to the raw id for an unknown topic', () => {
    const out = buildInsights({
      problems: [],
      notes: [],
      signals: {
        topics: { 'mystery-topic': topic('mystery-topic', 0, 4, { edge: 4 }) },
        patterns: [],
        lastUpdated: AT,
        misses: { edge: { count: 4, lastSeen: AT } },
      },
      countedSessions: INSIGHTS_UNLOCK_SESSIONS,
      now: NOW.toISOString() as IsoTimestamp,
    });
    expect(out.focus[0]).toMatchObject({
      topicId: 'mystery-topic',
      label: 'mystery-topic',
    });
    expect(out.slips[0]?.topics).toEqual([
      { topicId: 'mystery-topic', label: 'mystery-topic', count: 4 },
    ]);
  });
});

describe('server /api/insights through the UI normalizeInsights (#82 + #83)', () => {
  const viaUi = (body: ApiInsightsResponse): InsightsResponse =>
    normalizeInsights(body as InsightsResponse);

  it('locked: the UI view model equals the server payload (lists empty)', async () => {
    await seedRich();
    await writeSession('quiz-a', 1);
    const body = await getInsights();
    const view = viaUi(body);
    expect(view).toEqual(body);
    expect(view.state).toBe('locked');
    expect(view.sessions).toEqual({ counted: 1, required: 2 });
    expect(view.topics.map((t) => t.topicId)).toEqual([...TOPIC_ORDER]);
    expect([view.focus, view.slips, view.strengths]).toEqual([[], [], []]);
  });

  it('unlocked: nothing is dropped; focus/slips/strengths pass through', async () => {
    await seedRich();
    await writeSession('quiz-a', 1);
    await writeSession('quiz-b', 2);
    const body = await getInsights();
    const view = viaUi(body);
    expect(view).toEqual(body);
    expect(view.state).toBe('unlocked');
    expect(view.focus.map((f) => f.topicId)).toEqual([
      'graphs',
      'trees',
      'dynamic-programming',
    ]);
    expect(view.slips.map((s) => s.code)).toEqual([
      'edge',
      'vague',
      'complexity',
    ]);
    expect(view.strengths.map((s) => s.topicId)).toEqual(['arrays', 'heap']);
  });

  it('no_db: the UI view model equals the server payload', async () => {
    const body = await getInsights(
      deps({ dataDir: path.join(tmpDir, 'missing') }),
    );
    expect(viaUi(body)).toEqual(body);
  });

  it('the UI fallback slip labels mirror the server MISS_LABELS', () => {
    expect(UI_MISS_LABELS).toEqual(MISS_LABELS);
  });
});

describe('canonicalizeSignals folds slip tallies through topic aliases (ADR 0012 D1)', () => {
  it('sums per-topic misses when retired ids merge; keeps valid global tallies', () => {
    const raw = {
      topics: {
        'two-pointers': topic('two-pointers', 1, 1, { edge: 1, boundary: 2 }),
        'sliding-window': topic('sliding-window', 0, 1, { edge: 2 }),
        arrays: topic('arrays', 1, 0, { vague: 1 }),
        miscellaneous: topic('miscellaneous', 0, 1, { edge: 5 }),
      },
      patterns: [],
      lastUpdated: AT,
      misses: {
        edge: { count: 3, lastSeen: AT },
        bogus: { count: 1, lastSeen: AT },
      },
    } as unknown as CompetencySignals;
    const out = canonicalizeSignals(raw);
    expect(Object.keys(out.topics)).toEqual(['arrays']);
    expect(out.topics['arrays']?.misses).toEqual({
      edge: 3,
      boundary: 2,
      vague: 1,
    });
    expect(out.misses).toEqual({ edge: { count: 3, lastSeen: AT } });
  });

  it('pre-ADR signals stay miss-free', () => {
    const out = canonicalizeSignals({
      topics: { arrays: topic('arrays', 1, 0) },
      patterns: [],
      lastUpdated: AT,
    });
    expect('misses' in out).toBe(false);
    expect('misses' in out.topics['arrays']!).toBe(false);
  });
});
