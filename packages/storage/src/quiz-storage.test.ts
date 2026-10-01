/**
 * Tests for the Quiz Master storage foundation in LocalFileStorageAdapter
 * (ADR 0007): QuizSession persistence/resume and the CompetencySignals dataset.
 *
 * All tests use temp directories, no network, and clean up after themselves.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileStorageAdapter } from './local-file-adapter.js';
import { deriveTopicStrength, MISS_CODES, isMissCode } from './index.js';
import type {
  QuizSession,
  CompetencySignals,
  IntuitionNote,
  CompetencyMap,
  WeaknessRegister,
} from './index.js';

function makeSession(overrides: Partial<QuizSession> = {}): QuizSession {
  return {
    sessionId: 'quiz-1',
    createdAt: '2026-09-24T10:00:00.000Z',
    deck: ['lc-1', 'lc-42', 'lc-53'],
    currentIndex: 0,
    answered: [],
    transcript: [
      {
        role: 'system',
        content: 'You are the Quiz Master.',
        at: '2026-09-24T10:00:00.000Z',
      },
    ],
    status: 'active',
    ...overrides,
  };
}

describe('LocalFileStorageAdapter - QuizSession methods (ADR 0007)', () => {
  let tempDir: string;
  let adapter: LocalFileStorageAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ibai-quiz-test-'));
    adapter = new LocalFileStorageAdapter(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('write -> readActiveQuizSession round-trip', () => {
    it('returns the active session after writing it', async () => {
      const session = makeSession();
      await adapter.writeQuizSession(session);

      const result = await adapter.readActiveQuizSession();
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe('quiz-1');
      expect(result!.deck).toEqual(['lc-1', 'lc-42', 'lc-53']);
      expect(result!.currentIndex).toBe(0);
      expect(result!.status).toBe('active');
      expect(result!.transcript).toHaveLength(1);
    });

    it('round-trips answers and transcript with progress advanced', async () => {
      const session = makeSession({
        currentIndex: 1,
        answered: [
          {
            problemId: 'lc-1',
            verdict: 'correct',
            at: '2026-09-24T10:01:00.000Z',
          },
        ],
        transcript: [
          {
            role: 'system',
            content: 'persona',
            at: '2026-09-24T10:00:00.000Z',
          },
          {
            role: 'assistant',
            content: 'Wrapped prompt',
            at: '2026-09-24T10:00:30.000Z',
          },
          {
            role: 'user',
            content: 'My approach: hash map',
            at: '2026-09-24T10:00:50.000Z',
          },
          {
            role: 'assistant',
            content: 'Correct direction.',
            at: '2026-09-24T10:01:00.000Z',
          },
        ],
      });
      await adapter.writeQuizSession(session);

      const result = await adapter.readActiveQuizSession();
      expect(result).not.toBeNull();
      expect(result!.currentIndex).toBe(1);
      expect(result!.answered).toEqual(session.answered);
      expect(result!.transcript).toHaveLength(4);
    });

    it('reads a specific session by id', async () => {
      const session = makeSession({ sessionId: 'quiz-abc' });
      await adapter.writeQuizSession(session);

      const byId = await adapter.readQuizSession('quiz-abc');
      expect(byId).not.toBeNull();
      expect(byId!.sessionId).toBe('quiz-abc');
    });
  });

  describe('no active session', () => {
    it('returns null when nothing has been written', async () => {
      const result = await adapter.readActiveQuizSession();
      expect(result).toBeNull();
    });

    it('returns null for readQuizSession on a missing id', async () => {
      const result = await adapter.readQuizSession('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('completing a session clears the active pointer', () => {
    it('readActiveQuizSession returns null after the session completes', async () => {
      await adapter.writeQuizSession(makeSession({ sessionId: 'quiz-x' }));
      expect(await adapter.readActiveQuizSession()).not.toBeNull();

      // Same session, now complete.
      await adapter.writeQuizSession(
        makeSession({
          sessionId: 'quiz-x',
          status: 'complete',
          currentIndex: 3,
        }),
      );

      expect(await adapter.readActiveQuizSession()).toBeNull();
      // But it is still readable by id (transcript preserved).
      const byId = await adapter.readQuizSession('quiz-x');
      expect(byId).not.toBeNull();
      expect(byId!.status).toBe('complete');
    });

    it('a new active session becomes the active one after a prior completes', async () => {
      await adapter.writeQuizSession(
        makeSession({ sessionId: 'quiz-old', status: 'complete' }),
      );
      await adapter.writeQuizSession(
        makeSession({ sessionId: 'quiz-new', status: 'active' }),
      );

      const result = await adapter.readActiveQuizSession();
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe('quiz-new');
    });
  });

  describe('tolerant parsing (never throws)', () => {
    it('malformed session JSON -> readQuizSession returns null', async () => {
      const dir = join(tempDir, 'quiz-sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'broken.json'), '{ not valid json', 'utf-8');

      const result = await adapter.readQuizSession('broken');
      expect(result).toBeNull();
    });

    it('well-formed JSON but wrong shape -> null', async () => {
      const dir = join(tempDir, 'quiz-sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'wrong.json'),
        JSON.stringify({ sessionId: 'wrong', deck: 'not-an-array' }),
        'utf-8',
      );

      const result = await adapter.readQuizSession('wrong');
      expect(result).toBeNull();
    });

    it('malformed active pointer -> readActiveQuizSession returns null', async () => {
      const dir = join(tempDir, 'quiz-sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'active.json'), 'nonsense', 'utf-8');

      const result = await adapter.readActiveQuizSession();
      expect(result).toBeNull();
    });

    it('dangling active pointer (session file missing) -> null', async () => {
      const dir = join(tempDir, 'quiz-sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'active.json'),
        JSON.stringify({ sessionId: 'ghost' }),
        'utf-8',
      );

      const result = await adapter.readActiveQuizSession();
      expect(result).toBeNull();
    });
  });

  describe('path traversal protection', () => {
    it('neutralizes a traversal attempt in the sessionId', async () => {
      const malicious = makeSession({ sessionId: '../../etc/evil' });
      await adapter.writeQuizSession(malicious);

      // The escaping path must not have written outside the base dir.
      const result = await adapter.readActiveQuizSession();
      // Sanitized id still round-trips within the base dir (no throw, no escape).
      expect(result).not.toBeNull();
      expect(result!.deck).toEqual(malicious.deck);
    });
  });
});

describe('LocalFileStorageAdapter - session management (ADR 0007, quiz-fix-b)', () => {
  let tempDir: string;
  let adapter: LocalFileStorageAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ibai-quiz-mgmt-test-'));
    adapter = new LocalFileStorageAdapter(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('listQuizSessions', () => {
    it('returns an empty list when no sessions exist', async () => {
      expect(await adapter.listQuizSessions()).toEqual([]);
    });

    it('summarizes sessions newest-first and flags the active one', async () => {
      // Older, complete session with one correct + one incorrect answer.
      await adapter.writeQuizSession(
        makeSession({
          sessionId: 'quiz-old',
          createdAt: '2026-09-24T10:00:00.000Z',
          status: 'complete',
          currentIndex: 3,
          answered: [
            {
              problemId: 'lc-1',
              verdict: 'correct',
              at: '2026-09-24T10:01:00.000Z',
            },
            {
              problemId: 'lc-42',
              verdict: 'incorrect',
              at: '2026-09-24T10:02:00.000Z',
            },
          ],
        }),
      );
      // Newer, active session.
      await adapter.writeQuizSession(
        makeSession({
          sessionId: 'quiz-new',
          createdAt: '2026-09-24T12:00:00.000Z',
          status: 'active',
          currentIndex: 1,
          answered: [
            {
              problemId: 'lc-1',
              verdict: 'correct',
              at: '2026-09-24T12:01:00.000Z',
            },
          ],
        }),
      );

      const list = await adapter.listQuizSessions();
      expect(list).toHaveLength(2);
      // Newest-first.
      expect(list[0]?.sessionId).toBe('quiz-new');
      expect(list[1]?.sessionId).toBe('quiz-old');

      // Active-session flag: only the newer one is active.
      expect(list[0]?.isActive).toBe(true);
      expect(list[1]?.isActive).toBe(false);

      // Summary tallies.
      expect(list[0]?.status).toBe('active');
      expect(list[0]?.deckSize).toBe(3);
      expect(list[0]?.answeredCount).toBe(1);
      expect(list[0]?.correctCount).toBe(1);

      expect(list[1]?.status).toBe('complete');
      expect(list[1]?.answeredCount).toBe(2);
      expect(list[1]?.correctCount).toBe(1);
    });

    it('skips the active.json pointer and malformed session files', async () => {
      await adapter.writeQuizSession(makeSession({ sessionId: 'quiz-ok' }));
      // active.json exists (written by the active session above).
      const dir = join(tempDir, 'quiz-sessions');
      await writeFile(join(dir, 'broken.json'), '{ not valid', 'utf-8');
      await writeFile(
        join(dir, 'wrong.json'),
        JSON.stringify({ sessionId: 'wrong', deck: 'not-an-array' }),
        'utf-8',
      );
      await writeFile(join(dir, 'notes.txt'), 'ignore me', 'utf-8');

      const list = await adapter.listQuizSessions();
      expect(list).toHaveLength(1);
      expect(list[0]?.sessionId).toBe('quiz-ok');
    });
  });

  describe('deleteQuizSession', () => {
    it('removes the session file (no longer readable, not listed)', async () => {
      await adapter.writeQuizSession(
        makeSession({ sessionId: 'quiz-del', status: 'complete' }),
      );
      expect(await adapter.readQuizSession('quiz-del')).not.toBeNull();

      await adapter.deleteQuizSession('quiz-del');

      expect(await adapter.readQuizSession('quiz-del')).toBeNull();
      expect(await adapter.listQuizSessions()).toEqual([]);
    });

    it('clears the active pointer when deleting the active session', async () => {
      await adapter.writeQuizSession(
        makeSession({ sessionId: 'quiz-active', status: 'active' }),
      );
      expect(await adapter.readActiveQuizSession()).not.toBeNull();

      await adapter.deleteQuizSession('quiz-active');

      expect(await adapter.readActiveQuizSession()).toBeNull();
    });

    it('leaves the active pointer intact when deleting a NON-active session', async () => {
      // Active session first, then an older complete one.
      await adapter.writeQuizSession(
        makeSession({ sessionId: 'quiz-keep', status: 'active' }),
      );
      await adapter.writeQuizSession(
        makeSession({ sessionId: 'quiz-other', status: 'complete' }),
      );
      // Re-assert quiz-keep is active (writing a complete session does not
      // touch a pointer that references a different session).
      expect((await adapter.readActiveQuizSession())?.sessionId).toBe(
        'quiz-keep',
      );

      await adapter.deleteQuizSession('quiz-other');

      // Active session still resumable.
      expect((await adapter.readActiveQuizSession())?.sessionId).toBe(
        'quiz-keep',
      );
    });

    it('deleting a missing session is a no-op (never throws)', async () => {
      await expect(
        adapter.deleteQuizSession('does-not-exist'),
      ).resolves.toBeUndefined();
    });
  });
});

describe('LocalFileStorageAdapter - CompetencySignals methods (ADR 0007)', () => {
  let tempDir: string;
  let adapter: LocalFileStorageAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ibai-signals-test-'));
    adapter = new LocalFileStorageAdapter(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('write -> read round-trips topics and patterns', async () => {
    const signals: CompetencySignals = {
      topics: {
        arrays: {
          topicId: 'arrays',
          correct: 5,
          incorrect: 1,
          lastSeen: '2026-09-24T10:00:00.000Z',
          strength: 'strong',
        },
        dp: {
          topicId: 'dp',
          correct: 1,
          incorrect: 4,
          lastSeen: '2026-09-24T10:00:00.000Z',
          strength: 'weak',
        },
      },
      patterns: [
        {
          id: 'off-by-one',
          description: 'Recurring off-by-one at loop boundaries',
          topics: ['arrays'],
          occurrences: 3,
          lastObserved: '2026-09-24T10:00:00.000Z',
        },
      ],
      lastUpdated: '2026-09-24T10:00:00.000Z',
    };

    await adapter.writeCompetencySignals(signals);
    const result = await adapter.readCompetencySignals();

    expect(result.topics['arrays']?.strength).toBe('strong');
    expect(result.topics['dp']?.incorrect).toBe(4);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]?.id).toBe('off-by-one');
    expect(result.lastUpdated).toBe('2026-09-24T10:00:00.000Z');
  });

  it('returns an empty dataset when none exists', async () => {
    const result = await adapter.readCompetencySignals();
    expect(result.topics).toEqual({});
    expect(result.patterns).toEqual([]);
    expect(typeof result.lastUpdated).toBe('string');
  });

  it('tolerant: malformed JSON -> empty dataset (never throws)', async () => {
    await writeFile(
      join(tempDir, 'competency-signals.json'),
      '{ broken',
      'utf-8',
    );
    const result = await adapter.readCompetencySignals();
    expect(result.topics).toEqual({});
    expect(result.patterns).toEqual([]);
  });

  it('tolerant: well-formed JSON but wrong shape -> empty dataset', async () => {
    await writeFile(
      join(tempDir, 'competency-signals.json'),
      JSON.stringify({ topics: [], patterns: 'nope' }),
      'utf-8',
    );
    const result = await adapter.readCompetencySignals();
    expect(result.topics).toEqual({});
    expect(result.patterns).toEqual([]);
  });
});

describe('deriveTopicStrength (ADR 0007)', () => {
  it('returns unknown below 3 observations', () => {
    expect(deriveTopicStrength(0, 0)).toBe('unknown');
    expect(deriveTopicStrength(2, 0)).toBe('unknown');
  });

  it('returns strong at >= 0.75 correct ratio', () => {
    expect(deriveTopicStrength(3, 1)).toBe('strong');
    expect(deriveTopicStrength(10, 0)).toBe('strong');
  });

  it('returns weak at <= 0.40 correct ratio', () => {
    expect(deriveTopicStrength(1, 4)).toBe('weak');
    expect(deriveTopicStrength(0, 5)).toBe('weak');
  });

  it('returns improving in the middle band', () => {
    expect(deriveTopicStrength(3, 3)).toBe('improving');
  });
});

describe('back-compat: existing methods unaffected by ADR 0007 additions', () => {
  let tempDir: string;
  let adapter: LocalFileStorageAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ibai-backcompat-test-'));
    adapter = new LocalFileStorageAdapter(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('competency map + weakness register still round-trip', async () => {
    const map: CompetencyMap = {
      entries: {
        trees: {
          topicId: 'trees',
          proficiency: 0.75,
          lastUpdated: '2026-09-24T10:00:00.000Z',
        },
      },
    };
    const register: WeaknessRegister = {
      entries: [
        {
          topicId: 'dp',
          note: 'state transitions',
          occurrences: 2,
          lastObserved: '2026-09-24T10:00:00.000Z',
        },
      ],
    };

    await adapter.updateCompetencyMap(map);
    await adapter.updateWeaknessRegister(register);

    expect(
      (await adapter.readCompetencyMap()).entries['trees']?.proficiency,
    ).toBe(0.75);
    expect((await adapter.readWeaknessRegister()).entries).toHaveLength(1);
  });

  it('intuition notes still round-trip alongside quiz data', async () => {
    const note: IntuitionNote = {
      problemId: 'lc-1',
      content: 'Hash map complement.',
      lastUpdated: '2026-09-24T10:00:00.000Z',
      status: 'done',
    };
    await adapter.writeIntuitionNote(note);

    // Writing quiz data in the same dir must not disturb the note.
    await adapter.writeQuizSession(makeSession());

    const result = await adapter.readIntuitionNote('lc-1');
    expect(result).not.toBeNull();
    expect(result!.content).toBe('Hash map complement.');
    expect(result!.status).toBe('done');
  });
});

describe('LocalFileStorageAdapter - miss codes (ADR 0012 D1, additive)', () => {
  let tempDir: string;
  let adapter: LocalFileStorageAdapter;
  const AT = '2026-09-30T10:00:00.000Z';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ibai-miss-test-'));
    adapter = new LocalFileStorageAdapter(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('exports the fixed enum and its guard', () => {
    expect(MISS_CODES).toEqual([
      'edge',
      'complexity',
      'brute',
      'technique',
      'vague',
      'boundary',
      'misread',
    ]);
    expect(isMissCode('edge')).toBe(true);
    expect(isMissCode('EDGE')).toBe(false);
    expect(isMissCode(1)).toBe(false);
  });

  it('a pre-ADR signals file (no misses) reads unchanged', async () => {
    const legacy = {
      topics: {
        arrays: {
          topicId: 'arrays',
          correct: 2,
          incorrect: 1,
          lastSeen: AT,
          strength: 'improving',
        },
      },
      patterns: [],
      lastUpdated: AT,
    };
    await writeFile(
      join(tempDir, 'competency-signals.json'),
      JSON.stringify(legacy),
    );
    const read = await adapter.readCompetencySignals();
    expect(read).toEqual(legacy);
    expect('misses' in read).toBe(false);
  });

  it('round-trips valid misses; unknown/malformed entries are dropped, the rest kept', async () => {
    await writeFile(
      join(tempDir, 'competency-signals.json'),
      JSON.stringify({
        topics: {
          arrays: {
            topicId: 'arrays',
            correct: 0,
            incorrect: 2,
            lastSeen: AT,
            strength: 'unknown',
            misses: { edge: 2, nope: 4, vague: -1, brute: 1.5 },
          },
          trees: {
            topicId: 'trees',
            correct: 0,
            incorrect: 1,
            lastSeen: AT,
            strength: 'unknown',
            misses: 'junk',
          },
        },
        patterns: [],
        lastUpdated: AT,
        misses: {
          edge: { count: 2, lastSeen: AT },
          nope: { count: 9, lastSeen: AT },
          vague: { count: 'x', lastSeen: AT },
          boundary: { count: 1 },
        },
      }),
    );
    const read = await adapter.readCompetencySignals();
    expect(read.misses).toEqual({ edge: { count: 2, lastSeen: AT } });
    expect(read.topics['arrays']?.misses).toEqual({ edge: 2 });
    expect(read.topics['arrays']?.incorrect).toBe(2);
    expect('misses' in read.topics['trees']!).toBe(false);
    // Re-writing what was read keeps the clean tallies.
    await adapter.writeCompetencySignals(read);
    expect(await adapter.readCompetencySignals()).toEqual(read);
  });

  it('a transcript entry keeps a valid miss and drops an unknown one', async () => {
    const session = makeSession({
      transcript: [
        { role: 'assistant', content: 'Two Sum (easy)', at: AT },
        { role: 'user', content: 'first', at: AT },
        { role: 'assistant', content: 'Why?', at: AT, miss: 'edge' },
      ],
    });
    await adapter.writeQuizSession(session);
    expect(await adapter.readQuizSession('quiz-1')).toEqual(session);

    await writeFile(
      join(tempDir, 'quiz-sessions', 'quiz-1.json'),
      JSON.stringify({
        ...session,
        transcript: [
          ...session.transcript.slice(0, 2),
          { role: 'assistant', content: 'Why?', at: AT, miss: 'nope' },
        ],
      }),
    );
    const read = await adapter.readQuizSession('quiz-1');
    expect(read?.transcript[2]).toEqual({
      role: 'assistant',
      content: 'Why?',
      at: AT,
    });
  });
});
