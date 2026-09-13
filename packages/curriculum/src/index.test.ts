import { describe, it, expect } from 'vitest';
import type { Problem, Difficulty, CurriculumSource } from './index.js';
import { CATALOG } from './index.js';

describe('@ibai/curriculum skeleton', () => {
  it('ships an empty placeholder catalog', () => {
    expect(CATALOG).toEqual([]);
  });

  it('exposes the Problem shape (types-only compile check)', () => {
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

  it('CurriculumSource is read-only (structural smoke)', () => {
    const src: CurriculumSource = {
      list: () => CATALOG,
      getById: () => undefined,
      filterByDifficulty: () => [],
      filterByTopic: () => [],
    };
    expect(src.list()).toEqual([]);
    expect(src.getById('nope')).toBeUndefined();
  });
});
