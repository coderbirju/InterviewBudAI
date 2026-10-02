import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from './Home';
import App from '../App';
import { navigate, notesHref, rememberHomeSearch } from '../lib/router';
import type { FullNote } from '../lib/api';

/**
 * Home guidance card wiring (w2a) with `fetch` mocked at the wire: the card
 * appears from GET /api/guidance, a guidance failure hides only the card, and
 * guidance is refetched after a saved status change and on back from Notes.
 */

const CATALOG = {
  topics: [
    {
      topic: 'Arrays & Hashing',
      problems: [
        {
          id: 'lc-1',
          title: 'Two Sum',
          url: 'https://leetcode.com/problems/two-sum/',
          difficulty: 'easy',
          status: 'none',
          completed: false,
        },
      ],
    },
  ],
  totals: {
    total: 1,
    byStatus: { none: 1, done: 0, to_revisit: 0, did_not_understand: 0 },
  },
};

const GUIDANCE = {
  state: 'ready',
  generatedAt: '2026-09-26T00:00:00.000Z',
  standing: [
    {
      topicId: 'arrays',
      notes: { done: 2, toRevisit: 1, didNotUnderstand: 0, total: 9 },
      quiz: { correct: 0, incorrect: 0 },
      lastActivity: null,
      band: 'unknown',
      needsReview: true,
    },
  ],
  nextUp: [
    {
      kind: 'revisit',
      problemId: 'lc-49',
      title: 'Group Anagrams',
      url: 'https://leetcode.com/problems/group-anagrams/',
      difficulty: 'medium',
      topicId: null,
      reason: 'Marked to revisit',
    },
  ],
  quiz: { doneCount: 2, lastQuizAt: null, suggested: false },
};

type Reply = { status: number; body: unknown };
type Handler = (init?: RequestInit) => Reply | Promise<Reply>;

/** A valid `FullNote` (GET/POST /api/notes/:id) for problem `lc-1`. */
function fullNote(overrides: Partial<FullNote> = {}): FullNote {
  return {
    problemId: 'lc-1',
    content: '',
    status: 'none',
    completed: false,
    timeComplexity: null,
    spaceComplexity: null,
    lastUpdated: null,
    ...overrides,
  };
}

let routes: Record<string, Handler>;
let fetchMock: ReturnType<
  typeof vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>
>;

const ok =
  (body: unknown): Handler =>
  () => ({ status: 200, body });

function guidanceCalls(): number {
  return fetchMock.mock.calls.filter(([p]) => String(p) === '/api/guidance')
    .length;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  rememberHomeSearch('');
  routes = {
    '/api/config': ok({
      dbConfigured: true,
      dataDir: '/tmp/db',
      provider: 'x',
    }),
    '/api/catalog': ok(CATALOG),
    '/api/progress': ok({
      completed: 0,
      total: 1,
      byStatus: CATALOG.totals.byStatus,
    }),
    '/api/guidance': ok(GUIDANCE),
    '/api/notes/lc-1': (init) =>
      init?.method === 'POST'
        ? { status: 200, body: fullNote({ status: 'done', completed: true }) }
        : { status: 200, body: fullNote() },
  };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const handler = routes[String(input)];
    const { status, body } = handler
      ? await handler(init)
      : { status: 404, body: { error: 'not found' } };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Guidance with the `arrays` chip showing `done`/9. */
function guidanceWithDone(done: number) {
  return {
    ...GUIDANCE,
    standing: [
      {
        ...GUIDANCE.standing[0],
        notes: { done, toRevisit: 1, didNotUnderstand: 0, total: 9 },
      },
    ],
  };
}

async function setDone(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Arrays & Hashing/ }));
  await user.click(
    screen.getByRole('button', { name: /Status: Not started/i }),
  );
  await user.click(await screen.findByRole('menuitemradio', { name: /Done/i }));
}

describe('Home guidance card', () => {
  it('renders the card from GET /api/guidance above the catalog', async () => {
    render(<Home />);
    const card = await screen.findByRole('region', { name: 'Your guidance' });
    expect(screen.getByText('1 needs review')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /^Group Anagrams/ }),
    ).toHaveAttribute('target', '_blank');
    // Wire difficulty is lowercase; the badge shows display casing.
    expect(within(card).getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Arrays & Hashing')).toBeInTheDocument();
  });

  it('a guidance error hides only the card; the catalog still renders', async () => {
    routes['/api/guidance'] = () => ({ status: 500, body: { error: 'boom' } });
    render(<Home />);
    expect(await screen.findByText('Arrays & Hashing')).toBeInTheDocument();
    await waitFor(() => expect(guidanceCalls()).toBe(1));
    expect(screen.queryByRole('region', { name: 'Your guidance' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('no_db guidance renders no card', async () => {
    routes['/api/guidance'] = ok({ ...GUIDANCE, state: 'no_db' });
    render(<Home />);
    await screen.findByText('Arrays & Hashing');
    await waitFor(() => expect(guidanceCalls()).toBe(1));
    expect(screen.queryByText('Where you stand')).toBeNull();
  });

  it('refetches guidance after a successful status change', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await screen.findByRole('region', { name: 'Your guidance' });
    expect(guidanceCalls()).toBe(1);

    routes['/api/guidance'] = ok({
      ...GUIDANCE,
      standing: [
        {
          ...GUIDANCE.standing[0],
          notes: { done: 3, toRevisit: 1, didNotUnderstand: 0, total: 9 },
        },
      ],
    });
    await setDone(user);
    await waitFor(() => expect(guidanceCalls()).toBe(2));
    expect(await screen.findByText('3/9')).toBeInTheDocument();
  });

  it('a failed refetch keeps the last good guidance', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await screen.findByRole('region', { name: 'Your guidance' });
    expect(screen.getByText('2/9')).toBeInTheDocument();

    routes['/api/guidance'] = () => ({ status: 500, body: { error: 'boom' } });
    await setDone(user);
    await waitFor(() => expect(guidanceCalls()).toBe(2));
    // Let the rejected refetch settle before asserting.
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole('region', { name: 'Your guidance' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2/9')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('discards an older guidance response that resolves after a newer one', async () => {
    const user = userEvent.setup();
    // The first (mount) request is held; the refetch answers immediately.
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    routes['/api/guidance'] = async () => {
      calls += 1;
      if (calls === 1) {
        await first;
        return { status: 200, body: guidanceWithDone(2) };
      }
      return { status: 200, body: guidanceWithDone(3) };
    };
    render(<Home />);
    await screen.findByText('Arrays & Hashing');

    await setDone(user);
    expect(await screen.findByText('3/9')).toBeInTheDocument();
    expect(guidanceCalls()).toBe(2);

    // The stale mount response lands last and must not overwrite the newer one.
    await act(async () => {
      releaseFirst();
      await first;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText('3/9')).toBeInTheDocument();
    expect(screen.queryByText('2/9')).toBeNull();
  });

  it('works when localStorage throws on read and write', async () => {
    const user = userEvent.setup();
    const boom = (): never => {
      throw new Error('storage disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

    render(<Home />);
    await screen.findByRole('region', { name: 'Your guidance' });
    const toggle = screen.getByRole('button', { name: /your guidance/i });
    // readCollapsed threw → defaults to expanded.
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Where you stand')).toBeVisible();

    // writeCollapsed throws; the in-memory toggle still works both ways.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Where you stand')).not.toBeVisible();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Where you stand')).toBeVisible();
    expect(screen.getByText('Arrays & Hashing')).toBeInTheDocument();
  });

  it('does not refetch guidance when the status save fails', async () => {
    const user = userEvent.setup();
    routes['/api/notes/lc-1'] = () => ({ status: 500, body: {} });
    render(<Home />);
    await screen.findByRole('region', { name: 'Your guidance' });
    await setDone(user);
    await screen.findByText(/could not save that change/i);
    expect(guidanceCalls()).toBe(1);
    // The card survives the failed toggle.
    expect(
      screen.getByRole('region', { name: 'Your guidance' }),
    ).toBeInTheDocument();
  });
});

describe('Home guidance card — back from Notes', () => {
  it('refetches guidance on popstate back to Home', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Your guidance' });
    expect(guidanceCalls()).toBe(1);

    act(() => navigate(notesHref('lc-1')));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Your guidance' }),
      ).toBeNull(),
    );

    // Browser Back: the URL changes, then `popstate` fires.
    act(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByRole('region', { name: 'Your guidance' });
    expect(guidanceCalls()).toBe(2);
  });
});
