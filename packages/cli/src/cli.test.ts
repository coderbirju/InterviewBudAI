/**
 * Tests for the CLI entry point and config utilities.
 *
 * Uses in-memory fake StorageAdapter — no real fs, no network.
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
import { run } from './cli.js';
import { resolveDataDir } from './config.js';

// ---------------------------------------------------------------------------
// In-memory fake StorageAdapter (same pattern as core tests)
// ---------------------------------------------------------------------------

interface FakeStorageData {
  competencyMap?: CompetencyMap;
  weaknessRegister?: WeaknessRegister;
  sessionContexts?: Record<SessionId, SessionContext>;
}

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
      throw new Error('CLI should not write: writeSessionSummary called');
    },

    async readCompetencyMap(): Promise<CompetencyMap> {
      return data.competencyMap ?? { entries: {} };
    },

    async updateCompetencyMap(_map: CompetencyMap): Promise<void> {
      throw new Error('CLI should not write: updateCompetencyMap called');
    },

    async readWeaknessRegister(): Promise<WeaknessRegister> {
      return data.weaknessRegister ?? { entries: [] };
    },

    async updateWeaknessRegister(_register: WeaknessRegister): Promise<void> {
      throw new Error('CLI should not write: updateWeaknessRegister called');
    },
  };
}

// ---------------------------------------------------------------------------
// resolveDataDir tests
// ---------------------------------------------------------------------------

describe('resolveDataDir', () => {
  it('uses flag when provided (highest precedence)', () => {
    const result = resolveDataDir({
      flag: '/custom/flag/path',
      env: '/env/path',
      home: '/home/user',
    });
    expect(result).toBe('/custom/flag/path');
  });

  it('uses env when flag not provided', () => {
    const result = resolveDataDir({
      env: '/env/path',
      home: '/home/user',
    });
    expect(result).toBe('/env/path');
  });

  it('uses default (~/.ibai/data) when neither flag nor env provided', () => {
    const result = resolveDataDir({
      home: '/home/user',
    });
    expect(result).toBe('/home/user/.ibai/data');
  });

  it('normalizes paths', () => {
    const result = resolveDataDir({
      flag: '/path/to/../data',
    });
    expect(result).toBe('/path/data');
  });

  it('rejects empty flag value', () => {
    expect(() => resolveDataDir({ flag: '', home: '/home/user' })).toThrow(
      '--data-dir value cannot be empty',
    );
  });

  it('rejects whitespace-only flag value', () => {
    expect(() => resolveDataDir({ flag: '   ', home: '/home/user' })).toThrow(
      '--data-dir value cannot be empty',
    );
  });

  it('rejects empty env value', () => {
    expect(() => resolveDataDir({ env: '', home: '/home/user' })).toThrow(
      'IBAI_DATA_DIR environment variable cannot be empty',
    );
  });

  it('rejects missing home when using default', () => {
    expect(() => resolveDataDir({})).toThrow(
      'Cannot determine home directory for default data path',
    );
  });
});

// ---------------------------------------------------------------------------
// run() tests
// ---------------------------------------------------------------------------

describe('run', () => {
  describe('help and errors', () => {
    it('shows help on --help', async () => {
      const result = await run(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('ibai - InterviewBudAI CLI');
      expect(result.output).toContain('assess');
      expect(result.output).toContain('--data-dir');
    });

    it('shows error for no command', async () => {
      const result = await run([]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('No command specified');
    });

    it('shows error for unknown command', async () => {
      const result = await run(['unknown']);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Unknown command 'unknown'");
    });
  });

  describe('assess command with fake storage', () => {
    it('renders empty assessment for new user', async () => {
      const storage = createFakeStorage();
      const result = await run(['assess'], { storage, home: '/home/test' });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('=== Where You Stand ===');
      expect(result.output).toContain('Topics tracked: 0');
      expect(result.output).toContain('No strengths recorded yet.');
      expect(result.output).toContain('No focus areas identified yet.');
      expect(result.output).toContain('No recurring weaknesses noted.');
    });

    it('renders populated assessment', async () => {
      const storage = createFakeStorage({
        competencyMap: {
          entries: {
            arrays: {
              topicId: 'arrays',
              proficiency: 0.9,
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
            graphs: {
              topicId: 'graphs',
              proficiency: 0.3,
              lastUpdated: '2026-09-01T00:00:00.000Z',
            },
          },
        },
        weaknessRegister: {
          entries: [
            {
              topicId: 'graphs',
              note: 'BFS confusion',
              occurrences: 2,
              lastObserved: '2026-09-01T00:00:00.000Z',
            },
          ],
        },
      });

      const result = await run(['assess'], { storage, home: '/home/test' });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Topics tracked: 2');
      expect(result.output).toContain('arrays: 90%');
      expect(result.output).toContain('graphs: 30%');
      expect(result.output).toContain('graphs (2x): BFS confusion');
    });

    it('includes recent session when --session provided', async () => {
      const storage = createFakeStorage({
        sessionContexts: {
          'test-session': {
            sessionId: 'test-session',
            history: [
              {
                role: 'user',
                content: 'Hello',
                timestamp: '2026-09-05T10:00:00.000Z',
              },
              {
                role: 'assistant',
                content: 'Hi!',
                timestamp: '2026-09-05T10:01:00.000Z',
              },
            ],
          },
        },
      });

      const result = await run(['assess', '--session', 'test-session'], {
        storage,
        home: '/home/test',
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Recent Session:');
      expect(result.output).toContain('Session ID: test-session');
      expect(result.output).toContain('Turns: 2');
      expect(result.output).toContain('Last role: assistant');
    });
  });

  describe('error handling', () => {
    it('returns non-zero exit code on storage error', async () => {
      const failingStorage: StorageAdapter = {
        async readSessionContext(): Promise<SessionContext> {
          throw new Error('Storage unavailable');
        },
        async writeSessionSummary(): Promise<void> {
          throw new Error('Storage unavailable');
        },
        async readCompetencyMap(): Promise<CompetencyMap> {
          throw new Error('Storage unavailable');
        },
        async updateCompetencyMap(): Promise<void> {
          throw new Error('Storage unavailable');
        },
        async readWeaknessRegister(): Promise<WeaknessRegister> {
          throw new Error('Storage unavailable');
        },
        async updateWeaknessRegister(): Promise<void> {
          throw new Error('Storage unavailable');
        },
      };

      const result = await run(['assess'], {
        storage: failingStorage,
        home: '/home/test',
      });

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Error:');
      expect(result.output).toContain('Storage unavailable');
    });

    it('handles config resolution errors', async () => {
      const storage = createFakeStorage();
      const result = await run(['assess', '--data-dir', ''], {
        storage,
        home: '/home/test',
      });

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Error:');
      expect(result.output).toContain('--data-dir value cannot be empty');
    });
  });
});
