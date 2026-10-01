import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Analytics } from './Analytics';
import { INSIGHTS_UNLOCKED } from '../lib/insights.fixture';
import { normalizePractice } from '../lib/api';
import type { PracticeResponse } from '../lib/api';

/** ADR 0013 D3 `GET /api/practice` example, verbatim shape. */
const PRACTICE_READY: PracticeResponse = {
  state: 'ready',
  generatedAt: '2026-10-01T12:00:00.000Z',
  totals: { checks: 42, problems: 17, windowEvents: 42, windowCap: 500 },
  firstCheck: { on_track: 5, partial: 8, off_track: 4 },
  slips: [
    {
      code: 'complexity',
      label: 'Complexity analysis off',
      count: 6,
      topics: [
        { topicId: 'arrays', label: 'Arrays', count: 3 },
        { topicId: 'graphs', label: 'Graphs', count: 2 },
      ],
    },
    {
      code: 'edge',
      label: 'Missed edge cases',
      count: 4,
      topics: [{ topicId: 'trees', label: 'Trees', count: 4 }],
    },
    { code: 'vague', label: 'Incomplete or vague', count: 2, topics: [] },
    { code: 'brute', label: 'Settled for brute force', count: 1, topics: [] },
  ],
  fixedAfterRecheck: { count: 3, of: 12 },
  readyToCodeFirstTry: { count: 5, of: 17 },
  since: '2026-09-01T10:00:00.000Z',
};

const PRACTICE_EMPTY: PracticeResponse = {
  ...PRACTICE_READY,
  state: 'empty',
  totals: { checks: 0, problems: 0, windowEvents: 0, windowCap: 500 },
  firstCheck: { on_track: 0, partial: 0, off_track: 0 },
  slips: [],
  fixedAfterRecheck: { count: 0, of: 0 },
  readyToCodeFirstTry: { count: 0, of: 0 },
  since: null,
};

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

type FetchFn = ReturnType<
  typeof vi.fn<[string, RequestInit?], Promise<unknown>>
>;

/**
 * Route `fetch`: insights is always the unlocked fixture; each GET
 * /api/practice takes the next reply from `practice` (the last one repeats);
 * POST /api/practice/reset answers `reset` (or rejects when it's an Error).
 */
function mockApi(
  practice: readonly Reply[],
  reset?: Reply | Error,
): FetchFn {
  let i = 0;
  const fn = vi.fn<[string, RequestInit?], Promise<unknown>>(
    async (url: string) => {
      let r: Reply;
      if (url === '/api/insights') {
        r = { status: 200, body: INSIGHTS_UNLOCKED };
      } else if (url === '/api/practice') {
        r = practice[Math.min(i, practice.length - 1)] ?? {
          status: 404,
          body: {},
        };
        i += 1;
      } else if (url === '/api/practice/reset') {
        if (reset instanceof Error) {
          throw reset;
        }
        r = reset ?? { status: 500, body: {} };
      } else {
        r = { status: 404, body: {} };
      }
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      };
    },
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const ok = (body: unknown): Reply => ({ status: 200, body });

async function renderPage(): Promise<void> {
  render(<Analytics />);
  await screen.findByRole('heading', { name: 'Your problems' });
}

async function findPractice(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', {
    name: 'Practice (intuition checks)',
  });
  const section = heading.closest('section');
  if (section === null) {
    throw new Error('no section');
  }
  return section;
}

/** Let pending fetch promises (and their state updates) settle inside act. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function practiceCalls(fn: FetchFn): number {
  return fn.mock.calls.filter((c) => c[0] === '/api/practice').length;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Analytics Practice section (ADR 0013 D5)', () => {
  it.each([
    ['empty', ok(PRACTICE_EMPTY)],
    ['no_db', ok({ ...PRACTICE_EMPTY, state: 'no_db' })],
    ['404 (older server)', { status: 404, body: { error: 'not found' } }],
    ['500', { status: 500, body: { error: 'boom' } }],
    ['unknown state', ok({ state: 'locked' })],
  ])('is hidden when the API gives %s, and the page still renders', async (_n, reply) => {
    const fn = mockApi([reply]);
    await renderPage();
    await waitFor(() => expect(practiceCalls(fn)).toBe(1));
    await settle();
    expect(
      screen.queryByRole('heading', { name: 'Practice (intuition checks)' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Focus next' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is hidden on a network failure', async () => {
    const fn = vi.fn(async (url: string) => {
      if (url === '/api/practice') {
        throw new TypeError('Failed to fetch');
      }
      return { ok: true, status: 200, json: async () => INSIGHTS_UNLOCKED };
    });
    vi.stubGlobal('fetch', fn);
    await renderPage();
    await settle();
    expect(
      screen.queryByRole('heading', { name: 'Practice (intuition checks)' }),
    ).not.toBeInTheDocument();
  });

  it('ready: renders outcomes, ≤ 3 slips, ratios and since, below the quiz sections', async () => {
    mockApi([ok(PRACTICE_READY)]);
    await renderPage();
    const section = await findPractice();

    // Below the quiz sections.
    const topics = screen.getByRole('heading', { name: 'By topic' });
    expect(
      topics.compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const donut = within(section).getByRole('img', {
      name: /first-check outcomes/i,
    });
    expect(donut).toHaveAccessibleName(
      /17 first checks: 5 on track, 8 partly there, 4 off track/,
    );
    const legend = within(section).getByRole('list', {
      name: 'First-check outcome counts',
    });
    expect(legend).toHaveTextContent('On track5');
    expect(legend).toHaveTextContent('Partly there8');
    expect(legend).toHaveTextContent('Off track4');

    expect(within(section).getByTestId('practice-fixed')).toHaveTextContent(
      '3 of 12',
    );
    expect(within(section).getByText('Fixed after re-check')).toBeVisible();
    expect(within(section).getByTestId('practice-ready')).toHaveTextContent(
      '5 of 17',
    );
    expect(
      within(section).getByText('Ready to code on first check'),
    ).toBeVisible();

    expect(within(section).getByText('Top practice slips')).toBeVisible();
    const counts = within(section).getAllByTestId('practice-slip-count');
    expect(counts).toHaveLength(3);
    expect(counts[0]).toHaveTextContent('×6');
    expect(within(section).getByText('Complexity analysis off')).toBeVisible();
    expect(within(section).getByText(/^Arrays/)).toHaveTextContent('Arrays 3');
    expect(
      within(section).queryByText('Settled for brute force'),
    ).not.toBeInTheDocument();

    expect(within(section).getByTestId('practice-since')).toHaveTextContent(
      /^Since .*2026/,
    );
    expect(
      within(section).getByRole('button', { name: 'Reset practice history' }),
    ).toBeVisible();
  });

  it('shares no numbers with the quiz slips section', async () => {
    mockApi([ok(PRACTICE_READY)]);
    await renderPage();
    const section = await findPractice();
    const quizSlips = screen
      .getByRole('heading', { name: 'Where you keep slipping' })
      .closest('section');
    expect(quizSlips).not.toBeNull();
    expect(quizSlips?.contains(section)).toBe(false);
    expect(section.contains(quizSlips)).toBe(false);
  });

  it('reset: two-step confirm, Cancel backs out without a request', async () => {
    const user = userEvent.setup();
    const fn = mockApi([ok(PRACTICE_READY)]);
    await renderPage();
    const section = await findPractice();

    await user.click(
      within(section).getByRole('button', { name: 'Reset practice history' }),
    );
    const group = within(section).getByRole('group');
    expect(group).toHaveTextContent(
      'Deletes all practice history. Quiz analytics are not affected. A backup is saved first.',
    );
    const cancel = within(group).getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    expect(within(section).queryByRole('group')).not.toBeInTheDocument();
    expect(
      within(section).getByRole('button', { name: 'Reset practice history' }),
    ).toHaveFocus();
    expect(
      fn.mock.calls.some((c) => c[0] === '/api/practice/reset'),
    ).toBe(false);
  });

  it('reset: confirm POSTs the token, shows the backup path, refetches and hides', async () => {
    const user = userEvent.setup();
    const fn = mockApi([ok(PRACTICE_READY), ok(PRACTICE_EMPTY)], {
      status: 200,
      body: { reset: true, backup: '/home/me/.ibai/.backups/2026-10-01T12-00' },
    });
    await renderPage();
    const section = await findPractice();

    await user.click(
      within(section).getByRole('button', { name: 'Reset practice history' }),
    );
    await user.click(
      within(section).getByRole('button', { name: 'Confirm reset' }),
    );

    const status = await screen.findByText(/Backup saved to/);
    expect(status.closest('[role="status"]')).toHaveTextContent(
      'Practice history reset. Backup saved to /home/me/.ibai/.backups/2026-10-01T12-00',
    );

    const call = fn.mock.calls.find((c) => c[0] === '/api/practice/reset');
    expect(call?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      confirm: 'reset-practice',
    });

    await waitFor(() => expect(practiceCalls(fn)).toBe(2));
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: /first-check outcomes/i })).not
        .toBeInTheDocument(),
    );
    // The backup notice stays after the section's data hides.
    expect(screen.getByText(/Backup saved to/)).toBeVisible();
    // Quiz analytics untouched.
    expect(screen.getByRole('heading', { name: 'Focus next' })).toBeVisible();
  });

  it.each([
    [
      '409 read_only',
      {
        status: 409,
        body: { error: 'This folder is read-only (format v2).', code: 'read_only' },
      },
      'This folder is read-only (format v2).',
      false,
    ],
    [
      '500 backup_failed',
      {
        status: 500,
        body: {
          error: 'Could not save a backup; practice history was not reset.',
          code: 'backup_failed',
        },
      },
      'Could not save a backup; practice history was not reset.',
      false,
    ],
    [
      '500 reset_failed',
      {
        status: 500,
        body: {
          error: 'Could not reset practice history.',
          code: 'reset_failed',
          backup: '/data/.backups/b1',
        },
      },
      'Could not reset practice history. Backup saved to /data/.backups/b1',
      true,
    ],
  ])('reset error %s: shows the server message, keeps the section', async (_n, reply, text, hasBackup) => {
    const user = userEvent.setup();
    const fn = mockApi([ok(PRACTICE_READY)], reply);
    await renderPage();
    const section = await findPractice();
    await user.click(
      within(section).getByRole('button', { name: 'Reset practice history' }),
    );
    await user.click(
      within(section).getByRole('button', { name: 'Confirm reset' }),
    );
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(alert.textContent?.includes('Backup saved to')).toBe(hasBackup);
    await waitFor(() => expect(practiceCalls(fn)).toBe(2));
    expect(
      within(section).getByRole('img', { name: /first-check outcomes/i }),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole('button', { name: 'Reset practice history' }),
    ).toBeEnabled();
  });

  it('reset network failure: a friendly alert, nothing reset', async () => {
    const user = userEvent.setup();
    mockApi([ok(PRACTICE_READY)], new TypeError('Failed to fetch'));
    await renderPage();
    const section = await findPractice();
    await user.click(
      within(section).getByRole('button', { name: 'Reset practice history' }),
    );
    await user.click(
      within(section).getByRole('button', { name: 'Confirm reset' }),
    );
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      "Couldn't reach the local API. Practice history was not reset.",
    );
  });

  it('renders labels and server text as text (XSS-safe)', async () => {
    const user = userEvent.setup();
    const evil = '<img src=x onerror="alert(1)">';
    mockApi(
      [
        ok({
          ...PRACTICE_READY,
          slips: [
            {
              code: 'edge',
              label: evil,
              count: 2,
              topics: [{ topicId: 'arrays', label: `<b>${evil}</b>`, count: 1 }],
            },
          ],
        }),
      ],
      { status: 500, body: { error: `<script>x</script>${evil}` } },
    );
    await renderPage();
    const section = await findPractice();
    expect(within(section).getByText(evil)).toBeInTheDocument();
    expect(section.querySelector('img')).toBeNull();
    expect(section.querySelector('b')).toBeNull();
    await user.click(
      within(section).getByRole('button', { name: 'Reset practice history' }),
    );
    await user.click(
      within(section).getByRole('button', { name: 'Confirm reset' }),
    );
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent(`<script>x</script>${evil}`);
    expect(section.querySelector('script')).toBeNull();
    expect(section.querySelector('img')).toBeNull();
  });
});

describe('normalizePractice', () => {
  it('keeps the ADR shape for a ready payload', () => {
    expect(normalizePractice(PRACTICE_READY)).toEqual(PRACTICE_READY);
  });

  it('degrades a malformed payload to a hidden empty state', () => {
    const n = normalizePractice({
      state: 'ready',
      firstCheck: { on_track: -3, partial: 'x' },
      slips: [null, { code: '' }, { code: 'edge', count: Infinity, topics: [1] }],
      fixedAfterRecheck: null,
      since: 42,
    });
    expect(n.firstCheck).toEqual({ on_track: 0, partial: 0, off_track: 0 });
    expect(n.slips).toEqual([
      { code: 'edge', label: '', count: 0, topics: [] },
    ]);
    expect(n.fixedAfterRecheck).toEqual({ count: 0, of: 0 });
    expect(n.since).toBeNull();
    expect(normalizePractice(null).state).toBe('empty');
    expect(normalizePractice({ state: 'empty', slips: [{ code: 'x' }] }).slips)
      .toEqual([]);
  });
});
