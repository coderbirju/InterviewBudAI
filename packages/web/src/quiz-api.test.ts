import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleApiRoute } from './api.js';
import type { ApiDeps } from './api.js';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import type { IsoTimestamp } from '@ibai/storage';
import type {
  LlmProvider,
  CompletionRequest,
  CompletionResponse,
} from '@ibai/providers';
import { seededRandom } from './quiz.js';

let tmpDir: string;

/**
 * A fake provider that returns a wrapped question for `wrap` prompts and a
 * canned verdict JSON for `evaluate` prompts. It distinguishes them by the
 * presence of the verdict-JSON instruction in the last user message. No
 * network. Optionally rejects, or returns raw text (to exercise malformed).
 */
class FakeQuizProvider implements LlmProvider {
  calls = 0;
  wrapCalls = 0;
  evalCalls = 0;
  constructor(
    private readonly opts: {
      verdictJson?: string; // returned for evaluate prompts
      rejectWith?: Error;
      wrapText?: string;
    } = {},
  ) {}
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.calls += 1;
    const last = request.messages[request.messages.length - 1]?.content ?? '';
    const isEvaluate = last.includes('"verdict"');
    if (this.opts.rejectWith && isEvaluate) {
      throw this.opts.rejectWith;
    }
    if (isEvaluate) {
      this.evalCalls += 1;
      return {
        content:
          this.opts.verdictJson ??
          '```json\n{"verdict":"correct","feedback":"good"}\n```',
      };
    }
    this.wrapCalls += 1;
    return { content: this.opts.wrapText ?? 'A wrapped little story.' };
  }
}

function makeQuizDeps(
  provider: LlmProvider | undefined,
  extra: Partial<ApiDeps> = {},
): ApiDeps {
  return {
    catalog: createCatalogSource(),
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    storage: new LocalFileStorageAdapter(tmpDir),
    defaultDataDir: tmpDir,
    provider,
    providerLabel: provider
      ? 'Using Ollama: test-model'
      : 'No model configured',
    env: {},
    argv: [],
    // Deterministic shuffle + clock for the tests.
    random: seededRandom(7),
    now: () => new Date('2026-09-24T12:00:00.000Z'),
    ...extra,
  };
}

async function seedDone(ids: string[]): Promise<void> {
  const adapter = new LocalFileStorageAdapter(tmpDir);
  for (const id of ids) {
    await adapter.writeIntuitionNote({
      problemId: id,
      content: `note for ${id}`,
      lastUpdated: new Date().toISOString() as IsoTimestamp,
      status: 'done',
      completed: true,
    });
  }
}

const CATALOG = createCatalogSource();
const DONE_IDS = CATALOG.list()
  .slice(0, 3)
  .map((p) => p.id);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-quiz-test-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/quiz/start', () => {
  it('builds a shuffled deck from the done-set and returns the first wrapped question', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider();
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/start',
      makeQuizDeps(provider),
      undefined,
      '{}',
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      empty: boolean;
      session: { deckSize: number; index: number; status: string };
      question: { problemId: string; wrapped: string };
    };
    expect(body.empty).toBe(false);
    expect(body.session.deckSize).toBe(DONE_IDS.length);
    expect(body.session.index).toBe(0);
    expect(body.session.status).toBe('active');
    expect(DONE_IDS).toContain(body.question.problemId);
    expect(body.question.wrapped).toBe('A wrapped little story.');
    expect(provider.wrapCalls).toBe(1);

    // Deck is deterministic under the seeded shuffle.
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const active = await adapter.readActiveQuizSession();
    expect(active?.deck.length).toBe(DONE_IDS.length);
    expect([...(active?.deck ?? [])].sort()).toEqual([...DONE_IDS].sort());
  });

  it('empty done-set → { empty:true } state, no session, no provider call', async () => {
    const provider = new FakeQuizProvider();
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/start',
      makeQuizDeps(provider),
      undefined,
      '{}',
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { empty: boolean; message: string };
    expect(body.empty).toBe(true);
    expect(body.message).toContain('mark problems complete');
    expect(provider.calls).toBe(0);
    const adapter = new LocalFileStorageAdapter(tmpDir);
    expect(await adapter.readActiveQuizSession()).toBeNull();
  });

  it('no provider → 400 { error:"no model configured" }', async () => {
    await seedDone(DONE_IDS);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/start',
      makeQuizDeps(undefined),
      undefined,
      '{}',
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'no model configured' });
  });

  it('GET /api/quiz/start → 405', async () => {
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/start',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      undefined,
    );
    expect(res.status).toBe(405);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });
});

describe('GET /api/quiz/session (resume)', () => {
  it('returns the active session with the current wrapped question', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider();
    await handleApiRoute(
      'POST',
      '/api/quiz/start',
      makeQuizDeps(provider),
      undefined,
      '{}',
    );
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/session',
      makeQuizDeps(provider),
      undefined,
      undefined,
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      active: boolean;
      session: { deckSize: number };
      question: { wrapped: string } | null;
    };
    expect(body.active).toBe(true);
    expect(body.session.deckSize).toBe(DONE_IDS.length);
    expect(body.question?.wrapped).toBe('A wrapped little story.');
  });

  it('no active session → { active:false }', async () => {
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/session',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      undefined,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ active: false });
  });

  it('POST /api/quiz/session → 405', async () => {
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/session',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      '{}',
    );
    expect(res.status).toBe(405);
  });
});

describe('POST /api/quiz/answer', () => {
  async function start(provider: LlmProvider): Promise<string> {
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/start',
      makeQuizDeps(provider),
      undefined,
      '{}',
    );
    const body = JSON.parse(res.body) as {
      question: { problemId: string };
    };
    return body.question.problemId;
  }

  it('correct verdict → records correct, advances (no repeat), updates signals, returns next', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider({
      verdictJson:
        '```json\n{"verdict":"correct","feedback":"good direction"}\n```',
    });
    const deps = makeQuizDeps(provider);
    const firstId = await start(provider);

    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'use a hash map' }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      verdict: string;
      terminal: boolean;
      session: { index: number; answered: number };
      question: { problemId: string } | null;
    };
    expect(body.verdict).toBe('correct');
    expect(body.terminal).toBe(true);
    expect(body.session.index).toBe(1);
    expect(body.session.answered).toBe(1);
    // Advanced to a DIFFERENT problem (no repeat).
    expect(body.question?.problemId).not.toBe(firstId);

    // Competency signals recorded the correct outcome.
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const signals = await adapter.readCompetencySignals();
    const totalCorrect = Object.values(signals.topics).reduce(
      (n, t) => n + t.correct,
      0,
    );
    expect(totalCorrect).toBeGreaterThan(0);
    // Note NOT flipped to to_revisit on correct.
    const note = await adapter.readIntuitionNote(firstId);
    expect(note?.status).toBe('done');
  });

  it('incorrect verdict → flips note to to_revisit, records pattern signal, advances', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider({
      verdictJson:
        '```json\n{"verdict":"incorrect","feedback":"off track","optimalNudge":"go read"}\n```',
    });
    const deps = makeQuizDeps(provider);
    const firstId = await start(provider);

    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'no idea' }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      verdict: string;
      terminal: boolean;
      optimalNudge?: string;
    };
    expect(body.verdict).toBe('incorrect');
    expect(body.terminal).toBe(true);
    expect(body.optimalNudge).toBe('go read');

    const adapter = new LocalFileStorageAdapter(tmpDir);
    // Note flipped to to_revisit (assert the storage write).
    const note = await adapter.readIntuitionNote(firstId);
    expect(note?.status).toBe('to_revisit');
    expect(note?.completed).toBe(false);
    // Original content preserved.
    expect(note?.content).toBe(`note for ${firstId}`);
    // Pattern signal recorded.
    const signals = await adapter.readCompetencySignals();
    expect(signals.patterns.length).toBeGreaterThan(0);
    expect(signals.patterns[0]?.id).toBe(`miss:${firstId}`);
  });

  it('provider malformed verdict → fail-closed 502, NO writes', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider({
      verdictJson: 'totally not json at all',
    });
    const deps = makeQuizDeps(provider);
    const firstId = await start(provider);

    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'something' }),
    );
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body)).toHaveProperty('error');

    const adapter = new LocalFileStorageAdapter(tmpDir);
    // No outcome recorded — session still at index 0, no answers.
    const active = await adapter.readActiveQuizSession();
    expect(active?.currentIndex).toBe(0);
    expect(active?.answered).toHaveLength(0);
    // Note untouched (still done), no signals written.
    const note = await adapter.readIntuitionNote(firstId);
    expect(note?.status).toBe('done');
    const signals = await adapter.readCompetencySignals();
    expect(signals.patterns).toHaveLength(0);
  });

  it('provider connection error → 502, no writes', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider({
      rejectWith: new Error('connect ECONNREFUSED 127.0.0.1:11434'),
    });
    const deps = makeQuizDeps(provider);
    await start(provider);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'x' }),
    );
    expect(res.status).toBe(502);
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const active = await adapter.readActiveQuizSession();
    expect(active?.answered).toHaveLength(0);
  });

  it('missing/empty answer → 400', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider();
    const deps = makeQuizDeps(provider);
    await start(provider);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: '   ' }),
    );
    expect(res.status).toBe(400);
  });

  it('no active session → 404', async () => {
    await seedDone(DONE_IDS);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      JSON.stringify({ answer: 'x' }),
    );
    expect(res.status).toBe(404);
  });

  it('no provider → 400', async () => {
    await seedDone(DONE_IDS);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      makeQuizDeps(undefined),
      undefined,
      JSON.stringify({ answer: 'x' }),
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'no model configured' });
  });

  it('answering through the whole deck completes the session', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider({
      verdictJson: '```json\n{"verdict":"correct","feedback":"ok"}\n```',
    });
    const deps = makeQuizDeps(provider);
    await start(provider);
    let last: { complete?: boolean; question: unknown } = { question: {} };
    for (let i = 0; i < DONE_IDS.length; i++) {
      const res = await handleApiRoute(
        'POST',
        '/api/quiz/answer',
        deps,
        undefined,
        JSON.stringify({ answer: `answer ${i}` }),
      );
      last = JSON.parse(res.body);
    }
    expect(last.complete).toBe(true);
    expect(last.question).toBeNull();
    const adapter = new LocalFileStorageAdapter(tmpDir);
    // Complete session clears the active pointer (resumability contract).
    expect(await adapter.readActiveQuizSession()).toBeNull();
  });

  it('GET /api/quiz/answer → 405', async () => {
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/answer',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      undefined,
    );
    expect(res.status).toBe(405);
  });
});

describe('POST /api/quiz/new', () => {
  it('discards the active session and reshuffles a fresh deck', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider();
    const deps = makeQuizDeps(provider);
    await handleApiRoute('POST', '/api/quiz/start', deps, undefined, '{}');

    const adapter = new LocalFileStorageAdapter(tmpDir);
    const first = await adapter.readActiveQuizSession();

    const res = await handleApiRoute(
      'POST',
      '/api/quiz/new',
      deps,
      undefined,
      '{}',
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { empty: boolean };
    expect(body.empty).toBe(false);

    const second = await adapter.readActiveQuizSession();
    // A NEW session id (fresh deck), not the old one.
    expect(second?.sessionId).not.toBe(first?.sessionId);
    expect(second?.currentIndex).toBe(0);
    expect(second?.answered).toHaveLength(0);
  });

  it('GET /api/quiz/new → 405', async () => {
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/new',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      undefined,
    );
    expect(res.status).toBe(405);
  });
});
