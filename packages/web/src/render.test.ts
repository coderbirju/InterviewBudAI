import { describe, it, expect } from 'vitest';
import type { AssessmentView } from '@ibai/core';
import {
  escapeHtml,
  renderAssessmentJson,
  renderAssessmentHtml,
} from './render.js';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#x27;s');
  });
});

describe('renderAssessmentJson', () => {
  it('returns formatted JSON', () => {
    const view: AssessmentView = {
      topicsTracked: 0,
      topStrengths: [],
      focusAreas: [],
      recurringWeaknesses: [],
      recentSession: null,
    };
    const result = renderAssessmentJson(view);
    expect(JSON.parse(result)).toEqual(view);
    expect(result).toContain('\n'); // formatted with newlines
  });
});

describe('renderAssessmentHtml', () => {
  const emptyView: AssessmentView = {
    topicsTracked: 0,
    topStrengths: [],
    focusAreas: [],
    recurringWeaknesses: [],
    recentSession: null,
  };

  const populatedView: AssessmentView = {
    topicsTracked: 5,
    topStrengths: [
      { topicId: 'arrays', proficiency: 0.9 },
      { topicId: 'strings', proficiency: 0.8 },
    ],
    focusAreas: [{ topicId: 'graphs', proficiency: 0.3 }],
    recurringWeaknesses: [
      {
        topicId: 'dp',
        note: 'Struggles with memoization',
        occurrences: 3,
        lastObserved: '2026-09-06T12:00:00Z',
      },
    ],
    recentSession: {
      sessionId: 'session-123',
      turnCount: 10,
      lastRole: 'assistant',
      lastTimestamp: '2026-09-06T12:00:00Z',
    },
  };

  it('contains page title', () => {
    const html = renderAssessmentHtml(emptyView);
    expect(html).toContain('<title>Where You Stand</title>');
    expect(html).toContain('<h1>Where You Stand</h1>');
  });

  it('shows friendly placeholders for empty state', () => {
    const html = renderAssessmentHtml(emptyView);
    expect(html).toContain('No strengths identified yet');
    expect(html).toContain('No focus areas identified yet');
    expect(html).toContain('No recurring weaknesses identified yet');
    expect(html).toContain('No recent session');
  });

  it('renders populated data', () => {
    const html = renderAssessmentHtml(populatedView);
    expect(html).toContain('arrays');
    expect(html).toContain('90%');
    expect(html).toContain('graphs');
    expect(html).toContain('30%');
    expect(html).toContain('dp');
    expect(html).toContain('memoization');
    expect(html).toContain('session-123');
    expect(html).toContain('10 turns');
  });

  it('escapes XSS in topicId', () => {
    const xssView: AssessmentView = {
      ...emptyView,
      topStrengths: [
        { topicId: '<script>alert(1)</script>', proficiency: 0.5 },
      ],
    };
    const html = renderAssessmentHtml(xssView);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
