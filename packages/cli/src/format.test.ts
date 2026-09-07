/**
 * Tests for the assessment formatter.
 *
 * Pure function tests — no fs, no network, no mocks needed.
 */

import { describe, it, expect } from 'vitest';
import type { AssessmentView } from '@ibai/core';
import { formatAssessment } from './format.js';

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
