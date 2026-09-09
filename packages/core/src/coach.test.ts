/**
 * @ibai/core — Coach engine job tests.
 *
 * Tests use in-memory fake implementations of StorageAdapter and LlmProvider
 * via their INTERFACE TYPES. No real filesystem, no network.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildCoachPrompt, coach } from './coach.js';
import type { CoachInput } from './coach.js';
import type { SessionPlan, PlanTopic } from './plan.js';
import type { AssessmentView } from './assess.js';
import type {
  StorageAdapter,
  SessionContext,
  SessionSummary,
  CompetencyMap,
  WeaknessRegister,
  TopicId,
} from '@ibai/storage';
import type {
  LlmProvider,
  CompletionRequest,
  CompletionResponse,
} from '@ibai/providers';

// ---------------------------------------------------------------------------
// Fake StorageAdapter
// ---------------------------------------------------------------------------

class FakeStorage implements StorageAdapter {
  public lastSummary: SessionSummary | null = null;
  public competencyMap: CompetencyMap = { entries: {} };
  public weaknessRegister: WeaknessRegister = { entries: [] };
  public summaryWriteCalled = false;
  public competencyUpdateCalled = false;
  public weaknessUpdateCalled = false;

  async readSessionContext(): Promise<SessionContext> {
    return { sessionId: 'test-session', history: [] };
  }

  async writeSessionSummary(summary: SessionSummary): Promise<void> {
    this.lastSummary = summary;
    this.summaryWriteCalled = true;
  }

  async readCompetencyMap(): Promise<CompetencyMap> {
    return this.competencyMap;
  }

  async updateCompetencyMap(map: CompetencyMap): Promise<void> {
    this.competencyMap = map;
    this.competencyUpdateCalled = true;
  }

  async readWeaknessRegister(): Promise<WeaknessRegister> {
    return this.weaknessRegister;
  }

  async updateWeaknessRegister(register: WeaknessRegister): Promise<void> {
    this.weaknessRegister = register;
    this.weaknessUpdateCalled = true;
  }
}

// ---------------------------------------------------------------------------
// Fake LlmProvider
// ---------------------------------------------------------------------------

class FakeProvider implements LlmProvider {
  public response: CompletionResponse = {
    content:
      'Great session! The candidate demonstrated strong problem-solving skills.',
  };
  public shouldReject = false;
  public rejectError = new Error('Provider error');

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    if (this.shouldReject) {
      throw this.rejectError;
    }
    return this.response;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createPlan(topics: PlanTopic[]): SessionPlan {
  return {
    topics,
    summary: 'Test session plan.',
  };
}

function createPlanTopic(
  topicId: TopicId,
  role: 'warmup' | 'focus' | 'twist',
  proficiency = 0.5,
): PlanTopic {
  return {
    topicId,
    role,
    proficiency,
    rationale: `Test rationale for ${topicId}`,
  };
}

function createInput(overrides: Partial<CoachInput> = {}): CoachInput {
  return {
    sessionId: 'test-session-123',
    plan: createPlan([
      createPlanTopic('arrays', 'warmup', 0.8),
      createPlanTopic('graphs', 'focus', 0.3),
      createPlanTopic('dynamic-programming', 'focus', 0.4),
      createPlanTopic('system-design', 'twist', 0.2),
    ]),
    outcomes: [
      { topicId: 'arrays', succeeded: true },
      { topicId: 'graphs', succeeded: false, note: 'Struggled with BFS' },
      { topicId: 'dynamic-programming', succeeded: true },
      { topicId: 'system-design', succeeded: false },
    ],
    completedAt: '2026-09-08T12:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: buildCoachPrompt
// ---------------------------------------------------------------------------

describe('buildCoachPrompt', () => {
  it('returns a request with a system persona message', () => {
    const plan = createPlan([
      createPlanTopic('arrays', 'warmup'),
      createPlanTopic('graphs', 'focus'),
      createPlanTopic('dp', 'twist'),
    ]);

    const request = buildCoachPrompt(plan);

    expect(request.messages.length).toBeGreaterThanOrEqual(1);
    const systemMsg = request.messages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg?.content).toContain('interview coach');
  });

  it('system message instructs eliciting user intuition and forbids giving answers', () => {
    const plan = createPlan([createPlanTopic('trees', 'focus')]);

    const request = buildCoachPrompt(plan);

    const systemMsg = request.messages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('ELICIT');
    expect(systemMsg?.content).toContain('NEVER provide solutions');
    expect(systemMsg?.content).toContain('NEVER');
  });

  it('includes focus topicIds and rationales as framing', () => {
    const plan = createPlan([createPlanTopic('linked-lists', 'focus', 0.35)]);

    const request = buildCoachPrompt(plan);

    const userMsg = request.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('linked-lists');
    expect(userMsg?.content).toContain('Test rationale for linked-lists');
  });

  it('includes plan.summary in the request', () => {
    const plan: SessionPlan = {
      topics: [createPlanTopic('sorting', 'focus')],
      summary: 'Focus on sorting algorithms today.',
    };

    const request = buildCoachPrompt(plan);

    const userMsg = request.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('Focus on sorting algorithms today.');
  });

  it('does NOT contain fabricated answers or solutions', () => {
    const plan = createPlan([
      createPlanTopic('binary-search', 'focus'),
      createPlanTopic('heap', 'twist'),
    ]);

    const request = buildCoachPrompt(plan);

    // Check that no message contains engine-authored answer content
    for (const msg of request.messages) {
      // These patterns would indicate leaked answers
      expect(msg.content.toLowerCase()).not.toContain('the answer is');
      expect(msg.content.toLowerCase()).not.toContain('solution:');
      expect(msg.content.toLowerCase()).not.toContain('here is how to solve');
    }
  });

  it('handles empty plan (no topics) gracefully', () => {
    const plan = createPlan([]);

    const request = buildCoachPrompt(plan);

    expect(request.messages.length).toBeGreaterThanOrEqual(1);
    const systemMsg = request.messages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
  });

  it('includes assessment context when provided', () => {
    const plan = createPlan([createPlanTopic('recursion', 'focus')]);
    const assessment: AssessmentView = {
      topicsTracked: 5,
      topStrengths: [{ topicId: 'arrays', proficiency: 0.9 }],
      focusAreas: [{ topicId: 'recursion', proficiency: 0.3 }],
      recurringWeaknesses: [
        {
          topicId: 'dp',
          note: 'memoization',
          occurrences: 3,
          lastObserved: '2026-09-01T00:00:00.000Z',
        },
      ],
      recentSession: null,
    };

    const request = buildCoachPrompt(plan, { assessment });

    const userMsg = request.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('recursion');
    expect(userMsg?.content).toContain('dp');
  });
});

// ---------------------------------------------------------------------------
// Tests: coach (growth-loop round trip)
// ---------------------------------------------------------------------------

describe('coach', () => {
  let fakeStorage: FakeStorage;
  let fakeProvider: FakeProvider;

  beforeEach(() => {
    fakeStorage = new FakeStorage();
    fakeProvider = new FakeProvider();
  });

  it('writes SessionSummary with correct fields from outcomes', async () => {
    const input = createInput();

    await coach({ storage: fakeStorage, provider: fakeProvider }, input);

    expect(fakeStorage.summaryWriteCalled).toBe(true);
    expect(fakeStorage.lastSummary).not.toBeNull();
    expect(fakeStorage.lastSummary?.sessionId).toBe('test-session-123');
    expect(fakeStorage.lastSummary?.completedAt).toBe(
      '2026-09-08T12:00:00.000Z',
    );
    expect(fakeStorage.lastSummary?.narrative).toBe(
      'Great session! The candidate demonstrated strong problem-solving skills.',
    );
    // Strengths from succeeded outcomes
    expect(fakeStorage.lastSummary?.strengths).toContain('arrays');
    expect(fakeStorage.lastSummary?.strengths).toContain('dynamic-programming');
    // Weaknesses from failed outcomes
    expect(fakeStorage.lastSummary?.weaknesses).toContain('graphs');
    expect(fakeStorage.lastSummary?.weaknesses).toContain('system-design');
  });

  it('updates competency map with proficiency changes', async () => {
    // Seed existing competency
    fakeStorage.competencyMap = {
      entries: {
        arrays: {
          topicId: 'arrays',
          proficiency: 0.7,
          lastUpdated: '2026-09-01T00:00:00.000Z',
        },
        graphs: {
          topicId: 'graphs',
          proficiency: 0.4,
          lastUpdated: '2026-09-01T00:00:00.000Z',
        },
        'other-topic': {
          topicId: 'other-topic',
          proficiency: 0.5,
          lastUpdated: '2026-09-01T00:00:00.000Z',
        },
      },
    };

    const input = createInput({
      outcomes: [
        { topicId: 'arrays', succeeded: true },
        { topicId: 'graphs', succeeded: false },
      ],
    });

    await coach({ storage: fakeStorage, provider: fakeProvider }, input);

    expect(fakeStorage.competencyUpdateCalled).toBe(true);
    // Success: proficiency should increase
    expect(
      fakeStorage.competencyMap.entries['arrays']?.proficiency,
    ).toBeCloseTo(0.8, 5);
    // Failure: proficiency should decrease
    expect(
      fakeStorage.competencyMap.entries['graphs']?.proficiency,
    ).toBeCloseTo(0.3, 5);
    // Untouched topic should be preserved
    expect(
      fakeStorage.competencyMap.entries['other-topic']?.proficiency,
    ).toBeCloseTo(0.5, 5);
  });

  it('clamps proficiency to [0, 1]', async () => {
    fakeStorage.competencyMap = {
      entries: {
        'high-topic': {
          topicId: 'high-topic',
          proficiency: 0.95,
          lastUpdated: '2026-09-01T00:00:00.000Z',
        },
        'low-topic': {
          topicId: 'low-topic',
          proficiency: 0.05,
          lastUpdated: '2026-09-01T00:00:00.000Z',
        },
      },
    };

    const input = createInput({
      plan: createPlan([
        createPlanTopic('high-topic', 'warmup'),
        createPlanTopic('low-topic', 'focus'),
      ]),
      outcomes: [
        { topicId: 'high-topic', succeeded: true },
        { topicId: 'low-topic', succeeded: false },
      ],
    });

    await coach({ storage: fakeStorage, provider: fakeProvider }, input);

    // Should be clamped to 1.0
    expect(fakeStorage.competencyMap.entries['high-topic']?.proficiency).toBe(
      1.0,
    );
    // Should be clamped to 0.0
    expect(fakeStorage.competencyMap.entries['low-topic']?.proficiency).toBe(
      0.0,
    );
  });

  it('updates weakness register for failed outcomes', async () => {
    // Seed existing weakness
    fakeStorage.weaknessRegister = {
      entries: [
        {
          topicId: 'graphs',
          note: 'Old note',
          occurrences: 2,
          lastObserved: '2026-09-01T00:00:00.000Z',
        },
      ],
    };

    const input = createInput({
      outcomes: [
        {
          topicId: 'graphs',
          succeeded: false,
          note: 'Still struggling with BFS',
        },
        {
          topicId: 'new-weakness',
          succeeded: false,
          note: 'First time failing this',
        },
        { topicId: 'success-topic', succeeded: true },
      ],
    });

    await coach({ storage: fakeStorage, provider: fakeProvider }, input);

    expect(fakeStorage.weaknessUpdateCalled).toBe(true);
    const entries = fakeStorage.weaknessRegister.entries;

    // Existing weakness should be incremented
    const graphsEntry = entries.find((e) => e.topicId === 'graphs');
    expect(graphsEntry?.occurrences).toBe(3);
    expect(graphsEntry?.note).toBe('Still struggling with BFS');

    // New weakness should be added
    const newEntry = entries.find((e) => e.topicId === 'new-weakness');
    expect(newEntry?.occurrences).toBe(1);
    expect(newEntry?.note).toBe('First time failing this');

    // Success topic should NOT be in weakness register
    const successEntry = entries.find((e) => e.topicId === 'success-topic');
    expect(successEntry).toBeUndefined();
  });

  it('records ALL writes (summary, competency, weakness)', async () => {
    const input = createInput();

    await coach({ storage: fakeStorage, provider: fakeProvider }, input);

    expect(fakeStorage.summaryWriteCalled).toBe(true);
    expect(fakeStorage.competencyUpdateCalled).toBe(true);
    expect(fakeStorage.weaknessUpdateCalled).toBe(true);
  });

  it('returns the raw request for observability', async () => {
    const input = createInput();

    const result = await coach(
      { storage: fakeStorage, provider: fakeProvider },
      input,
    );

    expect(result.request).toBeDefined();
    expect(result.request.messages.length).toBeGreaterThan(0);
  });

  it('handles empty plan and outcomes without crashing', async () => {
    const input = createInput({
      plan: createPlan([]),
      outcomes: [],
    });

    const result = await coach(
      { storage: fakeStorage, provider: fakeProvider },
      input,
    );

    expect(result.summary.topics).toEqual([]);
    expect(result.summary.strengths).toEqual([]);
    expect(result.summary.weaknesses).toEqual([]);
    expect(fakeStorage.summaryWriteCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: provider error path
// ---------------------------------------------------------------------------

describe('coach - provider error handling', () => {
  it('rejects when provider rejects', async () => {
    const fakeStorage = new FakeStorage();
    const fakeProvider = new FakeProvider();
    fakeProvider.shouldReject = true;
    fakeProvider.rejectError = new Error('Model unavailable');

    const input = createInput();

    await expect(
      coach({ storage: fakeStorage, provider: fakeProvider }, input),
    ).rejects.toThrow('Model unavailable');

    // No writes should have happened
    expect(fakeStorage.summaryWriteCalled).toBe(false);
    expect(fakeStorage.competencyUpdateCalled).toBe(false);
    expect(fakeStorage.weaknessUpdateCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: untrusted output guard
// ---------------------------------------------------------------------------

describe('coach - untrusted output guard', () => {
  it('handles empty content from provider', async () => {
    const fakeStorage = new FakeStorage();
    const fakeProvider = new FakeProvider();
    fakeProvider.response = { content: '' };

    const input = createInput();

    const result = await coach(
      { storage: fakeStorage, provider: fakeProvider },
      input,
    );

    expect(result.summary.narrative).toBe('');
  });

  it('handles whitespace-only content from provider', async () => {
    const fakeStorage = new FakeStorage();
    const fakeProvider = new FakeProvider();
    fakeProvider.response = { content: '   \n\t  ' };

    const input = createInput();

    const result = await coach(
      { storage: fakeStorage, provider: fakeProvider },
      input,
    );

    expect(result.summary.narrative).toBe('');
  });

  it('trims valid content from provider', async () => {
    const fakeStorage = new FakeStorage();
    const fakeProvider = new FakeProvider();
    fakeProvider.response = { content: '  Good session!  \n' };

    const input = createInput();

    const result = await coach(
      { storage: fakeStorage, provider: fakeProvider },
      input,
    );

    expect(result.summary.narrative).toBe('Good session!');
  });
});
