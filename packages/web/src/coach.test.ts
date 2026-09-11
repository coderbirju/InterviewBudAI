import { describe, it, expect } from 'vitest';
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
 */
class FakeLlmProvider implements LlmProvider {
  public completeCalls: CompletionRequest[] = [];
  private response: CompletionResponse = {
    content: JSON.stringify({
      narrative: 'Great session! You showed strong understanding.',
      strengths: ['arrays', 'problem-solving'],
      weaknesses: ['edge cases'],
    }),
  };
  private shouldThrow = false;
  private errorMessage = 'Provider error';

  setResponse(response: CompletionResponse): void {
    this.response = response;
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

describe('createCoachHandler - GET /coach (form)', () => {
  it('returns 200 with HTML form', async () => {
    const storage = new FakeStorageAdapter();
    const handler = createCoachHandler({ storage });

    const res = await handler({ method: 'GET', url: '/coach' });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('Coaching Session');
    expect(res.body).toContain('<form');
  });

  it('shows plan topics in form', async () => {
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

    const handler = createCoachHandler({ storage });
    const res = await handler({ method: 'GET', url: '/coach' });

    expect(res.body).toContain('arrays');
    expect(res.body).toContain('Pass');
    expect(res.body).toContain('Fail');
  });
});

describe('createCoachHandler - POST /coach (HTML)', () => {
  it('returns 400 when provider not configured', async () => {
    const storage = new FakeStorageAdapter();
    const handler = createCoachHandler({ storage }); // no provider

    const res = await handler({
      method: 'POST',
      url: '/coach',
      body: 'outcome_arrays=pass',
    });

    expect(res.status).toBe(400);
    expect(res.body).toContain('IBAI_OLLAMA_MODEL');
  });

  it('runs coach loop and records write-back on success', async () => {
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
      url: '/coach',
      body: 'outcome_arrays=pass&note_arrays=Did%20great!',
    });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('Session Complete');
    expect(res.body).toContain('Progress Saved');

    // Verify provider was called
    expect(provider.completeCalls.length).toBe(1);

    // Verify write-back occurred
    expect(storage.writeSessionSummaryCalls.length).toBe(1);
    expect(storage.updateCompetencyMapCalls.length).toBe(1);
    expect(storage.updateWeaknessRegisterCalls.length).toBe(1);
  });

  it('returns 502 on connection error with friendly message', async () => {
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
    provider.setShouldThrow(true, 'fetch failed: ECONNREFUSED');

    const handler = createCoachHandler({ storage, provider });

    const res = await handler({
      method: 'POST',
      url: '/coach',
      body: 'outcome_arrays=pass',
    });

    expect(res.status).toBe(502);
    expect(res.body).toContain('Ollama');
    expect(res.body).toContain('ollama serve');
  });
});

describe('createCoachHandler - POST /coach.json (JSON)', () => {
  it('returns 400 when provider not configured', async () => {
    const storage = new FakeStorageAdapter();
    const handler = createCoachHandler({ storage }); // no provider

    const res = await handler({
      method: 'POST',
      url: '/coach.json',
      body: JSON.stringify({
        outcomes: [{ topicId: 'arrays', succeeded: true }],
      }),
    });

    expect(res.status).toBe(400);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const body = JSON.parse(res.body);
    expect(body.error).toContain('IBAI_OLLAMA_MODEL');
  });

  it('returns CoachResult as JSON on success', async () => {
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
        outcomes: [{ topicId: 'arrays', succeeded: true, note: 'Did great!' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.contentType).toBe('application/json; charset=utf-8');

    const result = JSON.parse(res.body);
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('competencyMap');
    expect(result).toHaveProperty('weaknessRegister');

    // Verify write-back
    expect(storage.writeSessionSummaryCalls.length).toBe(1);
  });

  it('returns 502 on connection error with JSON error', async () => {
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
    provider.setShouldThrow(true, 'ECONNREFUSED');

    const handler = createCoachHandler({ storage, provider });

    const res = await handler({
      method: 'POST',
      url: '/coach.json',
      body: JSON.stringify({ outcomes: [] }),
    });

    expect(res.status).toBe(502);
    expect(res.contentType).toBe('application/json; charset=utf-8');
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Ollama');
  });
});

describe('empty/new-user coach', () => {
  it('GET /coach shows empty state message', async () => {
    const storage = new FakeStorageAdapter();
    const handler = createCoachHandler({ storage });

    const res = await handler({ method: 'GET', url: '/coach' });

    expect(res.status).toBe(200);
    // Empty plan shows message
    expect(res.body).toContain('No topics in your plan yet');
  });

  it('POST /coach succeeds with empty outcomes', async () => {
    const storage = new FakeStorageAdapter();
    const provider = new FakeLlmProvider();
    const handler = createCoachHandler({ storage, provider });

    const res = await handler({
      method: 'POST',
      url: '/coach',
      body: '', // no outcomes
    });

    expect(res.status).toBe(200);
    expect(provider.completeCalls.length).toBe(1);
  });
});

describe('XSS escaping in coach output', () => {
  it('escapes script tags in narrative', () => {
    const malicious = '<script>alert("xss")</script>';
    const escaped = escapeHtml(malicious);
    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escaped).not.toContain('<script>');
  });

  it('escapes malicious notes in form', async () => {
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

    const handler = createCoachHandler({ storage });
    const res = await handler({ method: 'GET', url: '/coach' });

    expect(res.body).not.toContain('<script>evil</script>');
    expect(res.body).toContain('&lt;script&gt;');
  });
});

describe('existing routes still work', () => {
  const createFakeHandler = () => {
    const storage = new FakeStorageAdapter();
    const handler = createCoachHandler({ storage });
    return { storage, handler };
  };

  it('GET / returns dashboard HTML', async () => {
    const { handler } = createFakeHandler();
    const res = await handler({ method: 'GET', url: '/' });
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('Where You Stand');
  });

  it('GET /assess returns dashboard HTML', async () => {
    const { handler } = createFakeHandler();
    const res = await handler({ method: 'GET', url: '/assess' });
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
