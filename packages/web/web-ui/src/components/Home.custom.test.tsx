import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from './Home';
import * as api from '../lib/api';
import { setFlash } from '../lib/flash';
import type {
  CatalogResponse,
  ConfigResponse,
  CustomProblem,
  ProgressResponse,
} from '../lib/api';

/* ADR 0010 D5: Add problem (top + per-topic "+"), Custom badge, no-url rows. */

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchConfig: vi.fn(),
    fetchCatalog: vi.fn(),
    fetchProgress: vi.fn(),
    fetchGuidance: vi.fn(),
    postNoteStatus: vi.fn(),
    createProblem: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const CONFIG: ConfigResponse = {
  dbConfigured: true,
  dataDir: '/tmp/db',
  provider: 'Ollama',
};

const XSS = '<img src=x onerror="alert(1)">';

const BY_STATUS = { none: 2, done: 0, to_revisit: 0, did_not_understand: 0 };

const VALID_PARENS = {
  id: 'lc-20',
  title: 'Valid Parentheses',
  url: 'https://leetcode.com/problems/valid-parentheses/',
  difficulty: 'Easy',
  status: 'none',
  completed: false,
} as const;

const CATALOG: CatalogResponse = {
  topics: [
    {
      topic: 'arrays',
      label: 'Arrays & Hashing',
      problems: [
        {
          id: 'lc-1',
          title: 'Two Sum',
          url: 'https://leetcode.com/problems/two-sum/',
          difficulty: 'Easy',
          status: 'none',
          completed: false,
        },
      ],
    },
    { topic: 'stack', label: 'Stack', problems: [VALID_PARENS] },
  ],
  totals: { total: 2, byStatus: BY_STATUS },
};

const CREATED: CustomProblem = {
  id: 'u-img-src-x-abc123',
  title: XSS,
  difficulty: 'hard',
  topics: ['stack'],
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
  custom: true,
};

const AFTER: CatalogResponse = {
  topics: [
    CATALOG.topics[0]!,
    {
      topic: 'stack',
      label: 'Stack',
      problems: [
        VALID_PARENS,
        {
          id: CREATED.id,
          title: XSS,
          difficulty: 'Hard',
          status: 'none',
          completed: false,
          custom: true,
        },
      ],
    },
  ],
  totals: { total: 3, byStatus: { ...BY_STATUS, none: 3 } },
};

const PROGRESS: ProgressResponse = {
  completed: 0,
  total: 2,
  byStatus: BY_STATUS,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
  mockedApi.fetchConfig.mockResolvedValue(CONFIG);
  mockedApi.fetchProgress.mockResolvedValue(PROGRESS);
  mockedApi.fetchGuidance.mockRejectedValue(new Error('no guidance'));
});

describe('Home — custom problems', () => {
  it('"Add problem" opens the form; creating one refetches, expands its topic and shows the Custom row', async () => {
    const user = userEvent.setup();
    mockedApi.fetchCatalog
      .mockResolvedValueOnce(CATALOG)
      .mockResolvedValue(AFTER);
    mockedApi.createProblem.mockResolvedValue(CREATED);
    const { container } = render(<Home />);

    await user.click(
      await screen.findByRole('button', { name: 'Add problem' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Add a problem' });
    // The 13 topics come from /api/catalog, with their labels.
    expect(
      within(dialog).getByRole('checkbox', { name: 'Arrays & Hashing' }),
    ).not.toBeChecked();
    await user.type(within(dialog).getByLabelText('Title'), XSS);
    await user.click(within(dialog).getByRole('checkbox', { name: 'Stack' }));
    await user.selectOptions(
      within(dialog).getByLabelText('Difficulty'),
      'hard',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add problem' }),
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const notice = (await screen.findByText(/^Added/)).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(notice).toHaveTextContent(`Added “${XSS}”.`);
    expect(
      within(notice).getByRole('link', { name: 'Open its notes' }),
    ).toHaveAttribute('href', `/notes/${CREATED.id}`);

    // Its topic is expanded; the row shows the title as text + a Custom badge.
    const panel = await screen.findByRole('row', {
      name: new RegExp('Custom'),
    });
    expect(within(panel).getByText(XSS)).toBeInTheDocument();
    expect(within(panel).getByText('Custom')).toBeInTheDocument();
    // No url ⇒ no outbound link on the title; nothing injected.
    expect(within(panel).queryByRole('link', { name: XSS })).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('the "+" on a topic header pre-selects that topic', async () => {
    const user = userEvent.setup();
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    render(<Home />);
    await user.click(
      await screen.findByRole('button', { name: 'Add a problem to Stack' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Add a problem' });
    expect(
      within(dialog).getByRole('checkbox', { name: 'Stack' }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Arrays & Hashing' }),
    ).not.toBeChecked();
    // Closing returns focus to the "+" that opened it.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Add a problem to Stack' }),
    ).toHaveFocus();
  });

  it('catalog rows keep their outbound link and get no badge', async () => {
    const user = userEvent.setup();
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    render(<Home />);
    await user.click(
      await screen.findByRole('button', { name: /^Arrays & Hashing/ }),
    );
    const row = screen.getByRole('row', { name: /Two Sum/ });
    expect(within(row).getByRole('link', { name: 'Two Sum' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(within(row).queryByText('Custom')).toBeNull();
  });

  it('shows a one-shot flash (e.g. after a delete on Notes) and lets it be dismissed', async () => {
    const user = userEvent.setup();
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    setFlash('Deleted “X” and its note. A backup was saved at /d/.backups/1.');
    const { unmount } = render(<Home />);
    expect(
      await screen.findByText(/A backup was saved at \/d\/\.backups\/1/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/A backup was saved/)).not.toBeInTheDocument();
    unmount();
    // Shown once: a later Home has no flash.
    render(<Home />);
    await screen.findByRole('button', { name: 'Add problem' });
    expect(screen.queryByText(/A backup was saved/)).not.toBeInTheDocument();
  });
});
