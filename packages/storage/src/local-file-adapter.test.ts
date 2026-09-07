import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileStorageAdapter } from './local-file-adapter.js';
import type {
  SessionSummary,
  CompetencyMap,
  WeaknessRegister,
  SessionContext,
} from './index.js';

describe('LocalFileStorageAdapter', () => {
  let tempDir: string;
  let adapter: LocalFileStorageAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ibai-storage-test-'));
    adapter = new LocalFileStorageAdapter(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Round-trip tests
  // -------------------------------------------------------------------------

  describe('writeSessionSummary round-trip', () => {
    it('writes summary to disk and can be read back', async () => {
      const summary: SessionSummary = {
        sessionId: 'sess-123',
        completedAt: '2026-09-06T12:00:00.000Z',
        topics: ['arrays', 'strings'],
        narrative: 'Practiced basic array and string problems.',
        strengths: ['arrays'],
        weaknesses: ['strings'],
      };

      await adapter.writeSessionSummary(summary);

      // Read the file directly from disk
      const filePath = join(tempDir, 'summaries', 'sess-123.json');
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;

      expect(parsed).toEqual(summary);
    });
  });

  describe('updateCompetencyMap round-trip', () => {
    it('writes and reads competency map correctly', async () => {
      const map: CompetencyMap = {
        entries: {
          trees: {
            topicId: 'trees',
            proficiency: 0.75,
            lastUpdated: '2026-09-06T12:00:00.000Z',
          },
          graphs: {
            topicId: 'graphs',
            proficiency: 0.5,
            lastUpdated: '2026-09-06T11:00:00.000Z',
          },
        },
      };

      await adapter.updateCompetencyMap(map);
      const result = await adapter.readCompetencyMap();

      expect(result).toEqual(map);
    });
  });

  describe('updateWeaknessRegister round-trip', () => {
    it('writes and reads weakness register correctly', async () => {
      const register: WeaknessRegister = {
        entries: [
          {
            topicId: 'dp',
            note: 'Struggles with state transitions',
            occurrences: 3,
            lastObserved: '2026-09-06T12:00:00.000Z',
          },
          {
            topicId: 'recursion',
            note: 'Base case identification',
            occurrences: 2,
            lastObserved: '2026-09-05T10:00:00.000Z',
          },
        ],
      };

      await adapter.updateWeaknessRegister(register);
      const result = await adapter.readWeaknessRegister();

      expect(result).toEqual(register);
    });
  });

  // -------------------------------------------------------------------------
  // Empty/missing cases
  // -------------------------------------------------------------------------

  describe('empty/missing file handling', () => {
    it('readCompetencyMap returns empty map when file does not exist', async () => {
      const result = await adapter.readCompetencyMap();
      expect(result).toEqual({ entries: {} });
    });

    it('readWeaknessRegister returns empty register when file does not exist', async () => {
      const result = await adapter.readWeaknessRegister();
      expect(result).toEqual({ entries: [] });
    });

    it('readSessionContext returns empty context for unknown session', async () => {
      const result = await adapter.readSessionContext('unknown-session');
      expect(result).toEqual({
        sessionId: 'unknown-session',
        history: [],
      });
    });

    it('none of the read operations throw on missing files', async () => {
      await expect(adapter.readCompetencyMap()).resolves.not.toThrow();
      await expect(adapter.readWeaknessRegister()).resolves.not.toThrow();
      await expect(
        adapter.readSessionContext('nonexistent'),
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Malformed file handling
  // -------------------------------------------------------------------------

  describe('malformed file handling', () => {
    it('readCompetencyMap returns empty map on invalid JSON', async () => {
      const filePath = join(tempDir, 'competency.json');
      await writeFile(filePath, 'not valid json {{{{', 'utf-8');

      const result = await adapter.readCompetencyMap();
      expect(result).toEqual({ entries: {} });
    });

    it('readCompetencyMap returns empty map on wrong structure', async () => {
      const filePath = join(tempDir, 'competency.json');
      await writeFile(
        filePath,
        JSON.stringify({ wrong: 'structure' }),
        'utf-8',
      );

      const result = await adapter.readCompetencyMap();
      expect(result).toEqual({ entries: {} });
    });

    it('readWeaknessRegister returns empty register on invalid JSON', async () => {
      const filePath = join(tempDir, 'weaknesses.json');
      await writeFile(filePath, '}}garbage{{', 'utf-8');

      const result = await adapter.readWeaknessRegister();
      expect(result).toEqual({ entries: [] });
    });

    it('readWeaknessRegister returns empty register on wrong structure', async () => {
      const filePath = join(tempDir, 'weaknesses.json');
      await writeFile(
        filePath,
        JSON.stringify({ entries: 'not an array' }),
        'utf-8',
      );

      const result = await adapter.readWeaknessRegister();
      expect(result).toEqual({ entries: [] });
    });

    it('readSessionContext returns empty context on malformed session file', async () => {
      await mkdir(join(tempDir, 'sessions'), { recursive: true });
      await writeFile(
        join(tempDir, 'sessions', 'bad-session.json'),
        'corrupted data',
        'utf-8',
      );

      const result = await adapter.readSessionContext('bad-session');
      expect(result).toEqual({
        sessionId: 'bad-session',
        history: [],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Path traversal protection
  // -------------------------------------------------------------------------

  describe('path traversal protection', () => {
    it('readSessionContext with path traversal attempt does not escape basePath', async () => {
      // Should not throw and should not try to read /etc/passwd
      const result = await adapter.readSessionContext('../../etc/passwd');

      // Should return empty context, not throw or read system files
      expect(result.sessionId).toBe('../../etc/passwd');
      expect(result.history).toEqual([]);
    });

    it('readSessionContext sanitizes forward slashes', async () => {
      const result = await adapter.readSessionContext('foo/bar/baz');
      expect(result.history).toEqual([]);
    });

    it('readSessionContext sanitizes backslashes', async () => {
      const result = await adapter.readSessionContext('foo\\bar\\baz');
      expect(result.history).toEqual([]);
    });

    it('writeSessionSummary sanitizes sessionId in path', async () => {
      const summary: SessionSummary = {
        sessionId: '../../../tmp/evil',
        completedAt: '2026-09-06T12:00:00.000Z',
        topics: [],
        narrative: 'test',
        strengths: [],
        weaknesses: [],
      };

      // Should not throw
      await adapter.writeSessionSummary(summary);

      // File should be within tempDir, not at /tmp/evil
      const expectedPath = join(tempDir, 'summaries', 'tmpevil.json');
      const content = await readFile(expectedPath, 'utf-8');
      expect(JSON.parse(content)).toEqual(summary);
    });
  });

  // -------------------------------------------------------------------------
  // Session context with existing data
  // -------------------------------------------------------------------------

  describe('readSessionContext with existing data', () => {
    it('reads valid session context from disk', async () => {
      const sessionContext: SessionContext = {
        sessionId: 'existing-session',
        history: [
          {
            role: 'user',
            content: 'Hello',
            timestamp: '2026-09-06T12:00:00.000Z',
          },
          {
            role: 'assistant',
            content: 'Hi there!',
            timestamp: '2026-09-06T12:00:01.000Z',
          },
        ],
      };

      await mkdir(join(tempDir, 'sessions'), { recursive: true });
      await writeFile(
        join(tempDir, 'sessions', 'existing-session.json'),
        JSON.stringify(sessionContext, null, 2),
        'utf-8',
      );

      const result = await adapter.readSessionContext('existing-session');
      expect(result).toEqual(sessionContext);
    });
  });

  // -------------------------------------------------------------------------
  // File format verification (pretty-printed, trailing newline)
  // -------------------------------------------------------------------------

  describe('file format', () => {
    it('competency.json is pretty-printed with trailing newline', async () => {
      const map: CompetencyMap = { entries: {} };
      await adapter.updateCompetencyMap(map);

      const content = await readFile(join(tempDir, 'competency.json'), 'utf-8');
      expect(content).toBe('{\n  "entries": {}\n}\n');
    });

    it('weaknesses.json is pretty-printed with trailing newline', async () => {
      const register: WeaknessRegister = { entries: [] };
      await adapter.updateWeaknessRegister(register);

      const content = await readFile(join(tempDir, 'weaknesses.json'), 'utf-8');
      expect(content).toBe('{\n  "entries": []\n}\n');
    });
  });
});
