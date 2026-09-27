import { describe, it, expect } from 'vitest';
import type { CompetencyResponse, CompetencyTopic } from './api';
import {
  STRENGTH_COLORS,
  STRENGTH_LABELS,
  competencyBars,
  groupByStrength,
  hasCompetencyData,
} from './competency';

const TOPICS: readonly CompetencyTopic[] = [
  {
    topicId: 'Dynamic Programming',
    correct: 1,
    incorrect: 4,
    strength: 'weak',
    lastSeen: '2026-09-24T12:00:00.000Z',
  },
  {
    topicId: 'Graphs',
    correct: 3,
    incorrect: 3,
    strength: 'improving',
    lastSeen: '2026-09-24T12:00:00.000Z',
  },
  {
    topicId: 'Arrays & Hashing',
    correct: 5,
    incorrect: 1,
    strength: 'strong',
    lastSeen: '2026-09-24T12:00:00.000Z',
  },
  {
    topicId: 'Tries',
    correct: 1,
    incorrect: 1,
    strength: 'unknown',
    lastSeen: null,
  },
];

const RESPONSE: CompetencyResponse = {
  topics: TOPICS,
  patterns: [
    {
      id: 'miss:lc-322',
      description: 'Missed "Coin Change".',
      topics: ['Dynamic Programming'],
      occurrences: 3,
      lastObserved: '2026-09-24T12:00:00.000Z',
    },
  ],
};

describe('competency: STRENGTH_COLORS/LABELS', () => {
  it('maps each band to the design-system token color', () => {
    expect(STRENGTH_COLORS.strong).toBe('#22c55e'); // emerald
    expect(STRENGTH_COLORS.improving).toBe('#f59e0b'); // amber
    expect(STRENGTH_COLORS.weak).toBe('#ef4444'); // red
    expect(STRENGTH_COLORS.unknown).toBe('#64748b'); // slate
  });

  it('carries a human-readable label per band', () => {
    expect(STRENGTH_LABELS.weak).toBe('Weak');
    expect(STRENGTH_LABELS.strong).toBe('Strong');
    expect(STRENGTH_LABELS.improving).toBe('Improving');
    expect(STRENGTH_LABELS.unknown).toBe('Not enough data');
  });
});

describe('competency: competencyBars', () => {
  it('computes total, correct-ratio fraction, color, label, and length', () => {
    const bars = competencyBars(TOPICS, 300);
    expect(bars).toHaveLength(4);

    const dp = bars[0];
    expect(dp.topicId).toBe('Dynamic Programming');
    expect(dp.total).toBe(5);
    expect(dp.fraction).toBeCloseTo(0.2, 5);
    expect(dp.color).toBe('#ef4444'); // weak → red
    expect(dp.label).toBe('Weak');
    // correct=1 of total=5 over a 300-unit axis → 60.
    expect(dp.length).toBe(60);

    const arrays = bars[2];
    expect(arrays.color).toBe('#22c55e'); // strong → emerald
    expect(arrays.fraction).toBeCloseTo(5 / 6, 5);
    expect(arrays.length).toBeCloseTo((5 / 6) * 300, 5);
  });

  it('uses the server topic label, falling back to the raw id', () => {
    const bars = competencyBars(
      [
        {
          topicId: 'stack',
          label: 'Stack & Queue',
          correct: 1,
          incorrect: 0,
          strength: 'unknown',
          lastSeen: null,
        },
        {
          topicId: 'custom',
          correct: 1,
          incorrect: 0,
          strength: 'unknown',
          lastSeen: null,
        },
      ],
      300,
    );
    expect(bars.map((b) => b.topicLabel)).toEqual(['Stack & Queue', 'custom']);
  });

  it('preserves the response (worst-first) order', () => {
    const bars = competencyBars(TOPICS, 300);
    expect(bars.map((b) => b.topicId)).toEqual([
      'Dynamic Programming',
      'Graphs',
      'Arrays & Hashing',
      'Tries',
    ]);
  });

  it('yields zero fraction/length for a topic with no attempts (no divide-by-zero)', () => {
    const bars = competencyBars(
      [
        {
          topicId: 'Empty',
          correct: 0,
          incorrect: 0,
          strength: 'unknown',
          lastSeen: null,
        },
      ],
      300,
    );
    expect(bars[0].total).toBe(0);
    expect(bars[0].fraction).toBe(0);
    expect(bars[0].length).toBe(0);
  });
});

describe('competency: groupByStrength', () => {
  it('buckets topics by band, preserving order within a bucket', () => {
    const groups = groupByStrength(TOPICS);
    expect(groups.weak.map((t) => t.topicId)).toEqual(['Dynamic Programming']);
    expect(groups.improving.map((t) => t.topicId)).toEqual(['Graphs']);
    expect(groups.strong.map((t) => t.topicId)).toEqual(['Arrays & Hashing']);
    expect(groups.unknown.map((t) => t.topicId)).toEqual(['Tries']);
  });

  it('returns empty buckets for missing bands', () => {
    const groups = groupByStrength([]);
    expect(groups.weak).toEqual([]);
    expect(groups.improving).toEqual([]);
    expect(groups.strong).toEqual([]);
    expect(groups.unknown).toEqual([]);
  });
});

describe('competency: hasCompetencyData', () => {
  it('is true when there is at least one topic or one pattern', () => {
    expect(hasCompetencyData(RESPONSE)).toBe(true);
    expect(hasCompetencyData({ topics: TOPICS, patterns: [] })).toBe(true);
    expect(hasCompetencyData({ topics: [], patterns: RESPONSE.patterns })).toBe(
      true,
    );
  });

  it('is false for a fully empty dataset', () => {
    expect(hasCompetencyData({ topics: [], patterns: [] })).toBe(false);
  });
});
