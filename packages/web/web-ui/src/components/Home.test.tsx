import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from './Home';
import * as api from '../lib/api';
import type {
  CatalogResponse,
  ConfigResponse,
  ProgressResponse,
} from '../lib/api';

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchConfig: vi.fn(),
    fetchCatalog: vi.fn(),
    fetchProgress: vi.fn(),
    postNoteStatus: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const CONFIG_OK: ConfigResponse = {
  dbConfigured: true,
  dataDir: '/tmp/db',
  provider: 'Ollama',
};

const CATALOG: CatalogResponse = {
  topics: [
    {
      topic: 'Arrays & Hashing',
      problems: [
        {
          id: 'two-sum',
          title: 'Two Sum',
          url: 'https://leetcode.com/problems/two-sum/',
          difficulty: 'Easy',
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

const PROGRESS: ProgressResponse = {
  completed: 0,
  total: 1,
  byStatus: { none: 1, done: 0, to_revisit: 0, did_not_understand: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

/** A multi-topic catalog for the search/filter tests. */
const BIG_CATALOG: CatalogResponse = {
  topics: [
    {
      topic: 'Arrays & Hashing',
      problems: [
        {
          id: 'two-sum',
          title: 'Two Sum',
          url: 'https://leetcode.com/problems/two-sum/',
          difficulty: 'Easy',
          status: 'done',
          completed: true,
        },
        {
          id: 'group-anagrams',
          title: 'Group Anagrams',
          url: 'https://leetcode.com/problems/group-anagrams/',
          difficulty: 'Medium',
          status: 'to_revisit',
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
          difficulty: 'Easy',
          status: 'none',
          completed: false,
        },
        {
          id: 'largest-rectangle-in-histogram',
          title: 'Largest Rectangle in Histogram',
          url: 'https://leetcode.com/problems/largest-rectangle-in-histogram/',
          difficulty: 'Hard',
          status: 'to_revisit',
          completed: false,
        },
      ],
    },
  ],
  totals: {
    total: 4,
    byStatus: { none: 1, done: 1, to_revisit: 2, did_not_understand: 0 },
  },
};

async function renderBig(): Promise<void> {
  mockedApi.fetchConfig.mockResolvedValue(CONFIG_OK);
  mockedApi.fetchCatalog.mockResolvedValue(BIG_CATALOG);
  mockedApi.fetchProgress.mockResolvedValue({
    completed: 1,
    total: 4,
    byStatus: BIG_CATALOG.totals.byStatus,
  });
  render(<Home />);
  await screen.findByText('Arrays & Hashing');
}

describe('Home search & filters', () => {
  it('typing filters rows, auto-expands matching topics and hides empty ones', async () => {
    const user = userEvent.setup();
    await renderBig();
    // Unfiltered: collapsed, no rows, full count.
    expect(screen.queryByText('Two Sum')).not.toBeInTheDocument();
    expect(screen.getByText('4 problems')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/search problems/i), 'SUM');

    const header = screen.getByRole('button', { name: /Arrays & Hashing/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Two Sum')).toBeInTheDocument();
    expect(screen.queryByText('Group Anagrams')).not.toBeInTheDocument();
    expect(screen.queryByText('Stack')).not.toBeInTheDocument();
    expect(screen.getByText('1 match')).toBeInTheDocument();
    expect(screen.getByText('1 of 4 problems')).toBeInTheDocument();
    // Reflected in the URL.
    expect(window.location.search).toBe('?q=SUM');
  });

  it('matches on problem id too', async () => {
    const user = userEvent.setup();
    await renderBig();
    await user.type(
      screen.getByLabelText(/search problems/i),
      'rectangle-in-histogram',
    );
    expect(
      screen.getByText('Largest Rectangle in Histogram'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Arrays & Hashing')).not.toBeInTheDocument();
  });

  it('chips toggle aria-pressed and combine (status AND difficulty)', async () => {
    const user = userEvent.setup();
    await renderBig();
    const revisit = screen.getByRole('button', { name: /To revisit/ });
    expect(revisit).toHaveAttribute('aria-pressed', 'false');
    await user.click(revisit);
    expect(revisit).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('2 of 4 problems')).toBeInTheDocument();
    expect(screen.getByText('Group Anagrams')).toBeInTheDocument();
    expect(
      screen.getByText('Largest Rectangle in Histogram'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hard' }));
    expect(screen.getByText('1 of 4 problems')).toBeInTheDocument();
    expect(screen.queryByText('Group Anagrams')).not.toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect(params.get('difficulty')).toBe('Hard');
    expect(params.get('status')).toBe('to_revisit');

    // Toggle off again.
    await user.click(revisit);
    expect(revisit).toHaveAttribute('aria-pressed', 'false');
  });

  it('Clear filters resets search, chips, URL and collapses topics', async () => {
    const user = userEvent.setup();
    await renderBig();
    const search = screen.getByLabelText(/search problems/i);
    await user.type(search, 'valid');
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    await user.click(screen.getByRole('button', { name: /clear filters/i }));

    expect(search).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Easy' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('4 problems')).toBeInTheDocument();
    expect(screen.getByText('Stack')).toBeInTheDocument();
    expect(screen.getByText('Arrays & Hashing')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Arrays & Hashing/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('button', { name: /clear filters/i }),
    ).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('shows a friendly no-results state that can reset', async () => {
    const user = userEvent.setup();
    await renderBig();
    await user.type(screen.getByLabelText(/search problems/i), 'zzz');
    expect(
      screen.getByText(/no problems match your filters/i),
    ).toBeInTheDocument();
    expect(screen.getByText('0 of 4 problems')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /show all problems/i }),
    );
    expect(screen.getByText('Arrays & Hashing')).toBeInTheDocument();
  });

  it('restores the filter from the URL on load', async () => {
    window.history.replaceState({}, '', '/?status=done');
    await renderBig();
    expect(screen.getByRole('button', { name: /^Done$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Two Sum')).toBeInTheDocument();
    expect(screen.getByText('1 of 4 problems')).toBeInTheDocument();
  });
});

describe('Home', () => {
  it('shows the create-database CTA when dbConfigured is false', async () => {
    mockedApi.fetchConfig.mockResolvedValue({
      dbConfigured: false,
      provider: 'none',
    });
    render(<Home />);
    const cta = await screen.findByRole('link', {
      name: /create your database/i,
    });
    expect(cta).toHaveAttribute('href', '/setup');
    // Catalog/progress not fetched in the no-db state.
    expect(mockedApi.fetchCatalog).not.toHaveBeenCalled();
  });

  it('shows a friendly error message when an API call fails', async () => {
    mockedApi.fetchConfig.mockRejectedValue(new Error('network down'));
    render(<Home />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load your data/i,
    );
  });

  it('renders the banner and categorized list when data loads', async () => {
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_OK);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    mockedApi.fetchProgress.mockResolvedValue(PROGRESS);

    render(<Home />);

    const banner = await screen.findByRole('region', {
      name: /overall progress/i,
    });
    expect(within(banner).getByText('0 / 1')).toBeInTheDocument(); // banner fraction
    expect(screen.getByText('Arrays & Hashing')).toBeInTheDocument();
  });

  it('optimistically updates the row, badge and bar, then POSTs', async () => {
    const user = userEvent.setup();
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_OK);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    mockedApi.fetchProgress.mockResolvedValue(PROGRESS);
    mockedApi.postNoteStatus.mockResolvedValue({
      problemId: 'two-sum',
      status: 'done',
      completed: true,
    });

    render(<Home />);
    await screen.findByText('Arrays & Hashing');

    // Expand the category.
    await user.click(screen.getByRole('button', { name: /Arrays & Hashing/ }));

    // Open the status control and pick "Done".
    const statusTrigger = screen.getByRole('button', {
      name: /Status: Not started/i,
    });
    await user.click(statusTrigger);
    const doneItem = await screen.findByRole('menuitemradio', {
      name: /Done/i,
    });
    await user.click(doneItem);

    // POST happened with the new status.
    await waitFor(() =>
      expect(mockedApi.postNoteStatus).toHaveBeenCalledWith('two-sum', 'done'),
    );

    // Optimistic: category badge is now 1 / 1 and the global bar shows 1 / 1.
    await waitFor(() => {
      const badges = screen.getAllByText('1 / 1');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('reverts and shows a subtle error if the POST fails', async () => {
    const user = userEvent.setup();
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_OK);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    mockedApi.fetchProgress.mockResolvedValue(PROGRESS);
    mockedApi.postNoteStatus.mockRejectedValue(new api.ApiError('boom', 500));

    render(<Home />);
    await screen.findByText('Arrays & Hashing');
    await user.click(screen.getByRole('button', { name: /Arrays & Hashing/ }));

    await user.click(
      screen.getByRole('button', { name: /Status: Not started/i }),
    );
    await user.click(
      await screen.findByRole('menuitemradio', { name: /Done/i }),
    );

    // Error surfaced.
    await waitFor(() =>
      expect(
        screen.getByText(/could not save that change/i),
      ).toBeInTheDocument(),
    );

    // Reverted: the status trigger is back to "Not started".
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Status: Not started/i }),
      ).toBeInTheDocument(),
    );
  });
});
