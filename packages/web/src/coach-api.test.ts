/**
 * POST /api/notes/:id/check, GET /api/practice, POST /api/practice/reset
 * (ADR 0013 D2/D3) — over a temp data folder with a fake provider.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCatalogSource } from '@ibai/curriculum';
import {
  LocalFileStorageAdapter,
  PRACTICE_EVENTS_MAX,
  PRACTICE_SIGNALS_FILE,
} from '@ibai/storage';
import type { IsoTimestamp, StorageAdapter } from '@ibai/storage';
import type {
  CompletionRequest,
  CompletionResponse,
  LlmProvider,
} from '@ibai/providers';
import { handleApiRoute, DMR_UNAVAILABLE_HINT } from './api.js';
import type { ApiDeps } from './api.js';
import { createCoachHandler } from './handler.js';
import { createBackup } from './import/backup.js';
import {
  COACH_LEAK_REMINDER,
  COACH_MALFORMED_REMINDER,
} from './coach-check.js';
import { createCoachLimiter } from './coach-routes.js';
import { buildPractice } from './practice.js';
import type { ApiPracticeResponse } from './practice.js';

const CATALOG = createCatalogSource();
const PROBLEM = CATALOG.list()[0]!;
const OTHER = CATALOG.list()[1]!;
const NOW = new Date('2026-10-01T12:00:00.000Z');

let tmpDir: string;
let clock: number;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-coach-test-'));
  clock = 1_000_000;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const PARTIAL = JSON.stringify({
  assessment: 'partial',
  questions: ['What does n ≤ 1e5 suggest you can afford?'],
  readyToCode: false,
  note: 'The cost is the gap.',
  miss: 'complexity',
});
const ON_TRACK = JSON.stringify({
  assessment: 'on_track',
  questions: [],
  readyToCode: true,
  note: '',
});

/** Returns queued replies (or throws queued errors); records every request. */
class FakeProvider implements LlmProvider {
  requests: CompletionRequest[] = [];
  constructor(private readonly replies: (string | Error)[] = [PARTIAL]) {}
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const next =
      this.replies.length > 1 ? this.replies.shift()! : this.replies[0]!;
    if (next instanceof Error) throw next;
    return { content: next };
  }
}

function deps(extra: Partial<ApiDeps> = {}): ApiDeps {
  return {
    catalog: CATALOG,
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    storage: new LocalFileStorageAdapter(tmpDir),
    dataDir: tmpDir,
    now: () => NOW,
    provider: new FakeProvider(),
    // A fresh limiter whose clock moves 10 s per start: never rate limited.
    coachLimiter: createCoachLimiter({ clock: () => (clock += 10_000) }),
    ...extra,
  };
}

async function check(
  body: unknown,
  d: ApiDeps = deps(),
  id: string = PROBLEM.id,
) {
  const res = await handleApiRoute(
    'POST',
    `/api/notes/${encodeURIComponent(id)}/check`,
    d,
    typeof body === 'string' ? body : JSON.stringify(body),
  );
  return {
    status: res.status,
    body: JSON.parse(res.body) as Record<string, unknown>,
  };
}

async function practice(d: ApiDeps = deps()): Promise<ApiPracticeResponse> {
  const res = await handleApiRoute('GET', '/api/practice', d, undefined);
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as ApiPracticeResponse;
}

const filesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { recursive: true }).map(String).sort();

describe('POST /api/notes/:id/check (ADR 0013 D2)', () => {
  it('200: the D2 shape; unsaved content is checked; nothing but the outcome is stored', async () => {
    const provider = new FakeProvider();
    const { status, body } = await check(
      {
        content: 'UNSAVED-EDIT: nested loops over pairs',
        timeComplexity: 'O(n^2)',
        // ADR 0014 D1: an older client's field is ignored, never sent.
        referenceApproach: 'SECRET-REFERENCE text',
        status: 'to_revisit',
      },
      deps({ provider }),
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      assessment: 'partial',
      questions: ['What does n ≤ 1e5 suggest you can afford?'],
      readyToCode: false,
      note: 'The cost is the gap.',
      miss: 'complexity',
      missLabel: 'Complexity analysis off',
      firstCheck: true,
      truncated: { note: false, statement: false },
      checkedAt: NOW.toISOString(),
      recorded: true,
    });
    // The editor text went to the model (never a saved note: there is none).
    const sent = provider.requests[0]!.messages[1]!.content;
    expect(sent).toContain('UNSAVED-EDIT');
    for (const m of provider.requests[0]!.messages) {
      expect(m.content).not.toContain('SECRET-REFERENCE');
      expect(m.content).not.toContain('Reference');
    }
    expect(provider.requests[0]!.options).toMatchObject({
      responseFormat: 'json',
      maxTokens: 256,
    });
    // Only practice-signals.json was written; it holds no text.
    expect(filesUnder(tmpDir)).toEqual([PRACTICE_SIGNALS_FILE]);
    const disk = fs.readFileSync(
      path.join(tmpDir, PRACTICE_SIGNALS_FILE),
      'utf8',
    );
    for (const text of ['UNSAVED', 'SECRET', 'n ≤ 1e5', 'gap', 'O(n^2)']) {
      expect(disk).not.toContain(text);
    }
    expect(JSON.parse(disk).events[0]).toMatchObject({
      problemId: PROBLEM.id,
      assessment: 'partial',
      status: 'to_revisit',
      first: true,
    });
  });

  it('does not read the saved note: the body is authoritative', async () => {
    await new LocalFileStorageAdapter(tmpDir).writeIntuitionNote({
      problemId: PROBLEM.id,
      content: 'SAVED-CONTENT',
      lastUpdated: NOW.toISOString() as IsoTimestamp,
    });
    const provider = new FakeProvider();
    await check({ content: 'editor text' }, deps({ provider }));
    const sent = provider.requests[0]!.messages.map((m) => m.content).join(
      '\n',
    );
    expect(sent).not.toContain('SAVED-CONTENT');
  });

  it('second check of a problem is not first; on_track drops miss + label', async () => {
    const d = deps({ provider: new FakeProvider([PARTIAL, ON_TRACK]) });
    expect((await check({ content: 'a' }, d)).body.firstCheck).toBe(true);
    const second = await check({ content: 'b' }, d);
    expect(second.body.firstCheck).toBe(false);
    expect(second.body).not.toHaveProperty('miss');
    expect(second.body).not.toHaveProperty('missLabel');
    expect(second.body.readyToCode).toBe(true);
  });

  it('checks content as sent, a legacy marker section included (ADR 0014 D1)', async () => {
    const marker = '<!-- ibai:reference-approach -->';
    const provider = new FakeProvider();
    const content = `my idea\n\n${marker}\n## Reference approach\n\nMY OLD TEXT`;
    const res = await check({ content }, deps({ provider }));
    expect(res.status).toBe(200);
    const sent = provider.requests[0]!.messages[1]!.content;
    expect(sent).toContain(content);
    const only = await check({ content: `  \n${marker}\nonly ref` });
    expect(only.status).toBe(200);
  });

  it('ignores referenceApproach of any type (ADR 0014 D1)', async () => {
    for (const referenceApproach of [
      [],
      7,
      null,
      { a: 1 },
      'r'.repeat(60_000),
    ]) {
      const provider = new FakeProvider();
      const res = await check(
        { content: 'a', referenceApproach },
        deps({ provider }),
      );
      expect(res.status, JSON.stringify(referenceApproach).slice(0, 20)).toBe(
        200,
      );
      expect(res.body.truncated).toEqual({ note: false, statement: false });
    }
  });

  it('flags truncation', async () => {
    const { body } = await check({
      content: 'n'.repeat(3000),
    });
    expect(body.truncated).toEqual({
      note: true,
      statement: false,
    });
  });

  it('400 empty_note / invalid_body matrix', async () => {
    const cases: [unknown, string][] = [
      [{}, 'empty_note'],
      [{ content: '   ' }, 'empty_note'],
      [{ content: 7 }, 'invalid_body'],
      [{ content: 'a', timeComplexity: 1 }, 'invalid_body'],
      [{ content: 'a', status: 'great' }, 'invalid_body'],
      [{ content: 'x'.repeat(50_001) }, 'invalid_body'],
      [{ content: 'a', spaceComplexity: 's'.repeat(50_001) }, 'invalid_body'],
      ['not json', 'invalid_body'],
      ['[1]', 'invalid_body'],
    ];
    for (const [body, code] of cases) {
      const res = await check(body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(res.body.code).toBe(code);
      expect(typeof res.body.error).toBe('string');
    }
    expect(fs.existsSync(path.join(tmpDir, PRACTICE_SIGNALS_FILE))).toBe(false);
  });

  it('400 no_provider; 404 unknown problem; 405 other methods', async () => {
    const none = await check({ content: 'a' }, deps({ provider: undefined }));
    expect(none).toEqual({
      status: 400,
      body: { error: 'no model configured', code: 'no_provider' },
    });
    const unknown = await check({ content: 'a' }, deps(), 'nope-123');
    expect(unknown).toEqual({
      status: 404,
      body: { error: 'unknown problem', problemId: 'nope-123' },
    });
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await handleApiRoute(
        method,
        `/api/notes/${PROBLEM.id}/check`,
        deps(),
        undefined,
      );
      expect(res.status).toBe(405);
    }
  });

  it('works for a custom problem from the merged catalog (statement sent, url never)', async () => {
    const id = 'u-ring-buffer-abc123';
    fs.mkdirSync(path.join(tmpDir, 'problems'));
    fs.writeFileSync(
      path.join(tmpDir, 'problems', `${id}.json`),
      JSON.stringify({
        id,
        title: 'Ring buffer',
        url: 'https://example.com/ring',
        statement: 'Design a ring buffer.',
        difficulty: 'medium',
        topics: ['arrays'],
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      }),
    );
    const provider = new FakeProvider();
    const res = await check({ content: 'two indexes' }, deps({ provider }), id);
    expect(res.status).toBe(200);
    const sent = provider.requests[0]!.messages[1]!.content;
    expect(sent).toContain('Design a ring buffer.');
    expect(sent).not.toContain('example.com');
  });

  it('retry once on a malformed reply, with the JSON reminder', async () => {
    const provider = new FakeProvider(['garbage', PARTIAL]);
    const res = await check({ content: 'a' }, deps({ provider }));
    expect(res.status).toBe(200);
    expect(provider.requests).toHaveLength(2);
    expect(
      provider.requests[1]!.messages[1]!.content.endsWith(
        COACH_MALFORMED_REMINDER,
      ),
    ).toBe(true);
  });

  it('retry once on a leak, with the leak reminder; 502 after a second failure, nothing recorded', async () => {
    const leak = JSON.stringify({
      assessment: 'partial',
      questions: ['def solve(nums):'],
    });
    const provider = new FakeProvider([leak, leak]);
    const res = await check({ content: 'a' }, deps({ provider }));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('The model gave an unusable reply. Try again.');
    expect(provider.requests).toHaveLength(2);
    expect(
      provider.requests[1]!.messages[1]!.content.endsWith(COACH_LEAK_REMINDER),
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, PRACTICE_SIGNALS_FILE))).toBe(false);
  });

  it('an empty completion counts as malformed (retried)', async () => {
    const provider = new FakeProvider([
      new Error('ollama: model returned an empty response'),
      PARTIAL,
    ]);
    expect((await check({ content: 'a' }, deps({ provider }))).status).toBe(
      200,
    );
    expect(provider.requests).toHaveLength(2);
  });

  it('503 model_unavailable with the DMR hint; transport errors are not retried', async () => {
    const provider = new FakeProvider([
      new Error('fetch failed: ECONNREFUSED'),
    ]);
    const res = await check(
      { content: 'a' },
      deps({
        provider,
        settings: {
          env: {
            IBAI_OPENAI_BASE_URL:
              'http://model-runner.docker.internal/engines/v1',
            IBAI_OPENAI_MODEL: 'some-model',
          },
          testProvider: async () => ({ status: 200, body: {} }) as never,
        },
      }),
    );
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('model_unavailable');
    expect(typeof res.body.detail).toBe('string');
    expect(res.body.hint).toBe(DMR_UNAVAILABLE_HINT);
    expect(provider.requests).toHaveLength(1);
  });

  it('502 on other provider errors', async () => {
    const res = await check(
      { content: 'a' },
      deps({ provider: new FakeProvider([new Error('HTTP 500 boom')]) }),
    );
    expect(res.status).toBe(502);
  });

  it('429 rate_limited: one in flight, and ≥ 3 s between starts', async () => {
    let now = 0;
    const limiter = createCoachLimiter({ clock: () => now });
    let release!: () => void;
    const slow: LlmProvider = {
      complete: () =>
        new Promise((resolve) => {
          release = () => resolve({ content: PARTIAL });
        }),
    };
    const d = deps({ provider: slow, coachLimiter: limiter });
    const first = check({ content: 'a' }, d);
    await new Promise((r) => setTimeout(r, 10));
    now = 1000;
    const busy = await check({ content: 'b' }, d);
    expect(busy.status).toBe(429);
    expect(busy.body).toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 2000,
    });
    now = 5000;
    const stillBusy = await check({ content: 'b' }, d);
    expect(stillBusy.body).toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 1000,
    });
    release();
    expect((await first).status).toBe(200);
    // Interval since the last START is 5 s: allowed again…
    const fast = deps({ provider: new FakeProvider(), coachLimiter: limiter });
    expect((await check({ content: 'c' }, fast)).status).toBe(200);
    // …and a start 1 s later is refused with the remaining 2 s.
    now = 6000;
    const tooSoon = await check({ content: 'd' }, fast);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body).toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 2000,
    });
  });

  it('a failing call still releases the in-flight slot', async () => {
    let now = 0;
    const limiter = createCoachLimiter({ clock: () => now });
    const d = deps({
      provider: new FakeProvider([new Error('HTTP 500')]),
      coachLimiter: limiter,
    });
    expect((await check({ content: 'a' }, d)).status).toBe(502);
    now = 3000;
    expect((await check({ content: 'a' }, d)).status).toBe(502);
  });

  it('no data folder: still checks, recorded:false, firstCheck:false', async () => {
    const missing = path.join(tmpDir, 'missing');
    const res = await check({ content: 'a' }, deps({ dataDir: missing }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recorded: false, firstCheck: false });
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('a failing practice write or a read-only folder: recorded:false', async () => {
    const failing: StorageAdapter = Object.assign(
      new LocalFileStorageAdapter(tmpDir),
      {
        appendPracticeEvent: async () => {
          throw new Error('EROFS');
        },
      },
    );
    const res = await check(
      { content: 'a' },
      deps({ createStorage: () => failing }),
    );
    expect(res.body).toMatchObject({ recorded: false, firstCheck: false });
    const ro = await check({ content: 'a' }, deps({ readOnlyFormat: () => 2 }));
    expect(ro.status).toBe(200);
    expect(ro.body.recorded).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, PRACTICE_SIGNALS_FILE))).toBe(false);
  });
});

describe('check route through the full handler (prechecks, 413, limiter)', () => {
  const HOST = '127.0.0.1:4173';
  function handler(provider: LlmProvider) {
    return createCoachHandler({
      storage: new LocalFileStorageAdapter(tmpDir),
      catalog: CATALOG,
      createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
      dataDir: tmpDir,
      homeDir: tmpDir,
      env: {},
      argv: [],
      port: 4173,
      provider,
      clock: () => 0,
    });
  }
  const post = (body: string, headers: Record<string, string> = {}) => ({
    method: 'POST',
    url: `/api/notes/${PROBLEM.id}/check`,
    body,
    contentType: 'application/json',
    headers: { host: HOST, ...headers },
  });

  it('413 over the body cap, before any model call', async () => {
    const provider = new FakeProvider();
    const res = await handler(provider)(post('x'.repeat(1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(provider.requests).toHaveLength(0);
  });

  it('cross-origin POST is refused (security prechecks)', async () => {
    const provider = new FakeProvider();
    const res = await handler(provider)(
      post(JSON.stringify({ content: 'a' }), { origin: 'http://evil.com' }),
    );
    expect(res.status).toBe(403);
    expect(provider.requests).toHaveLength(0);
  });

  it('one limiter per handler: a second immediate check is 429', async () => {
    const h = handler(new FakeProvider());
    expect((await h(post(JSON.stringify({ content: 'a' })))).status).toBe(200);
    const again = await h(post(JSON.stringify({ content: 'a' })));
    expect(again.status).toBe(429);
    expect(JSON.parse(again.body)).toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 3000,
    });
  });
});

describe('GET /api/practice (ADR 0013 D3)', () => {
  it('no_db / empty states have zero counts', async () => {
    const noDb = await practice(deps({ dataDir: path.join(tmpDir, 'nope') }));
    expect(noDb).toMatchObject({
      state: 'no_db',
      totals: { checks: 0, problems: 0, windowEvents: 0, windowCap: 500 },
      firstCheck: { on_track: 0, partial: 0, off_track: 0 },
      slips: [],
      fixedAfterRecheck: { count: 0, of: 0 },
      readyToCodeFirstTry: { count: 0, of: 0 },
      since: null,
    });
    expect((await practice()).state).toBe('empty');
    for (const method of ['POST', 'DELETE']) {
      const res = await handleApiRoute(method, '/api/practice', deps(), '{}');
      expect(res.status).toBe(405);
    }
  });

  it('counts first checks, fixed-after-recheck, ready-first-try and slips', async () => {
    const d = (reply: string) => deps({ provider: new FakeProvider([reply]) });
    await check({ content: 'a' }, d(PARTIAL), PROBLEM.id); // first, partial
    await check({ content: 'a' }, d(ON_TRACK), PROBLEM.id); // fixed
    await check({ content: 'a' }, d(ON_TRACK), OTHER.id); // first, ready
    const p = await practice();
    expect(p.state).toBe('ready');
    expect(p.totals).toEqual({
      checks: 3,
      problems: 2,
      windowEvents: 3,
      windowCap: PRACTICE_EVENTS_MAX,
    });
    expect(p.firstCheck).toEqual({ on_track: 1, partial: 1, off_track: 0 });
    expect(p.fixedAfterRecheck).toEqual({ count: 1, of: 1 });
    expect(p.readyToCodeFirstTry).toEqual({ count: 1, of: 2 });
    expect(p.slips).toHaveLength(1);
    expect(p.slips[0]).toMatchObject({
      code: 'complexity',
      label: 'Complexity analysis off',
      count: 1,
    });
    expect(p.since).toBe(NOW.toISOString());
    // Quiz analytics are untouched.
    const insights = await handleApiRoute(
      'GET',
      '/api/insights',
      deps(),
      undefined,
    );
    expect(JSON.parse(insights.body).state).not.toBe('unlocked');
    expect(filesUnder(tmpDir)).toEqual([PRACTICE_SIGNALS_FILE]);
  });
});

describe('practice stats builder (pure)', () => {
  const at = (i: number) =>
    new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString() as IsoTimestamp;
  const ev = (
    problemId: string,
    assessment: 'on_track' | 'partial' | 'off_track',
    first: boolean,
    i: number,
    extra: Record<string, unknown> = {},
  ) => ({
    problemId,
    topics: ['arrays'],
    assessment,
    readyToCode: assessment === 'on_track',
    status: 'none' as const,
    first,
    at: at(i),
    ...extra,
  });

  it('fixedAfterRecheck anchors on first:true, ignoring a rotated-out first', () => {
    const p = buildPractice(
      {
        version: 1,
        updatedAt: at(9),
        // "a": its first event rotated out; the window starts at a re-check.
        events: [
          ev('a', 'off_track', false, 1),
          ev('a', 'on_track', false, 2),
          ev('b', 'off_track', true, 3),
          ev('b', 'partial', false, 4),
          ev('c', 'partial', true, 5),
          ev('c', 'on_track', false, 6),
        ],
        seen: ['a', 'b', 'c', 'z'],
      },
      at(10),
    );
    expect(p.fixedAfterRecheck).toEqual({ count: 1, of: 2 });
    expect(p.firstCheck).toEqual({ on_track: 0, partial: 1, off_track: 1 });
    // problems is the all-time seen size (beyond the window).
    expect(p.totals.problems).toBe(4);
    expect(p.since).toBe(at(1));
  });

  it('slips: top 3 by count then latest, ≤ 3 topics each', () => {
    const p = buildPractice(
      {
        version: 1,
        updatedAt: at(9),
        events: [
          ev('a', 'partial', true, 1, { miss: 'edge', topics: ['heap'] }),
          ev('b', 'partial', true, 2, { miss: 'vague' }),
          ev('c', 'partial', true, 3, { miss: 'brute' }),
          ev('d', 'partial', true, 4, {
            miss: 'edge',
            topics: ['arrays', 'graphs', 'trees', 'heap'],
          }),
          ev('e', 'partial', true, 5, { miss: 'misread' }),
        ],
        seen: ['a', 'b', 'c', 'd', 'e'],
      },
      at(10),
    );
    expect(p.slips.map((s) => s.code)).toEqual(['edge', 'misread', 'brute']);
    expect(p.slips[0]!.topics).toEqual([
      { topicId: 'heap', label: 'Heap', count: 2 },
      { topicId: 'arrays', label: 'Arrays', count: 1 },
      { topicId: 'trees', label: 'Trees', count: 1 },
    ]);
  });
});

describe('firstCheck across roll-off and reset', () => {
  it('stays false after the first event rolls out of the 500 window', async () => {
    const adapter = new LocalFileStorageAdapter(tmpDir);
    await adapter.appendPracticeEvent({
      problemId: PROBLEM.id,
      topics: [],
      assessment: 'partial',
      readyToCode: false,
      status: 'none',
      first: true,
      at: NOW.toISOString() as IsoTimestamp,
    });
    for (let i = 0; i < PRACTICE_EVENTS_MAX; i++) {
      await adapter.appendPracticeEvent({
        problemId: OTHER.id,
        topics: [],
        assessment: 'partial',
        readyToCode: false,
        status: 'none',
        first: false,
        at: NOW.toISOString() as IsoTimestamp,
      });
    }
    const read = await adapter.readPracticeSignals();
    expect(read!.events.some((e) => e.problemId === PROBLEM.id)).toBe(false);
    const res = await check({ content: 'a' });
    expect(res.body.firstCheck).toBe(false);
    expect((await practice()).totals.problems).toBe(2);
  });

  it('is true again after a reset', async () => {
    await check({ content: 'a' });
    const reset = await handleApiRoute(
      'POST',
      '/api/practice/reset',
      deps({ backup: async () => '/b/1' }),
      JSON.stringify({ confirm: 'reset-practice' }),
    );
    expect(reset.status).toBe(200);
    expect((await check({ content: 'a' })).body.firstCheck).toBe(true);
  });
});

describe('POST /api/practice/reset (ADR 0013 D3)', () => {
  const reset = (d: ApiDeps, body: unknown = { confirm: 'reset-practice' }) =>
    handleApiRoute(
      'POST',
      '/api/practice/reset',
      d,
      typeof body === 'string' ? body : JSON.stringify(body),
    );

  async function seed(): Promise<void> {
    await check({ content: 'a' });
    // Quiz + note files that must survive.
    await new LocalFileStorageAdapter(tmpDir).writeIntuitionNote({
      problemId: PROBLEM.id,
      content: 'keep me',
      lastUpdated: NOW.toISOString() as IsoTimestamp,
    });
    fs.writeFileSync(path.join(tmpDir, 'competency-signals.json'), '{}');
    fs.writeFileSync(
      path.join(tmpDir, `${PRACTICE_SIGNALS_FILE}.corrupt-20260101T000000Z`),
      'old',
    );
  }

  it('backs up first (real ADR 0009 D3 backup), then removes only the practice file', async () => {
    await seed();
    const res = await reset(deps());
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { reset: boolean; backup: string };
    expect(body.reset).toBe(true);
    expect(body.backup.startsWith(path.join(tmpDir, '.backups'))).toBe(true);
    expect(fs.existsSync(path.join(body.backup, PRACTICE_SIGNALS_FILE))).toBe(
      true,
    );
    const left = fs.readdirSync(tmpDir).sort();
    expect(left).not.toContain(PRACTICE_SIGNALS_FILE);
    expect(left).toContain('competency-signals.json');
    expect(left).toContain('notes');
    expect(left).toContain(`${PRACTICE_SIGNALS_FILE}.corrupt-20260101T000000Z`);
    expect((await practice()).state).toBe('empty');
  });

  it('backup failure: 500 backup_failed and nothing deleted', async () => {
    await seed();
    const res = await reset(
      deps({
        backup: async () => {
          throw new Error('disk full');
        },
      }),
    );
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Could not save a backup; practice history was not reset.',
      code: 'backup_failed',
    });
    expect(fs.existsSync(path.join(tmpDir, PRACTICE_SIGNALS_FILE))).toBe(true);
  });

  it('delete failure after the backup: 500 reset_failed with the backup path', async () => {
    const failing: StorageAdapter = Object.assign(
      new LocalFileStorageAdapter(tmpDir),
      {
        resetPracticeSignals: async (beforeDelete?: () => Promise<void>) => {
          await beforeDelete?.();
          throw new Error('EACCES');
        },
      },
    );
    const res = await reset(
      deps({ createStorage: () => failing, backup: async () => '/b/2' }),
    );
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Could not reset practice history.',
      code: 'reset_failed',
      backup: '/b/2',
    });
  });

  it('the backup runs inside the practice queue: a concurrent append is in the backup or after the reset', async () => {
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const at = NOW.toISOString() as IsoTimestamp;
    const ev = (problemId: string) => ({
      problemId,
      topics: [],
      assessment: 'partial' as const,
      readyToCode: false,
      status: 'none' as const,
      first: false,
      at,
    });
    await adapter.appendPracticeEvent(ev('before'));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let backupStarted!: () => void;
    const started = new Promise<void>((r) => (backupStarted = r));
    const resetting = reset(
      deps({
        backup: async (dir, now) => {
          backupStarted();
          await gate;
          return createBackup(dir, now);
        },
      }),
    );
    await started;
    // Issued WHILE the backup is running: it must wait for the reset.
    const appended = adapter.appendPracticeEvent(ev('during'));
    await new Promise((r) => setTimeout(r, 20));
    release();
    const res = await resetting;
    await appended;
    expect(res.status).toBe(200);
    const { backup } = JSON.parse(res.body) as { backup: string };
    const inBackup = JSON.parse(
      fs.readFileSync(path.join(backup, PRACTICE_SIGNALS_FILE), 'utf8'),
    ) as { events: { problemId: string }[] };
    expect(inBackup.events.map((e) => e.problemId)).toEqual(['before']);
    const after = await adapter.readPracticeSignals();
    expect(after!.events.map((e) => e.problemId)).toEqual(['during']);
    expect(after!.events[0]!.first).toBe(true);
  });

  it('an adapter without the backup hook: 501 reset_unsupported, nothing backed up or deleted', async () => {
    await check({ content: 'a' });
    let called = false;
    let backedUp = false;
    const legacy: StorageAdapter = Object.assign(
      new LocalFileStorageAdapter(tmpDir),
      {
        resetPracticeSignals: async () => {
          called = true;
        },
      },
    );
    const res = await reset(
      deps({
        createStorage: () => legacy,
        backup: async () => {
          backedUp = true;
          return '/b';
        },
      }),
    );
    expect(res.status).toBe(501);
    expect(JSON.parse(res.body)).toEqual({
      error: 'this storage cannot reset practice history safely',
      code: 'reset_unsupported',
    });
    expect(called).toBe(false);
    expect(backedUp).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, PRACTICE_SIGNALS_FILE))).toBe(true);
    const none: StorageAdapter = Object.assign(
      new LocalFileStorageAdapter(tmpDir),
      { resetPracticeSignals: undefined },
    );
    const missing = await reset(deps({ createStorage: () => none }));
    expect(missing.status).toBe(501);
    expect(JSON.parse(missing.body).code).toBe('reset_unsupported');
  });

  it('400 bad confirm / no db; 409 read-only; 405 other methods', async () => {
    for (const body of [{}, { confirm: 'yes' }, 'nope', '[]']) {
      const res = await reset(deps(), body);
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({
        error: 'confirm must be "reset-practice"',
        code: 'invalid_body',
      });
    }
    const noDb = await reset(deps({ dataDir: path.join(tmpDir, 'nope') }));
    expect(noDb.status).toBe(400);
    expect(JSON.parse(noDb.body)).toEqual({ error: 'no database configured' });
    let backedUp = false;
    const ro = await reset(
      deps({
        readOnlyFormat: () => 3,
        backup: async () => {
          backedUp = true;
          return '/b';
        },
      }),
    );
    expect(ro.status).toBe(409);
    expect(JSON.parse(ro.body)).toEqual({
      error: 'This folder is read-only (format v3).',
      code: 'read_only',
    });
    expect(backedUp).toBe(false);
    for (const method of ['GET', 'DELETE']) {
      const res = await handleApiRoute(
        method,
        '/api/practice/reset',
        deps(),
        '{}',
      );
      expect(res.status).toBe(405);
    }
  });
});
