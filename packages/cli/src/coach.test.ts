/**
 * Tests for the coach command wiring in the CLI.
 *
 * Uses recording fake storage and fake LLM provider.
 * NO real fs, NO network, NO live Ollama.
 *
 * Updated for AI-evaluation contract (ADR 0005 D6):
 * - Uses --answer flags instead of --outcome
 * - Provider must return well-formed JSON evaluation
 */

import { describe, it, expect } from 'vitest';
import { run } from './cli.js';
import { formatCoach } from './format.js';
import type {
  StorageAdapter,
  SessionId,
  IsoTimestamp,
  SessionSummary,
  CompetencyMap,
  WeaknessRegister,
  SessionContext,
} from '@ibai/storage';
import type {
  LlmProvider,
  CompletionRequest,
  CompletionResponse,
} from '@ibai/providers';
import type { CoachResult, SessionPlan } from '@ibai/core';

// ---------------------------------------------------------------------------
// Recording Fake Storage
// ---------------------------------------------------------------------------

interface RecordedCalls {
  writeSessionSummary: SessionSummary[];
  updateCompetencyMap: CompetencyMap[];
  updateWeaknessRegister: WeaknessRegister[];
}

function createRecordingFakeStorage(initialData?: {
  competencyMap?: CompetencyMap;
  weaknessRegister?: WeaknessRegister;
}): StorageAdapter & { recorded: RecordedCalls } {
  const recorded: RecordedCalls = {
    writeSessionSummary: [],
    updateCompetencyMap: [],
    updateWeaknessRegister: [],
  };

  let storedCompetencyMap: CompetencyMap = initialData?.competencyMap ?? {
    entries: {},
  };
  let storedWeaknessRegister: WeaknessRegister =
    initialData?.weaknessRegister ?? { entries: [] };

  return {
    recorded,
    async readSessionContext(_sessionId: SessionId): Promise<SessionContext> {
      return { sessionId: _sessionId, history: [] };
    },
    async writeSessionSummary(summary: SessionSummary): Promise<void> {
      recorded.writeSessionSummary.push(summary);
    },
    async readCompetencyMap(): Promise<CompetencyMap> {
      return storedCompetencyMap;
    },
    async updateCompetencyMap(map: CompetencyMap): Promise<void> {
      recorded.updateCompetencyMap.push(map);
      storedCompetencyMap = map;
    },
    async readWeaknessRegister(): Promise<WeaknessRegister> {
      return storedWeaknessRegister;
    },
    async updateWeaknessRegister(register: WeaknessRegister): Promise<void> {
      recorded.updateWeaknessRegister.push(register);
      storedWeaknessRegister = register;
    },
  };
}

// ---------------------------------------------------------------------------
// Fake LLM Provider (returns well-formed AI-evaluation JSON)
// ---------------------------------------------------------------------------

/**
 * Create a fake provider that returns well-formed evaluation JSON.
 * The topicIds parameter specifies which topics to include in the evaluation.
 */
function createFakeProvider(
  narrative: string,
  evaluations: Array<{ topicId: string; succeeded: boolean; feedback: string }>,
): LlmProvider {
  const json = JSON.stringify({ narrative, evaluations });
  const content = `Here is my evaluation:\n\n\`\`\`json\n${json}\n\`\`\``;
  return {
    async complete(_request: CompletionRequest): Promise<CompletionResponse> {
      return { content };
    },
  };
}

function createFailingProvider(errorMessage: string): LlmProvider {
  return {
    async complete(_request: CompletionRequest): Promise<CompletionResponse> {
      throw new Error(errorMessage);
    },
  };
}

// ---------------------------------------------------------------------------
// Coach Command Tests
// ---------------------------------------------------------------------------

describe('coach command', () => {
  it('runs coach with --answer flags and captures write-back from model verdicts', async () => {
    const storage = createRecordingFakeStorage({
      competencyMap: {
        entries: {
          graphs: {
            topicId: 'graphs',
            proficiency: 0.3,
            lastUpdated: '2026-09-01T00:00:00.000Z' as IsoTimestamp,
          },
        },
      },
    });

    // Provider returns evaluation for 'graphs' topic (which the plan will generate)
    const provider = createFakeProvider(
      'Great session! You showed strong problem-solving on graphs.',
      [
        {
          topicId: 'graphs',
          succeeded: true,
          feedback: 'Excellent BFS explanation',
        },
      ],
    );

    const result = await run(
      [
        'coach',
        '--model',
        'test-model',
        '--answer',
        'I would use BFS for shortest path',
      ],
      { storage, provider },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('=== Coaching Session ===');
    expect(result.output).toContain(
      'Great session! You showed strong problem-solving on graphs.',
    );
    expect(result.output).toContain('Saved session summary');

    // Verify write-back calls
    expect(storage.recorded.writeSessionSummary.length).toBe(1);
    expect(storage.recorded.updateCompetencyMap.length).toBe(1);
    expect(storage.recorded.updateWeaknessRegister.length).toBe(1);

    // Verify summary content derived from model verdicts
    const summary = storage.recorded.writeSessionSummary[0];
    expect(summary?.narrative).toBe(
      'Great session! You showed strong problem-solving on graphs.',
    );
    expect(summary?.strengths).toContain('graphs');
  });

  it('returns error when no --answer flags provided', async () => {
    const storage = createRecordingFakeStorage({
      competencyMap: {
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.5,
            lastUpdated: '2026-09-01T00:00:00.000Z' as IsoTimestamp,
          },
        },
      },
    });
    const provider = createFakeProvider('Test', [
      { topicId: 'arrays', succeeded: true, feedback: 'Good' },
    ]);

    const result = await run(['coach', '--model', 'test-model'], {
      storage,
      provider,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('--answer');
  });

  it('returns exitCode 1 on provider error', async () => {
    const storage = createRecordingFakeStorage({
      competencyMap: {
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.5,
            lastUpdated: '2026-09-01T00:00:00.000Z' as IsoTimestamp,
          },
        },
      },
    });
    const provider = createFailingProvider('Model not found');

    const result = await run(
      ['coach', '--model', 'bad-model', '--answer', 'my answer'],
      {
        storage,
        provider,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Error:');
  });

  it('shows friendly message on ECONNREFUSED', async () => {
    const storage = createRecordingFakeStorage({
      competencyMap: {
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.5,
            lastUpdated: '2026-09-01T00:00:00.000Z' as IsoTimestamp,
          },
        },
      },
    });
    const provider = createFailingProvider(
      'connect ECONNREFUSED 127.0.0.1:11434',
    );

    const result = await run(
      ['coach', '--model', 'test', '--answer', 'my answer'],
      {
        storage,
        provider,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('could not reach the LLM');
    expect(result.output).toContain('Is Ollama running?');
  });

  it('shows friendly message on fetch failed', async () => {
    const storage = createRecordingFakeStorage({
      competencyMap: {
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.5,
            lastUpdated: '2026-09-01T00:00:00.000Z' as IsoTimestamp,
          },
        },
      },
    });
    const provider = createFailingProvider('fetch failed');

    const result = await run(
      ['coach', '--model', 'test', '--answer', 'my answer'],
      {
        storage,
        provider,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('could not reach the LLM');
  });

  it('errors when --model is missing and no env var', async () => {
    const storage = createRecordingFakeStorage();

    const result = await run(['coach', '--answer', 'my answer'], {
      storage,
      env: {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Configure a model');
  });

  it('uses IBAI_OLLAMA_MODEL env var when --model not provided', async () => {
    const storage = createRecordingFakeStorage({
      competencyMap: {
        entries: {
          arrays: {
            topicId: 'arrays',
            proficiency: 0.5,
            lastUpdated: '2026-09-01T00:00:00.000Z' as IsoTimestamp,
          },
        },
      },
    });
    const provider = createFakeProvider('Using env model.', [
      { topicId: 'arrays', succeeded: true, feedback: 'Good' },
    ]);

    // With injected provider, model is not needed (provider is already configured)
    const result = await run(['coach', '--answer', 'my answer'], {
      storage,
      provider,
      env: { IBAI_OLLAMA_MODEL: 'env-model' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('=== Coaching Session ===');
  });
});

// ---------------------------------------------------------------------------
// formatCoach Tests
// ---------------------------------------------------------------------------

describe('formatCoach', () => {
  it('formats CoachResult with all sections', () => {
    const sessionId = 'test-session-123';
    const plan: SessionPlan = {
      topics: [
        {
          topicId: 'graphs',
          role: 'focus',
          proficiency: 0.3,
          rationale: 'needs work',
        },
        {
          topicId: 'arrays',
          role: 'warmup',
          proficiency: 0.9,
          rationale: 'strong',
        },
      ],
      summary: 'Focus on graphs, warm up with arrays.',
    };
    const result: CoachResult = {
      summary: {
        sessionId: sessionId as SessionId,
        completedAt: '2026-09-10T12:00:00.000Z' as IsoTimestamp,
        topics: ['graphs', 'arrays'],
        narrative: 'Excellent work on arrays! Graphs need more practice.',
        strengths: ['arrays'],
        weaknesses: ['graphs'],
      },
      competencyMap: {
        entries: {
          graphs: {
            topicId: 'graphs',
            proficiency: 0.2,
            lastUpdated: '2026-09-10T12:00:00.000Z' as IsoTimestamp,
          },
          arrays: {
            topicId: 'arrays',
            proficiency: 1.0,
            lastUpdated: '2026-09-10T12:00:00.000Z' as IsoTimestamp,
          },
        },
      },
      weaknessRegister: {
        entries: [
          {
            topicId: 'graphs',
            note: 'BFS confusion',
            occurrences: 2,
            lastObserved: '2026-09-10T12:00:00.000Z' as IsoTimestamp,
          },
        ],
      },
      request: { messages: [] },
      evaluations: [
        { topicId: 'arrays', succeeded: true, feedback: 'Great work' },
        { topicId: 'graphs', succeeded: false, feedback: 'Needs practice' },
      ],
    };

    const output = formatCoach(sessionId, plan, result);

    expect(output).toContain('=== Coaching Session ===');
    expect(output).toContain('Session ID: test-session-123');
    expect(output).toContain('Topics covered: 2');
    expect(output).toContain('Excellent work on arrays!');
    expect(output).toContain('Competency entries: 2');
    expect(output).toContain('Weakness entries: 1');
  });

  it('handles empty narrative gracefully', () => {
    const result: CoachResult = {
      summary: {
        sessionId: 'test' as SessionId,
        completedAt: '2026-09-10T12:00:00.000Z' as IsoTimestamp,
        topics: [],
        narrative: '',
        strengths: [],
        weaknesses: [],
      },
      competencyMap: { entries: {} },
      weaknessRegister: { entries: [] },
      request: { messages: [] },
      evaluations: [],
    };
    const plan: SessionPlan = { topics: [], summary: 'Empty session' };

    const output = formatCoach('test', plan, result);

    expect(output).toContain('(No narrative generated)');
  });
});
