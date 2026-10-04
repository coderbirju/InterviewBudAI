import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import userEvent from '@testing-library/user-event';
import { Notes } from './Notes';
import * as api from '../lib/api';
import { rememberHomeSearch } from '../lib/router';
import type { CatalogResponse, FullNote } from '../lib/api';

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchNote: vi.fn(),
    fetchCatalog: vi.fn(),
    saveNote: vi.fn(),
    fetchStatement: vi.fn(),
    fetchPreferences: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

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
          status: 'to_revisit',
          completed: false,
        },
      ],
    },
  ],
  totals: {
    total: 1,
    byStatus: { none: 0, done: 0, to_revisit: 1, did_not_understand: 0 },
  },
};

const SAVED_NOTE: FullNote = {
  problemId: 'two-sum',
  content: 'Use a hash map of value -> index.',
  status: 'to_revisit',
  completed: false,
  timeComplexity: 'O(n)',
  spaceComplexity: 'O(n)',
  lastUpdated: '2026-09-24T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the URL so router-based navigation assertions start from /app.
  window.history.pushState({}, '', '/app/notes/two-sum');
  // ADR 0015: these tests cover the editor while the statement is still
  // loading, so no template is applied (Notes.statement.test.tsx covers it).
  mockedApi.fetchStatement.mockReturnValue(new Promise(() => {}));
  mockedApi.fetchPreferences.mockResolvedValue({
    language: 'python',
    leetcodeFetch: { enabled: true, pinned: false },
  });
});

describe('Notes editor', () => {
  it('"Back to problems" returns to the last Home filter (W3)', async () => {
    const user = userEvent.setup();
    mockedApi.fetchNote.mockResolvedValue(SAVED_NOTE);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    rememberHomeSearch('?q=sum&status=to_revisit');
    try {
      render(<Notes problemId="two-sum" />);
      const back = await screen.findByRole('link', {
        name: /back to problems/i,
      });
      expect(back).toHaveAttribute('href', '/?q=sum&status=to_revisit');
      await user.click(back);
      expect(window.location.pathname).toBe('/');
      expect(window.location.search).toBe('?q=sum&status=to_revisit');
    } finally {
      rememberHomeSearch('');
    }
  });

  it('renders and pre-fills all fields from the saved note + catalog', async () => {
    mockedApi.fetchNote.mockResolvedValue(SAVED_NOTE);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);

    render(<Notes problemId="two-sum" />);

    // Title links to the LeetCode url (new tab, noopener).
    const titleLink = await screen.findByRole('link', { name: /Two Sum/ });
    expect(titleLink).toHaveAttribute(
      'href',
      'https://leetcode.com/problems/two-sum/',
    );
    expect(titleLink).toHaveAttribute('target', '_blank');
    expect(titleLink).toHaveAttribute(
      'rel',
      expect.stringContaining('noopener'),
    );

    // Content pre-filled.
    expect(screen.getByLabelText(/Intuition/i)).toHaveValue(
      'Use a hash map of value -> index.',
    );
    // Complexity pre-filled.
    expect(screen.getByLabelText(/Time complexity/i)).toHaveValue('O(n)');
    expect(screen.getByLabelText(/Space complexity/i)).toHaveValue('O(n)');
    // Status control reflects the saved status.
    expect(
      screen.getByRole('button', { name: /Status: To revisit/i }),
    ).toBeInTheDocument();
  });

  it('falls back to the id as the title when the catalog lookup fails', async () => {
    mockedApi.fetchNote.mockResolvedValue({
      ...SAVED_NOTE,
      content: '',
      timeComplexity: null,
      spaceComplexity: null,
      status: 'none',
    });
    mockedApi.fetchCatalog.mockRejectedValue(new Error('catalog down'));

    render(<Notes problemId="two-sum" />);
    // Heading falls back to the id; still no crash.
    expect(
      await screen.findByRole('heading', { name: 'two-sum' }),
    ).toBeInTheDocument();
  });

  it('saves the edited fields via POST and shows a Saved confirmation', async () => {
    const user = userEvent.setup();
    mockedApi.fetchNote.mockResolvedValue(SAVED_NOTE);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    mockedApi.saveNote.mockResolvedValue({
      ...SAVED_NOTE,
      content: 'Updated intuition',
      timeComplexity: 'O(n log n)',
    });

    render(<Notes problemId="two-sum" />);
    const textarea = await screen.findByLabelText(/Intuition/i);

    await user.clear(textarea);
    await user.type(textarea, 'Updated intuition');
    const timeInput = screen.getByLabelText(/Time complexity/i);
    await user.clear(timeInput);
    await user.type(timeInput, 'O(n log n)');

    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() =>
      expect(mockedApi.saveNote).toHaveBeenCalledWith('two-sum', {
        content: 'Updated intuition',
        status: 'to_revisit',
        timeComplexity: 'O(n log n)',
        spaceComplexity: 'O(n)',
      }),
    );

    // Confirmation shown.
    expect(await screen.findByText(/^Saved$/)).toBeInTheDocument();
  });

  it('lets the status selector set a different one of the 4 states, then saves it', async () => {
    const user = userEvent.setup();
    mockedApi.fetchNote.mockResolvedValue(SAVED_NOTE);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    mockedApi.saveNote.mockResolvedValue({ ...SAVED_NOTE, status: 'done' });

    render(<Notes problemId="two-sum" />);
    await screen.findByLabelText(/Intuition/i);

    // Open the status menu and choose Done.
    await user.click(
      screen.getByRole('button', { name: /Status: To revisit/i }),
    );
    await user.click(
      await screen.findByRole('menuitemradio', { name: /^Done$/ }),
    );

    // The trigger now reflects Done.
    expect(
      screen.getByRole('button', { name: /Status: Done/i }),
    ).toBeInTheDocument();

    // Saving sends the new status.
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() =>
      expect(mockedApi.saveNote).toHaveBeenCalledWith(
        'two-sum',
        expect.objectContaining({ status: 'done' }),
      ),
    );
  });

  it('shows the create-database CTA when no DB is configured', async () => {
    mockedApi.fetchNote.mockResolvedValue({ dbConfigured: false });

    render(<Notes problemId="two-sum" />);
    const cta = await screen.findByRole('link', {
      name: /create your database/i,
    });
    expect(cta).toHaveAttribute('href', '/data');
    // Editor form not rendered.
    expect(screen.queryByLabelText(/Intuition/i)).not.toBeInTheDocument();
  });

  it('shows a friendly not-found message for an unknown problem (404)', async () => {
    mockedApi.fetchNote.mockRejectedValue(new api.ApiError('unknown', 404));

    render(<Notes problemId="nope" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /problem not found/i,
    );
  });

  it('shows an inline error (no crash) on a network/API failure', async () => {
    mockedApi.fetchNote.mockRejectedValue(new Error('network down'));

    render(<Notes problemId="two-sum" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load this note/i,
    );
  });

  it('surfaces a save error without crashing when POST fails', async () => {
    const user = userEvent.setup();
    mockedApi.fetchNote.mockResolvedValue(SAVED_NOTE);
    mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
    mockedApi.saveNote.mockRejectedValue(new api.ApiError('boom', 500));

    render(<Notes problemId="two-sum" />);
    await screen.findByLabelText(/Intuition/i);

    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() =>
      expect(screen.getByText(/could not save your note/i)).toBeInTheDocument(),
    );
  });

  // ADR 0014 D2: the other tests run the textarea fallback (jsdom has no style
  // nonce); this one runs the real lazy CodeMirror editor.
  it('with a valid style nonce, saves the CodeMirror editor content', async () => {
    const user = userEvent.setup();
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'ibai-style-nonce');
    meta.setAttribute('nonce', 'AAECAwQFBgcICQoLDA0ODw==');
    document.head.appendChild(meta);
    try {
      mockedApi.fetchNote.mockResolvedValue(SAVED_NOTE);
      mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
      mockedApi.saveNote.mockImplementation(async (_id, body) => ({
        ...SAVED_NOTE,
        content: body.content ?? '',
      }));

      render(<Notes problemId="two-sum" />);
      await screen.findByTestId('note-editor');
      const content = await screen.findByRole('textbox', {
        name: /Intuition/i,
      });
      expect(content).toHaveAttribute('contenteditable', 'true');
      const view = EditorView.findFromDOM(content);
      expect(view?.state.doc.toString()).toBe(SAVED_NOTE.content);
      act(() => {
        view?.dispatch({
          changes: {
            from: view.state.doc.length,
            insert: '\n```python\nseen = {}\n```',
          },
        });
      });

      await user.click(screen.getByRole('button', { name: /^Save$/ }));
      await waitFor(() =>
        expect(mockedApi.saveNote).toHaveBeenCalledWith(
          'two-sum',
          expect.objectContaining({
            content: SAVED_NOTE.content + '\n```python\nseen = {}\n```',
          }),
        ),
      );
      // The save reconcile is an outside value: it must not clear "Saved".
      expect(await screen.findByText(/^Saved$/)).toBeInTheDocument();
    } finally {
      meta.remove();
    }
  });
});
