import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import * as api from './lib/api';
import { INSIGHTS_LOCKED } from './lib/insights.fixture';
import type { CatalogResponse, DataDirStatus } from './lib/api';

/**
 * App-level wiring for "Your data" (ADR 0009 D1): the Data nav link, the /data
 * route, and the data-folder banner on Home + Analytics.
 */

vi.mock('./lib/api', async () => {
  const actual = await vi.importActual<typeof import('./lib/api')>('./lib/api');
  return {
    ...actual,
    fetchConfig: vi.fn(),
    fetchProgress: vi.fn(),
    fetchCatalog: vi.fn(),
    fetchCompetency: vi.fn(),
    fetchInsights: vi.fn(),
    fetchDataDir: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const EMPTY_COUNTS = { none: 1, done: 0, to_revisit: 0, did_not_understand: 0 };

const CATALOG: CatalogResponse = {
  topics: [
    {
      topic: 'Arrays & Hashing',
      problems: [
        {
          id: 'a',
          title: 'A',
          url: 'https://x/a',
          difficulty: 'Easy',
          status: 'none',
          completed: false,
        },
      ],
    },
  ],
  totals: { total: 1, byStatus: EMPTY_COUNTS },
};

const STATUS: DataDirStatus = {
  dataDir: '/home/me/.interviewbudai/data',
  source: 'default',
  pinned: false,
  exists: true,
  noteCount: 0,
  formatVersion: 1,
  legacyCandidates: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mockedApi.fetchConfig.mockResolvedValue({
    dbConfigured: true,
    dataDir: STATUS.dataDir,
    provider: 'none',
  });
  mockedApi.fetchProgress.mockResolvedValue({
    completed: 0,
    total: 1,
    byStatus: EMPTY_COUNTS,
  });
  mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
  mockedApi.fetchCompetency.mockResolvedValue({ topics: [], patterns: [] });
  mockedApi.fetchInsights.mockResolvedValue(INSIGHTS_LOCKED);
  mockedApi.fetchDataDir.mockResolvedValue(STATUS);
  window.history.pushState({}, '', '/');
});

describe('App: Your data', () => {
  it('Home shows the empty-folder banner linking to /data; the Data nav link opens the page', async () => {
    const user = userEvent.setup();
    render(<App />);
    const banner = await screen.findByRole('region', { name: 'Data folder' });
    expect(banner).toHaveTextContent("Don't see your solved problems?");
    await screen.findByText('Arrays & Hashing');

    const nav = screen.getByRole('link', { name: /^Data$/ });
    expect(nav).toHaveAttribute('href', '/data');
    await user.click(nav);
    expect(
      await screen.findByRole('heading', { name: 'Your data' }),
    ).toBeInTheDocument();
    expect(nav).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('active-path')).toHaveTextContent(
      STATUS.dataDir,
    );
  });

  it('Analytics shows the banner too', async () => {
    window.history.pushState({}, '', '/analytics');
    render(<App />);
    expect(
      await screen.findByRole('region', { name: 'Data folder' }),
    ).toBeInTheDocument();
    await screen.findByRole('heading', { name: /^Analytics$/ });
  });

  it('no banner when the folder already has notes', async () => {
    mockedApi.fetchDataDir.mockResolvedValue({ ...STATUS, noteCount: 5 });
    render(<App />);
    await screen.findByText('Arrays & Hashing');
    expect(mockedApi.fetchDataDir).toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Data folder' }),
    ).not.toBeInTheDocument();
  });
});
