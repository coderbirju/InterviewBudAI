import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  GuidanceCard,
  GUIDANCE_COLLAPSED_KEY,
  MAX_NEXT_UP_ROWS,
  MAX_STANDING_CHIPS,
} from './GuidanceCard';
import type {
  GuidanceNextUp,
  GuidanceResponse,
  GuidanceStanding,
  TopicStrength,
} from '../lib/api';
import { STRENGTH_COLORS, STRENGTH_LABELS } from '../lib/competency';

function standing(
  topicId: string,
  band: TopicStrength,
  notes: Partial<GuidanceStanding['notes']> = {},
): GuidanceStanding {
  const n = { done: 0, toRevisit: 0, didNotUnderstand: 0, total: 10, ...notes };
  return {
    topicId,
    notes: n,
    quiz: { correct: 0, incorrect: 0 },
    lastActivity: null,
    band,
    needsReview: n.toRevisit + n.didNotUnderstand > 0,
  };
}

function next(
  problemId: string,
  kind: GuidanceNextUp['kind'],
  extra: Partial<GuidanceNextUp> = {},
): GuidanceNextUp {
  return {
    kind,
    problemId,
    title: `Title ${problemId}`,
    url: `https://leetcode.com/problems/${problemId}/`,
    difficulty: 'Medium',
    topicId: 'arrays',
    reason: `Reason ${problemId}`,
    ...extra,
  };
}

function ready(extra: Partial<GuidanceResponse> = {}): GuidanceResponse {
  return {
    state: 'ready',
    generatedAt: '2026-09-26T00:00:00.000Z',
    standing: [
      standing('arrays', 'weak', { done: 3, total: 9, toRevisit: 2 }),
      standing('graphs', 'unknown', { done: 1, total: 13 }),
    ],
    nextUp: [
      // Only a revisit may be topic-less (`topicId: null`).
      next('p1', 'revisit', { topicId: null }),
      next('p2', 'weak_topic', { difficulty: 'Hard' }),
      next('p3', 'continue', { topicId: 'graphs' }),
    ],
    quiz: { doneCount: 4, lastQuizAt: null, suggested: false },
    ...extra,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('GuidanceCard — where you stand', () => {
  it('renders a chip per topic with the Analytics band color and label', () => {
    render(<GuidanceCard guidance={ready()} />);
    const chips = screen.getAllByTestId('standing-chip');
    expect(chips).toHaveLength(2);

    const weak = within(chips[0]).getByText(STRENGTH_LABELS.weak);
    expect(weak).toHaveAttribute('data-band', 'weak');
    expect(weak).toHaveStyle({ color: STRENGTH_COLORS.weak });

    const unknown = within(chips[1]).getByText(STRENGTH_LABELS.unknown);
    expect(unknown).toHaveStyle({ color: STRENGTH_COLORS.unknown });
  });

  it('shows done/total and the review count prominently, even for unknown bands', () => {
    render(<GuidanceCard guidance={ready()} />);
    const [arrays, graphs] = screen.getAllByTestId('standing-chip');
    expect(arrays).toHaveTextContent('arrays');
    expect(arrays).toHaveTextContent('3/9');
    expect(within(arrays).getByText('2 need review')).toBeInTheDocument();

    expect(graphs).toHaveTextContent('1/13');
    expect(within(graphs).queryByText(/review/)).not.toBeInTheDocument();
  });

  it('caps chips at MAX_STANDING_CHIPS and links to Analytics', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      standing(`t${i}`, 'unknown', { done: i, total: 10 }),
    );
    render(<GuidanceCard guidance={ready({ standing: many })} />);
    expect(screen.getAllByTestId('standing-chip')).toHaveLength(
      MAX_STANDING_CHIPS,
    );
    expect(
      screen.getByRole('link', { name: /see all in analytics/i }),
    ).toHaveAttribute('href', '/analytics');
  });
});

describe('GuidanceCard — next up', () => {
  it('renders ≤3 rows with external title link, badge, reason, kind icon, notes link', () => {
    const four = [...ready().nextUp, next('p4', 'start')];
    render(<GuidanceCard guidance={ready({ nextUp: four })} />);

    const title = screen.getByRole('link', { name: /^Title p1/ });
    expect(title).toHaveAttribute('href', 'https://leetcode.com/problems/p1/');
    expect(title).toHaveAttribute('target', '_blank');
    expect(title).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Reason p1')).toBeInTheDocument();
    expect(screen.getByText('Hard')).toBeInTheDocument();

    expect(screen.getAllByRole('link', { name: /^Notes for / })).toHaveLength(
      MAX_NEXT_UP_ROWS,
    );
    expect(
      screen.getByRole('link', { name: 'Notes for Title p1' }),
    ).toHaveAttribute('href', '/notes/p1');
    expect(screen.queryByText('Title p4')).not.toBeInTheDocument();

    const kinds = Array.from(document.querySelectorAll('[data-kind]')).map(
      (el) => el.getAttribute('data-kind'),
    );
    expect(kinds).toEqual(['revisit', 'weak_topic', 'continue']);
    expect(screen.getByText('Revisit')).toHaveClass('sr-only');
    expect(screen.getByText('Weak topic')).toHaveClass('sr-only');
  });

  it('the Notes link navigates in-app on a plain click', async () => {
    const user = userEvent.setup();
    render(<GuidanceCard guidance={ready()} />);
    await user.click(screen.getByRole('link', { name: 'Notes for Title p2' }));
    expect(window.location.pathname).toBe('/notes/p2');
  });
});

describe('GuidanceCard — quiz nudge, empty, no_db', () => {
  it('shows a quiz nudge linking to /interview only when suggested', () => {
    const { rerender } = render(<GuidanceCard guidance={ready()} />);
    expect(screen.queryByRole('link', { name: /quiz yourself/i })).toBeNull();

    rerender(
      <GuidanceCard
        guidance={ready({
          quiz: { doneCount: 5, lastQuizAt: null, suggested: true },
        })}
      />,
    );
    expect(
      screen.getByRole('link', { name: /quiz yourself/i }),
    ).toHaveAttribute('href', '/interview');
  });

  it('empty state shows "Start here" with the starter problems', () => {
    render(
      <GuidanceCard
        guidance={{
          ...ready(),
          state: 'empty',
          standing: [],
          nextUp: [next('s1', 'start'), next('s2', 'start')],
        }}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Start here' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Title s1/ })).toBeInTheDocument();
    expect(screen.queryByText('Where you stand')).not.toBeInTheDocument();
  });

  it('no_db renders nothing', () => {
    const { container } = render(
      <GuidanceCard guidance={{ ...ready(), state: 'no_db' }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('GuidanceCard — collapse', () => {
  it('toggles by keyboard, sets aria-expanded, and persists to localStorage', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<GuidanceCard guidance={ready()} />);
    const toggle = screen.getByRole('button', { name: /your guidance/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Where you stand')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(GUIDANCE_COLLAPSED_KEY)).toBe('1');

    unmount();
    render(<GuidanceCard guidance={ready()} />);
    const again = screen.getByRole('button', { name: /your guidance/i });
    expect(again).toHaveAttribute('aria-expanded', 'false');

    again.focus();
    await user.keyboard(' ');
    expect(again).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Where you stand')).toBeInTheDocument();
    expect(window.localStorage.getItem(GUIDANCE_COLLAPSED_KEY)).toBeNull();
  });
});

describe('GuidanceCard — untrusted text', () => {
  it('renders titles, reasons and topic ids as escaped text, never HTML', () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    render(
      <GuidanceCard
        guidance={ready({
          standing: [standing(evil, 'unknown', { done: 1, total: 2 })],
          nextUp: [next('x', 'start', { title: evil, reason: evil })],
        })}
      />,
    );
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    // Topic chip, title link and reason all show the literal string.
    expect(screen.getAllByText(evil).length).toBeGreaterThanOrEqual(3);
  });
});
