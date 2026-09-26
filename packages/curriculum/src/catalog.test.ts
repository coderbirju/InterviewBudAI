import { describe, it, expect } from 'vitest';
import { CATALOG, createCatalogSource } from './index.js';
import type { Problem, Difficulty } from './index.js';

describe('@ibai/curriculum CATALOG', () => {
  it('has no duplicate ids', () => {
    const ids = CATALOG.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('all difficulties are valid', () => {
    const validDifficulties: Difficulty[] = ['easy', 'medium', 'hard'];
    for (const problem of CATALOG) {
      expect(validDifficulties).toContain(problem.difficulty);
    }
  });

  it('all urls match LeetCode pattern', () => {
    const urlPattern = /^https:\/\/leetcode\.com\/problems\/[a-z0-9-]+\/$/;
    for (const problem of CATALOG) {
      expect(problem.url).toMatch(urlPattern);
    }
  });

  it('all ids match expected pattern', () => {
    const idPattern = /^(lc-\d+|sysd-[a-z0-9-]+|misc-[a-z0-9-]+)$/;
    for (const problem of CATALOG) {
      expect(problem.id).toMatch(idPattern);
    }
  });

  it('all problems have ONLY allowed fields (no intuition/notes/answers)', () => {
    const allowedFields = new Set([
      'id',
      'title',
      'url',
      'difficulty',
      'topics',
    ]);
    for (const problem of CATALOG) {
      const keys = Object.keys(problem);
      for (const key of keys) {
        expect(allowedFields.has(key)).toBe(true);
      }
      expect(keys.length).toBe(5);
    }
  });

  it('all topics arrays are non-empty', () => {
    for (const problem of CATALOG) {
      expect(problem.topics.length).toBeGreaterThan(0);
    }
  });

  it('no problem lists the same topic twice', () => {
    for (const problem of CATALOG) {
      expect(new Set(problem.topics).size).toBe(problem.topics.length);
    }
  });

  it('ids are unique within every per-topic list', () => {
    const source = createCatalogSource();
    const topics = new Set(CATALOG.flatMap((p) => p.topics));
    for (const topic of topics) {
      const ids = source.filterByTopic(topic).map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('multi-topic problems are only the deliberate ones in IMPORT-MANIFEST.md', () => {
    // ADR 0003 allows several topics per problem. Each such entry counts once
    // in de-duplicated totals but toward every topic it is tagged with, so a
    // new one must be a conscious choice recorded in the import manifest.
    const multi = CATALOG.filter((p) => p.topics.length > 1).map((p) => ({
      id: p.id,
      topics: [...p.topics],
    }));
    expect(multi).toEqual([
      { id: 'lc-209', topics: ['arrays-2d', 'sliding-window'] },
    ]);
  });

  it('catalog is not empty', () => {
    expect(CATALOG.length).toBeGreaterThan(0);
  });
});

describe('createCatalogSource', () => {
  const source = createCatalogSource();

  it('list() returns all catalog entries', () => {
    const list = source.list();
    expect(list.length).toBe(CATALOG.length);
    expect(list).toEqual(CATALOG);
  });

  it('getById() returns correct problem', () => {
    const first = CATALOG[0];
    const found = source.getById(first.id);
    expect(found).toEqual(first);
  });

  it('getById() returns undefined for non-existent id', () => {
    const notFound = source.getById('lc-9999999');
    expect(notFound).toBeUndefined();
  });

  it('filterByDifficulty() returns correct problems', () => {
    const easyProblems = source.filterByDifficulty('easy');
    const expectedEasy = CATALOG.filter((p) => p.difficulty === 'easy');
    expect(easyProblems.length).toBe(expectedEasy.length);
    for (const p of easyProblems) {
      expect(p.difficulty).toBe('easy');
    }
  });

  it('filterByDifficulty() returns empty for no matches', () => {
    const mediumOnly: Problem[] = [
      {
        id: 'test-1',
        title: 'Test',
        url: 'https://leetcode.com/problems/test/',
        difficulty: 'medium',
        topics: ['test'],
      },
    ];
    const customSource = createCatalogSource(mediumOnly);
    expect(customSource.filterByDifficulty('easy')).toEqual([]);
  });

  it('filterByTopic() returns correct problems', () => {
    const topicToTest = CATALOG[0].topics[0];
    const topicProblems = source.filterByTopic(topicToTest);
    expect(topicProblems.length).toBeGreaterThan(0);
    for (const p of topicProblems) {
      expect(p.topics).toContain(topicToTest);
    }
  });

  it('filterByTopic() returns empty for non-existent topic', () => {
    const noMatch = source.filterByTopic('nonexistent-topic-xyz');
    expect(noMatch).toEqual([]);
  });

  it('accepts custom catalog', () => {
    const custom: Problem[] = [
      {
        id: 'custom-1',
        title: 'Custom Problem',
        url: 'https://leetcode.com/problems/custom/',
        difficulty: 'hard',
        topics: ['custom-topic'],
      },
    ];
    const customSource = createCatalogSource(custom);
    expect(customSource.list()).toEqual(custom);
    expect(customSource.getById('custom-1')).toEqual(custom[0]);
  });
});
