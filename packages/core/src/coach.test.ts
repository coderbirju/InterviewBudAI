/**
 * @ibai/core — Coach engine job tests.
 *
 * Tests use in-memory fake implementations of StorageAdapter and LlmProvider
 * via their INTERFACE TYPES. No real filesystem, no network.
 *
 * Tests the new AI-evaluation contract (ADR 0005 D6):
 * - Model evaluates candidate answers and returns structured verdicts
 * - Parse model output as UNTRUSTED with strict validation
 * - FAIL CLOSED on malformed output (no storage writes)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildCoachPrompt, coach } from './coach.js';
import type { CoachInput, TopicAnswer } from './coach.js';
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

  resetWriteFlags(): void {
    this.summaryWriteCalled = false;
    this.competencyUpdateCalled = false;
    this.weaknessUpdateCalled = false;
  }
}

// ---------------------------------------------------------------------------
// Fake LlmProvider
// ---------------------------------------------------------------------------

class FakeProvider implements LlmProvider {
  public response: CompletionResponse = {
    content: '',
  };
  public shouldReject = false;
  public rejectError = new Error('Provider error');

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    if (this.shouldReject) {
      throw this.rejectError;
    }
    return this.response;
  }

  /** Helper to set a well-formed JSON response */
  setWellFormedResponse(
    narrative: string,
    evaluations: Array<{
      topicId: string;
      succeeded: boolean;
      feedback: string;
    }>,
  ): void {
    const json = JSON.stringify({ narrative, evaluations });
    this.response = {
      content: `Here is my evaluation of the candidate's answers.\n\n\`\`\`json\n${json}\n\`\`\``,
    };
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
  const defaultAnswers: TopicAnswer[] = [
    { topicId: 'arrays', answer: 'I would use a hash map for O(1) lookup.' },
    { topicId: 'graphs', answer: 'I think BFS is the right approach here.' },
    { topicId: 'dynamic-programming', answer: 'We can use memoization.' },
    { topicId: 'system-design', answer: 'I would start with a load balancer.' },
  ];

  return {
    sessionId: 'test-session-123',
    plan: createPlan([
      createPlanTopic('arrays', 'warmup', 0.8),
      createPlanTopic('graphs', 'focus', 0.3),
      createPlanTopic('dynamic-programming', 'focus', 0.4),
      createPlanTopic('system-design', 'twist', 0.2),
    ]),
    answers: defaultAnswers,
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
    const answers: TopicAnswer[] = [
      { topicId: 'arrays', answer: 'My answer' },
      { topicId: 'graphs', answer: 'My answer' },
      { topicId: 'dp', answer: 'My answer' },
    ];

    const request = buildCoachPrompt(plan, answers);

    expect(request.messages.length).toBeGreaterThanOrEqual(1);
    const systemMsg = request.messages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg?.content).toContain('interview coach');
  });

  it('system message instructs eliciting user intuition and forbids giving answers', () => {
    const plan = createPlan([createPlanTopic('trees', 'focus')]);
    const answers: TopicAnswer[] = [{ topicId: 'trees', answer: 'My answer' }];

    const request = buildCoachPrompt(plan, answers);

    const systemMsg = request.messages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('ELICIT');
    expect(systemMsg?.content).toContain('NEVER provide solutions');
    expect(systemMsg?.content).toContain('NEVER');
  });

  it('includes candidate answers in the user message', () => {
    const plan = createPlan([createPlanTopic('linked-lists', 'focus', 0.35)]);
    const answers: TopicAnswer[] = [
      {
        topicId: 'linked-lists',
        question: 'Reverse a linked list',
        answer: 'Use two pointers',
      },
    ];

    const request = buildCoachPrompt(plan, answers);

    const userMsg = request.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('CANDIDATE ANSWERS');
    expect(userMsg?.content).toContain('linked-lists');
    expect(userMsg?.content).toContain('Use two pointers');
    expect(userMsg?.content).toContain('Reverse a linked list');
  });

  it('includes JSON output instruction', () => {
    const plan = createPlan([createPlanTopic('arrays', 'warmup')]);
    const answers: TopicAnswer[] = [{ topicId: 'arrays', answer: 'My answer' }];

    const request = buildCoachPrompt(plan, answers);

    const userMsg = request.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('json');
    expect(userMsg?.content).toContain('narrative');
    expect(userMsg?.content).toContain('evaluations');
  });

  it('includes plan.summary in the request', () => {
    const plan: SessionPlan = {
      topics: [createPlanTopic('sorting', 'focus')],
      summary: 'Focus on sorting algorithms today.',
    };
    const answers: TopicAnswer[] = [
      { topicId: 'sorting', answer: 'My answer' },
    ];

    const request = buildCoachPrompt(plan, answers);

    const userMsg = request.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('Focus on sorting algorithms today.');
  });

  it('does NOT contain fabricated answers or solutions', () => {
    const plan = createPlan([
      createPlanTopic('binary-search', 'focus'),
      createPlanTopic('heap', 'twist'),
    ]);
    const answers: TopicAnswer[] = [
      { topicId: 'binary-search', answer: 'My answer' },
      { topicId: 'heap', answer: 'My answer' },
    ];

    const request = buildCoachPrompt(plan, answers);

    for (const msg of request.messages) {
      expect(msg.content.toLowerCase()).not.toContain('the answer is');
      expect(msg.content.toLowerCase()).not.toContain('solution:');
      expect(msg.content.toLowerCase()).not.toContain('here is how to solve');
    }
  });

  it('handles empty plan (no topics) gracefully', () => {
    const plan = createPlan([]);
    const answers: TopicAnswer[] = [];

    const request = buildCoachPrompt(plan, answers);

    expect(request.messages.length).toBeGreaterThanOrEqual(1);
    const systemMsg = request.messages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
  });

  it('includes assessment context when provided', () => {
    const plan = createPlan([createPlanTopic('recursion', 'focus')]);
    const answers: TopicAnswer[] = [
      { topicId: 'recursion', answer: 'My answer' },
    ];
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

    const request = buildCoachPrompt(plan, answers, { assessment });

    const userMsg = request.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('recursion');
    expect(userMsg?.content).toContain('dp');
  });
});

// ---------------------------------------------------------------------------
// Tests: coach (AI-evaluation with model verdicts)
// ---------------------------------------------------------------------------

describe('coach', () => {
  let fakeStorage: FakeStorage;
  let fakeProvider: FakeProvider;

  beforeEach(() => {
    fakeStorage = new FakeStorage();
    fakeProvider = new FakeProvider();
  });

  describe('well-formed model output', () => {
    it('parses fenced JSON and derives summary from model verdicts', async () => {
      fakeProvider.setWellFormedResponse(
        'Great session! The candidate showed solid understanding.',
        [
          {
            topicId: 'arrays',
            succeeded: true,
            feedback: 'Excellent hash map usage',
          },
          {
            topicId: 'graphs',
            succeeded: false,
            feedback: 'Struggled with BFS traversal',
          },
          {
            topicId: 'dynamic-programming',
            succeeded: true,
            feedback: 'Good memoization approach',
          },
          {
            topicId: 'system-design',
            succeeded: false,
            feedback: 'Needs more practice',
          },
        ],
      );

      const input = createInput();
      const result = await coach(
        { storage: fakeStorage, provider: fakeProvider },
        input,
      );

      expect(fakeStorage.summaryWriteCalled).toBe(true);
      expect(fakeStorage.lastSummary?.sessionId).toBe('test-session-123');
      expect(fakeStorage.lastSummary?.narrative).toBe(
        'Great session! The candidate showed solid understanding.',
      );
      expect(fakeStorage.lastSummary?.strengths).toContain('arrays');
      expect(fakeStorage.lastSummary?.strengths).toContain(
        'dynamic-programming',
      );
      expect(fakeStorage.lastSummary?.weaknesses).toContain('graphs');
      expect(fakeStorage.lastSummary?.weaknesses).toContain('system-design');

      expect(result.evaluations).toHaveLength(4);
      expect(
        result.evaluations.find((e) => e.topicId === 'arrays')?.succeeded,
      ).toBe(true);
      expect(
        result.evaluations.find((e) => e.topicId === 'graphs')?.succeeded,
      ).toBe(false);
    });

    it('updates competency map from model verdicts (+/-0.1 clamped)', async () => {
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
        },
      };

      fakeProvider.setWellFormedResponse('Good session', [
        { topicId: 'arrays', succeeded: true, feedback: 'Great' },
        { topicId: 'graphs', succeeded: false, feedback: 'Needs work' },
      ]);

      const input = createInput({
        plan: createPlan([
          createPlanTopic('arrays', 'warmup', 0.7),
          createPlanTopic('graphs', 'focus', 0.4),
        ]),
        answers: [
          { topicId: 'arrays', answer: 'My answer' },
          { topicId: 'graphs', answer: 'My answer' },
        ],
      });

      await coach({ storage: fakeStorage, provider: fakeProvider }, input);

      expect(fakeStorage.competencyUpdateCalled).toBe(true);
      expect(
        fakeStorage.competencyMap.entries['arrays']?.proficiency,
      ).toBeCloseTo(0.8, 5);
      expect(
        fakeStorage.competencyMap.entries['graphs']?.proficiency,
      ).toBeCloseTo(0.3, 5);
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

      fakeProvider.setWellFormedResponse('Session complete', [
        { topicId: 'high-topic', succeeded: true, feedback: 'Excellent' },
        { topicId: 'low-topic', succeeded: false, feedback: 'Struggling' },
      ]);

      const input = createInput({
        plan: createPlan([
          createPlanTopic('high-topic', 'warmup'),
          createPlanTopic('low-topic', 'focus'),
        ]),
        answers: [
          { topicId: 'high-topic', answer: 'My answer' },
          { topicId: 'low-topic', answer: 'My answer' },
        ],
      });

      await coach({ storage: fakeStorage, provider: fakeProvider }, input);

      expect(fakeStorage.competencyMap.entries['high-topic']?.proficiency).toBe(
        1.0,
      );
      expect(fakeStorage.competencyMap.entries['low-topic']?.proficiency).toBe(
        0.0,
      );
    });

    it('updates weakness register from model feedback', async () => {
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

      fakeProvider.setWellFormedResponse('Session feedback', [
        {
          topicId: 'graphs',
          succeeded: false,
          feedback: 'Still struggling with BFS',
        },
        {
          topicId: 'new-weakness',
          succeeded: false,
          feedback: 'First time failing this',
        },
        { topicId: 'success-topic', succeeded: true, feedback: 'Great work' },
      ]);

      const input = createInput({
        plan: createPlan([
          createPlanTopic('graphs', 'focus'),
          createPlanTopic('new-weakness', 'focus'),
          createPlanTopic('success-topic', 'warmup'),
        ]),
        answers: [
          { topicId: 'graphs', answer: 'My answer' },
          { topicId: 'new-weakness', answer: 'My answer' },
          { topicId: 'success-topic', answer: 'My answer' },
        ],
      });

      await coach({ storage: fakeStorage, provider: fakeProvider }, input);

      expect(fakeStorage.weaknessUpdateCalled).toBe(true);
      const entries = fakeStorage.weaknessRegister.entries;

      const graphsEntry = entries.find((e) => e.topicId === 'graphs');
      expect(graphsEntry?.occurrences).toBe(3);
      expect(graphsEntry?.note).toBe('Still struggling with BFS');

      const newEntry = entries.find((e) => e.topicId === 'new-weakness');
      expect(newEntry?.occurrences).toBe(1);
      expect(newEntry?.note).toBe('First time failing this');

      const successEntry = entries.find((e) => e.topicId === 'success-topic');
      expect(successEntry).toBeUndefined();
    });

    it('parses JSON from prose + trailing fenced block', async () => {
      fakeProvider.response = {
        content:
          'Let me evaluate the candidate\'s performance.\n\nThe candidate showed varying levels.\n\n```json\n{"narrative": "Mixed performance overall", "evaluations": [{ "topicId": "arrays", "succeeded": true, "feedback": "Good" }]}\n```',
      };

      const input = createInput({
        plan: createPlan([createPlanTopic('arrays', 'warmup')]),
        answers: [{ topicId: 'arrays', answer: 'My answer' }],
      });

      const result = await coach(
        { storage: fakeStorage, provider: fakeProvider },
        input,
      );

      expect(result.summary.narrative).toBe('Mixed performance overall');
      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0]?.succeeded).toBe(true);
    });

    it('falls back to bare JSON object when no fenced block', async () => {
      fakeProvider.response = {
        content:
          'Some prose here {"narrative": "Bare JSON test", "evaluations": [{"topicId": "arrays", "succeeded": true, "feedback": "OK"}]} more prose',
      };

      const input = createInput({
        plan: createPlan([createPlanTopic('arrays', 'warmup')]),
        answers: [{ topicId: 'arrays', answer: 'My answer' }],
      });

      const result = await coach(
        { storage: fakeStorage, provider: fakeProvider },
        input,
      );

      expect(result.summary.narrative).toBe('Bare JSON test');
    });
  });

  describe('malformed model output - FAIL CLOSED', () => {
    it('rejects when no JSON found in response', async () => {
      fakeProvider.response = {
        content: 'This response has no JSON at all, just plain text.',
      };

      const input = createInput();

      await expect(
        coach({ storage: fakeStorage, provider: fakeProvider }, input),
      ).rejects.toThrow('no JSON found');

      expect(fakeStorage.summaryWriteCalled).toBe(false);
      expect(fakeStorage.competencyUpdateCalled).toBe(false);
      expect(fakeStorage.weaknessUpdateCalled).toBe(false);
    });

    it('rejects when JSON is invalid', async () => {
      fakeProvider.response = {
        content: '```json\n{ invalid json here }\n```',
      };

      const input = createInput();

      await expect(
        coach({ storage: fakeStorage, provider: fakeProvider }, input),
      ).rejects.toThrow('invalid JSON');

      expect(fakeStorage.summaryWriteCalled).toBe(false);
    });

    it('rejects when narrative field is missing', async () => {
      fakeProvider.response = {
        content: '```json\n{"evaluations": []}\n```',
      };

      const input = createInput({
        plan: createPlan([]),
        answers: [],
      });

      await expect(
        coach({ storage: fakeStorage, provider: fakeProvider }, input),
      ).rejects.toThrow('narrative');

      expect(fakeStorage.summaryWriteCalled).toBe(false);
    });

    it('rejects when evaluations array is missing', async () => {
      fakeProvider.response = {
        content: '```json\n{"narrative": "test"}\n```',
      };

      const input = createInput({
        plan: createPlan([]),
        answers: [],
      });

      await expect(
        coach({ storage: fakeStorage, provider: fakeProvider }, input),
      ).rejects.toThrow('evaluations');

      expect(fakeStorage.summaryWriteCalled).toBe(false);
    });

    it('rejects when succeeded is not a boolean', async () => {
      fakeProvider.response = {
        content:
          '```json\n{"narrative": "test", "evaluations": [{"topicId": "arrays", "succeeded": "yes", "feedback": "ok"}]}\n```',
      };

      const input = createInput({
        plan: createPlan([createPlanTopic('arrays', 'warmup')]),
        answers: [{ topicId: 'arrays', answer: 'My answer' }],
      });

      await expect(
        coach({ storage: fakeStorage, provider: fakeProvider }, input),
      ).rejects.toThrow('boolean');

      expect(fakeStorage.summaryWriteCalled).toBe(false);
    });

    it('rejects when a plan topic is missing from evaluations', async () => {
      fakeProvider.response = {
        content:
          '```json\n{"narrative": "test", "evaluations": [{"topicId": "arrays", "succeeded": true, "feedback": "ok"}]}\n```',
      };

      const input = createInput({
        plan: createPlan([
          createPlanTopic('arrays', 'warmup'),
          createPlanTopic('graphs', 'focus'),
        ]),
        answers: [
          { topicId: 'arrays', answer: 'My answer' },
          { topicId: 'graphs', answer: 'My answer' },
        ],
      });

      await expect(
        coach({ storage: fakeStorage, provider: fakeProvider }, input),
      ).rejects.toThrow('missing required topicId');

      expect(fakeStorage.summaryWriteCalled).toBe(false);
    });

    it('rejects when evaluation references unknown topic', async () => {
      fakeProvider.response = {
        content:
          '```json\n{"narrative": "test", "evaluations": [{"topicId": "arrays", "succeeded": true, "feedback": "ok"}, {"topicId": "unknown-topic", "succeeded": true, "feedback": "ok"}]}\n```',
      };

      const input = createInput({
        plan: createPlan([createPlanTopic('arrays', 'warmup')]),
        answers: [{ topicId: 'arrays', answer: 'My answer' }],
      });

      await expect(
        coach({ storage: fakeStorage, provider: fakeProvider }, input),
      ).rejects.toThrow('unknown topicId');

      expect(fakeStorage.summaryWriteCalled).toBe(false);
    });
  });

  describe('provider error handling', () => {
    it('propagates provider error without storage writes', async () => {
      fakeProvider.shouldReject = true;
      fakeProvider.rejectError = new Error('Connection refused');

      const input = createInput();

      await expect(
        coach({ storage: fakeStorage, provider: fakeProvider }, input),
      ).rejects.toThrow('Connection refused');

      expect(fakeStorage.summaryWriteCalled).toBe(false);
      expect(fakeStorage.competencyUpdateCalled).toBe(false);
      expect(fakeStorage.weaknessUpdateCalled).toBe(false);
    });
  });

  describe('result structure', () => {
    it('returns request, evaluations, and all derived data', async () => {
      fakeProvider.setWellFormedResponse('Test narrative', [
        { topicId: 'arrays', succeeded: true, feedback: 'Good' },
      ]);

      const input = createInput({
        plan: createPlan([createPlanTopic('arrays', 'warmup')]),
        answers: [{ topicId: 'arrays', answer: 'My answer' }],
      });

      const result = await coach(
        { storage: fakeStorage, provider: fakeProvider },
        input,
      );

      expect(result.request).toBeDefined();
      expect(result.request.messages.length).toBeGreaterThan(0);
      expect(result.evaluations).toHaveLength(1);
      expect(result.summary).toBeDefined();
      expect(result.competencyMap).toBeDefined();
      expect(result.weaknessRegister).toBeDefined();
    });
  });
});
