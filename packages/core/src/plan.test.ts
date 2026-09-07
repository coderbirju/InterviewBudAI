/**
 * Tests for the Plan engine job.
 *
 * Plan is pure and synchronous — takes an AssessmentView, returns a SessionPlan.
 * Tests construct AssessmentView literals directly (no storage needed).
 */

import { describe, it, expect } from 'vitest';
import type { AssessmentView, TopicProficiency } from './assess.js';
import type { WeaknessEntry, TopicId, IsoTimestamp } from '@ibai/storage';
import { plan } from './plan.js';

// ---------------------------------------------------------------------------
// Helper to create AssessmentView literals
// ---------------------------------------------------------------------------

function createView(overrides: Partial<AssessmentView> = {}): AssessmentView {
  return {
    topicsTracked: 0,
    topStrengths: [],
    focusAreas: [],
    recurringWeaknesses: [],
    recentSession: null,
    ...overrides,
  };
}

function tp(topicId: string, proficiency: number): TopicProficiency {
  return { topicId: topicId as TopicId, proficiency };
}

function we(
  topicId: string,
  occurrences: number,
  note: string = 'test weakness',
): WeaknessEntry {
  return {
    topicId: topicId as TopicId,
    note,
    occurrences,
    lastObserved: '2026-09-01T00:00:00.000Z' as IsoTimestamp,
  };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('plan', () => {
  describe('empty/new user', () => {
    it('returns empty topics array and default summary when no data', () => {
      const view = createView({
        topicsTracked: 0,
        topStrengths: [],
        focusAreas: [],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      expect(result.topics).toEqual([]);
      expect(result.summary).toBe(
        'No history yet — start with a broad baseline session.',
      );
    });
  });

  describe('populated view', () => {
    it('selects warmup from topStrengths, focus from focusAreas, twist from recurringWeaknesses', () => {
      const view = createView({
        topicsTracked: 5,
        topStrengths: [tp('sorting', 0.9), tp('arrays', 0.8)],
        focusAreas: [tp('graphs', 0.3), tp('dp', 0.4), tp('trees', 0.5)],
        recurringWeaknesses: [we('recursion', 5), we('graphs', 3)],
      });

      const result = plan(view);

      // Should have: warmup (sorting), focus (graphs, dp, trees), twist (recursion)
      expect(result.topics).toHaveLength(5);

      // Check ordering: warmup first
      expect(result.topics[0].role).toBe('warmup');
      expect(result.topics[0].topicId).toBe('sorting');

      // Then focus topics in order (graphs, dp, trees)
      expect(result.topics[1].role).toBe('focus');
      expect(result.topics[1].topicId).toBe('graphs');
      expect(result.topics[2].role).toBe('focus');
      expect(result.topics[2].topicId).toBe('dp');
      expect(result.topics[3].role).toBe('focus');
      expect(result.topics[3].topicId).toBe('trees');

      // Twist last (recursion, not graphs which is already in focus)
      expect(result.topics[4].role).toBe('twist');
      expect(result.topics[4].topicId).toBe('recursion');
    });

    it('limits focus topics to MAX_FOCUS_TOPICS (3)', () => {
      const view = createView({
        topicsTracked: 6,
        topStrengths: [tp('sorting', 0.9)],
        focusAreas: [
          tp('a', 0.1),
          tp('b', 0.2),
          tp('c', 0.3),
          tp('d', 0.4),
          tp('e', 0.5),
        ],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      const focusTopics = result.topics.filter((t) => t.role === 'focus');
      expect(focusTopics).toHaveLength(3);
      expect(focusTopics.map((t) => t.topicId)).toEqual(['a', 'b', 'c']);
    });

    it('skips warmup if topStrengths[0] is already in focus', () => {
      // If the strongest topic is also the weakest (only one topic tracked)
      const view = createView({
        topicsTracked: 1,
        topStrengths: [tp('graphs', 0.5)],
        focusAreas: [tp('graphs', 0.5)],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      // graphs should be focus (higher precedence), not warmup
      expect(result.topics).toHaveLength(1);
      expect(result.topics[0].role).toBe('focus');
      expect(result.topics[0].topicId).toBe('graphs');
    });

    it('skips twist if all weaknesses are already in plan', () => {
      const view = createView({
        topicsTracked: 3,
        topStrengths: [tp('sorting', 0.9)],
        focusAreas: [tp('graphs', 0.3), tp('dp', 0.4)],
        recurringWeaknesses: [we('graphs', 5), we('dp', 3)], // both already in focus
      });

      const result = plan(view);

      const twistTopics = result.topics.filter((t) => t.role === 'twist');
      expect(twistTopics).toHaveLength(0);
    });
  });

  describe('rationale is mechanical', () => {
    it('focus rationale contains correct percent', () => {
      const view = createView({
        topicsTracked: 1,
        topStrengths: [],
        focusAreas: [tp('graphs', 0.35)],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      expect(result.topics[0].rationale).toContain('35%');
      expect(result.topics[0].rationale).toContain('lowest proficiency');
    });

    it('focus rationale includes weakness count when topic has recurring weakness', () => {
      const view = createView({
        topicsTracked: 1,
        topStrengths: [],
        focusAreas: [tp('graphs', 0.3)],
        recurringWeaknesses: [we('graphs', 4)],
      });

      const result = plan(view);

      expect(result.topics[0].rationale).toContain('30%');
      expect(result.topics[0].rationale).toContain('4 recurring misses');
    });

    it('warmup rationale contains strongest area percent', () => {
      const view = createView({
        topicsTracked: 2,
        topStrengths: [tp('sorting', 0.87)],
        focusAreas: [tp('graphs', 0.3)],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      const warmup = result.topics.find((t) => t.role === 'warmup');
      expect(warmup).toBeDefined();
      expect(warmup!.rationale).toContain('87%');
      expect(warmup!.rationale).toContain('strongest area');
      expect(warmup!.rationale).toContain('warm up here');
    });

    it('twist rationale contains miss count', () => {
      const view = createView({
        topicsTracked: 2,
        topStrengths: [tp('sorting', 0.9)],
        focusAreas: [tp('graphs', 0.3)],
        recurringWeaknesses: [we('recursion', 7)],
      });

      const result = plan(view);

      const twist = result.topics.find((t) => t.role === 'twist');
      expect(twist).toBeDefined();
      expect(twist!.rationale).toContain('7 misses');
      expect(twist!.rationale).toContain('recurring weakness');
      expect(twist!.rationale).toContain('stretch');
    });

    it('handles singular miss correctly', () => {
      const view = createView({
        topicsTracked: 2,
        topStrengths: [tp('sorting', 0.9)],
        focusAreas: [tp('graphs', 0.3)],
        recurringWeaknesses: [we('recursion', 1)],
      });

      const result = plan(view);

      const twist = result.topics.find((t) => t.role === 'twist');
      expect(twist!.rationale).toContain('1 miss');
      expect(twist!.rationale).not.toContain('1 misses');
    });
  });

  describe('determinism and tie-breaks', () => {
    it('calling plan twice on same input yields deeply-equal output', () => {
      const view = createView({
        topicsTracked: 4,
        topStrengths: [tp('sorting', 0.9), tp('arrays', 0.8)],
        focusAreas: [tp('graphs', 0.3), tp('dp', 0.4)],
        recurringWeaknesses: [we('recursion', 5)],
      });

      const result1 = plan(view);
      const result2 = plan(view);

      expect(result1).toEqual(result2);
    });

    it('maintains stable ordering from pre-sorted input arrays', () => {
      // focusAreas are already sorted by proficiency ASC with topicId tie-break
      // This test verifies plan doesn't re-sort and preserves that order
      const view = createView({
        topicsTracked: 3,
        topStrengths: [],
        focusAreas: [
          tp('alpha', 0.3), // same proficiency, alpha < beta
          tp('beta', 0.3),
          tp('gamma', 0.4),
        ],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      const focusTopics = result.topics.filter((t) => t.role === 'focus');
      expect(focusTopics.map((t) => t.topicId)).toEqual([
        'alpha',
        'beta',
        'gamma',
      ]);
    });
  });

  describe('edge cases', () => {
    it('handles no strengths (only focus topics)', () => {
      const view = createView({
        topicsTracked: 2,
        topStrengths: [],
        focusAreas: [tp('graphs', 0.3), tp('dp', 0.4)],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      expect(result.topics).toHaveLength(2);
      expect(result.topics.every((t) => t.role === 'focus')).toBe(true);
    });

    it('handles no weaknesses (warmup + focus only)', () => {
      const view = createView({
        topicsTracked: 3,
        topStrengths: [tp('sorting', 0.9)],
        focusAreas: [tp('graphs', 0.3), tp('dp', 0.4)],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      const roles = result.topics.map((t) => t.role);
      expect(roles).not.toContain('twist');
      expect(roles).toContain('warmup');
      expect(roles).toContain('focus');
    });

    it('handles only strengths (warmup only, no focus)', () => {
      const view = createView({
        topicsTracked: 1,
        topStrengths: [tp('sorting', 0.9)],
        focusAreas: [],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      expect(result.topics).toHaveLength(1);
      expect(result.topics[0].role).toBe('warmup');
    });

    it('handles only weaknesses (twist only)', () => {
      const view = createView({
        topicsTracked: 1,
        topStrengths: [],
        focusAreas: [],
        recurringWeaknesses: [we('recursion', 3)],
      });

      const result = plan(view);

      expect(result.topics).toHaveLength(1);
      expect(result.topics[0].role).toBe('twist');
    });
  });

  describe('summary generation', () => {
    it('generates correct summary with all components', () => {
      const view = createView({
        topicsTracked: 4,
        topStrengths: [tp('sorting', 0.9)],
        focusAreas: [tp('graphs', 0.3), tp('dp', 0.4)],
        recurringWeaknesses: [we('recursion', 5)],
      });

      const result = plan(view);

      expect(result.summary).toContain('Focus on 2 gap topics');
      expect(result.summary).toContain('warm up on sorting');
      expect(result.summary).toContain('stretch on recursion');
    });

    it('handles singular gap topic', () => {
      const view = createView({
        topicsTracked: 2,
        topStrengths: [tp('sorting', 0.9)],
        focusAreas: [tp('graphs', 0.3)],
        recurringWeaknesses: [],
      });

      const result = plan(view);

      expect(result.summary).toContain('Focus on 1 gap topic');
      expect(result.summary).not.toContain('1 gap topics');
    });
  });
});
