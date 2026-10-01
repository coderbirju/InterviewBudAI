import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Analytics } from './Analytics';
import type { InsightsResponse } from '../lib/api';
import {
  INSIGHTS_LOCKED,
  INSIGHTS_NO_DB,
  INSIGHTS_UNLOCKED,
  TOPIC_FIXTURE,
} from '../lib/insights.fixture';

/** Mock `fetch` so `/api/insights` answers `body` (or fails with `status`). */
function mockInsights(
  body: unknown,
  status = 200,
): ReturnType<typeof vi.fn<[string], Promise<unknown>>> {
  const fn = vi.fn<[string], Promise<unknown>>(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function renderReady(body: InsightsResponse): Promise<void> {
  mockInsights(body);
  render(<Analytics />);
  await screen.findByRole('heading', { name: 'Your problems' });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Analytics v2', () => {
  it('shows a loading state, then fetches GET /api/insights once', async () => {
    const fetchFn = mockInsights(INSIGHTS_LOCKED);
    render(<Analytics />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    await screen.findByRole('heading', { name: 'Your problems' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/api/insights');
  });

  it('locked: donut has a text summary and center total', async () => {
    await renderReady(INSIGHTS_LOCKED);

    const donut = screen.getByRole('img', { name: /problems by status/i });
    expect(donut).toHaveAccessibleName(
      /156 problems: 12 done, 3 to revisit, 1 didn't understand, 140 not started/,
    );
    expect(within(donut).getByText('156')).toBeInTheDocument();
  });

  it('donut center shows the sum of the four buckets, not status.total', async () => {
    await renderReady({
      ...INSIGHTS_LOCKED,
      status: { ...INSIGHTS_LOCKED.status, total: 999 },
    });
    const donut = screen.getByRole('img', { name: /problems by status/i });
    expect(within(donut).getByText('156')).toBeInTheDocument();
    expect(within(donut).queryByText('999')).not.toBeInTheDocument();
  });

  it('locked: only the legend counts, quiz CTA and tiles', async () => {
    await renderReady(INSIGHTS_LOCKED);

    const legend = screen.getByRole('list', { name: 'Status counts' });
    expect(legend).toHaveTextContent('Done12');
    expect(legend).toHaveTextContent('To revisit3');
    expect(legend).toHaveTextContent("Didn't understand1");
    expect(legend).toHaveTextContent('Not started140');

    expect(
      screen.getByText(/Take a quiz to see your gaps and patterns/),
    ).toHaveTextContent('1 of 2 sessions done');
    expect(screen.getByRole('link', { name: /take a quiz/i })).toHaveAttribute(
      'href',
      '/interview',
    );
    expect(screen.getAllByTestId('topic-tile')).toHaveLength(13);

    for (const name of ['Focus next', 'Where you keep slipping', 'Strengths']) {
      expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument();
    }
  });

  it('locked: ignores focus/slips/strengths even if the payload carries them', async () => {
    await renderReady({ ...INSIGHTS_UNLOCKED, state: 'locked' });
    expect(
      screen.queryByRole('heading', { name: 'Focus next' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Missed edge cases')).not.toBeInTheDocument();
  });

  it('unlocked: donut, focus, slips, strengths and tiles with their content', async () => {
    await renderReady(INSIGHTS_UNLOCKED);

    expect(
      screen.getByRole('img', { name: /problems by status/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sessions done/)).not.toBeInTheDocument();

    const focus = screen
      .getByRole('heading', { name: 'Focus next' })
      .closest('section') as HTMLElement;
    const rows = within(focus).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Graphs');
    expect(rows[0]).toHaveTextContent('Weak');
    expect(rows[0]).toHaveTextContent(
      '4 of 6 quiz answers missed · 2 to revisit',
    );
    expect(rows[1]).toHaveTextContent('Improving');

    const slips = screen
      .getByRole('heading', { name: 'Where you keep slipping' })
      .closest('section') as HTMLElement;
    expect(within(slips).getByText('Missed edge cases')).toBeInTheDocument();
    const count = within(slips).getByTestId('slip-count');
    expect(count).toHaveTextContent('×5');
    expect(within(count).getByText('5 times')).toHaveClass('sr-only');
    expect(within(slips).getByText('Trees')).toHaveTextContent('Trees 3');
    expect(within(slips).getByText('Graphs')).toHaveTextContent('Graphs 2');

    const strengths = screen
      .getByRole('heading', { name: 'Strengths' })
      .closest('section') as HTMLElement;
    expect(within(strengths).getByRole('listitem')).toHaveTextContent(
      'Arrays 7 correct · 1 incorrect',
    );

    expect(screen.getAllByTestId('topic-tile')).toHaveLength(13);
  });

  it('unlocked: caps focus and slips at 3 rows and slip topics at 3', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      topicId: `t${i}`,
      label: `T${i}`,
      band: 'weak' as const,
      reason: `${i} to revisit`,
    }));
    const slip = (
      code: string,
      n: number,
    ): InsightsResponse['slips'][number] => ({
      code,
      label: `Slip ${code}`,
      count: n,
      lastSeen: '2026-09-29T18:00:00.000Z',
      topics: many.map((t) => ({
        topicId: t.topicId,
        label: t.label,
        count: 1,
      })),
    });
    await renderReady({
      ...INSIGHTS_UNLOCKED,
      focus: many,
      slips: [
        slip('edge', 4),
        slip('brute', 3),
        slip('vague', 2),
        slip('misread', 1),
      ],
    });
    const focus = screen
      .getByRole('heading', { name: 'Focus next' })
      .closest('section') as HTMLElement;
    expect(within(focus).getAllByRole('listitem')).toHaveLength(3);
    const slips = screen
      .getByRole('heading', { name: 'Where you keep slipping' })
      .closest('section') as HTMLElement;
    const items = within(slips).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0] as HTMLElement).getAllByText(/^T\d/)).toHaveLength(
      3,
    );
  });

  it('unlocked with empty sections shows a friendly line in each', async () => {
    await renderReady({
      ...INSIGHTS_UNLOCKED,
      focus: [],
      slips: [],
      strengths: [],
    });
    for (const name of ['Focus next', 'Where you keep slipping', 'Strengths']) {
      const section = screen
        .getByRole('heading', { name })
        .closest('section') as HTMLElement;
      expect(section).toHaveTextContent(
        'Not enough quiz data yet in this section.',
      );
    }
    expect(
      screen.getByText(/Slips are tagged from your next quiz/),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('topic-tile')).toHaveLength(13);
  });

  it('never lists a Focus topic under Strengths, and falls back to the topic id', async () => {
    await renderReady({
      ...INSIGHTS_UNLOCKED,
      strengths: [
        { topicId: 'graphs', label: 'Graphs', correct: 9, incorrect: 0 },
        { topicId: 'heap', label: '', correct: 4, incorrect: 0 },
      ],
    });
    const strengths = screen
      .getByRole('heading', { name: 'Strengths' })
      .closest('section') as HTMLElement;
    const chips = within(strengths).getAllByRole('listitem');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('heap 4 correct · 0 incorrect');
  });

  it('falls back to a client label for a slip without one, and a generic label for unknown codes', async () => {
    const base = INSIGHTS_UNLOCKED.slips[0]!;
    await renderReady({
      ...INSIGHTS_UNLOCKED,
      slips: [
        { ...base, code: 'brute', label: '' },
        { ...base, code: 'zzz-new', label: '' },
      ],
    });
    expect(screen.getByText('Settled for brute force')).toBeInTheDocument();
    expect(screen.getByText('Other slip')).toBeInTheDocument();
    expect(screen.queryByText('zzz-new')).not.toBeInTheDocument();
  });

  it('renders duplicate slip codes without key collisions', async () => {
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const base = INSIGHTS_UNLOCKED.slips[0]!;
    await renderReady({ ...INSIGHTS_UNLOCKED, slips: [base, base] });
    expect(screen.getAllByText('Missed edge cases')).toHaveLength(2);
    expect(
      errors.mock.calls.some((c) => String(c[0]).includes('same key')),
    ).toBe(false);
    errors.mockRestore();
  });

  it('renders the 13 tiles in API order with labelled done/total', async () => {
    await renderReady(INSIGHTS_LOCKED);
    const tiles = screen.getAllByTestId('topic-tile');
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(
      INSIGHTS_LOCKED.topics.map(
        (t) => `${t.label}: ${t.done} of ${t.total} done`,
      ),
    );
    expect(tiles.map((t) => t.textContent)).toEqual(
      TOPIC_FIXTURE.map(([, label], i) => `${label}${i % 4}/${10 + i}`),
    );
  });

  it('no_db: the create-your-database CTA, no donut', async () => {
    mockInsights(INSIGHTS_NO_DB);
    render(<Analytics />);
    expect(
      await screen.findByRole('heading', { name: 'No data yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /create your database/i }),
    ).toHaveAttribute('href', '/data');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows an error alert when the API fails', async () => {
    mockInsights({}, 500);
    render(<Analytics />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load your analytics/i,
    );
  });

  it('renders labels and reasons as text (XSS-safe)', async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    await renderReady({
      ...INSIGHTS_UNLOCKED,
      topics: INSIGHTS_UNLOCKED.topics.map((t, i) =>
        i === 0 ? { ...t, label: evil } : t,
      ),
      focus: [{ topicId: 'x', label: evil, band: 'weak', reason: evil }],
      slips: [
        {
          ...INSIGHTS_UNLOCKED.slips[0]!,
          label: evil,
          topics: [{ topicId: 'x', label: evil, count: 1 }],
        },
      ],
      strengths: [{ topicId: 'x', label: evil, correct: 1, incorrect: 0 }],
    });
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(
      3,
    );
  });
});
