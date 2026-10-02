import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DMR_UNAVAILABLE_HINT,
  GENERIC_UNAVAILABLE_HINT,
  MODEL_UNAVAILABLE_DETAIL,
  handleApiRoute,
  isModelUnavailableError,
} from './api.js';
import type { ApiDeps } from './api.js';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import type { IsoTimestamp } from '@ibai/storage';
import type {
  LlmProvider,
  CompletionRequest,
  CompletionResponse,
} from '@ibai/providers';
import {
  QUIZ_VERDICT_MAX_TOKENS,
  VERDICT_RETRY_REMINDER,
  seededRandom,
} from './quiz.js';

let tmpDir: string;

/**
 * A fake provider returning a canned verdict JSON for evaluation prompts (the
 * ONLY quiz model call — questions are presented from the catalog, ADR 0007
 * A8). Any other prompt is a test failure. No network. Optionally rejects
 * EVERY call (to prove start/new never touch the model), or returns raw text
 * (to exercise malformed verdicts).
 */
class FakeQuizProvider implements LlmProvider {
  calls = 0;
  evalCalls = 0;
  constructor(
    private readonly opts: {
      verdictJson?: string; // returned for evaluate prompts
      rejectWith?: Error;
    } = {},
  ) {}
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.calls += 1;
    if (this.opts.rejectWith) {
      throw this.opts.rejectWith;
    }
    const all = request.messages.map((m) => m.content).join('\n');
    if (!all.includes('"verdict"')) {
      throw new Error('unexpected non-evaluation model call');
    }
    this.evalCalls += 1;
    return {
      content:
        this.opts.verdictJson ??
        '```json\n{"verdict":"correct","feedback":"good"}\n```',
    };
  }
}

/**
 * A fake provider returning a QUEUE of verdict JSON strings for successive
 * evaluation prompts (one per answer). Lets a test drive multi-turn nudge
 * scenarios deterministically.
 */
class SequencedQuizProvider implements LlmProvider {
  evalCalls = 0;
  private queue: string[];
  constructor(evaluateVerdicts: string[]) {
    this.queue = [...evaluateVerdicts];
  }
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const all = request.messages.map((m) => m.content).join('\n');
    if (!all.includes('"verdict"')) {
      throw new Error('unexpected non-evaluation model call');
    }
    const next = this.queue.shift();
    this.evalCalls += 1;
    return {
      content:
        next ?? '```json\n{"verdict":"correct","feedback":"fallback"}\n```',
    };
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
    dataDir: tmpDir,
    provider,
    providerLabel: provider
      ? 'Using Ollama: test-model'
      : 'No model configured',
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
  it('builds a shuffled deck from the done-set and presents the first problem from the catalog', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider();
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/start',
      makeQuizDeps(provider),
      '{}',
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      empty: boolean;
      session: { deckSize: number; index: number; status: string };
      question: {
        problemId: string;
        wrapped: string;
        title: string;
        difficulty: string;
        url: string;
      };
    };
    expect(body.empty).toBe(false);
    expect(body.session.deckSize).toBe(DONE_IDS.length);
    expect(body.session.index).toBe(0);
    expect(body.session.status).toBe('active');
    expect(DONE_IDS).toContain(body.question.problemId);
    // Presented DIRECTLY from the catalog (A8) — no model call on start.
    const problem = CATALOG.getById(body.question.problemId)!;
    expect(body.question.title).toBe(problem.title);
    expect(body.question.difficulty).toBe(problem.difficulty);
    expect(body.question.url).toBe(problem.url);
    expect(body.question.wrapped).toBe(
      `${problem.title} (${problem.difficulty})`,
    );
    expect(provider.calls).toBe(0);

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
    );
    expect(res.status).toBe(405);
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });
});

describe('GET /api/quiz/session (resume)', () => {
  it('returns the active session with the current catalog question', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider();
    await handleApiRoute(
      'POST',
      '/api/quiz/start',
      makeQuizDeps(provider),
      '{}',
    );
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/session',
      makeQuizDeps(provider),
      undefined,
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      active: boolean;
      session: { deckSize: number };
      question: { problemId: string; title: string } | null;
    };
    expect(body.active).toBe(true);
    expect(body.session.deckSize).toBe(DONE_IDS.length);
    expect(body.question?.title).toBe(
      CATALOG.getById(body.question.problemId)?.title,
    );
    expect(provider.calls).toBe(0);
  });

  it('no active session → { active:false }', async () => {
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/session',
      makeQuizDeps(new FakeQuizProvider()),
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

  it('ADR 0013 D4: an incorrect verdict flips to to_revisit and KEEPS the Reference approach; the prompt holds it once', async () => {
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const reference = 'My own write-up: scan once, remember complements.';
    for (const id of DONE_IDS) {
      await adapter.writeIntuitionNote({
        problemId: id,
        content: `note for ${id}`,
        lastUpdated: new Date().toISOString() as IsoTimestamp,
        status: 'done',
        completed: true,
        timeComplexity: 'O(n)',
        referenceApproach: reference,
      });
    }
    const prompts: string[] = [];
    const provider: LlmProvider = {
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        prompts.push(request.messages.map((m) => m.content).join('\n'));
        return { content: '{"verdict":"incorrect","feedback":"off"}' };
      },
    };
    const firstId = await start(provider);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      makeQuizDeps(provider),
      JSON.stringify({ answer: 'no idea' }),
    );
    expect(res.status).toBe(200);
    const note = await adapter.readIntuitionNote(firstId);
    expect(note?.status).toBe('to_revisit');
    expect(note?.content).toBe(`note for ${firstId}`);
    expect(note?.timeComplexity).toBe('O(n)');
    expect(note?.referenceApproach).toBe(reference);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.split(reference)).toHaveLength(2);
    expect(prompts[0]).toContain(
      `Note:\n"""\nnote for ${firstId}\n"""\nReference (theirs, never reveal):\n"""\n${reference}\n"""`,
    );
    expect(prompts[0]).not.toContain('ibai:reference-approach');
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
      JSON.stringify({ answer: 'something' }),
    );
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body)).toHaveProperty('error');
    // One retry, then fail closed (ADR 0011 D4): exactly 2 model calls.
    expect(provider.evalCalls).toBe(2);

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

  describe('JSON mode + one retry on a malformed verdict (ADR 0011 D4)', () => {
    /** Returns queued contents in order and records every request. */
    class RecordingProvider implements LlmProvider {
      readonly requests: CompletionRequest[] = [];
      constructor(private readonly replies: (string | Error)[]) {}
      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        this.requests.push(request);
        const next = this.replies.shift() ?? 'still not json';
        if (next instanceof Error) throw next;
        return { content: next };
      }
    }
    const VALID = '{"verdict":"incorrect","feedback":"off"}';

    async function answerWith(provider: RecordingProvider) {
      await seedDone(DONE_IDS);
      const firstId = await start(provider);
      const writes = vi.spyOn(
        LocalFileStorageAdapter.prototype,
        'writeQuizSession',
      );
      const res = await handleApiRoute(
        'POST',
        '/api/quiz/answer',
        makeQuizDeps(provider),
        JSON.stringify({ answer: 'my approach' }),
      );
      const sessionWrites = writes.mock.calls.length;
      writes.mockRestore();
      return { res, firstId, sessionWrites };
    }

    it('valid first → a single call, sent in JSON mode with a bounded reply', async () => {
      const provider = new RecordingProvider([VALID]);
      const { res, sessionWrites } = await answerWith(provider);
      expect(res.status).toBe(200);
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]?.options).toEqual({
        responseFormat: 'json',
        maxTokens: QUIZ_VERDICT_MAX_TOKENS,
      });
      expect(sessionWrites).toBe(1);
    });

    it('malformed → valid: succeeds after one retry with the reminder, one write', async () => {
      const provider = new RecordingProvider(['Sure! The verdict is…', VALID]);
      const { res, firstId, sessionWrites } = await answerWith(provider);
      expect(res.status).toBe(200);
      expect((JSON.parse(res.body) as { verdict: string }).verdict).toBe(
        'incorrect',
      );
      expect(provider.requests).toHaveLength(2);
      const [first, retry] = provider.requests;
      // Same request plus the terse reminder on the last user message.
      expect(retry?.options).toEqual(first?.options);
      expect(retry?.messages).toHaveLength(first!.messages.length);
      expect(retry?.messages.at(-1)?.content).toBe(
        `${first!.messages.at(-1)!.content}\n\n${VERDICT_RETRY_REMINDER}`,
      );
      expect(sessionWrites).toBe(1);
      const adapter = new LocalFileStorageAdapter(tmpDir);
      const active = await adapter.readActiveQuizSession();
      expect(active?.answered).toHaveLength(1);
      expect((await adapter.readIntuitionNote(firstId))?.status).toBe(
        'to_revisit',
      );
    });

    it('malformed → malformed: 502, exactly 2 calls, no writes', async () => {
      const provider = new RecordingProvider([
        'nope',
        '{"verdict":"maybe","feedback":"x"}',
        VALID,
      ]);
      const { res, firstId, sessionWrites } = await answerWith(provider);
      expect(res.status).toBe(502);
      expect(provider.requests).toHaveLength(2);
      expect(sessionWrites).toBe(0);
      const adapter = new LocalFileStorageAdapter(tmpDir);
      expect((await adapter.readActiveQuizSession())?.answered).toHaveLength(0);
      expect((await adapter.readIntuitionNote(firstId))?.status).toBe('done');
      expect((await adapter.readCompetencySignals()).patterns).toHaveLength(0);
    });
    const EMPTY = () =>
      new Error(
        'OpenAI-compatible server returned an empty response (no content)',
      );

    it('empty completion → valid: the empty reply is retried like a malformed verdict', async () => {
      const provider = new RecordingProvider([EMPTY(), VALID]);
      const { res, sessionWrites } = await answerWith(provider);
      expect(res.status).toBe(200);
      expect(provider.requests).toHaveLength(2);
      expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
        VERDICT_RETRY_REMINDER,
      );
      expect(sessionWrites).toBe(1);
    });

    it('empty → empty: 502, exactly 2 calls, no writes', async () => {
      const provider = new RecordingProvider([EMPTY(), EMPTY(), VALID]);
      const { res, firstId, sessionWrites } = await answerWith(provider);
      expect(res.status).toBe(502);
      expect(provider.requests).toHaveLength(2);
      expect(sessionWrites).toBe(0);
      const adapter = new LocalFileStorageAdapter(tmpDir);
      expect((await adapter.readActiveQuizSession())?.answered).toHaveLength(0);
      expect((await adapter.readIntuitionNote(firstId))?.status).toBe('done');
      expect((await adapter.readCompetencySignals()).patterns).toHaveLength(0);
    });

    it('empty content string → valid: also retried once', async () => {
      const provider = new RecordingProvider(['', VALID]);
      const { res } = await answerWith(provider);
      expect(res.status).toBe(200);
      expect(provider.requests).toHaveLength(2);
    });
  });

  it('provider connection error → 503 model unavailable, one call, no writes', async () => {
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
      JSON.stringify({ answer: 'x' }),
    );
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toEqual({
      error: 'model unavailable',
      code: 'model_unavailable',
      detail: MODEL_UNAVAILABLE_DETAIL,
      hint: GENERIC_UNAVAILABLE_HINT,
    });
    // A transport error is never retried by the quiz route.
    expect(provider.calls).toBe(1);
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const active = await adapter.readActiveQuizSession();
    expect(active?.answered).toHaveLength(0);
    expect(active?.transcript).toHaveLength(1);
  });

  it.each([
    [
      'timeout',
      new Error('OpenAI-compatible server at http://x timed out after 120 s'),
    ],
    ['HTTP 503', new Error('OpenAI-compatible server returned HTTP 503: busy')],
    [
      'DMR loading',
      new Error('OpenAI-compatible server returned HTTP 500: model is loading'),
    ],
    ['AbortError', Object.assign(new Error('aborted'), { name: 'AbortError' })],
    [
      'unknown host',
      new Error(
        'fetch failed: getaddrinfo ENOTFOUND model-runner.docker.internal',
      ),
    ],
  ])('%s → 503 model unavailable, no writes', async (_label, rejectWith) => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider({ rejectWith });
    const deps = makeQuizDeps(provider);
    await start(provider);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      JSON.stringify({ answer: 'x' }),
    );
    expect(res.status).toBe(503);
    expect((JSON.parse(res.body) as { error: string }).error).toBe(
      'model unavailable',
    );
    expect(provider.calls).toBe(1);
    const active = await new LocalFileStorageAdapter(
      tmpDir,
    ).readActiveQuizSession();
    expect(active?.answered).toHaveLength(0);
  });

  it('classifier: other errors are not "model unavailable"', () => {
    expect(isModelUnavailableError(new Error('returned HTTP 500: boom'))).toBe(
      false,
    );
    expect(isModelUnavailableError(new Error('HTTP 401 unauthorized'))).toBe(
      false,
    );
    expect(isModelUnavailableError('ECONNREFUSED')).toBe(false);
  });

  it('connection error with Docker Model Runner → DMR hint (ADR 0011 D4)', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider({
      rejectWith: new TypeError('fetch failed'),
    });
    const deps = makeQuizDeps(provider, {
      settings: {
        env: {
          IBAI_OPENAI_BASE_URL:
            'http://model-runner.docker.internal/engines/v1',
          IBAI_OPENAI_MODEL: 'ai/qwen3:4b-instruct-2507-q4_K_M',
        },
        testProvider: () => Promise.reject(new Error('unused')),
      },
    });
    await start(provider);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      JSON.stringify({ answer: 'x' }),
    );
    expect(res.status).toBe(503);
    const body = JSON.parse(res.body) as { error: string; hint: string };
    expect(body.error).toBe('model unavailable');
    expect(body.hint).toBe(DMR_UNAVAILABLE_HINT);
    expect(body.hint).toContain('about 2.5 GB');
    expect(body.hint).toContain(
      'Is Docker Model Runner enabled? Docker Desktop: Settings → AI → Enable Docker Model Runner. Docker Engine: install the docker-model-plugin package (check with `docker model status`).',
    );
  });

  it('connection error with a non-DMR OpenAI-compatible server → generic text', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider({
      rejectWith: new TypeError('fetch failed'),
    });
    const deps = makeQuizDeps(provider, {
      settings: {
        env: {
          IBAI_OPENAI_BASE_URL: 'http://localhost:1234/v1',
          IBAI_OPENAI_MODEL: 'm',
        },
        testProvider: () => Promise.reject(new Error('unused')),
      },
    });
    await start(provider);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      JSON.stringify({ answer: 'x' }),
    );
    expect(res.status).toBe(503);
    expect((JSON.parse(res.body) as { hint: string }).hint).toBe(
      GENERIC_UNAVAILABLE_HINT,
    );
    expect(res.body).not.toContain('Settings → AI');
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
    await handleApiRoute('POST', '/api/quiz/start', deps, '{}');
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

  it('a second on_track that arrives on the malformed-verdict RETRY is still coerced to incorrect', async () => {
    await seedDone(DONE_IDS);
    const provider = new SequencedQuizProvider([
      ON_TRACK,
      'not json at all',
      ON_TRACK,
    ]);
    const deps = makeQuizDeps(provider);
    await startWith(deps);
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const firstId = (await adapter.readActiveQuizSession())?.deck[0] as string;

    const first = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      JSON.stringify({ answer: 'partial 1' }),
    );
    expect(JSON.parse(first.body).verdict).toBe('on_track');

    // Malformed first reply, then on_track on the retry → coerced.
    const second = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      JSON.stringify({ answer: 'partial 2' }),
    );
    expect(provider.evalCalls).toBe(3);
    expect(second.status).toBe(200);
    const body = JSON.parse(second.body) as {
      verdict: string;
      terminal: boolean;
      session: { index: number; answered: number };
    };
    expect(body.verdict).toBe('incorrect');
    expect(body.terminal).toBe(true);
    expect(body.session.index).toBe(1);
    expect(body.session.answered).toBe(1);
    expect((await adapter.readIntuitionNote(firstId))?.status).toBe(
      'to_revisit',
    );
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
      JSON.stringify({ answer: 'partial' }),
    );
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
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
    await handleApiRoute('POST', '/api/quiz/start', deps, '{}');

    const adapter = new LocalFileStorageAdapter(tmpDir);
    const first = await adapter.readActiveQuizSession();

    const res = await handleApiRoute('POST', '/api/quiz/new', deps, '{}');
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
    );
    expect(res.status).toBe(405);
  });
});

describe('POST /api/quiz/end + GET /api/quiz/sessions (session management)', () => {
  async function startSession(): Promise<ApiDeps> {
    const provider = new FakeQuizProvider();
    const deps = makeQuizDeps(provider);
    await handleApiRoute('POST', '/api/quiz/start', deps, '{}');
    return deps;
  }

  it('end sets the active session complete, clears active, but keeps it listed', async () => {
    await seedDone(DONE_IDS);
    const deps = await startSession();

    const endRes = await handleApiRoute('POST', '/api/quiz/end', deps, '{}');
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
    const res = await handleApiRoute('POST', '/api/quiz/end', deps, '{}');
    expect(res.status).toBe(404);
  });

  it('GET /api/quiz/end → 405', async () => {
    const res = await handleApiRoute(
      'GET',
      '/api/quiz/end',
      makeQuizDeps(new FakeQuizProvider()),
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
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ sessions: [] });
  });

  it('POST /api/quiz/sessions → 405', async () => {
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/sessions',
      makeQuizDeps(new FakeQuizProvider()),
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
    await handleApiRoute('POST', '/api/quiz/start', deps, '{}');

    const adapter = new LocalFileStorageAdapter(tmpDir);
    const sessionId = (await adapter.readActiveQuizSession())!.sessionId;

    // End it so it is no longer active.
    await handleApiRoute('POST', '/api/quiz/end', deps, '{}');
    expect(await adapter.readActiveQuizSession()).toBeNull();

    // Resume it.
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/resume',
      deps,
      JSON.stringify({ sessionId }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      ok: boolean;
      session: { sessionId: string; status: string };
      question: { problemId: string; title: string } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.session.status).toBe('active');

    // It is the active session again.
    const active = await adapter.readActiveQuizSession();
    expect(active?.sessionId).toBe(sessionId);
    // The current question is re-presented from the catalog.
    expect(body.question?.problemId).toBe(active?.deck[0]);
    expect(body.question?.title).toBe(CATALOG.getById(active!.deck[0]!)?.title);
  });

  it('resuming an exhausted session does NOT re-activate it (no empty active view)', async () => {
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const deck = DONE_IDS.slice(0, 1);
    await adapter.writeQuizSession({
      sessionId: 'quiz-done',
      createdAt: '2026-09-24T12:00:00.000Z' as IsoTimestamp,
      deck,
      currentIndex: 1,
      answered: [
        {
          problemId: deck[0]!,
          verdict: 'correct',
          at: '2026-09-24T12:00:00.000Z' as IsoTimestamp,
        },
      ],
      transcript: [],
      status: 'complete',
    });
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/resume',
      makeQuizDeps(new FakeQuizProvider()),
      JSON.stringify({ sessionId: 'quiz-done' }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      session: { status: string };
      question: unknown;
    };
    expect(body.question).toBeNull();
    expect(body.session.status).toBe('complete');
    expect(await adapter.readActiveQuizSession()).toBeNull();
  });

  it('resume unknown id → 404', async () => {
    await seedDone(DONE_IDS);
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/resume',
      makeQuizDeps(new FakeQuizProvider()),
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
    );
    expect(res.status).toBe(405);
  });
});

describe('delete a quiz session (session management)', () => {
  async function startAndGetId(deps: ApiDeps): Promise<string> {
    await handleApiRoute('POST', '/api/quiz/start', deps, '{}');
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
      JSON.stringify({ sessionId }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const listRes = await handleApiRoute(
      'GET',
      '/api/quiz/sessions',
      deps,
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
    );
    expect(res.status).toBe(405);
  });

  it('POST /api/quiz/session/:id (wrong method) → 405', async () => {
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/session/abc',
      makeQuizDeps(new FakeQuizProvider()),
      '{}',
    );
    expect(res.status).toBe(405);
  });
});

describe('quiz reliability (W1) — no orphan sessions, catalog presentation', () => {
  const ON_TRACK_PROBE =
    '```json\n{"verdict":"on_track","feedback":"What about <b>duplicates</b>?"}\n```';

  async function answer(deps: ApiDeps, text: string) {
    return handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      JSON.stringify({ answer: text }),
    );
  }

  it('start never calls the provider, so a failing provider cannot orphan a session', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider({
      rejectWith: new Error('ECONNREFUSED'),
    });
    const deps = makeQuizDeps(provider);
    const res = await handleApiRoute('POST', '/api/quiz/start', deps, '{}');
    expect(res.status).toBe(200);
    expect(provider.calls).toBe(0);

    // A reload always finds a presentable question for the active session.
    const reload = await handleApiRoute(
      'GET',
      '/api/quiz/session',
      deps,
      undefined,
    );
    const body = JSON.parse(reload.body) as {
      active: boolean;
      question: { title: string } | null;
    };
    expect(body.active).toBe(true);
    expect(body.question?.title).toBeTruthy();
  });

  it('POST /api/quiz/new also never calls the provider', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider();
    const res = await handleApiRoute(
      'POST',
      '/api/quiz/new',
      makeQuizDeps(provider),
      '{}',
    );
    expect(res.status).toBe(200);
    expect(provider.calls).toBe(0);
  });

  it('a legacy orphan (active, empty transcript) is resumable and answerable', async () => {
    await seedDone(DONE_IDS);
    const adapter = new LocalFileStorageAdapter(tmpDir);
    await adapter.writeQuizSession({
      sessionId: 'quiz-orphan',
      createdAt: '2026-09-24T12:00:00.000Z' as IsoTimestamp,
      deck: DONE_IDS,
      currentIndex: 0,
      answered: [],
      transcript: [],
      status: 'active',
    });
    const provider = new SequencedQuizProvider([
      ON_TRACK_PROBE,
      ON_TRACK_PROBE,
    ]);
    const deps = makeQuizDeps(provider);

    const get = await handleApiRoute(
      'GET',
      '/api/quiz/session',
      deps,
      undefined,
    );
    const got = JSON.parse(get.body) as {
      active: boolean;
      question: { problemId: string; title: string } | null;
    };
    expect(got.active).toBe(true);
    expect(got.question?.problemId).toBe(DONE_IDS[0]);
    expect(got.question?.title).toBe(CATALOG.getById(DONE_IDS[0]!)?.title);

    // The one-nudge cap still holds on the healed session: the first on_track
    // stays, a second is coerced to a terminal incorrect.
    const first = JSON.parse((await answer(deps, 'partial')).body) as {
      verdict: string;
    };
    expect(first.verdict).toBe('on_track');
    const second = JSON.parse((await answer(deps, 'still partial')).body) as {
      verdict: string;
      terminal: boolean;
    };
    expect(second.verdict).toBe('incorrect');
    expect(second.terminal).toBe(true);
  });

  it('common legacy orphan (Q1 nudged → Q1 answered → Q2 unpresented) gets a fresh nudge on Q2', async () => {
    await seedDone(DONE_IDS);
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const t0 = '2026-09-24T11:00:00.000Z' as IsoTimestamp;
    const t1 = '2026-09-24T11:01:00.000Z' as IsoTimestamp;
    const t2 = '2026-09-24T11:02:00.000Z' as IsoTimestamp;
    await adapter.writeQuizSession({
      sessionId: 'quiz-common-orphan',
      createdAt: t0,
      deck: DONE_IDS,
      currentIndex: 1,
      answered: [{ problemId: DONE_IDS[0]!, verdict: 'correct', at: t2 }],
      transcript: [
        { role: 'assistant', content: 'Q1 presented', at: t0 },
        { role: 'user', content: 'partial', at: t1 },
        { role: 'assistant', content: 'Q1 probe?', at: t1 },
        { role: 'user', content: 'full answer', at: t2 },
        { role: 'assistant', content: 'Q1 verdict feedback', at: t2 },
      ],
      status: 'active',
    });
    const deps = makeQuizDeps(new SequencedQuizProvider([ON_TRACK_PROBE]));

    const get = JSON.parse(
      (await handleApiRoute('GET', '/api/quiz/session', deps, undefined)).body,
    ) as { question: { problemId: string; probe?: string } };
    expect(get.question.problemId).toBe(DONE_IDS[1]);
    // Q1's verdict feedback must NOT be shown as a Q2 probe.
    expect(get.question.probe).toBeUndefined();

    // Q2's first on_track stays non-terminal (not coerced to incorrect).
    const res = JSON.parse((await answer(deps, 'q2 partial')).body) as {
      verdict: string;
      terminal: boolean;
    };
    expect(res.verdict).toBe('on_track');
    expect(res.terminal).toBe(false);
    const note = await adapter.readIntuitionNote(DONE_IDS[1]!);
    expect(note?.status).toBe('done');
  });

  it('a legacy orphan that was already nudged cannot gain a second nudge', async () => {
    await seedDone(DONE_IDS);
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const at = '2026-09-24T12:00:00.000Z' as IsoTimestamp;
    await adapter.writeQuizSession({
      sessionId: 'quiz-nudged-orphan',
      createdAt: at,
      deck: DONE_IDS,
      currentIndex: 0,
      answered: [],
      transcript: [
        { role: 'user', content: 'partial', at },
        { role: 'assistant', content: 'probe?', at },
      ],
      status: 'active',
    });
    const deps = makeQuizDeps(new SequencedQuizProvider([ON_TRACK_PROBE]));
    const res = JSON.parse((await answer(deps, 'still partial')).body) as {
      verdict: string;
      terminal: boolean;
    };
    expect(res.verdict).toBe('incorrect');
    expect(res.terminal).toBe(true);
  });

  it('on_track keeps the problem title and returns the probe separately (also on resume)', async () => {
    await seedDone(DONE_IDS);
    const provider = new SequencedQuizProvider([ON_TRACK_PROBE]);
    const deps = makeQuizDeps(provider);
    const startRes = await handleApiRoute(
      'POST',
      '/api/quiz/start',
      deps,
      '{}',
    );
    const start = JSON.parse(startRes.body) as {
      question: { problemId: string; title: string };
    };

    const res = JSON.parse((await answer(deps, 'hash map?')).body) as {
      verdict: string;
      question: {
        problemId: string;
        title: string;
        wrapped: string;
        probe?: string;
      };
    };
    expect(res.verdict).toBe('on_track');
    expect(res.question.problemId).toBe(start.question.problemId);
    expect(res.question.title).toBe(start.question.title);
    expect(res.question.wrapped).not.toContain('duplicates');
    expect(res.question.probe).toBe('What about <b>duplicates</b>?');

    const reloadRes = await handleApiRoute(
      'GET',
      '/api/quiz/session',
      deps,
      undefined,
    );
    const reload = JSON.parse(reloadRes.body) as {
      question: { title: string; probe?: string };
    };
    expect(reload.question.title).toBe(start.question.title);
    expect(reload.question.probe).toBe('What about <b>duplicates</b>?');
  });

  it('a terminal answer presents the next problem from the catalog (only the verdict hits the model)', async () => {
    await seedDone(DONE_IDS);
    const provider = new FakeQuizProvider();
    const deps = makeQuizDeps(provider);
    await handleApiRoute('POST', '/api/quiz/start', deps, '{}');
    const res = JSON.parse((await answer(deps, 'hash map')).body) as {
      question: { problemId: string; title: string; url: string } | null;
    };
    const next = CATALOG.getById(res.question!.problemId)!;
    expect(res.question?.title).toBe(next.title);
    expect(res.question?.url).toBe(next.url);
    expect(provider.calls).toBe(1);
    expect(provider.evalCalls).toBe(1);
  });
});

describe('POST /api/quiz/answer — miss codes + post-nudge prompt (ADR 0012)', () => {
  /** Queue of verdicts; records every prompt it is sent. */
  class RecordingProvider implements LlmProvider {
    readonly prompts: (readonly { role: string; content: string }[])[] = [];
    private readonly queue: string[];
    constructor(verdicts: string[]) {
      this.queue = [...verdicts];
    }
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      this.prompts.push(request.messages);
      return {
        content:
          this.queue.shift() ?? '{"verdict":"correct","feedback":"fallback"}',
      };
    }
  }

  const v = (verdict: string, miss?: string): string =>
    JSON.stringify({ verdict, feedback: 'fb?', ...(miss && { miss }) });

  async function play(verdicts: string[], answers: string[]) {
    await seedDone(DONE_IDS);
    const provider = new RecordingProvider(verdicts);
    const deps = makeQuizDeps(provider);
    await handleApiRoute('POST', '/api/quiz/start', deps, '{}');
    const adapter = new LocalFileStorageAdapter(tmpDir);
    const firstId = (await adapter.readActiveQuizSession())!.deck[0]!;
    for (const a of answers) {
      const res = await handleApiRoute(
        'POST',
        '/api/quiz/answer',
        deps,
        JSON.stringify({ answer: a }),
      );
      expect(res.status).toBe(200);
    }
    const topics = CATALOG.getById(firstId)!.topics;
    return {
      provider,
      adapter,
      firstId,
      topics,
      signals: await adapter.readCompetencySignals(),
    };
  }

  it('incorrect with a code records it globally and on every topic of the problem', async () => {
    const { signals, topics } = await play([v('incorrect', 'edge')], ['a']);
    expect(signals.misses).toEqual({
      edge: { count: 1, lastSeen: expect.any(String) },
    });
    for (const t of topics) {
      expect(signals.topics[t]?.misses).toEqual({ edge: 1 });
    }
  });

  it('first-try correct records none; correct with brute records brute', async () => {
    const plain = await play([v('correct', 'edge')], ['a']);
    expect(plain.signals.misses).toBeUndefined();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-quiz-test-'));
    const brute = await play([v('correct', 'brute')], ['a']);
    expect(Object.keys(brute.signals.misses ?? {})).toEqual(['brute']);
  });

  it('on_track keeps its code on the probe entry; correct after the nudge records the probe code', async () => {
    await seedDone(DONE_IDS);
    const provider = new RecordingProvider([
      v('on_track', 'complexity'),
      v('correct'),
    ]);
    const deps = makeQuizDeps(provider);
    await handleApiRoute('POST', '/api/quiz/start', deps, '{}');
    const adapter = new LocalFileStorageAdapter(tmpDir);
    await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      JSON.stringify({ answer: 'my first idea' }),
    );
    const mid = await adapter.readActiveQuizSession();
    expect(mid?.transcript.at(-1)).toMatchObject({
      role: 'assistant',
      miss: 'complexity',
    });
    // Nothing tallied while the question is open.
    expect((await adapter.readCompetencySignals()).misses).toBeUndefined();
    await handleApiRoute(
      'POST',
      '/api/quiz/answer',
      deps,
      JSON.stringify({ answer: 'my second idea' }),
    );
    const signals = await adapter.readCompetencySignals();
    expect(Object.keys(signals.misses ?? {})).toEqual(['complexity']);
    expect(signals.misses?.complexity?.count).toBe(1);

    // The post-nudge prompt carries this question's first answer + probe,
    // before the answer being graded; the first prompt has neither.
    const [p1, p2] = provider.prompts;
    expect(p1![1]!.content).not.toContain('PROBE GIVEN');
    expect(p2).toHaveLength(2);
    expect(p2![1]!.content).toContain(
      'FIRST ANSWER:\n"""\nmy first idea\n"""\nPROBE GIVEN:\n"""\nfb?\n"""\nAnswer:\n"""\nmy second idea\n"""',
    );
  });

  it('terminal code wins over the probe code; a missing terminal code falls back to the probe', async () => {
    const wins = await play(
      [v('on_track', 'edge'), v('incorrect', 'vague')],
      ['a', 'b'],
    );
    expect(Object.keys(wins.signals.misses ?? {})).toEqual(['vague']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-quiz-test-'));
    const falls = await play(
      [v('on_track', 'edge'), v('incorrect', 'unknown-code')],
      ['a', 'b'],
    );
    expect(Object.keys(falls.signals.misses ?? {})).toEqual(['edge']);
  });

  it('a second on_track coerced to incorrect records its own code (A3 coercion kept)', async () => {
    const { signals, adapter, firstId } = await play(
      [v('on_track', 'edge'), v('on_track', 'technique')],
      ['a', 'b'],
    );
    expect(Object.keys(signals.misses ?? {})).toEqual(['technique']);
    expect((await adapter.readIntuitionNote(firstId))?.status).toBe(
      'to_revisit',
    );
    const session = await adapter.readActiveQuizSession();
    expect(session?.answered[0]?.verdict).toBe('incorrect');
  });

  it('one miss per question at most', async () => {
    const { signals } = await play(
      [v('on_track', 'edge'), v('incorrect', 'edge')],
      ['a', 'b'],
    );
    expect(signals.misses?.edge?.count).toBe(1);
  });
});
