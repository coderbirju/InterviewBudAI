import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { rememberHomeSearch } from './lib/router';

/**
 * App-level integration: the real App, router, Home and Notes components with
 * only the network (`fetch`) faked. Guards the W3 promise that a Home filter
 * survives a round-trip through a problem's Notes page.
 */

const WIRE_CATALOG = {
  topics: [
    {
      topic: 'Arrays & Hashing',
      problems: [
        {
          id: 'two-sum',
          title: 'Two Sum',
          url: 'https://leetcode.com/problems/two-sum/',
          difficulty: 'easy',
          status: 'none',
          completed: false,
        },
        {
          id: 'group-anagrams',
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
          id: 'valid-parentheses',
          title: 'Valid Parentheses',
          url: 'https://leetcode.com/problems/valid-parentheses/',
          difficulty: 'easy',
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A minimal fake of the same-origin JSON API (the GET routes this flow hits). */
function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const path = typeof input === 'string' ? input : input.toString();
  if (path === '/api/config') {
    return Promise.resolve(
      json({ dbConfigured: true, dataDir: '/tmp/db', provider: 'ollama' }),
    );
  }
  if (path === '/api/catalog') {
    return Promise.resolve(json(WIRE_CATALOG));
  }
  if (path === '/api/progress') {
    return Promise.resolve(
      json({ completed: 0, total: 3, byStatus: WIRE_CATALOG.totals.byStatus }),
    );
  }
  const note = /^\/api\/notes\/([^/]+)$/.exec(path);
  if (note) {
    return Promise.resolve(
      json({
        problemId: decodeURIComponent(note[1] ?? ''),
        content: '',
        status: 'none',
        completed: false,
        timeComplexity: null,
        spaceComplexity: null,
        lastUpdated: null,
      }),
    );
  }
  return Promise.resolve(json({ error: 'not found' }, 404));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  window.history.replaceState({}, '', '/');
  rememberHomeSearch('');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App: Home filter survives a Notes round-trip', () => {
  it('filter on Home → open Notes → Back to problems keeps the filter', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Arrays & Hashing');

    await user.type(screen.getByLabelText(/search problems/i), 'sum');
    expect(window.location.search).toBe('?q=sum');
    expect(screen.getByText('1 of 3 problems')).toBeInTheDocument();
    expect(screen.queryByText('Stack')).not.toBeInTheDocument();

    // Open the matching row's notes (client-side navigation).
    const row = screen.getByText('Two Sum').closest('tr');
    expect(row).not.toBeNull();
    await user.click(
      within(row as HTMLElement).getByRole('link', {
        name: /open notes for two sum/i,
      }),
    );
    expect(window.location.pathname).toBe('/notes/two-sum');
    // Notes loaded: the title links out to the problem.
    expect(
      await screen.findByRole('link', { name: 'Two Sum' }),
    ).toHaveAttribute('href', 'https://leetcode.com/problems/two-sum/');

    // Back to problems returns to the same filtered Home view.
    await user.click(screen.getByRole('link', { name: /back to problems/i }));
    await screen.findByText('Arrays & Hashing');

    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?q=sum');
    expect(screen.getByLabelText(/search problems/i)).toHaveValue('sum');
    expect(screen.getByText('1 of 3 problems')).toBeInTheDocument();
    expect(screen.getByText('Two Sum')).toBeInTheDocument();
    expect(screen.queryByText('Stack')).not.toBeInTheDocument();
  });
});
