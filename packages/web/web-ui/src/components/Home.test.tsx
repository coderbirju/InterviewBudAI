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
