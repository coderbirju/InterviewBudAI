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

/**
 * A fake provider that returns wrapped presentations for `wrap` prompts and a
 * QUEUE of verdict JSON strings for successive `evaluate` prompts (one per
 * answer). Lets a test drive multi-turn nudge scenarios deterministically.
 */
class SequencedQuizProvider implements LlmProvider {
  wrapCalls = 0;
  evalCalls = 0;
  private queue: string[];
  constructor(evaluateVerdicts: string[]) {
    this.queue = [...evaluateVerdicts];
  }
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const last = request.messages[request.messages.length - 1]?.content ?? '';
    const isEvaluate = last.includes('"verdict"');
    if (isEvaluate) {
      const next = this.queue.shift();
      this.evalCalls += 1;
      return {
        content:
          next ?? '```json\n{"verdict":"correct","feedback":"fallback"}\n```',
      };
    }
    this.wrapCalls += 1;
    return { content: 'Two Sum. Find two numbers that add to a target.' };
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

describe('POST /api/quiz/answer — at-most-one-nudge policy (quiz-fix-a)', () => {
  const ON_TRACK =
    '```json\n{"verdict":"on_track","feedback":"What is the time complexity?"}\n```';
  const CORRECT =
    '```json\n{"verdict":"correct","feedback":"good, semi-optimal"}\n```';
  const INCORRECT =
    '```json\n{"verdict":"incorrect","feedback":"wrong direction"}\n```';

  async function startWith(deps: ApiDeps): Promise<void> {
    await handleApiRoute('POST', '/api/quiz/start', deps, undefined, '{}');
  }

  it('first on_track stays on the same question and records the nudge', async () => {
    await seedDone(DONE_IDS);
    const provider = new SequencedQuizProvider([ON_TRACK]);
    const deps = makeQuizDeps(provider);
    await startWith(deps);

    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'a partial idea' }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      verdict: string;
      terminal: boolean;
      session: { index: number; answered: number };
    };
    expect(body.verdict).toBe('on_track');
    expect(body.terminal).toBe(false);
    // Same question — no advance, no recorded outcome.
    expect(body.session.index).toBe(0);
    expect(body.session.answered).toBe(0);

    // The nudge is recorded in the transcript (survives resume).
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const active = await adapter.readActiveQuizSession();
    const userTurns = (active?.transcript ?? []).filter(
      (t) => t.role === 'user',
    ).length;
    expect(userTurns).toBe(1);
    expect(active?.answered).toHaveLength(0);
  });

  it('a SECOND on_track from the model is COERCED to incorrect → to_revisit + advance', async () => {
    await seedDone(DONE_IDS);
    // Model tries to nudge twice; the engine must coerce the second.
    const provider = new SequencedQuizProvider([ON_TRACK, ON_TRACK]);
    const deps = makeQuizDeps(provider);
    await startWith(deps);

    // First answer → on_track (allowed).
    const first = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'partial 1' }),
    );
    expect(JSON.parse(first.body).verdict).toBe('on_track');

    const adapter = new LocalFileStorageAdapter(tmpDir);
    const firstId = (await adapter.readActiveQuizSession())?.deck[0] as string;

    // Second answer → model says on_track again → COERCED to incorrect.
    const second = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'partial 2' }),
    );
    expect(second.status).toBe(200);
    const body = JSON.parse(second.body) as {
      verdict: string;
      terminal: boolean;
      session: { index: number; answered: number };
    };
    expect(body.verdict).toBe('incorrect');
    expect(body.terminal).toBe(true);
    // Advanced (deck moved on), outcome recorded.
    expect(body.session.index).toBe(1);
    expect(body.session.answered).toBe(1);

    // Note flipped to to_revisit (terminal incorrect behavior).
    const note = await adapter.readIntuitionNote(firstId);
    expect(note?.status).toBe('to_revisit');
  });

  it('correct after one nudge → terminal correct + advance (note stays done)', async () => {
    await seedDone(DONE_IDS);
    const provider = new SequencedQuizProvider([ON_TRACK, CORRECT]);
    const deps = makeQuizDeps(provider);
    await startWith(deps);

    const adapter = new LocalFileStorageAdapter(tmpDir);
    const firstId = (await adapter.readActiveQuizSession())?.deck[0] as string;

    await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'partial' }),
    );
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'now the full approach' }),
    );
    const body = JSON.parse(res.body) as {
      verdict: string;
      terminal: boolean;
      session: { index: number; answered: number };
    };
    expect(body.verdict).toBe('correct');
    expect(body.terminal).toBe(true);
    expect(body.session.index).toBe(1);
    expect(body.session.answered).toBe(1);
    // Correct → note NOT flipped.
    const note = await adapter.readIntuitionNote(firstId);
    expect(note?.status).toBe('done');
  });

  it('a clearly-wrong FIRST answer → incorrect immediately (no nudge owed)', async () => {
    await seedDone(DONE_IDS);
    const provider = new SequencedQuizProvider([INCORRECT]);
    const deps = makeQuizDeps(provider);
    await startWith(deps);

    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      undefined,
      JSON.stringify({ answer: 'no idea at all' }),
    );
    const body = JSON.parse(res.body) as {
      verdict: string;
      terminal: boolean;
      session: { index: number; answered: number };
    };
    expect(body.verdict).toBe('incorrect');
    expect(body.terminal).toBe(true);
    // Advanced on the very first answer — no probe was used.
    expect(body.session.index).toBe(1);
    expect(body.session.answered).toBe(1);
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

describe('POST /api/quiz/end + GET /api/quiz/sessions (session management)', () => {
  async function startSession(): Promise<ApiDeps> {
    const provider = new FakeQuizProvider();
    const deps = makeQuizDeps(provider);
    await handleApiRoute('POST', '/api/quiz/start', deps, undefined, '{}');
    return deps;
  }

  it('end sets the active session complete, clears active, but keeps it listed', async () => {
    await seedDone(DONE_IDS);
    const deps = await startSession();

    const endRes = await handleApiRoute(
      'POST',
      '/api/quiz/end',
      deps,
      undefined,
      '{}',
    );
    expect(endRes.status).toBe(200);
    const endBody = JSON.parse(endRes.body) as {
      ok: boolean;
      session: { status: string };
    };
    expect(endBody.ok).toBe(true);
    expect(endBody.session.status).toBe('complete');

    // No longer the active/resumable session.
    const adapter = new LocalFileStorageAdapter(tmpDir);
    expect(await adapter.readActiveQuizSession()).toBeNull();

    // But it REMAINS listed.
    const listRes = await handleApiRoute(
      'GET',
      '/api/quiz/sessions',
      deps,
      undefined,
      undefined,
    );
    expect(listRes.status).toBe(200);
    const listBody = JSON.parse(listRes.body) as {
      sessions: Array<{ status: string; isActive: boolean }>;
    };
    expect(listBody.sessions).toHaveLength(1);
    expect(listBody.sessions[0]?.status).toBe('complete');
    expect(listBody.sessions[0]?.isActive).toBe(false);
  });

  it('end with no active session → 404', async () => {
    await seedDone(DONE_IDS);
    const deps = makeQuizDeps(new FakeQuizProvider());
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/end',
      deps,
      undefined,
      '{}',
    );
    expect(res.status).toBe(404);
  });

  it('GET /api/quiz/end → 405', async () => {
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/end',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      undefined,
    );
    expect(res.status).toBe(405);
  });

  it('GET /api/quiz/sessions is empty-safe with no sessions', async () => {
    await seedDone(DONE_IDS);
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/sessions',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      undefined,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ sessions: [] });
  });

  it('POST /api/quiz/sessions → 405', async () => {
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/sessions',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      '{}',
    );
    expect(res.status).toBe(405);
  });
});

describe('POST /api/quiz/resume (session management)', () => {
  it('re-activates a listed (ended) session and re-presents its question', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider();
    const deps = makeQuizDeps(provider);
    await handleApiRoute('POST', '/api/quiz/start', deps, undefined, '{}');

    const adapter = new LocalFileStorageAdapter(tmpDir);
    const sessionId = (await adapter.readActiveQuizSession())!.sessionId;

    // End it so it is no longer active.
    await handleApiRoute('POST', '/api/quiz/end', deps, undefined, '{}');
    expect(await adapter.readActiveQuizSession()).toBeNull();

    // Resume it.
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/resume',
      deps,
      undefined,
      JSON.stringify({ sessionId }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      ok: boolean;
      session: { sessionId: string; status: string };
      question: { wrapped: string } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.session.status).toBe('active');

    // It is the active session again.
    const active = await adapter.readActiveQuizSession();
    expect(active?.sessionId).toBe(sessionId);
    // The wrapped question is re-presented from the transcript.
    expect(body.question?.wrapped).toBe('A wrapped little story.');
  });

  it('resume unknown id → 404', async () => {
    await seedDone(DONE_IDS);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/resume',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      JSON.stringify({ sessionId: 'nope' }),
    );
    expect(res.status).toBe(404);
  });

  it('resume with missing sessionId → 400', async () => {
    await seedDone(DONE_IDS);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/resume',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      '{}',
    );
    expect(res.status).toBe(400);
  });

  it('GET /api/quiz/resume → 405', async () => {
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/resume',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      undefined,
    );
    expect(res.status).toBe(405);
  });
});

describe('delete a quiz session (session management)', () => {
  async function startAndGetId(deps: ApiDeps): Promise<string> {
    await handleApiRoute('POST', '/api/quiz/start', deps, undefined, '{}');
    const adapter = new LocalFileStorageAdapter(tmpDir);
    return (await adapter.readActiveQuizSession())!.sessionId;
  }

  it('POST /api/quiz/delete removes the session (gone from the list)', async () => {
    await seedDone(DONE_IDS);
    const deps = makeQuizDeps(new FakeQuizProvider());
    const sessionId = await startAndGetId(deps);

    const res = await handleApiRoute(
      'POST',
      '/api/quiz/delete',
      deps,
      undefined,
      JSON.stringify({ sessionId }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const listRes = await handleApiRoute(
      'GET',
      '/api/quiz/sessions',
      deps,
      undefined,
      undefined,
    );
    expect(JSON.parse(listRes.body)).toEqual({ sessions: [] });
    // Deleting the active session also cleared the active pointer.
    const adapter = new LocalFileStorageAdapter(tmpDir);
    expect(await adapter.readActiveQuizSession()).toBeNull();
  });

  it('DELETE /api/quiz/session/:id removes the session (REST form)', async () => {
    await seedDone(DONE_IDS);
    const deps = makeQuizDeps(new FakeQuizProvider());
    const sessionId = await startAndGetId(deps);

    const res = await handleApiRoute(
      'DELETE',
      `/api/quiz/session/${encodeURIComponent(sessionId)}`,
      deps,
      undefined,
      undefined,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const adapter = new LocalFileStorageAdapter(tmpDir);
    expect(await adapter.readQuizSession(sessionId)).toBeNull();
  });

  it('POST /api/quiz/delete with missing sessionId → 400', async () => {
    await seedDone(DONE_IDS);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/delete',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      '{}',
    );
    expect(res.status).toBe(400);
  });

  it('deleting a missing session is a no-op ok:true (idempotent)', async () => {
    await seedDone(DONE_IDS);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/delete',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      JSON.stringify({ sessionId: 'ghost' }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('GET /api/quiz/delete → 405', async () => {
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/delete',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      undefined,
    );
    expect(res.status).toBe(405);
  });

  it('POST /api/quiz/session/:id (wrong method) → 405', async () => {
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/session/abc',
      makeQuizDeps(new FakeQuizProvider()),
      undefined,
      '{}',
    );
    expect(res.status).toBe(405);
  });
});
