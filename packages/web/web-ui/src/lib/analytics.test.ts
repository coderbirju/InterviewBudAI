import { describe, it, expect } from 'vitest';
import type { CatalogResponse, StatusCounts } from './api';
import {
  STATUS_CHART_ORDER,
  STATUS_COLORS,
  barLength,
  completionPercent,
  hasTrackedData,
  statusSlices,
  topicCompletionBars,
  totalCount,
} from './analytics';

const COUNTS: StatusCounts = {
  none: 5,
  done: 3,
  to_revisit: 2,
  did_not_understand: 0,
};

const ZERO_COUNTS: StatusCounts = {
  none: 0,
  done: 0,
  to_revisit: 0,
  did_not_understand: 0,
};

const CATALOG: CatalogResponse = {
  topics: [
    {
      topic: 'Arrays & Hashing',
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
        {
          id: 'd',
          title: 'D',
          url: 'https://x/d',
          difficulty: 'Easy',
          status: 'none',
          completed: false,
        },
      ],
    },
    {
      topic: 'Empty Topic',
      problems: [],
    },
  ],
  totals: {
    total: 4,
    byStatus: { none: 1, done: 2, to_revisit: 1, did_not_understand: 0 },
  },
};

describe('analytics: counts', () => {
  it('sums the four per-status counts', () => {
    expect(totalCount(COUNTS)).toBe(10);
    expect(totalCount(ZERO_COUNTS)).toBe(0);
  });
});

describe('analytics: statusSlices', () => {
  it('returns the four statuses in fixed order with token colors', () => {
    const slices = statusSlices(COUNTS);
    expect(slices.map((s) => s.status)).toEqual(STATUS_CHART_ORDER);
    expect(slices.map((s) => s.status)).toEqual([
      'done',
      'to_revisit',
      'did_not_understand',
      'none',
    ]);
    // Colors come from the design-system tokens.
    expect(slices[0].color).toBe(STATUS_COLORS.done);
    expect(slices[0].color).toBe('#22c55e');
  });

  it('maps counts and fractions of the tracked total', () => {
    const slices = statusSlices(COUNTS);
    const done = slices.find((s) => s.status === 'done');
    expect(done?.count).toBe(3);
    // 3 / 10 tracked.
    expect(done?.fraction).toBeCloseTo(0.3, 5);
    const none = slices.find((s) => s.status === 'none');
    expect(none?.count).toBe(5);
    expect(none?.fraction).toBeCloseTo(0.5, 5);
  });

  it('yields zero fractions (no divide-by-zero) when nothing is tracked', () => {
    const slices = statusSlices(ZERO_COUNTS);
    expect(slices.every((s) => s.count === 0 && s.fraction === 0)).toBe(true);
  });

  it('carries a human-readable label per status', () => {
    const labels = statusSlices(COUNTS).map((s) => s.label);
    expect(labels).toEqual([
      'Done',
      'To revisit',
      "Didn't understand",
      'Not started',
    ]);
  });
});

describe('analytics: barLength', () => {
  it('scales a value proportionally to the axis length', () => {
    expect(barLength(5, 10, 200)).toBe(100);
    expect(barLength(10, 10, 200)).toBe(200);
    expect(barLength(0, 10, 200)).toBe(0);
  });

  it('returns 0 for a non-positive max or axis (no divide-by-zero)', () => {
    expect(barLength(5, 0, 200)).toBe(0);
    expect(barLength(5, 10, 0)).toBe(0);
    expect(barLength(5, -1, 200)).toBe(0);
  });

  it('clamps an over-max value to the axis length', () => {
    expect(barLength(20, 10, 200)).toBe(200);
    expect(barLength(-5, 10, 200)).toBe(0);
  });
});

describe('analytics: topicCompletionBars', () => {
  it('computes per-topic done/total, fraction, and proportional length', () => {
    const bars = topicCompletionBars(CATALOG, 300);
    expect(bars).toHaveLength(2);

    const arrays = bars[0];
    expect(arrays.topic).toBe('Arrays & Hashing');
    expect(arrays.done).toBe(2);
    expect(arrays.total).toBe(4);
    expect(arrays.fraction).toBeCloseTo(0.5, 5);
    // done=2 of total=4 over a 300-unit axis → 150.
    expect(arrays.length).toBe(150);
  });

  it('handles an empty topic with zero fraction and zero length', () => {
    const bars = topicCompletionBars(CATALOG, 300);
    const empty = bars[1];
    expect(empty.topic).toBe('Empty Topic');
    expect(empty.done).toBe(0);
    expect(empty.total).toBe(0);
    expect(empty.fraction).toBe(0);
    expect(empty.length).toBe(0);
  });

  it('preserves the server catalog topic order', () => {
    const bars = topicCompletionBars(CATALOG, 300);
    expect(bars.map((b) => b.topic)).toEqual([
      'Arrays & Hashing',
      'Empty Topic',
    ]);
  });
});

describe('analytics: hasTrackedData', () => {
  it('is true only when a DB is configured and something is tracked', () => {
    expect(hasTrackedData(true, COUNTS)).toBe(true);
    expect(hasTrackedData(true, ZERO_COUNTS)).toBe(false);
    expect(hasTrackedData(false, COUNTS)).toBe(false);
    expect(hasTrackedData(false, ZERO_COUNTS)).toBe(false);
  });
});

describe('analytics: completionPercent', () => {
  it('rounds a completed/total percentage and clamps to [0, 100]', () => {
    expect(completionPercent(0, 100)).toBe(0);
    expect(completionPercent(1, 3)).toBe(33);
    expect(completionPercent(2, 3)).toBe(67);
    expect(completionPercent(100, 100)).toBe(100);
    expect(completionPercent(5, 0)).toBe(0); // no divide-by-zero
    expect(completionPercent(150, 100)).toBe(100); // clamp
  });
});
