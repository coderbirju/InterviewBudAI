import { describe, it, expect } from 'vitest';
import {
  MISS_LABELS,
  STATUS_ORDER,
  UNKNOWN_MISS_LABEL,
  arcDash,
  donutSegments,
  donutSummary,
  missLabel,
  ringFraction,
} from './analytics';
import { normalizeInsights } from './api';
import type { InsightsResponse, InsightsStatus } from './api';
import { INSIGHTS_LOCKED, INSIGHTS_UNLOCKED } from './insights.fixture';

const STATUS: InsightsStatus = {
  done: 12,
  toRevisit: 3,
  didNotUnderstand: 1,
  notStarted: 140,
  total: 156,
};
const ZERO: InsightsStatus = {
  done: 0,
  toRevisit: 0,
  didNotUnderstand: 0,
  notStarted: 0,
  total: 0,
};

describe('donutSegments', () => {
  it('keeps the fixed order and lengths that sum to 100%', () => {
    const segs = donutSegments(STATUS);
    expect(segs.map((s) => s.key)).toEqual(STATUS_ORDER);
    const sum = segs.reduce((a, s) => a + s.length, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(segs[0]?.length).toBeCloseTo(12 / 156);
  });

  it('chains segments: each starts where the previous ends', () => {
    const segs = donutSegments(STATUS);
    expect(segs[0]?.start).toBe(0);
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1]!;
      expect(segs[i]?.start).toBeCloseTo(prev.start + prev.length);
    }
  });

  it('is zero-total safe (all lengths 0, no NaN)', () => {
    const segs = donutSegments(ZERO);
    for (const s of segs) {
      expect(s.length).toBe(0);
      expect(s.start).toBe(0);
    }
  });

  it('treats negative / non-finite counts as 0', () => {
    const segs = donutSegments({
      ...ZERO,
      done: -4,
      toRevisit: Number.NaN,
      notStarted: 2,
    });
    expect(segs.map((s) => s.count)).toEqual([0, 0, 0, 2]);
    expect(segs[3]?.length).toBe(1);
  });

  it('a single non-zero bucket fills the whole circle', () => {
    const segs = donutSegments({ ...ZERO, done: 5, total: 5 });
    expect(segs[0]?.length).toBe(1);
  });
});

describe('arcDash / ringFraction', () => {
  it('maps start/length onto a circumference', () => {
    expect(arcDash(0.25, 0.5, 100)).toEqual({
      dasharray: '50 50',
      dashoffset: -25,
    });
  });

  it('clamps out-of-range and NaN input', () => {
    expect(arcDash(-1, 2, 100)).toEqual({ dasharray: '100 0', dashoffset: -0 });
    expect(arcDash(Number.NaN, Number.NaN, 100).dasharray).toBe('0 100');
  });

  it('ringFraction is done/total in [0,1], 0 for a 0 total', () => {
    expect(ringFraction(5, 10)).toBe(0.5);
    expect(ringFraction(3, 0)).toBe(0);
    expect(ringFraction(12, 10)).toBe(1);
  });
});

describe('donutSummary', () => {
  it('reads every bucket with its count', () => {
    expect(donutSummary(STATUS)).toBe(
      "156 problems: 12 done, 3 to revisit, 1 didn't understand, 140 not started",
    );
  });
});

describe('missLabel', () => {
  it('prefers the API label', () => {
    expect(missLabel('edge', 'From the server')).toBe('From the server');
  });

  it('falls back to the client map for a known code', () => {
    expect(missLabel('complexity', undefined)).toBe(MISS_LABELS.complexity);
    expect(missLabel('boundary', '  ')).toBe('Off-by-one / boundaries');
  });

  it('uses a generic label for an unknown code (never the raw code)', () => {
    expect(missLabel('zzz', undefined)).toBe(UNKNOWN_MISS_LABEL);
    expect(missLabel('toString', '')).toBe(UNKNOWN_MISS_LABEL);
  });

  it('covers all seven ADR 0012 codes', () => {
    expect(Object.keys(MISS_LABELS).sort()).toEqual(
      [
        'boundary',
        'brute',
        'complexity',
        'edge',
        'misread',
        'technique',
        'vague',
      ].sort(),
    );
  });
});

describe('normalizeInsights', () => {
  it('passes a well-formed payload through', () => {
    expect(normalizeInsights(INSIGHTS_UNLOCKED)).toEqual(INSIGHTS_UNLOCKED);
  });

  it('empties focus/slips/strengths unless unlocked', () => {
    const out = normalizeInsights({ ...INSIGHTS_UNLOCKED, state: 'locked' });
    expect(out.focus).toEqual([]);
    expect(out.slips).toEqual([]);
    expect(out.strengths).toEqual([]);
  });

  it('degrades an unknown state / missing fields to a zeroed locked view', () => {
    const out = normalizeInsights({
      state: 'weird',
      generatedAt: 'x',
    } as unknown as InsightsResponse);
    expect(out.state).toBe('locked');
    expect(out.sessions).toEqual({ counted: 0, required: 2 });
    expect(out.status).toEqual(ZERO);
    expect(out.topics).toEqual([]);
  });

  it('keeps topics in API order', () => {
    expect(normalizeInsights(INSIGHTS_LOCKED).topics).toBe(
      INSIGHTS_LOCKED.topics,
    );
  });
});
