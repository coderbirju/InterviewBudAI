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
import type {
  LlmProvider,
  CompletionRequest,
  CompletionResponse,
} from '@ibai/providers';
import { createCoachHandler } from './handler.js';
import type { HandlerRequest } from './handler.js';
import { resolveOllamaUrl, resolveOllamaModel } from './config.js';
import {
  renderCoachForm,
  renderCoachResult,
  renderCoachJson,
  escapeHtml,
} from './render.js';
import type { SessionPlan, AssessmentView, CoachResult } from '@ibai/core';

/**
 * In-memory fake storage adapter for testing.
 * Tracks write-back calls for verification.
 */
class FakeStorageAdapter implements StorageAdapter {
  private competencyMap: CompetencyMap = { entries: {} };
  private weaknessRegister: WeaknessRegister = { entries: [] };
  private sessionContexts: Map<string, SessionContext> = new Map();
  private shouldThrow = false;

  // Track write-back calls
  public writeSessionSummaryCalls: SessionSummary[] = [];
  public updateCompetencyMapCalls: CompetencyMap[] = [];
  public updateWeaknessRegisterCalls: WeaknessRegister[] = [];

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

  async writeSessionSummary(summary: SessionSummary): Promise<void> {
    if (this.shouldThrow) throw new Error('Storage error');
    this.writeSessionSummaryCalls.push(summary);
  }

  async readCompetencyMap(): Promise<CompetencyMap> {
    if (this.shouldThrow) throw new Error('Storage error');
    return this.competencyMap;
  }

  async updateCompetencyMap(map: CompetencyMap): Promise<void> {
    if (this.shouldThrow) throw new Error('Storage error');
    this.updateCompetencyMapCalls.push(map);
    this.competencyMap = map;
  }

  async readWeaknessRegister(): Promise<WeaknessRegister> {
    if (this.shouldThrow) throw new Error('Storage error');
    return this.weaknessRegister;
  }

  async updateWeaknessRegister(register: WeaknessRegister): Promise<void> {
    if (this.shouldThrow) throw new Error('Storage error');
    this.updateWeaknessRegisterCalls.push(register);
    this.weaknessRegister = register;
  }

  reset(): void {
    this.writeSessionSummaryCalls = [];
    this.updateCompetencyMapCalls = [];
    this.updateWeaknessRegisterCalls = [];
  }
}

/**
 * Fake LLM provider for testing.
 * Updated for AI-evaluation contract: returns fenced JSON with narrative + evaluations.
 */
class FakeLlmProvider implements LlmProvider {
  public completeCalls: CompletionRequest[] = [];
  private response: CompletionResponse = {
    content:
      '```json\n{"narrative": "Great session! You showed strong understanding.", "evaluations": [{"topicId": "arrays", "succeeded": true, "feedback": "Good work"}]}\n```',
  };
  private shouldThrow = false;
  private errorMessage = 'Provider error';

  setResponse(response: CompletionResponse): void {
    this.response = response;
  }

  /** Helper to set well-formed evaluation response for specific topics */
  setEvaluationResponse(
    narrative: string,
    evaluations: Array<{
      topicId: string;
      succeeded: boolean;
      feedback: string;
    }>,
  ): void {
    const json = JSON.stringify({ narrative, evaluations });
    this.response = {
      content: '```json\n' + json + '\n```',
    };
  }

  setShouldThrow(should: boolean, message?: string): void {
    this.shouldThrow = should;
    if (message) this.errorMessage = message;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.completeCalls.push(request);
    if (this.shouldThrow) {
      throw new Error(this.errorMessage);
    }
    return this.response;
  }

  reset(): void {
    this.completeCalls = [];
  }
}

describe('resolveOllamaUrl', () => {
  it('returns default URL when no config', () => {
    expect(resolveOllamaUrl({})).toBe('http://127.0.0.1:11434');
  });

  it('uses IBAI_OLLAMA_URL env var when set', () => {
    expect(resolveOllamaUrl({ IBAI_OLLAMA_URL: 'http://custom:5000' })).toBe(
      'http://custom:5000',
    );
  });

  it('uses opts.endpoint over env var', () => {
    expect(
      resolveOllamaUrl(
        { IBAI_OLLAMA_URL: 'http://env:5000' },
        {
          endpoint: 'http://opts:6000',
        },
      ),
    ).toBe('http://opts:6000');
  });
});

describe('resolveOllamaModel', () => {
  it('returns undefined when no config', () => {
    expect(resolveOllamaModel({})).toBeUndefined();
  });

  it('uses IBAI_OLLAMA_MODEL env var when set', () => {
    expect(resolveOllamaModel({ IBAI_OLLAMA_MODEL: 'llama2' })).toBe('llama2');
  });

  it('uses opts.model over env var', () => {
    expect(
      resolveOllamaModel({ IBAI_OLLAMA_MODEL: 'llama2' }, { model: 'mistral' }),
    ).toBe('mistral');
  });
});

describe('createCoachHandler - GET /coach (interactive interview)', () => {
  it('returns 200 with provider-required page when provider not configured', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const handler = createCoachHandler({ storage }); // no provider

    const res = await handler({ method: 'GET', url: '/coach' });

    // Provider-required is a configuration state (200), not an error (4xx)
    expect(res.status).toBe(200);
    expect(res.body).toContain('Configure a model');
    expect(res.body).toContain('ANTHROPIC_API_KEY');
    expect(res.body).toContain('IBAI_OLLAMA_MODEL');
  });

  it('returns 200 with interview step when provider configured', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const provider = new FakeLlmProvider();
    const handler = createCoachHandler({ storage, provider });

    const res = await handler({ method: 'GET', url: '/coach' });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('Interview'); // Interview step page
    expect(res.body).toContain('arrays');
    expect(res.body).toContain('<form'); // Interview form
    expect(provider.completeCalls.length).toBe(1); // Provider called for question
  });

  it('shows provider label when configured', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const provider = new FakeLlmProvider();
    const handler = createCoachHandler({
      storage,
      provider,
      providerLabel: 'Demo interviewer (no LLM configured)',
    });

    const res = await handler({ method: 'GET', url: '/coach' });

    expect(res.status).toBe(200);
    expect(res.body).toContain('Demo interviewer');
  });
});

describe('createCoachHandler - POST /coach (interactive interview)', () => {
  it('returns 200 with provider-required page when provider not configured', async () => {
    const storage = new FakeStorageAdapter();
    const handler = createCoachHandler({ storage }); // no provider

    const res = await handler({
      method: 'POST',
      url: '/coach',
      body: 'sessionId=test-session&step=0&current_answer=test&current_question=What%20is%20an%20array?',
    });

    // Provider-required is a configuration state (200), not an error (4xx)
    expect(res.status).toBe(200);
    expect(res.body).toContain('Configure a model');
    expect(res.body).toContain('IBAI_OLLAMA_MODEL');
  });

  it('returns 400 when answer is empty', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const provider = new FakeLlmProvider();
    const handler = createCoachHandler({ storage, provider });

    // Empty answer (model evaluates, no outcome needed)
    const res = await handler({
      method: 'POST',
      url: '/coach',
      body: 'sessionId=test-session&step=0&current_answer=&current_question=What%20is%20an%20array?',
    });

    expect(res.status).toBe(400);
    expect(res.body).toContain('Please provide an answer');
  });

  it('advances to next step when more topics remain', async () => {
    const storage = new FakeStorageAdapter();
    // Set up two topics so we have multiple steps
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
        'linked-lists': {
          topicId: 'linked-lists',
          proficiency: 0.2,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const provider = new FakeLlmProvider();
    const handler = createCoachHandler({ storage, provider });

    // Submit first step answer (step 0)
    const res = await handler({
      method: 'POST',
      url: '/coach',
      body: 'sessionId=test-session&step=0&current_answer=Arrays%20are%20contiguous%20memory&current_question=What%20is%20an%20array?',
    });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    // Should render next interview step, not the final result
    expect(res.body).toContain('Interview');
    expect(res.body).toContain('linked-lists'); // Next topic
    expect(provider.completeCalls.length).toBe(1); // Called to get next question
  });

  it('runs coach loop and records write-back when interview complete', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const provider = new FakeLlmProvider();
    // Set proper AI-evaluation response for 'arrays' topic
    provider.setEvaluationResponse('Great work on arrays!', [
      {
        topicId: 'arrays',
        succeeded: true,
        feedback: 'Excellent understanding',
      },
    ]);
    const handler = createCoachHandler({ storage, provider });

    // Submit final step (step 0 with only one topic completes the interview)
    const res = await handler({
      method: 'POST',
      url: '/coach',
      body: 'sessionId=test-session&step=0&current_answer=Arrays%20are%20ordered%20collections&current_question=What%20is%20an%20array?',
    });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('Session Complete');
    expect(res.body).toContain('Progress Saved');

    // Verify provider was called for coach feedback
    expect(provider.completeCalls.length).toBe(1);

    // Verify write-back occurred
    expect(storage.writeSessionSummaryCalls.length).toBe(1);
    expect(storage.updateCompetencyMapCalls.length).toBe(1);
    expect(storage.updateWeaknessRegisterCalls.length).toBe(1);
  });

  it('returns 502 on connection error during interview', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
        'linked-lists': {
          topicId: 'linked-lists',
          proficiency: 0.2,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const provider = new FakeLlmProvider();
    provider.setShouldThrow(true, 'fetch failed: ECONNREFUSED');

    const handler = createCoachHandler({ storage, provider });

    const res = await handler({
      method: 'POST',
      url: '/coach',
      body: 'sessionId=test-session&step=0&current_answer=test&current_outcome=pass&current_question=What%20is%20an%20array?',
    });

    expect(res.status).toBe(502);
    expect(res.body).toContain('Ollama');
    expect(res.body).toContain('ollama serve');
  });
});

describe('createCoachHandler - POST /coach.json (JSON API)', () => {
  it('returns 400 with provider-required message when no provider', async () => {
    const storage = new FakeStorageAdapter();
    const handler = createCoachHandler({ storage }); // no provider

    const res = await handler({
      method: 'POST',
      url: '/coach.json',
      body: JSON.stringify({
        answers: [{ topicId: 'arrays', answer: 'test answer' }],
      }),
    });

    expect(res.status).toBe(400);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const body = JSON.parse(res.body);
    expect(body.error).toContain('No model configured');
  });

  it('returns 400 for missing answers array', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const provider = new FakeLlmProvider();
    const handler = createCoachHandler({ storage, provider });

    const res = await handler({
      method: 'POST',
      url: '/coach.json',
      body: JSON.stringify({
        sessionId: 'test-session-123',
        // Missing answers array
      }),
    });

    expect(res.status).toBe(400);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const result = JSON.parse(res.body);
    expect(result.error).toContain('Missing or invalid answers array');
  });

  it('returns 502 on provider connection error', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const provider = new FakeLlmProvider();
    provider.setShouldThrow(true, 'ECONNREFUSED: connection refused');

    const handler = createCoachHandler({ storage, provider });

    const res = await handler({
      method: 'POST',
      url: '/coach.json',
      body: JSON.stringify({
        answers: [{ topicId: 'arrays', answer: 'My answer here' }],
      }),
    });

    expect(res.status).toBe(502);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Could not reach the model provider');
  });
});

describe('empty/new-user coach', () => {
  it('GET /coach shows empty state message when no topics', async () => {
    const storage = new FakeStorageAdapter(); // empty storage = no topics
    const provider = new FakeLlmProvider();
    const handler = createCoachHandler({ storage, provider });

    const res = await handler({ method: 'GET', url: '/coach' });

    expect(res.status).toBe(200);
    // Empty plan shows message (from renderNoTopicsState)
    expect(res.body).toContain('No Topics Yet');
  });

  it('POST /coach.json with empty answers and matching mock succeeds (evaluates topic from plan)', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.3,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });
    const provider = new FakeLlmProvider();
    // Default FakeLlmProvider response includes valid evaluation for 'arrays'
    const handler = createCoachHandler({ storage, provider });

    const res = await handler({
      method: 'POST',
      url: '/coach.json',
      body: JSON.stringify({ answers: [] }),
    });

    // Empty answers still proceeds to coach() which succeeds if mock evaluation matches plan topics
    // The default FakeLlmProvider response evaluates 'arrays', which matches the plan
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summary).toBeDefined();
    expect(body.evaluations).toBeDefined();
  });
});

describe('XSS escaping in coach output', () => {
  it('escapes script tags in narrative', () => {
    const malicious = '<script>alert("xss")</script>';
    const escaped = escapeHtml(malicious);
    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escaped).not.toContain('<script>');
  });

  it('escapes malicious topic IDs in interview', async () => {
    const storage = new FakeStorageAdapter();
    storage.setCompetencyMap({
      entries: {
        '<script>evil</script>': {
          topicId: '<script>evil</script>',
          proficiency: 0.5,
          lastUpdated: '2026-09-06T12:00:00Z',
        },
      },
    });

    const provider = new FakeLlmProvider();
    const handler = createCoachHandler({ storage, provider });
    const res = await handler({ method: 'GET', url: '/coach' });

    // Verify malicious topic ID is escaped in output
    expect(res.body).not.toContain('<script>evil</script>');
    expect(res.body).toContain('&lt;script&gt;');
  });
});

describe('existing routes still work', () => {
  let testDataDir: string | null = null;

  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-coach-test-'));
  });

  afterEach(() => {
    if (testDataDir && fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
      testDataDir = null;
    }
  });

  const createFakeHandler = () => {
    const storage = new FakeStorageAdapter();
    const handler = createCoachHandler({
      storage,
      createStorage: () => storage,
      defaultDataDir: '/nonexistent/path/that/does/not/exist',
      env: {},
      argv: [],
    });
    return { storage, handler };
  };

  const withCookie = (req: HandlerRequest): HandlerRequest => ({
    ...req,
    headers: { cookie: `ibai_data_dir=${encodeURIComponent(testDataDir!)}` },
  });

  it('GET / returns home page HTML when cookie is set', async () => {
    const { handler } = createFakeHandler();
    const res = await handler(withCookie({ method: 'GET', url: '/' }));
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('Continue practicing');
    expect(res.body).toContain('Interview with AI');
  });

  it('GET / returns 200 with home page when no cookie (empty state)', async () => {
    const { handler } = createFakeHandler();
    const res = await handler({ method: 'GET', url: '/' });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Create your database');
  });

  it('GET /assess returns dashboard HTML when cookie is set', async () => {
    const { handler } = createFakeHandler();
    const res = await handler(withCookie({ method: 'GET', url: '/assess' }));
    expect(res.status).toBe(200);
    expect(res.body).toContain('Where You Stand');
  });

  it('GET /assess.json returns JSON', async () => {
    const { handler } = createFakeHandler();
    const res = await handler({ method: 'GET', url: '/assess.json' });
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const view = JSON.parse(res.body);
    expect(view).toHaveProperty('topicsTracked');
  });

  it('GET /plan.json returns JSON', async () => {
    const { handler } = createFakeHandler();
    const res = await handler({ method: 'GET', url: '/plan.json' });
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const plan = JSON.parse(res.body);
    expect(plan).toHaveProperty('topics');
    expect(plan).toHaveProperty('summary');
  });

  it('unknown paths return 404', async () => {
    const { handler } = createFakeHandler();
    const res = await handler({ method: 'GET', url: '/unknown' });
    expect(res.status).toBe(404);
  });

  it('unsupported methods return 405', async () => {
    const { handler } = createFakeHandler();
    const res = await handler({ method: 'DELETE', url: '/coach' });
    expect(res.status).toBe(405);
  });
});

describe('render functions', () => {
  const emptyPlan: SessionPlan = {
    topics: [],
    summary: 'No history yet.',
  };

  const emptyView: AssessmentView = {
    topicsTracked: 0,
    topStrengths: [],
    focusAreas: [],
    recurringWeaknesses: [],
    recentSession: null,
  };

  const mockResult: CoachResult = {
    summary: {
      sessionId: 'test-123',
      completedAt: '2026-09-10T12:00:00Z',
      topics: ['arrays'],
      narrative: 'Great job on arrays!',
      strengths: ['arrays'],
      weaknesses: ['edge cases'],
    },
    competencyMap: { entries: {} },
    weaknessRegister: { entries: [] },
    request: { messages: [] },
  };

  it('renderCoachForm produces valid HTML', () => {
    const html = renderCoachForm(emptyPlan, emptyView);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Coaching Session');
  });

  it('renderCoachResult shows narrative and confirmation', () => {
    const html = renderCoachResult('test-123', emptyPlan, mockResult);
    expect(html).toContain('Great job on arrays!');
    expect(html).toContain('Progress Saved');
    expect(html).toContain('Session summary written');
  });

  it('renderCoachJson returns valid JSON', () => {
    const json = renderCoachJson(mockResult);
    const parsed = JSON.parse(json);
    expect(parsed.summary.narrative).toBe('Great job on arrays!');
  });
});
