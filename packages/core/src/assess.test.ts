/**
 * Tests for the Assess engine job.
 *
 * Uses an in-memory fake implementing StorageAdapter. No fs, no network.
 * Write methods throw to verify Assess never writes.
 */

import { describe, it, expect } from 'vitest';
import type {
  StorageAdapter,
  SessionContext,
  SessionSummary,
  CompetencyMap,
  WeaknessRegister,
  SessionId,
} from '@ibai/storage';
import { assess } from './assess.js';

// ---------------------------------------------------------------------------
// In-memory fake StorageAdapter
// ---------------------------------------------------------------------------

interface FakeStorageData {
  competencyMap?: CompetencyMap;
  weaknessRegister?: WeaknessRegister;
  sessionContexts?: Record<SessionId, SessionContext>;
}

/**
 * Creates an in-memory fake StorageAdapter for testing.
 * Read methods return provided data; write methods throw (Assess must not write).
 */
function createFakeStorage(data: FakeStorageData = {}): StorageAdapter {
  return {
    async readSessionContext(sessionId: SessionId): Promise<SessionContext> {
      return (
        data.sessionContexts?.[sessionId] ?? {
          sessionId,
          history: [],
        }
      );
    },

    async writeSessionSummary(_summary: SessionSummary): Promise<void> {
      throw new Error('Assess must not write: writeSessionSummary called');
    },

    async readCompetencyMap(): Promise<CompetencyMap> {
      return data.competencyMap ?? { entries: {} };
    },

    async updateCompetencyMap(_map: CompetencyMap): Promise<void> {
      throw new Error('Assess must not write: updateCompetencyMap called');
    },

    async readWeaknessRegister(): Promise<WeaknessRegister> {
      return data.weaknessRegister ?? { entries: [] };
    },

    async updateWeaknessRegister(_register: WeaknessRegister): Promise<void> {
      throw new Error('Assess must not write: updateWeaknessRegister called');
    },
  };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('assess', () => {
  describe('empty/new user', () => {
    it('returns sensible empty AssessmentView with no sessionId', async () => {
      const storage = createFakeStorage();
      const result = await assess(storage);

      expect(result.topicsTracked).toBe(0);
      expect(result.topStrengths).toEqual([]);
      expect(result.focusAreas).toEqual([]);
      expect(result.recurringWeaknesses).toEqual([]);
      expect(result.recentSession).toBeNull();
    });
  });

  describe('populated competency map', () => {
    it('returns correct strength/weakness ranking with deterministic tie-break', async () => {
      const storage = createFakeStorage({
        competencyMap: {
          entries: {
            arrays: {
              topicId: 'arrays',
              proficiency: 0.8,
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
            graphs: {
              topicId: 'graphs',
              proficiency: 0.3,
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
            dp: {
              topicId: 'dp',
              proficiency: 0.5,
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
            trees: {
              topicId: 'trees',
              proficiency: 0.8, // same as arrays - tie-break by topicId
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
            sorting: {
              topicId: 'sorting',
              proficiency: 0.9,
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
            strings: {
              topicId: 'strings',
              proficiency: 0.3, // same as graphs - tie-break by topicId
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
            'linked-lists': {
              topicId: 'linked-lists',
              proficiency: 0.6,
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
          },
        },
      });

      const result = await assess(storage);

      expect(result.topicsTracked).toBe(7);

      // Top strengths: sorted by proficiency DESC, tie-break by topicId ASC
      // 0.9: sorting, 0.8: arrays, trees, 0.6: linked-lists, 0.5: dp
      expect(result.topStrengths).toEqual([
        { topicId: 'sorting', proficiency: 0.9 },
        { topicId: 'arrays', proficiency: 0.8 }, // arrays < trees alphabetically
        { topicId: 'trees', proficiency: 0.8 },
        { topicId: 'linked-lists', proficiency: 0.6 },
        { topicId: 'dp', proficiency: 0.5 },
      ]);

      // Focus areas: sorted by proficiency ASC, tie-break by topicId ASC
      // 0.3: graphs, strings, 0.5: dp, 0.6: linked-lists, 0.8: arrays
      expect(result.focusAreas).toEqual([
        { topicId: 'graphs', proficiency: 0.3 }, // graphs < strings alphabetically
        { topicId: 'strings', proficiency: 0.3 },
        { topicId: 'dp', proficiency: 0.5 },
        { topicId: 'linked-lists', proficiency: 0.6 },
        { topicId: 'arrays', proficiency: 0.8 },
      ]);
    });

    it('limits results to top 5 strengths and focus areas', async () => {
      const entries: CompetencyMap['entries'] = {};
      for (let i = 0; i < 10; i++) {
        const topicId = `topic-${i.toString().padStart(2, '0')}`;
        entries[topicId] = {
          topicId,
          proficiency: i * 0.1,
          lastUpdated: '2026-09-01T00:00:00.000Z',
        };
      }

      const storage = createFakeStorage({ competencyMap: { entries } });
      const result = await assess(storage);

      expect(result.topicsTracked).toBe(10);
      expect(result.topStrengths).toHaveLength(5);
      expect(result.focusAreas).toHaveLength(5);
    });
  });

  describe('weakness register', () => {
    it('returns weaknesses sorted by occurrences desc with topicId tie-break', async () => {
      const storage = createFakeStorage({
        weaknessRegister: {
          entries: [
            {
              topicId: 'dp',
              note: 'Struggles with memoization',
              occurrences: 3,
              lastObserved: '2026-09-01T00:00:00.000Z',
            },
            {
              topicId: 'graphs',
              note: 'BFS vs DFS confusion',
              occurrences: 5,
              lastObserved: '2026-09-02T00:00:00.000Z',
            },
            {
              topicId: 'trees',
              note: 'Tree traversal order',
              occurrences: 3, // same as dp - tie-break by topicId
              lastObserved: '2026-09-03T00:00:00.000Z',
            },
          ],
        },
      });

      const result = await assess(storage);

      // Sorted by occurrences DESC, tie-break by topicId ASC
      expect(result.recurringWeaknesses).toEqual([
        {
          topicId: 'graphs',
          note: 'BFS vs DFS confusion',
          occurrences: 5,
          lastObserved: '2026-09-02T00:00:00.000Z',
        },
        {
          topicId: 'dp', // dp < trees alphabetically
          note: 'Struggles with memoization',
          occurrences: 3,
          lastObserved: '2026-09-01T00:00:00.000Z',
        },
        {
          topicId: 'trees',
          note: 'Tree traversal order',
          occurrences: 3,
          lastObserved: '2026-09-03T00:00:00.000Z',
        },
      ]);
    });

    it('limits recurring weaknesses to top 10', async () => {
      const entries = [];
      for (let i = 0; i < 15; i++) {
        entries.push({
          topicId: `topic-${i.toString().padStart(2, '0')}`,
          note: `Weakness ${i}`,
          occurrences: 15 - i,
          lastObserved: '2026-09-01T00:00:00.000Z',
        });
      }

      const storage = createFakeStorage({
        weaknessRegister: { entries },
      });
      const result = await assess(storage);

      expect(result.recurringWeaknesses).toHaveLength(10);
    });
  });

  describe('recent session', () => {
    it('reflects session context with history', async () => {
      const storage = createFakeStorage({
        sessionContexts: {
          'session-123': {
            sessionId: 'session-123',
            history: [
              {
                role: 'system',
                content: 'Welcome',
                timestamp: '2026-09-05T10:00:00.000Z',
              },
              {
                role: 'user',
                content: 'Hello',
                timestamp: '2026-09-05T10:01:00.000Z',
              },
              {
                role: 'assistant',
                content: 'Hi there!',
                timestamp: '2026-09-05T10:02:00.000Z',
              },
            ],
          },
        },
      });

      const result = await assess(storage, 'session-123');

      expect(result.recentSession).toEqual({
        sessionId: 'session-123',
        turnCount: 3,
        lastRole: 'assistant',
        lastTimestamp: '2026-09-05T10:02:00.000Z',
      });
    });

    it('handles empty session history', async () => {
      const storage = createFakeStorage({
        sessionContexts: {
          'empty-session': {
            sessionId: 'empty-session',
            history: [],
          },
        },
      });

      const result = await assess(storage, 'empty-session');

      // Session exists but is empty - return object with turnCount=0, null last* fields
      expect(result.recentSession).toEqual({
        sessionId: 'empty-session',
        turnCount: 0,
        lastRole: null,
        lastTimestamp: null,
      });
    });

    it('returns null recentSession when no sessionId provided', async () => {
      const storage = createFakeStorage({
        sessionContexts: {
          'some-session': {
            sessionId: 'some-session',
            history: [
              {
                role: 'user',
                content: 'Test',
                timestamp: '2026-09-05T10:00:00.000Z',
              },
            ],
          },
        },
      });

      const result = await assess(storage);

      expect(result.recentSession).toBeNull();
    });
  });

  describe('assess never writes', () => {
    it('does not call any write methods', async () => {
      // Fake storage throws on any write - if assess writes, test fails
      const storage = createFakeStorage({
        competencyMap: {
          entries: {
            arrays: {
              topicId: 'arrays',
              proficiency: 0.5,
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
          },
        },
        weaknessRegister: {
          entries: [
            {
              topicId: 'dp',
              note: 'Test weakness',
              occurrences: 1,
              lastObserved: '2026-09-01T00:00:00.000Z',
            },
          ],
        },
        sessionContexts: {
          'test-session': {
            sessionId: 'test-session',
            history: [
              {
                role: 'user',
                content: 'Test',
                timestamp: '2026-09-05T10:00:00.000Z',
              },
            ],
          },
        },
      });

      // This should not throw - assess only reads
      await expect(assess(storage, 'test-session')).resolves.toBeDefined();
    });
  });
});
