import { describe, it, expect } from 'vitest';
import type { AssessmentView, SessionPlan } from '@ibai/core';
import type { Problem } from '@ibai/curriculum';
import type { NoteStatus } from '@ibai/storage';
import {
  escapeHtml,
  renderAssessmentJson,
  renderPlanJson,
  renderAnalyticsHtml,
  computeProficiencyBars,
  computeStatusCounts,
  renderProficiencySvg,
  renderStatusBreakdownSvg,
  renderAssessmentHtml,
  renderStatusBadge,
  renderCatalogTable,
  renderHomeHtml,
} from './render.js';
import type { StatusCounts } from './render.js';

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

describe('renderAnalyticsHtml', () => {
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
    const html = renderAnalyticsHtml(emptyView, emptyPlan);
    expect(html).toContain('<title>InterviewBudAI - Analytics</title>');
    expect(html).toContain('InterviewBudAI');
  });

  it('contains Where You Stand section', () => {
    const html = renderAnalyticsHtml(emptyView, emptyPlan);
    expect(html).toContain('Where You Stand');
  });

  it('contains Your Next Session section', () => {
    const html = renderAnalyticsHtml(emptyView, emptyPlan);
    expect(html).toContain('Your Next Session');
  });

  it('shows friendly placeholders for empty state', () => {
    const html = renderAnalyticsHtml(emptyView, emptyPlan);
    expect(html).toContain('No strengths identified yet');
    expect(html).toContain('No focus areas identified yet');
    expect(html).toContain('No recurring weaknesses identified yet');
    expect(html).toContain('No recent session');
  });

  it('shows empty plan message', () => {
    const html = renderAnalyticsHtml(emptyView, emptyPlan);
    expect(html).toContain('No history yet');
    expect(html).toContain('Start practicing');
  });

  it('renders populated view data', () => {
    const html = renderAnalyticsHtml(populatedView, populatedPlan);
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
    const html = renderAnalyticsHtml(populatedView, populatedPlan);
    expect(html).toContain('topic-card');
    expect(html).toContain('role-badge');
    expect(html).toContain('warmup');
    expect(html).toContain('focus');
    expect(html).toContain('twist');
  });

  it('renders proficiency bars', () => {
    const html = renderAnalyticsHtml(populatedView, populatedPlan);
    expect(html).toContain('proficiency-bar-container');
    expect(html).toContain('proficiency-bar');
  });

  it('renders rationale for each topic', () => {
    const html = renderAnalyticsHtml(populatedView, populatedPlan);
    expect(html).toContain('strongest area');
    expect(html).toContain('lowest proficiency');
    expect(html).toContain('recurring weakness');
  });

  it('renders plan summary', () => {
    const html = renderAnalyticsHtml(populatedView, populatedPlan);
    expect(html).toContain('plan-summary');
    expect(html).toContain('Focus on 1 gap topic');
  });

  it('renders JSON links in footer', () => {
    const html = renderAnalyticsHtml(emptyView, emptyPlan);
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
    const html = renderAnalyticsHtml(xssView, emptyPlan);
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
    const html = renderAnalyticsHtml(emptyView, xssPlan);
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
    const html = renderAnalyticsHtml(emptyView, xssPlan);
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
    const html = renderAnalyticsHtml(xssView, emptyPlan);
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
    // Note: deprecated function only shows assessment, not plan section
  });
});

describe('renderStatusBadge (A4)', () => {
  it('renders nothing for none', () => {
    expect(renderStatusBadge('none')).toBe('');
  });

  it('renders a green Done badge', () => {
    const html = renderStatusBadge('done');
    expect(html).toContain('status-done');
    expect(html).toContain('Done');
  });

  it('renders an amber To revisit badge', () => {
    const html = renderStatusBadge('to_revisit');
    expect(html).toContain('status-revisit');
    expect(html).toContain('To revisit');
  });

  it('renders a red Did not understand badge', () => {
    const html = renderStatusBadge('did_not_understand');
    expect(html).toContain('status-confused');
    expect(html).toContain('Did not understand');
  });
});

describe('renderCatalogTable (A3/A4)', () => {
  const problems: readonly Problem[] = [
    {
      id: 'p-1',
      title: 'Two Sum',
      url: 'https://example.com/two-sum',
      difficulty: 'easy',
      topics: ['arrays'],
    },
    {
      id: 'p-2',
      title: 'Binary Search',
      url: 'https://example.com/bsearch',
      difficulty: 'medium',
      topics: ['binary-search'],
    },
  ];

  it('groups by topic and renders rows with Notes links', () => {
    const html = renderCatalogTable(problems);
    expect(html).toContain('catalog-table');
    expect(html).toContain('Two Sum');
    expect(html).toContain('arrays');
    expect(html).toContain('binary-search');
    expect(html).toContain('/notes/p-1');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
  });

  it('shows a status badge for a problem that has a status', () => {
    const statusById = new Map<string, NoteStatus>([['p-1', 'to_revisit']]);
    const html = renderCatalogTable(problems, statusById);
    expect(html).toContain('status-revisit');
    expect(html).toContain('To revisit');
  });

  it('escapes XSS in titles', () => {
    const xss: readonly Problem[] = [
      {
        id: 'x',
        title: '<script>alert(1)</script>',
        url: 'https://example.com/x',
        difficulty: 'easy',
        topics: ['t'],
      },
    ];
    const html = renderCatalogTable(xss);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderHomeHtml (A1/A2/A3)', () => {
  const problems: readonly Problem[] = [
    {
      id: 'p-1',
      title: 'Two Sum',
      url: 'https://example.com/two-sum',
      difficulty: 'easy',
      topics: ['arrays'],
    },
  ];

  it('shows create-database CTA when no db', () => {
    const html = renderHomeHtml(false);
    expect(html).toContain('Create your database');
    expect(html).toContain('href="/setup"');
    // The table element itself is not rendered (the class appears only in CSS).
    expect(html).not.toContain('<table class="catalog-table"');
    expect(html).not.toContain('home-actions">');
  });

  it('shows the catalog table + Continue practicing when db configured', () => {
    const html = renderHomeHtml(true, problems);
    expect(html).toContain('catalog-table');
    expect(html).toContain('Two Sum');
    expect(html).toContain('Continue practicing');
    expect(html).toContain('href="/coach"');
    expect(html).toContain('home-actions');
  });

  it('has no big body header/tagline and no Interview with AI button (A1/A2)', () => {
    const html = renderHomeHtml(true, problems);
    expect(html).not.toContain(
      'Your AI-powered interview preparation companion',
    );
    expect(html).not.toContain('<div class="hero">');
    expect(html).not.toContain('Interview with AI');
  });

  it('nav carries the InterviewBudAI wordmark', () => {
    const html = renderHomeHtml(true, problems);
    expect(html).toContain('nav-wordmark');
    expect(html).toContain('>InterviewBudAI</a>');
  });
});

// ===========================================================================
// Milestone C2 — analytics charts
// ===========================================================================

describe('computeProficiencyBars (C2)', () => {
  const base: AssessmentView = {
    topicsTracked: 0,
    topStrengths: [],
    focusAreas: [],
    recurringWeaknesses: [],
    recentSession: null,
  };

  it('returns empty for an empty view', () => {
    expect(computeProficiencyBars(base)).toEqual([]);
  });

  it('merges strengths and focus areas, sorted desc by proficiency', () => {
    const view: AssessmentView = {
      ...base,
      topStrengths: [
        { topicId: 'arrays', proficiency: 0.9 },
        { topicId: 'strings', proficiency: 0.7 },
      ],
      focusAreas: [{ topicId: 'graphs', proficiency: 0.3 }],
    };
    const bars = computeProficiencyBars(view);
    expect(bars.map((b) => b.topicId)).toEqual(['arrays', 'strings', 'graphs']);
    expect(bars[0].proficiency).toBe(0.9);
  });

  it('dedupes by topicId (first occurrence wins)', () => {
    const view: AssessmentView = {
      ...base,
      topStrengths: [{ topicId: 'dp', proficiency: 0.8 }],
      focusAreas: [{ topicId: 'dp', proficiency: 0.2 }],
    };
    const bars = computeProficiencyBars(view);
    expect(bars).toHaveLength(1);
    expect(bars[0].proficiency).toBe(0.8);
  });

  it('clamps proficiency into [0,1]', () => {
    const view: AssessmentView = {
      ...base,
      topStrengths: [{ topicId: 'a', proficiency: 1.5 }],
      focusAreas: [{ topicId: 'b', proficiency: -0.4 }],
    };
    const bars = computeProficiencyBars(view);
    const a = bars.find((x) => x.topicId === 'a');
    const b = bars.find((x) => x.topicId === 'b');
    expect(a?.proficiency).toBe(1);
    expect(b?.proficiency).toBe(0);
  });
});

describe('computeStatusCounts (C2)', () => {
  it('counts each status correctly', () => {
    const counts = computeStatusCounts([
      'done',
      'done',
      'to_revisit',
      'did_not_understand',
      'none',
      'none',
      'none',
    ]);
    expect(counts).toEqual({
      done: 2,
      to_revisit: 1,
      did_not_understand: 1,
      none: 3,
    });
  });

  it('returns all-zero for empty input', () => {
    expect(computeStatusCounts([])).toEqual({
      done: 0,
      to_revisit: 0,
      did_not_understand: 0,
      none: 0,
    });
  });
});

describe('renderProficiencySvg (C2)', () => {
  it('emits <svg> with a bar per topic, wider bar for higher proficiency', () => {
    const svg = renderProficiencySvg([
      { topicId: 'arrays', proficiency: 1.0 },
      { topicId: 'graphs', proficiency: 0.25 },
    ]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('arrays');
    expect(svg).toContain('100%');
    expect(svg).toContain('25%');
    // Full-proficiency bar width (320) should be present; quarter (80) too.
    expect(svg).toContain('width="320"');
    expect(svg).toContain('width="80"');
  });

  it('returns a friendly empty state (no <svg>) when there are no bars', () => {
    const out = renderProficiencySvg([]);
    expect(out).not.toContain('<svg');
    expect(out).toContain('No proficiency data yet');
  });

  it('escapes XSS in topic labels', () => {
    const svg = renderProficiencySvg([
      { topicId: '<script>alert(1)</script>', proficiency: 0.5 },
    ]);
    expect(svg).not.toContain('<script>alert(1)</script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

describe('renderStatusBreakdownSvg (C2)', () => {
  it('emits <svg> with each status count when data exists', () => {
    const svg = renderStatusBreakdownSvg({
      done: 3,
      to_revisit: 1,
      did_not_understand: 2,
      none: 4,
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('Done');
    expect(svg).toContain('To revisit');
    expect(svg).toContain('Did not understand');
    expect(svg).toContain('Not started');
  });

  it('returns friendly empty state (no <svg>) when all counts are zero', () => {
    const out = renderStatusBreakdownSvg({
      done: 0,
      to_revisit: 0,
      did_not_understand: 0,
      none: 0,
    });
    expect(out).not.toContain('<svg');
    expect(out).toContain('No problems tracked yet');
  });
});

describe('renderAnalyticsHtml charts + empty state (C2)', () => {
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
    ...emptyView,
    topicsTracked: 2,
    topStrengths: [{ topicId: 'arrays', proficiency: 0.9 }],
    focusAreas: [{ topicId: 'graphs', proficiency: 0.3 }],
  };

  it('renders <svg> charts when proficiency data exists', () => {
    const html = renderAnalyticsHtml(populatedView, emptyPlan);
    expect(html).toContain('<svg');
    expect(html).toContain('Proficiency by topic');
  });

  it('renders <svg> status chart + table when status counts exist', () => {
    const counts: StatusCounts = {
      done: 2,
      to_revisit: 1,
      did_not_understand: 0,
      none: 5,
    };
    const html = renderAnalyticsHtml(emptyView, emptyPlan, [], counts);
    expect(html).toContain('<svg');
    expect(html).toContain('Status breakdown');
    expect(html).toContain('analytics-table');
    expect(html).toContain('Total tracked');
  });

  it('renders a safe empty state (no crash) when there is no data', () => {
    const html = renderAnalyticsHtml(emptyView, emptyPlan);
    expect(html).toContain('No data yet');
    // Empty state must not blow up / emit chart SVG.
    expect(html).not.toContain('<svg');
    expect(html).toContain('<title>InterviewBudAI - Analytics</title>');
  });

  it('nav shows Analytics not Dashboard', () => {
    const html = renderAnalyticsHtml(populatedView, emptyPlan);
    expect(html).toContain('href="/analytics"');
    expect(html).toContain('>Analytics<');
    expect(html).not.toContain('>Dashboard<');
  });

  it('escapes XSS in topic labels inside the chart', () => {
    const xssView: AssessmentView = {
      ...emptyView,
      topicsTracked: 1,
      topStrengths: [{ topicId: '<img onerror=alert(1)>', proficiency: 0.5 }],
    };
    const html = renderAnalyticsHtml(xssView, emptyPlan);
    expect(html).not.toContain('<img onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });
});
