import { describe, it, expect } from 'vitest';
import type { AssessmentView, SessionPlan } from '@ibai/core';
import {
  escapeHtml,
  renderAssessmentJson,
  renderPlanJson,
  renderDashboardHtml,
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

describe('renderPlanJson', () => {
  it('returns formatted JSON for empty plan', () => {
    const plan: SessionPlan = {
      topics: [],
      summary: 'No history yet — start with a broad baseline session.',
    };
    const result = renderPlanJson(plan);
    expect(JSON.parse(result)).toEqual(plan);
    expect(result).toContain('\n'); // formatted with newlines
  });

  it('returns formatted JSON for populated plan', () => {
    const plan: SessionPlan = {
      topics: [
        {
          topicId: 'arrays',
          role: 'warmup',
          proficiency: 0.9,
          rationale: 'strongest area (90%) — warm up here',
        },
        {
          topicId: 'graphs',
          role: 'focus',
          proficiency: 0.3,
          rationale: 'lowest proficiency (30%)',
        },
      ],
      summary: 'Focus on 1 gap topic; warm up on arrays.',
    };
    const result = renderPlanJson(plan);
    const parsed = JSON.parse(result);
    expect(parsed.topics).toHaveLength(2);
    expect(parsed.topics[0].topicId).toBe('arrays');
    expect(parsed.topics[1].role).toBe('focus');
  });
});

describe('renderDashboardHtml', () => {
  const emptyView: AssessmentView = {
    topicsTracked: 0,
    topStrengths: [],
    focusAreas: [],
    recurringWeaknesses: [],
    recentSession: null,
  };

  const emptyPlan: SessionPlan = {
    topics: [],
    summary: 'No history yet — start with a broad baseline session.',
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

  const populatedPlan: SessionPlan = {
    topics: [
      {
        topicId: 'arrays',
        role: 'warmup',
        proficiency: 0.9,
        rationale: 'strongest area (90%) — warm up here',
      },
      {
        topicId: 'graphs',
        role: 'focus',
        proficiency: 0.3,
        rationale: 'lowest proficiency (30%)',
      },
      {
        topicId: 'dp',
        role: 'twist',
        proficiency: 0.0,
        rationale: 'recurring weakness: 3 misses — stretch',
      },
    ],
    summary: 'Focus on 1 gap topic; warm up on arrays; stretch on dp.',
  };

  it('contains page title', () => {
    const html = renderDashboardHtml(emptyView, emptyPlan);
    expect(html).toContain('<title>InterviewBudAI - Dashboard</title>');
    expect(html).toContain('InterviewBudAI');
  });

  it('contains Where You Stand section', () => {
    const html = renderDashboardHtml(emptyView, emptyPlan);
    expect(html).toContain('Where You Stand');
  });

  it('contains Your Next Session section', () => {
    const html = renderDashboardHtml(emptyView, emptyPlan);
    expect(html).toContain('Your Next Session');
  });

  it('shows friendly placeholders for empty state', () => {
    const html = renderDashboardHtml(emptyView, emptyPlan);
    expect(html).toContain('No strengths identified yet');
    expect(html).toContain('No focus areas identified yet');
    expect(html).toContain('No recurring weaknesses identified yet');
    expect(html).toContain('No recent session');
  });

  it('shows empty plan message', () => {
    const html = renderDashboardHtml(emptyView, emptyPlan);
    expect(html).toContain('No history yet');
    expect(html).toContain('Start practicing');
  });

  it('renders populated view data', () => {
    const html = renderDashboardHtml(populatedView, populatedPlan);
    expect(html).toContain('arrays');
    expect(html).toContain('90%');
    expect(html).toContain('graphs');
    expect(html).toContain('30%');
    expect(html).toContain('dp');
    expect(html).toContain('memoization');
    expect(html).toContain('session-123');
    expect(html).toContain('10 turns');
  });

  it('renders topic cards with role badges', () => {
    const html = renderDashboardHtml(populatedView, populatedPlan);
    expect(html).toContain('topic-card');
    expect(html).toContain('role-badge');
    expect(html).toContain('warmup');
    expect(html).toContain('focus');
    expect(html).toContain('twist');
  });

  it('renders proficiency bars', () => {
    const html = renderDashboardHtml(populatedView, populatedPlan);
    expect(html).toContain('proficiency-bar-container');
    expect(html).toContain('proficiency-bar');
  });

  it('renders rationale for each topic', () => {
    const html = renderDashboardHtml(populatedView, populatedPlan);
    expect(html).toContain('strongest area');
    expect(html).toContain('lowest proficiency');
    expect(html).toContain('recurring weakness');
  });

  it('renders plan summary', () => {
    const html = renderDashboardHtml(populatedView, populatedPlan);
    expect(html).toContain('plan-summary');
    expect(html).toContain('Focus on 1 gap topic');
  });

  it('renders JSON links in footer', () => {
    const html = renderDashboardHtml(emptyView, emptyPlan);
    expect(html).toContain('/assess.json');
    expect(html).toContain('/plan.json');
  });

  it('escapes XSS in topicId', () => {
    const xssView: AssessmentView = {
      ...emptyView,
      topStrengths: [
        { topicId: '<script>alert(1)</script>', proficiency: 0.5 },
      ],
    };
    const html = renderDashboardHtml(xssView, emptyPlan);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes XSS in plan topicId', () => {
    const xssPlan: SessionPlan = {
      topics: [
        {
          topicId: '<img onerror=alert(1)>',
          role: 'focus',
          proficiency: 0.5,
          rationale: 'test',
        },
      ],
      summary: 'test',
    };
    const html = renderDashboardHtml(emptyView, xssPlan);
    expect(html).not.toContain('<img onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('escapes XSS in rationale', () => {
    const xssPlan: SessionPlan = {
      topics: [
        {
          topicId: 'test',
          role: 'focus',
          proficiency: 0.5,
          rationale: '<script>evil()</script>',
        },
      ],
      summary: 'test',
    };
    const html = renderDashboardHtml(emptyView, xssPlan);
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes XSS in weakness note', () => {
    const xssView: AssessmentView = {
      ...emptyView,
      recurringWeaknesses: [
        {
          topicId: 'test',
          note: '<script>hack()</script>',
          occurrences: 1,
          lastObserved: '2026-09-06T12:00:00Z',
        },
      ],
    };
    const html = renderDashboardHtml(xssView, emptyPlan);
    expect(html).not.toContain('<script>hack()</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderAssessmentHtml (legacy)', () => {
  it('still works for backwards compatibility', () => {
    const view: AssessmentView = {
      topicsTracked: 0,
      topStrengths: [],
      focusAreas: [],
      recurringWeaknesses: [],
      recentSession: null,
    };
    const html = renderAssessmentHtml(view);
    expect(html).toContain('Where You Stand');
    expect(html).toContain('Your Next Session');
  });
});
