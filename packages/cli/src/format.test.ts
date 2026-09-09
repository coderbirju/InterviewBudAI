/**
 * Tests for the assessment formatter.
 *
 * Pure function tests — no fs, no network, no mocks needed.
 */

import { describe, it, expect } from 'vitest';
import type { AssessmentView, SessionPlan } from '@ibai/core';
import { formatAssessment, formatPlan } from './format.js';

describe('formatAssessment', () => {
  describe('empty view', () => {
    it('shows friendly empty messages and no recent session block', () => {
      const emptyView: AssessmentView = {
        topicsTracked: 0,
        topStrengths: [],
        focusAreas: [],
        recurringWeaknesses: [],
        recentSession: null,
      };

      const result = formatAssessment(emptyView);

      // Header present
      expect(result).toContain('=== Where You Stand ===');
      expect(result).toContain('Topics tracked: 0');

      // Friendly empty messages
      expect(result).toContain('No strengths recorded yet.');
      expect(result).toContain('No focus areas identified yet.');
      expect(result).toContain('No recurring weaknesses noted.');

      // No recent session block
      expect(result).not.toContain('Recent Session:');
      expect(result).not.toContain('Session ID:');
    });
  });

  describe('populated view', () => {
    it('shows strengths, focus areas, weaknesses, and recent session', () => {
      const populatedView: AssessmentView = {
        topicsTracked: 7,
        topStrengths: [
          { topicId: 'sorting', proficiency: 0.92 },
          { topicId: 'arrays', proficiency: 0.85 },
          { topicId: 'trees', proficiency: 0.78 },
        ],
        focusAreas: [
          { topicId: 'graphs', proficiency: 0.25 },
          { topicId: 'dp', proficiency: 0.33 },
        ],
        recurringWeaknesses: [
          {
            topicId: 'graphs',
            note: 'BFS vs DFS confusion',
            occurrences: 5,
            lastObserved: '2026-09-02T00:00:00.000Z',
          },
          {
            topicId: 'dp',
            note: 'Memoization patterns',
            occurrences: 3,
            lastObserved: '2026-09-01T00:00:00.000Z',
          },
        ],
        recentSession: {
          sessionId: 'session-abc-123',
          turnCount: 12,
          lastRole: 'assistant',
          lastTimestamp: '2026-09-05T14:30:00.000Z',
        },
      };

      const result = formatAssessment(populatedView);

      // Header
      expect(result).toContain('=== Where You Stand ===');
      expect(result).toContain('Topics tracked: 7');

      // Strengths (proficiency as percentage)
      expect(result).toContain('Top Strengths:');
      expect(result).toContain('sorting: 92%');
      expect(result).toContain('arrays: 85%');
      expect(result).toContain('trees: 78%');
      expect(result).not.toContain('No strengths recorded yet.');

      // Focus areas
      expect(result).toContain('Focus Areas:');
      expect(result).toContain('graphs: 25%');
      expect(result).toContain('dp: 33%');
      expect(result).not.toContain('No focus areas identified yet.');

      // Weaknesses with occurrences and note
      expect(result).toContain('Recurring Weaknesses:');
      expect(result).toContain('graphs (5x): BFS vs DFS confusion');
      expect(result).toContain('dp (3x): Memoization patterns');
      expect(result).not.toContain('No recurring weaknesses noted.');

      // Recent session block
      expect(result).toContain('Recent Session:');
      expect(result).toContain('Session ID: session-abc-123');
      expect(result).toContain('Turns: 12');
      expect(result).toContain('Last role: assistant');
      expect(result).toContain('Last activity: 2026-09-05T14:30:00.000Z');
    });

    it('handles recentSession with null lastRole and lastTimestamp', () => {
      const viewWithEmptySession: AssessmentView = {
        topicsTracked: 1,
        topStrengths: [{ topicId: 'arrays', proficiency: 0.5 }],
        focusAreas: [{ topicId: 'arrays', proficiency: 0.5 }],
        recurringWeaknesses: [],
        recentSession: {
          sessionId: 'empty-session',
          turnCount: 0,
          lastRole: null,
          lastTimestamp: null,
        },
      };

      const result = formatAssessment(viewWithEmptySession);

      expect(result).toContain('Recent Session:');
      expect(result).toContain('Session ID: empty-session');
      expect(result).toContain('Turns: 0');
      // Should NOT contain lastRole or lastTimestamp lines when null
      expect(result).not.toContain('Last role:');
      expect(result).not.toContain('Last activity:');
    });
  });

  describe('proficiency formatting', () => {
    it('rounds proficiency to nearest percentage', () => {
      const view: AssessmentView = {
        topicsTracked: 2,
        topStrengths: [
          { topicId: 'topic-a', proficiency: 0.824 }, // should round to 82%
          { topicId: 'topic-b', proficiency: 0.825 }, // should round to 83%
        ],
        focusAreas: [],
        recurringWeaknesses: [],
        recentSession: null,
      };

      const result = formatAssessment(view);

      expect(result).toContain('topic-a: 82%');
      expect(result).toContain('topic-b: 83%');
    });
  });
});

describe('formatPlan', () => {
  describe('empty plan', () => {
    it('shows friendly empty message and summary', () => {
      const emptyPlan: SessionPlan = {
        topics: [],
        summary: 'No history yet \u2014 start with a broad baseline session.',
      };

      const result = formatPlan(emptyPlan);

      // Header present
      expect(result).toContain('=== Your Next Session ===');

      // Empty state message
      expect(result).toContain(
        'No session history yet \u2014 complete a practice session to get a personalized plan.',
      );

      // Summary present
      expect(result).toContain(
        'Summary: No history yet \u2014 start with a broad baseline session.',
      );
    });
  });

  describe('populated plan', () => {
    it('shows warmup, focus, and twist topics with proficiency and rationale', () => {
      const populatedPlan: SessionPlan = {
        topics: [
          {
            topicId: 'sorting',
            role: 'warmup',
            proficiency: 0.95,
            rationale: 'strongest area (95%) \u2014 warm up here',
          },
          {
            topicId: 'graphs',
            role: 'focus',
            proficiency: 0.12,
            rationale: 'lowest proficiency (12%)',
          },
          {
            topicId: 'dp',
            role: 'focus',
            proficiency: 0.22,
            rationale: 'lowest proficiency (22%) with 3 recurring misses',
          },
          {
            topicId: 'trees',
            role: 'twist',
            proficiency: 0.45,
            rationale: 'recurring weakness: 2 misses \u2014 stretch',
          },
        ],
        summary: 'Focus on 2 gap topics; warm up on sorting; stretch on trees.',
      };

      const result = formatPlan(populatedPlan);

      // Header
      expect(result).toContain('=== Your Next Session ===');

      // Each role present
      expect(result).toContain('warmup');
      expect(result).toContain('focus');
      expect(result).toContain('twist');

      // Topics present
      expect(result).toContain('sorting');
      expect(result).toContain('graphs');
      expect(result).toContain('dp');
      expect(result).toContain('trees');

      // Proficiency percentages present
      expect(result).toContain('95%');
      expect(result).toContain('12%');
      expect(result).toContain('22%');
      expect(result).toContain('45%');

      // Rationales present
      expect(result).toContain('strongest area');
      expect(result).toContain('lowest proficiency');
      expect(result).toContain('recurring weakness');

      // Summary
      expect(result).toContain(
        'Summary: Focus on 2 gap topics; warm up on sorting; stretch on trees.',
      );

      // Should NOT contain empty state message
      expect(result).not.toContain('No session history yet');
    });

    it('preserves topic ordering (warmup -> focus -> twist)', () => {
      const orderedPlan: SessionPlan = {
        topics: [
          {
            topicId: 'arrays',
            role: 'warmup',
            proficiency: 0.9,
            rationale: 'warmup rationale',
          },
          {
            topicId: 'graphs',
            role: 'focus',
            proficiency: 0.2,
            rationale: 'focus rationale',
          },
          {
            topicId: 'dp',
            role: 'twist',
            proficiency: 0.4,
            rationale: 'twist rationale',
          },
        ],
        summary: 'Test ordering.',
      };

      const result = formatPlan(orderedPlan);
      const lines = result.split('\n');

      // Find indices of each role line
      const warmupIdx = lines.findIndex((l) => l.includes('warmup'));
      const focusIdx = lines.findIndex((l) => l.includes('focus'));
      const twistIdx = lines.findIndex((l) => l.includes('twist'));

      // Warmup should come before focus, focus before twist
      expect(warmupIdx).toBeLessThan(focusIdx);
      expect(focusIdx).toBeLessThan(twistIdx);
    });
  });

  describe('proficiency formatting', () => {
    it('rounds proficiency to nearest percentage', () => {
      const plan: SessionPlan = {
        topics: [
          {
            topicId: 'topic-a',
            role: 'focus',
            proficiency: 0.124, // should round to 12%
            rationale: 'test rounding down',
          },
          {
            topicId: 'topic-b',
            role: 'focus',
            proficiency: 0.125, // should round to 13%
            rationale: 'test rounding up',
          },
        ],
        summary: 'Test.',
      };

      const result = formatPlan(plan);

      expect(result).toContain('12%');
      expect(result).toContain('13%');
    });
  });
});
