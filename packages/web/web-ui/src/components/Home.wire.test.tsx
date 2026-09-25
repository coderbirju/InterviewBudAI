import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from './Home';

/**
 * Wire-shaped regression test: the api module is NOT mocked. `fetch` returns
 * exactly what the server sends — the curriculum's LOWERCASE difficulties
 * (`'easy'|'medium'|'hard'`) — so hand-written display-cased fixtures can no
 * longer hide a casing mismatch between the wire and the SPA's badge/filter.
 */
const WIRE_CATALOG = {
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
        {
          id: 'lc-49',
          title: 'Group Anagrams',
          url: 'https://leetcode.com/problems/group-anagrams/',
          difficulty: 'medium',
          status: 'none',
          completed: false,
        },
      ],
    },
    {
      topic: 'Stack',
      problems: [
        {
          id: 'lc-84',
          title: 'Largest Rectangle in Histogram',
          url: 'https://leetcode.com/problems/largest-rectangle-in-histogram/',
          difficulty: 'hard',
          status: 'none',
          completed: false,
        },
      ],
    },
  ],
  totals: {
    total: 3,
    byStatus: { none: 3, done: 0, to_revisit: 0, did_not_understand: 0 },
  },
};

const WIRE: Record<string, unknown> = {
  '/api/config': { dbConfigured: true, dataDir: '/tmp/db', provider: 'x' },
  '/api/catalog': WIRE_CATALOG,
  '/api/progress': {
    completed: 0,
    total: 3,
    byStatus: WIRE_CATALOG.totals.byStatus,
  },
};

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const body = WIRE[path];
      return new Response(JSON.stringify(body ?? { error: 'not found' }), {
        status: body ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Home with the real (lowercase) catalog wire shape', () => {
  it('difficulty chips match lowercase wire difficulties and badges get their color', async () => {
    const user = userEvent.setup();
    render(<Home />);
    await screen.findByText('Arrays & Hashing');

    await user.click(screen.getByRole('button', { name: 'Hard' }));
    expect(screen.getByText('1 of 3 problems')).toBeInTheDocument();
    expect(
      screen.getByText('Largest Rectangle in Histogram'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Two Sum')).not.toBeInTheDocument();

    // The row's badge renders display casing in the hard token color.
    const badges = screen
      .getAllByText('Hard')
      .filter((el) => el.tagName === 'SPAN');
    expect(
      badges.some((b) => b.classList.contains('text-difficulty-hard')),
    ).toBe(true);
  });

  it('a URL filter `difficulty=Easy,Hard` still works against lowercase data', async () => {
    window.history.replaceState({}, '', '/?difficulty=Easy,Hard');
    render(<Home />);
    expect(await screen.findByText('2 of 3 problems')).toBeInTheDocument();
    expect(screen.getByText('Two Sum')).toBeInTheDocument();
    expect(
      screen.getByText('Largest Rectangle in Histogram'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Group Anagrams')).not.toBeInTheDocument();
    const easy = screen
      .getAllByText('Easy')
      .filter((el) => el.tagName === 'SPAN');
    expect(easy.some((b) => b.classList.contains('text-difficulty-easy'))).toBe(
      true,
    );
  });
});
