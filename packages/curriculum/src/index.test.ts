import { describe, it, expect } from 'vitest';
import type { Problem, Difficulty, CurriculumSource } from './index.js';
import { CATALOG, createCatalogSource } from './index.js';

// Small inline fixture for testing injected sources (not shipped)
const TEST_FIXTURE: readonly Problem[] = [
  {
    id: 'test-1',
    title: 'Test Problem One',
    url: 'https://example.com/problem-one',
    difficulty: 'easy',
    topics: ['test-topic-a'],
  },
  {
    id: 'test-2',
    title: 'Test Problem Two',
    url: 'https://example.com/problem-two',
    difficulty: 'medium',
    topics: ['test-topic-a', 'test-topic-b'],
  },
  {
    id: 'test-3',
    title: 'Test Problem Three',
    url: 'https://example.com/problem-three',
    difficulty: 'hard',
    topics: ['test-topic-b', 'test-topic-c'],
  },
];

describe('@ibai/curriculum', () => {
  describe('createCatalogSource with shipped CATALOG (default)', () => {
    const src = createCatalogSource();

    it('list() returns all problems and count matches CATALOG length', () => {
      const all = src.list();
      expect(all.length).toBe(CATALOG.length);
      expect(all).toBe(src.list()); // Same readonly reference
    });

    it('getById() returns the correct problem for a known id', () => {
      const problem = src.getById('lc-1');
      expect(problem).toBeDefined();
      expect(problem!.title).toBe('Two Sum');
      expect(problem!.difficulty).toBe('easy');
    });

    it('getById() returns undefined for unknown id', () => {
      expect(src.getById('nonexistent-id')).toBeUndefined();
    });

    it('filterByDifficulty("easy") returns only easy problems', () => {
      const easy = src.filterByDifficulty('easy');
      const manualCount = CATALOG.filter((p) => p.difficulty === 'easy').length;
      expect(easy.length).toBe(manualCount);
      expect(easy.every((p) => p.difficulty === 'easy')).toBe(true);
    });

    it('filterByDifficulty("medium") returns only medium problems', () => {
      const medium = src.filterByDifficulty('medium');
      const manualCount = CATALOG.filter(
        (p) => p.difficulty === 'medium',
      ).length;
      expect(medium.length).toBe(manualCount);
      expect(medium.every((p) => p.difficulty === 'medium')).toBe(true);
    });

    it('filterByDifficulty("hard") returns only hard problems', () => {
      const hard = src.filterByDifficulty('hard');
      const manualCount = CATALOG.filter((p) => p.difficulty === 'hard').length;
      expect(hard.length).toBe(manualCount);
      expect(hard.every((p) => p.difficulty === 'hard')).toBe(true);
    });

    it('filterByTopic returns only problems tagged with that topic', () => {
      const arraysHashing = src.filterByTopic('arrays-hashing');
      expect(arraysHashing.length).toBeGreaterThan(0);
      expect(
        arraysHashing.every((p) => p.topics.includes('arrays-hashing')),
      ).toBe(true);
    });

    it('filterByTopic returns empty array for unknown topic', () => {
      expect(src.filterByTopic('nonexistent-topic')).toEqual([]);
    });
  });

  describe('createCatalogSource with injected fixture', () => {
    const src = createCatalogSource(TEST_FIXTURE);

    it('list() returns all problems from fixture', () => {
      const all = src.list();
      expect(all.length).toBe(TEST_FIXTURE.length);
      expect(all.length).toBe(3);
    });

    it('getById() hit returns the right problem', () => {
      const p = src.getById('test-2');
      expect(p).toBeDefined();
      expect(p!.title).toBe('Test Problem Two');
      expect(p!.difficulty).toBe('medium');
    });

    it('getById() miss returns undefined', () => {
      expect(src.getById('lc-1')).toBeUndefined(); // not in fixture
    });

    it('filterByDifficulty works correctly', () => {
      expect(src.filterByDifficulty('easy').length).toBe(1);
      expect(src.filterByDifficulty('medium').length).toBe(1);
      expect(src.filterByDifficulty('hard').length).toBe(1);
    });

    it('filterByTopic returns matching entries', () => {
      const topicA = src.filterByTopic('test-topic-a');
      expect(topicA.length).toBe(2);
      expect(topicA.every((p) => p.topics.includes('test-topic-a'))).toBe(true);

      const topicB = src.filterByTopic('test-topic-b');
      expect(topicB.length).toBe(2);

      const topicC = src.filterByTopic('test-topic-c');
      expect(topicC.length).toBe(1);
    });

    it('filterByTopic returns empty for unknown topic', () => {
      expect(src.filterByTopic('unknown')).toEqual([]);
    });
  });

  describe('shipped CATALOG invariants', () => {
    it('has no duplicate ids', () => {
      const ids = CATALOG.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('every difficulty is one of easy|medium|hard', () => {
      const validDifficulties: Difficulty[] = ['easy', 'medium', 'hard'];
      for (const p of CATALOG) {
        expect(validDifficulties).toContain(p.difficulty);
      }
    });

    it('every url is a well-formed https:// URL', () => {
      for (const p of CATALOG) {
        expect(p.url).toMatch(/^https:\/\//);
      }
    });

    it('every entry has 1-3 topics', () => {
      for (const p of CATALOG) {
        expect(p.topics.length).toBeGreaterThanOrEqual(1);
        expect(p.topics.length).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('CATALOG key guard (product rule lock)', () => {
    const ALLOWED_KEYS = ['difficulty', 'id', 'title', 'topics', 'url'];
    const FORBIDDEN_KEYS = [
      'answer',
      'solution',
      'hint',
      'description',
      'intuition',
      'walkthrough',
      'notes',
    ];

    it('every Problem has exactly the allowed keys', () => {
      for (const p of CATALOG) {
        const keys = Object.keys(p).sort();
        expect(keys).toEqual(ALLOWED_KEYS);
      }
    });

    it('no Problem has forbidden keys (answers/hints/solutions/etc)', () => {
      for (const p of CATALOG) {
        const keys = Object.keys(p);
        for (const forbidden of FORBIDDEN_KEYS) {
          expect(keys).not.toContain(forbidden);
        }
      }
    });
  });

  describe('type compile checks', () => {
    it('exposes the Problem shape', () => {
      const sample: Problem = {
        id: 'x',
        title: 'x',
        url: 'https://example.com',
        difficulty: 'easy',
        topics: [],
      };
      const d: Difficulty = 'medium';
      expect(sample.difficulty === 'easy' || d === 'medium').toBe(true);
    });

    it('CurriculumSource interface is correctly typed', () => {
      const src: CurriculumSource = createCatalogSource([]);
      expect(src.list()).toEqual([]);
      expect(src.getById('nope')).toBeUndefined();
      expect(src.filterByDifficulty('easy')).toEqual([]);
      expect(src.filterByTopic('any')).toEqual([]);
    });
  });
});
