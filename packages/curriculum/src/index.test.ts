import { describe, it, expect } from 'vitest';
import type { Problem, Difficulty, CurriculumSource } from './index.js';
import { CATALOG, createCatalogSource } from './index.js';

describe('@ibai/curriculum exports', () => {
  it('exports a non-empty CATALOG', () => {
    expect(CATALOG.length).toBeGreaterThan(0);
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

  it('CurriculumSource interface is implemented by createCatalogSource', () => {
    const src: CurriculumSource = createCatalogSource();
    expect(src.list().length).toBe(CATALOG.length);
    expect(typeof src.getById).toBe('function');
    expect(typeof src.filterByDifficulty).toBe('function');
    expect(typeof src.filterByTopic).toBe('function');
  });
});
