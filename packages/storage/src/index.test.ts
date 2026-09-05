import { describe, it, expect } from 'vitest';
import type {
  SessionId,
  TopicId,
  IsoTimestamp,
  SessionHistoryEntry,
  SessionContext,
  SessionSummary,
  CompetencyEntry,
  CompetencyMap,
  WeaknessEntry,
  WeaknessRegister,
  StorageAdapter,
} from './index.js';

describe('@ibai/storage interface contracts', () => {
  it('exports SessionHistoryEntry type that compiles with correct shape', () => {
    const entry: SessionHistoryEntry = {
      role: 'user',
      content: 'test content',
      timestamp: '2026-09-05T12:00:00.000Z',
    };
    expect(entry.role).toBe('user');
    expect(entry.content).toBe('test content');
  });

  it('exports SessionContext type that compiles with correct shape', () => {
    const ctx: SessionContext = {
      sessionId: 'sess-1' as SessionId,
      history: [],
    };
    expect(ctx.sessionId).toBe('sess-1');
    expect(ctx.history).toEqual([]);
  });

  it('exports SessionSummary type that compiles with correct shape', () => {
    const summary: SessionSummary = {
      sessionId: 'sess-1' as SessionId,
      completedAt: '2026-09-05T13:00:00.000Z' as IsoTimestamp,
      topics: ['arrays' as TopicId],
      narrative: 'Practiced array problems.',
      strengths: ['arrays' as TopicId],
      weaknesses: [],
    };
    expect(summary.sessionId).toBe('sess-1');
    expect(summary.topics).toContain('arrays');
  });

  it('exports CompetencyEntry type that compiles with correct shape', () => {
    const entry: CompetencyEntry = {
      topicId: 'trees' as TopicId,
      proficiency: 0.75,
      lastUpdated: '2026-09-05T12:00:00.000Z' as IsoTimestamp,
    };
    expect(entry.proficiency).toBe(0.75);
  });

  it('exports CompetencyMap type that compiles with correct shape', () => {
    const map: CompetencyMap = {
      entries: {
        trees: {
          topicId: 'trees' as TopicId,
          proficiency: 0.75,
          lastUpdated: '2026-09-05T12:00:00.000Z' as IsoTimestamp,
        },
      },
    };
    expect(map.entries['trees']?.proficiency).toBe(0.75);
  });

  it('exports WeaknessEntry type that compiles with correct shape', () => {
    const entry: WeaknessEntry = {
      topicId: 'dp' as TopicId,
      note: 'Struggles with state transitions',
      occurrences: 3,
      lastObserved: '2026-09-05T12:00:00.000Z' as IsoTimestamp,
    };
    expect(entry.occurrences).toBe(3);
  });

  it('exports WeaknessRegister type that compiles with correct shape', () => {
    const register: WeaknessRegister = {
      entries: [],
    };
    expect(register.entries).toEqual([]);
  });

  it('StorageAdapter interface can be implemented', () => {
    // Type-level test: verifies the interface is implementable
    const mockAdapter: StorageAdapter = {
      readSessionContext: async (_sessionId: SessionId) => ({
        sessionId: _sessionId,
        history: [],
      }),
      writeSessionSummary: async (_summary: SessionSummary) => {},
      readCompetencyMap: async () => ({ entries: {} }),
      updateCompetencyMap: async (_map: CompetencyMap) => {},
      readWeaknessRegister: async () => ({ entries: [] }),
      updateWeaknessRegister: async (_register: WeaknessRegister) => {},
    };
    expect(mockAdapter).toBeDefined();
  });
});
