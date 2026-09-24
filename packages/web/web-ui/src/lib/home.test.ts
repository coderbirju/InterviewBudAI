import { describe, it, expect } from 'vitest';
import type { CatalogTopic } from './api';
import {
  difficultyBadgeClasses,
  formatFraction,
  percent,
  statusPillClasses,
  topicCompletion,
  STATUS_ORDER,
} from './home';

describe('home helpers', () => {
  it('formats a fraction as "completed / total"', () => {
    expect(formatFraction(12, 175)).toBe('12 / 175');
    expect(formatFraction(0, 0)).toBe('0 / 0');
  });

  it('computes a clamped percentage', () => {
    expect(percent(0, 100)).toBe(0);
    expect(percent(50, 100)).toBe(50);
    expect(percent(100, 100)).toBe(100);
    expect(percent(5, 0)).toBe(0); // no divide-by-zero
  });

  it('maps difficulty to the strict token colors', () => {
    expect(difficultyBadgeClasses('Easy')).toContain('difficulty-easy');
    expect(difficultyBadgeClasses('Medium')).toContain('difficulty-medium');
    expect(difficultyBadgeClasses('Hard')).toContain('difficulty-hard');
  });

  it('maps status to the token colors, none is neutral', () => {
    expect(statusPillClasses('done')).toContain('status-done');
    expect(statusPillClasses('to_revisit')).toContain('status-revisit');
    expect(statusPillClasses('did_not_understand')).toContain('status-blocked');
    expect(statusPillClasses('none')).toContain('slate');
  });

  it('offers all four statuses in the menu order', () => {
    expect(STATUS_ORDER).toEqual([
      'none',
      'done',
      'to_revisit',
      'did_not_understand',
    ]);
  });

  it('counts done problems per topic', () => {
    const topic: CatalogTopic = {
      topic: 'Arrays',
      problems: [
        {
          id: 'a',
          title: 'A',
          url: 'https://x/a',
          difficulty: 'Easy',
          status: 'done',
          completed: true,
        },
        {
          id: 'b',
          title: 'B',
          url: 'https://x/b',
          difficulty: 'Medium',
          status: 'to_revisit',
          completed: false,
        },
        {
          id: 'c',
          title: 'C',
          url: 'https://x/c',
          difficulty: 'Hard',
          status: 'done',
          completed: true,
        },
      ],
    };
    expect(topicCompletion(topic)).toEqual({ done: 2, total: 3 });
  });
});
