import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Analytics } from './Analytics';
import * as api from '../lib/api';
import type {
  CatalogResponse,
  CompetencyResponse,
  ConfigResponse,
  ProgressResponse,
} from '../lib/api';

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchConfig: vi.fn(),
    fetchProgress: vi.fn(),
    fetchCatalog: vi.fn(),
    fetchCompetency: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const CONFIG_DB: ConfigResponse = {
  dbConfigured: true,
  dataDir: '/home/me/.ibai',
  provider: 'ollama',
};

const CONFIG_NO_DB: ConfigResponse = {
  dbConfigured: false,
  provider: 'ollama',
};

const PROGRESS: ProgressResponse = {
  completed: 3,
  total: 6,
  byStatus: { none: 1, done: 3, to_revisit: 1, did_not_understand: 1 },
};

const PROGRESS_EMPTY: ProgressResponse = {
  completed: 0,
  total: 0,
  byStatus: { none: 0, done: 0, to_revisit: 0, did_not_understand: 0 },
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
    {
      topic: 'Two Pointers',
      problems: [
        {
          id: 'c',
          title: 'C',
          url: 'https://x/c',
          difficulty: 'Hard',
          status: 'none',
          completed: false,
        },
      ],
    },
  ],
  totals: {
    total: 3,
    byStatus: { none: 1, done: 1, to_revisit: 1, did_not_understand: 0 },
  },
};

const COMPETENCY: CompetencyResponse = {
  topics: [
    {
      topicId: 'Dynamic Programming',
      correct: 1,
      incorrect: 4,
      strength: 'weak',
      lastSeen: '2026-09-24T12:00:00.000Z',
    },
    {
      topicId: 'Arrays & Hashing',
      correct: 5,
      incorrect: 1,
      strength: 'strong',
      lastSeen: '2026-09-24T12:00:00.000Z',
    },
  ],
  patterns: [
    {
      id: 'miss:lc-322',
      description: 'Missed "Coin Change"; you reached for greedy first.',
      topics: ['Dynamic Programming'],
      occurrences: 3,
      lastObserved: '2026-09-24T12:00:00.000Z',
    },
  ],
};

const COMPETENCY_EMPTY: CompetencyResponse = { topics: [], patterns: [] };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no competency signals unless a test overrides it.
  mockedApi.fetchCompetency.mockResolvedValue(COMPETENCY_EMPTY);
});

describe('Analytics page', () => {
  it('renders the status breakdown + per-topic bars from mocked APIs', async () => {
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_DB);
    mockedApi.fetchProgress.mockResolvedValue(PROGRESS);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);

    render(<Analytics />);

    // Status breakdown chart is present (accessible SVG image).
    const statusChart = await screen.findByRole('img', {
      name: /problems by status/i,
    });
    expect(statusChart).toBeInTheDocument();

    // Per-topic bars: one accessible SVG per topic, showing done/total + %.
    expect(
      screen.getByRole('img', {
        name: /Arrays & Hashing: 1 of 2 done \(50%\)/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: /Two Pointers: 0 of 1 done \(0%\)/i,
      }),
    ).toBeInTheDocument();
  });

  it('shows the overall summary with completed/total and per-status counts', async () => {
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_DB);
    mockedApi.fetchProgress.mockResolvedValue(PROGRESS);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);

    render(<Analytics />);

    const summary = await screen.findByRole('region', {
      name: /overall summary/i,
    });
    // Overall fraction + percent.
    expect(within(summary).getByText('3 / 6')).toBeInTheDocument();
    expect(within(summary).getByText(/50% done/i)).toBeInTheDocument();

    // Per-status table rows carry the right labels + counts.
    const table = within(summary).getByRole('table');
    const doneRow = within(table).getByRole('row', { name: /Done/i });
    // Done count is 3 (from byStatus.done).
    expect(within(doneRow).getByText('3')).toBeInTheDocument();
  });

  it('shows a friendly empty state (not a crash) when a DB is configured but nothing is tracked', async () => {
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_DB);
    mockedApi.fetchProgress.mockResolvedValue(PROGRESS_EMPTY);
    mockedApi.fetchCatalog.mockResolvedValue({
      topics: [],
      totals: { total: 0, byStatus: PROGRESS_EMPTY.byStatus },
    });

    render(<Analytics />);

    expect(await screen.findByText(/no data yet/i)).toBeInTheDocument();
    // Links back to the catalog (Home), not a crash.
    const link = screen.getByRole('link', { name: /go to the catalog/i });
    expect(link).toHaveAttribute('href', '/');
    // No chart rendered in the empty state.
    expect(
      screen.queryByRole('img', { name: /problems by status/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the create-database empty state when no DB is configured', async () => {
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_NO_DB);

    render(<Analytics />);

    expect(await screen.findByText(/no data yet/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /create your database/i });
    expect(cta).toHaveAttribute('href', '/setup');
    // Progress/catalog are not even fetched when there is no DB.
    expect(mockedApi.fetchProgress).not.toHaveBeenCalled();
    expect(mockedApi.fetchCatalog).not.toHaveBeenCalled();
  });

  it('shows an inline error (no crash) on a network/API failure', async () => {
    mockedApi.fetchConfig.mockRejectedValue(new Error('network down'));

    render(<Analytics />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load your analytics/i,
    );
  });

  it('shows a loading state before data resolves', () => {
    // Never-resolving config keeps the page in the loading state.
    mockedApi.fetchConfig.mockReturnValue(new Promise(() => {}));

    render(<Analytics />);
    expect(screen.getByRole('status')).toHaveTextContent(
      /loading your analytics/i,
    );
  });

  it('renders the competency section: weak topic (red), strong topic (emerald), and a pattern', async () => {
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_DB);
    mockedApi.fetchProgress.mockResolvedValue(PROGRESS);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    mockedApi.fetchCompetency.mockResolvedValue(COMPETENCY);

    render(<Analytics />);

    const section = await screen.findByRole('region', {
      name: /competency intelligence/i,
    });

    // Weak topic bar present + colored red (#ef4444).
    const weak = within(section).getByRole('img', {
      name: /Dynamic Programming: Weak, 1 correct, 4 incorrect/i,
    });
    expect(weak).toBeInTheDocument();
    const weakFill = weak.querySelector('rect[fill="#ef4444"]');
    expect(weakFill).not.toBeNull();

    // Strong topic bar present + colored emerald (#22c55e).
    const strong = within(section).getByRole('img', {
      name: /Arrays & Hashing: Strong, 5 correct, 1 incorrect/i,
    });
    expect(strong).toBeInTheDocument();
    const strongFill = strong.querySelector('rect[fill="#22c55e"]');
    expect(strongFill).not.toBeNull();

    // The recurring miss pattern appears (escaped text, verbatim).
    expect(
      within(section).getByText(
        /Missed "Coin Change"; you reached for greedy/i,
      ),
    ).toBeInTheDocument();
    // Occurrence count badge.
    expect(within(section).getByText('×3')).toBeInTheDocument();
  });

  it('shows the competency empty state (with a quiz link) when there are no signals', async () => {
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_DB);
    mockedApi.fetchProgress.mockResolvedValue(PROGRESS);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    mockedApi.fetchCompetency.mockResolvedValue(COMPETENCY_EMPTY);

    render(<Analytics />);

    const section = await screen.findByRole('region', {
      name: /competency intelligence/i,
    });
    expect(
      within(section).getByText(
        /take a quiz session to build your competency map/i,
      ),
    ).toBeInTheDocument();
    const quizLink = within(section).getByRole('link', {
      name: /start a quiz/i,
    });
    expect(quizLink).toHaveAttribute('href', '/interview');
  });
});
