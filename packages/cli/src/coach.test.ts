/**
 * Tests for the coach command wiring in the CLI.
 *
 * Uses recording fake storage and fake LLM provider.
 * NO real fs, NO network, NO live Ollama.
 */

import { describe, it, expect } from 'vitest';
import { run } from './cli.js';
import { formatCoach } from './format.js';
import { parseOutcomes } from './config.js';
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
// Fake LLM Provider
// ---------------------------------------------------------------------------

function createFakeProvider(
  content: string = 'Test narrative from coach.',
): LlmProvider {
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
  it('runs full assess->plan->coach loop and captures write-back', async () => {
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
    const provider = createFakeProvider(
      'Great session! You showed strong problem-solving.',
    );

    const result = await run(
      [
        'coach',
        '--model',
        'test-model',
        '--outcome',
        'graphs:pass',
        '--outcome',
        'trees:fail:struggled with traversal',
      ],
      { storage, provider },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('=== Coaching Session ===');
    expect(result.output).toContain(
      'Great session! You showed strong problem-solving.',
    );
    expect(result.output).toContain('Saved session summary');

    // Verify write-back calls
    expect(storage.recorded.writeSessionSummary.length).toBe(1);
    expect(storage.recorded.updateCompetencyMap.length).toBe(1);
    expect(storage.recorded.updateWeaknessRegister.length).toBe(1);

    // Verify summary content
    const summary = storage.recorded.writeSessionSummary[0];
    expect(summary.narrative).toBe(
      'Great session! You showed strong problem-solving.',
    );
    expect(summary.strengths).toContain('graphs');
    expect(summary.weaknesses).toContain('trees');
  });

  it('returns exitCode 1 on provider error', async () => {
    const storage = createRecordingFakeStorage();
    const provider = createFailingProvider('Model not found');

    const result = await run(['coach', '--model', 'bad-model'], {
      storage,
      provider,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Error:');
    expect(result.output).toContain('Model not found');
  });

  it('shows friendly message on ECONNREFUSED', async () => {
    const storage = createRecordingFakeStorage();
    const provider = createFailingProvider(
      'connect ECONNREFUSED 127.0.0.1:11434',
    );

    const result = await run(['coach', '--model', 'test'], {
      storage,
      provider,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('could not reach the LLM');
    expect(result.output).toContain('Is Ollama running?');
  });

  it('shows friendly message on fetch failed', async () => {
    const storage = createRecordingFakeStorage();
    const provider = createFailingProvider('fetch failed');

    const result = await run(['coach', '--model', 'test'], {
      storage,
      provider,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('could not reach the LLM');
  });

  it('handles empty/new-user case (no outcomes)', async () => {
    const storage = createRecordingFakeStorage();
    const provider = createFakeProvider('Welcome to your first session!');

    const result = await run(['coach', '--model', 'test-model'], {
      storage,
      provider,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('=== Coaching Session ===');
    expect(result.output).toContain('Welcome to your first session!');

    // Write-back still happens
    expect(storage.recorded.writeSessionSummary.length).toBe(1);
    expect(storage.recorded.updateCompetencyMap.length).toBe(1);
    expect(storage.recorded.updateWeaknessRegister.length).toBe(1);
  });

  it('errors when --model is missing and no env var', async () => {
    const storage = createRecordingFakeStorage();

    const result = await run(['coach'], { storage, env: {} });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(
      '--model (or IBAI_OLLAMA_MODEL) is required',
    );
  });

  it('uses IBAI_OLLAMA_MODEL env var when --model not provided', async () => {
    const storage = createRecordingFakeStorage();
    const provider = createFakeProvider('Using env model.');

    // With injected provider, model is not needed (provider is already configured)
    const result = await run(['coach'], {
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
    };

    const output = formatCoach(sessionId, plan, result);

    expect(output).toContain('=== Coaching Session ===');
    expect(output).toContain('Session ID: test-session-123');
    expect(output).toContain('Topics covered: 2');
    expect(output).toContain(
      'Plan summary: Focus on graphs, warm up with arrays.',
    );
    expect(output).toContain('Session Recap:');
    expect(output).toContain(
      'Excellent work on arrays! Graphs need more practice.',
    );
    expect(output).toContain('Saved session summary');
    expect(output).toContain('Competency entries: 2');
    expect(output).toContain('Weakness entries: 1');
  });

  it('handles empty narrative', () => {
    const sessionId = 'empty-narrative';
    const plan: SessionPlan = { topics: [], summary: 'Empty plan' };
    const result: CoachResult = {
      summary: {
        sessionId: sessionId as SessionId,
        completedAt: '2026-09-10T12:00:00.000Z' as IsoTimestamp,
        topics: [],
        narrative: '',
        strengths: [],
        weaknesses: [],
      },
      competencyMap: { entries: {} },
      weaknessRegister: { entries: [] },
      request: { messages: [] },
    };

    const output = formatCoach(sessionId, plan, result);

    expect(output).toContain('(No narrative generated)');
    expect(output).toContain('Competency entries: 0');
    expect(output).toContain('Weakness entries: 0');
  });
});

// ---------------------------------------------------------------------------
// parseOutcomes Tests
// ---------------------------------------------------------------------------

describe('parseOutcomes', () => {
  it('parses valid pass outcome', () => {
    const outcomes = parseOutcomes(['graphs:pass']);
    expect(outcomes).toEqual([{ topicId: 'graphs', succeeded: true }]);
  });

  it('parses valid fail outcome', () => {
    const outcomes = parseOutcomes(['trees:fail']);
    expect(outcomes).toEqual([{ topicId: 'trees', succeeded: false }]);
  });

  it('parses outcome with note', () => {
    const outcomes = parseOutcomes(['dp:fail:struggled with memoization']);
    expect(outcomes).toEqual([
      { topicId: 'dp', succeeded: false, note: 'struggled with memoization' },
    ]);
  });

  it('handles note containing colons', () => {
    const outcomes = parseOutcomes(['api:fail:error at 10:30:45']);
    expect(outcomes).toEqual([
      { topicId: 'api', succeeded: false, note: 'error at 10:30:45' },
    ]);
  });

  it('parses multiple outcomes', () => {
    const outcomes = parseOutcomes([
      'graphs:pass',
      'trees:fail:traversal issues',
    ]);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toEqual({ topicId: 'graphs', succeeded: true });
    expect(outcomes[1]).toEqual({
      topicId: 'trees',
      succeeded: false,
      note: 'traversal issues',
    });
  });

  it('returns empty array for undefined input', () => {
    const outcomes = parseOutcomes(undefined);
    expect(outcomes).toEqual([]);
  });

  it('returns empty array for empty array input', () => {
    const outcomes = parseOutcomes([]);
    expect(outcomes).toEqual([]);
  });

  it('throws on invalid format (missing result)', () => {
    expect(() => parseOutcomes(['graphs'])).toThrow(
      "invalid --outcome 'graphs'; expected topicId:pass|fail[:note]",
    );
  });

  it('throws on invalid result value', () => {
    expect(() => parseOutcomes(['graphs:yes'])).toThrow(
      "invalid --outcome 'graphs:yes'; expected topicId:pass|fail[:note]",
    );
  });

  it('throws on p/f shortcuts (strict mode)', () => {
    expect(() => parseOutcomes(['graphs:p'])).toThrow(
      "invalid --outcome 'graphs:p'; expected topicId:pass|fail[:note]",
    );
  });
});
