/**
 * GET /api/guidance (ADR 0007 amendment w2a) — end to end over a real,
 * temp-dir-backed data folder. The "ready" fixture is SYNTHETIC but shaped
 * like a real user's folder: ~25 done notes across topics, a few to-revisit /
 * didn't-understand notes, and quiz competency signals.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCatalogSource } from '@ibai/curriculum';
import type { Problem } from '@ibai/curriculum';
import { LocalFileStorageAdapter, deriveTopicStrength } from '@ibai/storage';
import type {
  CompetencySignals,
  IsoTimestamp,
  NoteStatus,
  StorageAdapter,
  TopicCompetency,
} from '@ibai/storage';
import { handleApiRoute } from './api.js';
import type { ApiDeps, ApiGuidanceResponse } from './api.js';
import { createCoachHandler } from './handler.js';

const NOW = new Date('2026-09-26T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const CATALOG = createCatalogSource();

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-guidance-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function daysAgo(days: number): IsoTimestamp {
  return new Date(NOW.getTime() - days * DAY).toISOString() as IsoTimestamp;
}

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

async function getGuidance(
  d: ApiDeps = deps(),
): Promise<{ status: number; body: ApiGuidanceResponse }> {
  const res = await handleApiRoute('GET', '/api/guidance', d, undefined);
  expect(res.contentType).toBe('application/json; charset=utf-8');
  return {
    status: res.status,
    body: JSON.parse(res.body) as ApiGuidanceResponse,
  };
}

function topicProblems(topic: string): readonly Problem[] {
  const list = CATALOG.filterByTopic(topic);
  expect(list.length).toBeGreaterThan(0);
  return list;
}

async function writeNote(
  problemId: string,
  status: NoteStatus,
  lastUpdated: IsoTimestamp,
): Promise<void> {
  await new LocalFileStorageAdapter(tmpDir).writeIntuitionNote({
    problemId,
    content: `my own notes for ${problemId}`,
    lastUpdated,
    status,
    completed: status === 'done',
  });
}

function signals(
  topics: Record<string, [number, number, number]>,
): CompetencySignals {
  const out: Record<string, TopicCompetency> = {};
  for (const [topicId, [correct, incorrect, age]] of Object.entries(topics)) {
    out[topicId] = {
      topicId,
      correct,
      incorrect,
      lastSeen: daysAgo(age),
      strength: deriveTopicStrength(correct, incorrect),
    };
  }
  return { topics: out, patterns: [], lastUpdated: daysAgo(3) };
}

/** Seed the synthetic "real user" folder; returns the revisit ids. */
async function seedRealisticUser(): Promise<{
  dnuId: string;
  revisitIds: string[];
}> {
  const doneCounts: Record<string, number> = {
    trees: 6,
    'dynamic-programming': 5,
    graphs: 4,
    stack: 4,
    'binary-search': 3,
    'linked-list': 3,
  };
  let age = 60;
  for (const [topic, n] of Object.entries(doneCounts)) {
    for (const p of topicProblems(topic).slice(0, n)) {
      await writeNote(p.id, 'done', daysAgo(age--));
    }
  }
  const dnuId = topicProblems('trees')[6]!.id;
  const llRevisit = topicProblems('linked-list')[3]!.id;
  const graphsRevisit = topicProblems('graphs')[4]!.id;
  await writeNote(dnuId, 'did_not_understand', daysAgo(12));
  await writeNote(llRevisit, 'to_revisit', daysAgo(5));
  await writeNote(graphsRevisit, 'to_revisit', daysAgo(2));
  // A note for a problem no longer in the catalog (ignored).
  fs.writeFileSync(
    path.join(tmpDir, 'notes', 'lc-999999.md'),
    `---\nid: lc-999999\nlastUpdated: ${daysAgo(1)}\nstatus: to_revisit\ncompleted: false\n---\nold`,
  );
  await new LocalFileStorageAdapter(tmpDir).writeCompetencySignals(
    signals({
      'dynamic-programming': [1, 4, 3],
      graphs: [3, 2, 3],
      trees: [5, 1, 4],
      stack: [2, 0, 4],
      'not-in-catalog': [0, 3, 3],
    }),
  );
  return { dnuId, revisitIds: [dnuId, llRevisit] };
}

/** Every file under `dir` with its bytes and mtime. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        out[path.relative(dir, full) + '/'] = String(fs.statSync(full).mtimeMs);
        walk(full);
      } else {
        out[path.relative(dir, full)] =
          `${fs.statSync(full).mtimeMs}:${fs.readFileSync(full, 'base64')}`;
      }
    }
  };
  walk(dir);
  return out;
}

describe('GET /api/guidance', () => {
  it('non-GET → 405 JSON', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await handleApiRoute(method, '/api/guidance', deps(), '{}');
      expect(res.status).toBe(405);
      expect(JSON.parse(res.body)).toHaveProperty('error');
    }
  });

  it('no data folder → no_db with empty lists', async () => {
    const missing = path.join(tmpDir, 'does-not-exist');
    const { status, body } = await getGuidance(deps({ dataDir: missing }));
    expect(status).toBe(200);
    expect(body).toEqual({
      state: 'no_db',
      generatedAt: NOW.toISOString(),
      standing: [],
      nextUp: [],
      quiz: { doneCount: 0, lastQuizAt: null, suggested: false },
    });
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('empty folder → empty state with 3 starter problems from 3 topics', async () => {
    const { status, body } = await getGuidance();
    expect(status).toBe(200);
    expect(body.state).toBe('empty');
    expect(body.standing).toEqual([]);
    expect(body.nextUp).toHaveLength(3);
    expect(body.nextUp.every((x) => x.kind === 'start')).toBe(true);
    expect(body.nextUp.every((x) => x.difficulty === 'easy')).toBe(true);
    expect(new Set(body.nextUp.map((x) => x.topicId)).size).toBe(3);
    for (const item of body.nextUp) {
      expect(CATALOG.getById(item.problemId)?.url).toBe(item.url);
    }
    expect(body.quiz.suggested).toBe(false);
  });

  it('ready: realistic synthetic folder', async () => {
    const { revisitIds } = await seedRealisticUser();
    const { status, body } = await getGuidance();
    expect(status).toBe(200);
    expect(body.state).toBe('ready');
    expect(body.generatedAt).toBe(NOW.toISOString());

    // Standing: weak first, bands identical to Analytics' derivation.
    expect(body.standing[0]!.band).toBe('weak');
    const dp = body.standing.find((s) => s.topicId === 'dynamic-programming');
    expect(dp).toMatchObject({
      band: deriveTopicStrength(1, 4),
      quiz: { correct: 1, incorrect: 4 },
      notes: { done: 5, toRevisit: 0, didNotUnderstand: 0 },
    });
    const trees = body.standing.find((s) => s.topicId === 'trees');
    expect(trees).toMatchObject({ band: 'strong', needsReview: true });
    expect(trees!.notes.didNotUnderstand).toBe(1);
    // A signal topic outside the catalog is listed but never suggested.
    expect(
      body.standing.find((s) => s.topicId === 'not-in-catalog'),
    ).toMatchObject({ band: 'weak', notes: { total: 0 } });
    expect(body.nextUp.some((x) => x.topicId === 'not-in-catalog')).toBe(false);

    // Next up: two oldest revisits, then the weak topic's easiest open problem.
    expect(body.nextUp).toHaveLength(3);
    expect(body.nextUp.slice(0, 2).map((x) => x.problemId)).toEqual(revisitIds);
    expect(body.nextUp[0]!.reason).toBe("Marked didn't understand 12 days ago");
    expect(body.nextUp[1]!.reason).toBe('Marked to revisit 5 days ago');
    expect(body.nextUp[2]).toMatchObject({
      kind: 'weak_topic',
      topicId: 'dynamic-programming',
      reason: 'dynamic-programming: 1/5 correct in quiz',
    });
    const ids = body.nextUp.map((x) => x.problemId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('lc-999999');

    // Quiz: 25 done, last quiz 3 days ago → not suggested.
    expect(body.quiz).toEqual({
      doneCount: 25,
      lastQuizAt: daysAgo(3),
      suggested: false,
    });
  });

  it('is strictly read-only (data folder byte-identical before/after)', async () => {
    await seedRealisticUser();
    const before = snapshot(tmpDir);
    await getGuidance();
    await getGuidance();
    expect(snapshot(tmpDir)).toEqual(before);
  });

  it('malformed competency-signals.json degrades to notes-only guidance', async () => {
    const id = topicProblems('graphs')[0]!.id;
    await writeNote(id, 'done', daysAgo(20));
    for (const content of ['{not json', '{"topics": 5, "patterns": "x"}']) {
      fs.writeFileSync(path.join(tmpDir, 'competency-signals.json'), content);
      const { status, body } = await getGuidance();
      expect(status).toBe(200);
      expect(body.state).toBe('ready');
      expect(body.standing.map((s) => s.topicId)).toEqual(['graphs']);
      expect(body.standing[0]!.quiz).toEqual({ correct: 0, incorrect: 0 });
      expect(body.quiz).toEqual({
        doneCount: 1,
        lastQuizAt: null,
        suggested: true,
      });
    }
  });

  it('folds retired topic ids in stored signals via TOPIC_ALIASES (read time)', async () => {
    await new LocalFileStorageAdapter(tmpDir).writeCompetencySignals(
      signals({
        'arrays-2d': [1, 2, 5],
        'two-pointers': [1, 0, 2],
        miscellaneous: [4, 4, 1],
      }),
    );
    const { body } = await getGuidance();
    expect(body.standing.map((s) => s.topicId)).toEqual(['arrays']);
    expect(body.standing[0]!.quiz).toEqual({ correct: 2, incorrect: 2 });
    expect(body.standing[0]!.lastActivity).toBe(daysAgo(2));
  });

  it('an adapter whose signal read throws still answers 200', async () => {
    const real = new LocalFileStorageAdapter(tmpDir);
    const throwing: StorageAdapter = {
      ...Object.fromEntries(
        Object.getOwnPropertyNames(Object.getPrototypeOf(real))
          .filter((k) => k !== 'constructor')
          .map((k) => [
            k,
            (real as unknown as Record<string, (...a: unknown[]) => unknown>)[
              k
            ]!.bind(real),
          ]),
      ),
      readCompetencySignals: () => Promise.reject(new Error('boom')),
    } as StorageAdapter;
    const { status, body } = await getGuidance(
      deps({ createStorage: () => throwing }),
    );
    expect(status).toBe(200);
    expect(body.state).toBe('empty');
  });

  it('is routed by the real handler', async () => {
    const handler = createCoachHandler({
      port: 4173,
      storage: new LocalFileStorageAdapter(tmpDir),
      catalog: CATALOG,
      createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
      dataDir: tmpDir,
      env: {},
      argv: [],
    });
    const res = await handler({
      method: 'GET',
      url: '/api/guidance',
      headers: { host: '127.0.0.1:4173' },
    });
    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as ApiGuidanceResponse).state).toBe('empty');
  });
});
