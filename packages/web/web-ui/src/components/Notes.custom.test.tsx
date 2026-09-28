import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Notes } from './Notes';
import * as api from '../lib/api';
import { ProblemApiError } from '../lib/api';
import { clearFlash, peekFlash } from '../lib/flash';
import type { CatalogResponse, CustomProblem, FullNote } from '../lib/api';

/* ADR 0010 D5: statement, Custom badge, Edit and two-step Delete on Notes. */

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchNote: vi.fn(),
    fetchCatalog: vi.fn(),
    saveNote: vi.fn(),
    updateProblem: vi.fn(),
    deleteProblem: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const ID = 'u-book-puzzle-abc123';
const XSS = '<img src=x onerror="alert(1)">';
const STATEMENT = `Line one ${XSS}\nLine two\n\n<script>alert(2)</script>`;

function catalogWith(
  problem: Partial<CatalogResponse['topics'][number]['problems'][number]>,
): CatalogResponse {
  const p = {
    id: ID,
    title: 'Book Puzzle',
    difficulty: 'Hard' as const,
    status: 'none' as const,
    completed: false,
    custom: true as const,
    statement: STATEMENT,
    ...problem,
  };
  return {
    topics: [
      { topic: 'arrays', label: 'Arrays & Hashing', problems: [p] },
      { topic: 'stack', label: 'Stack', problems: [p] },
      { topic: 'heap', label: 'Heap / Priority Queue', problems: [] },
    ],
    totals: {
      total: 1,
      byStatus: { none: 1, done: 0, to_revisit: 0, did_not_understand: 0 },
    },
  };
}

const NOTE: FullNote = {
  problemId: ID,
  content: 'my thinking',
  status: 'none',
  completed: false,
  timeComplexity: null,
  spaceComplexity: null,
  lastUpdated: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  clearFlash();
  window.history.pushState({}, '', `/notes/${ID}`);
  mockedApi.fetchNote.mockResolvedValue(NOTE);
});

describe('Notes — custom problems', () => {
  it('shows the Custom badge and the statement as escaped text with line breaks kept', async () => {
    mockedApi.fetchCatalog.mockResolvedValue(catalogWith({ title: XSS }));
    const { container } = render(<Notes problemId={ID} />);
    const heading = await screen.findByRole('heading', { level: 1, name: XSS });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Problem statement' });
    const text = within(section).getByText(/Line one/);
    expect(text.textContent).toBe(STATEMENT);
    expect(text).toHaveClass('whitespace-pre-wrap');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('catalog problems have no Edit / Delete / statement', async () => {
    mockedApi.fetchCatalog.mockResolvedValue(
      catalogWith({
        custom: undefined,
        statement: undefined,
        url: 'https://leetcode.com/problems/two-sum/',
      }),
    );
    render(<Notes problemId={ID} />);
    await screen.findByRole('link', { name: /Book Puzzle/ });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByText('Custom')).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Problem statement' }),
    ).toBeNull();
  });

  it('Edit opens the form pre-filled (incl. its topics) and PATCHes; the header refreshes', async () => {
    const user = userEvent.setup();
    mockedApi.fetchCatalog
      .mockResolvedValueOnce(catalogWith({}))
      .mockResolvedValue(catalogWith({ title: 'Renamed' }));
    mockedApi.updateProblem.mockResolvedValue({
      id: ID,
      title: 'Renamed',
      difficulty: 'hard',
      topics: ['arrays', 'stack'],
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:01.000Z',
      custom: true,
    } satisfies CustomProblem);
    render(<Notes problemId={ID} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit problem' });
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Book Puzzle');
    expect(within(dialog).getByLabelText('Difficulty')).toHaveValue('hard');
    expect(within(dialog).getByLabelText(/Problem statement/)).toHaveValue(
      STATEMENT,
    );
    expect(
      within(dialog).getByRole('checkbox', { name: 'Arrays & Hashing' }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Stack' }),
    ).toBeChecked();
    const title = within(dialog).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );
    expect(mockedApi.updateProblem).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({
        title: 'Renamed',
        url: null,
        difficulty: 'hard',
        topics: ['arrays', 'stack'],
      }),
      { allowSimilarTitle: false },
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Renamed' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Delete without a note: one confirm, then Home with a notice', async () => {
    const user = userEvent.setup();
    mockedApi.fetchCatalog.mockResolvedValue(catalogWith({}));
    mockedApi.deleteProblem.mockResolvedValue({
      deleted: true,
      noteDeleted: false,
    });
    render(<Notes problemId={ID} />);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', {
      name: 'Delete this problem?',
    });
    await user.click(
      within(confirm).getByRole('button', { name: 'Delete problem' }),
    );
    expect(mockedApi.deleteProblem).toHaveBeenCalledWith(ID, {
      deleteNote: false,
    });
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(peekFlash()).toBe('Deleted “Book Puzzle”.');
  });

  it('Delete with a note: 409 hasNote ⇒ a second explicit confirm ⇒ deleteNote:true; notice carries the backup path', async () => {
    const user = userEvent.setup();
    mockedApi.fetchCatalog.mockResolvedValue(catalogWith({}));
    mockedApi.deleteProblem
      .mockRejectedValueOnce(
        new ProblemApiError(
          'this problem has a note',
          409,
          undefined,
          false,
          true,
        ),
      )
      .mockResolvedValueOnce({
        deleted: true,
        noteDeleted: true,
        backup: '/data/.backups/20260927T000000Z',
      });
    render(<Notes problemId={ID} />);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete problem',
      }),
    );
    const second = await screen.findByRole('alertdialog', {
      name: 'This problem has a note',
    });
    expect(second).toHaveTextContent(/also deletes your note/);
    expect(window.location.pathname).toBe(`/notes/${ID}`);
    await user.click(
      within(second).getByRole('button', {
        name: 'Delete the problem AND its note (a backup is made first)',
      }),
    );
    expect(mockedApi.deleteProblem).toHaveBeenLastCalledWith(ID, {
      deleteNote: true,
    });
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(peekFlash()).toBe(
      'Deleted “Book Puzzle” and its note. A backup was saved at /data/.backups/20260927T000000Z.',
    );
  });

  it('Cancel on the confirm deletes nothing and returns focus to Delete', async () => {
    const user = userEvent.setup();
    mockedApi.fetchCatalog.mockResolvedValue(catalogWith({}));
    render(<Notes problemId={ID} />);
    const del = await screen.findByRole('button', { name: 'Delete' });
    await user.click(del);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Cancel',
      }),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(del).toHaveFocus();
    expect(mockedApi.deleteProblem).not.toHaveBeenCalled();
  });

  it('a delete error (e.g. backup failed) stays in the dialog', async () => {
    const user = userEvent.setup();
    mockedApi.fetchCatalog.mockResolvedValue(catalogWith({}));
    mockedApi.deleteProblem.mockRejectedValue(
      new ProblemApiError(
        'could not back up the data folder, so nothing was deleted: EACCES',
        500,
      ),
    );
    render(<Notes problemId={ID} />);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete problem' }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /nothing was deleted/,
    );
    expect(window.location.pathname).toBe(`/notes/${ID}`);
  });
});
