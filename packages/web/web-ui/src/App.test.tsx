import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import * as api from './lib/api';
import { INSIGHTS_LOCKED } from './lib/insights.fixture';
import type {
  CatalogResponse,
  CompetencyResponse,
  ConfigResponse,
  ProgressResponse,
} from './lib/api';

vi.mock('./lib/api', async () => {
  const actual = await vi.importActual<typeof import('./lib/api')>('./lib/api');
  return {
    ...actual,
    fetchConfig: vi.fn(),
    fetchProgress: vi.fn(),
    fetchCatalog: vi.fn(),
    fetchCompetency: vi.fn(),
    fetchInsights: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const CONFIG: ConfigResponse = {
  dbConfigured: true,
  dataDir: '/home/me/.ibai',
  provider: 'ollama',
};

const PROGRESS: ProgressResponse = {
  completed: 1,
  total: 2,
  byStatus: { none: 0, done: 1, to_revisit: 1, did_not_understand: 0 },
};

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
          status: 'done',
          completed: true,
        },
        {
          id: 'b',
          title: 'B',
          url: 'https://x/b',
          difficulty: 'Medium',
          status: 'to_revisit',
          completed: false,
        },
      ],
    },
  ],
  totals: {
    total: 2,
    byStatus: { none: 0, done: 1, to_revisit: 1, did_not_understand: 0 },
  },
};

const COMPETENCY_EMPTY: CompetencyResponse = { topics: [], patterns: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.fetchConfig.mockResolvedValue(CONFIG);
  mockedApi.fetchProgress.mockResolvedValue(PROGRESS);
  mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
  mockedApi.fetchCompetency.mockResolvedValue(COMPETENCY_EMPTY);
  mockedApi.fetchInsights.mockResolvedValue(INSIGHTS_LOCKED);
  // Start each test from the SPA root.
  window.history.pushState({}, '', '/');
});

describe('App shell', () => {
  it('renders an Analytics nav link pointing at the SPA analytics route', async () => {
    render(<App />);
    const link = screen.getByRole('link', { name: /Analytics/i });
    expect(link).toHaveAttribute('href', '/analytics');
    // Let Home finish its initial load so no update lands after the test.
    expect(await screen.findByText('Arrays & Hashing')).toBeInTheDocument();
  });

  it('navigates to the analytics page via the nav link (client-side)', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('link', { name: /Analytics/i }));

    // The Analytics view heading + its status chart appear (no full reload).
    expect(
      await screen.findByRole('heading', { name: /^Analytics$/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: /problems by status/i }),
      ).toBeInTheDocument(),
    );
    // The active nav link reflects the analytics route.
    expect(screen.getByRole('link', { name: /Analytics/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders the analytics page on a direct /app/analytics load', async () => {
    window.history.pushState({}, '', '/analytics');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: /^Analytics$/ }),
    ).toBeInTheDocument();
  });

  it('renders an Interview nav link pointing at the SPA interview route', async () => {
    render(<App />);
    const link = screen.getByRole('link', { name: /^Interview$/ });
    expect(link).toHaveAttribute('href', '/interview');
    // Let Home finish its initial load so no update lands after the test.
    expect(await screen.findByText('Arrays & Hashing')).toBeInTheDocument();
  });

  it('navigates to the interview page via the nav link (client-side)', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('link', { name: /^Interview$/ }));

    // The Interview view heading appears (no full reload).
    expect(
      await screen.findByRole('heading', { name: /^Interview$/ }),
    ).toBeInTheDocument();
    // The active nav link reflects the interview route.
    expect(screen.getByRole('link', { name: /^Interview$/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders the interview page on a direct /app/interview load', async () => {
    window.history.pushState({}, '', '/interview');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: /^Interview$/ }),
    ).toBeInTheDocument();
  });
});
