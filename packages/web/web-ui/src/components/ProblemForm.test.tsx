import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProblemForm } from './ProblemForm';
import * as api from '../lib/api';
import { ProblemApiError } from '../lib/api';
import type { CustomProblem } from '../lib/api';

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, createProblem: vi.fn(), updateProblem: vi.fn() };
});

const mockedApi = vi.mocked(api);

const TOPICS = [
  { id: 'arrays', label: 'Arrays & Hashing' },
  { id: 'stack', label: 'Stack' },
  { id: 'heap', label: 'Heap / Priority Queue' },
  { id: 'trees', label: 'Trees' },
];

const CREATED: CustomProblem = {
  id: 'u-my-puzzle-abc123',
  title: 'My Puzzle',
  difficulty: 'hard',
  topics: ['stack'],
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
  custom: true,
};

/** The form behind an opener button, as Home uses it. */
function Harness({
  onSaved = vi.fn(),
  initialTopics = [],
}: {
  onSaved?: (p: CustomProblem) => void;
  initialTopics?: string[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open form
      </button>
      {open && (
        <ProblemForm
          mode="create"
          topics={TOPICS}
          initial={{ topics: initialTopics }}
          onClose={() => setOpen(false)}
          onSaved={(p) => {
            setOpen(false);
            onSaved(p);
          }}
        />
      )}
    </>
  );
}

async function openForm(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Open form' }));
  return screen.getByRole('dialog', { name: 'Add a problem' });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

describe('ProblemForm', () => {
  it('is an accessible modal: labelled, focus on Title, Tab trapped, Escape closes and returns focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const title = within(dialog).getByLabelText('Title');
    expect(title).toHaveFocus();
    for (const label of [/Link/, 'Difficulty', /Problem statement/]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    expect(
      within(dialog).getByRole('group', { name: 'Topics' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Arrays & Hashing' }),
    ).toBeInTheDocument();

    // Shift+Tab from the first control wraps to the last, Tab wraps back.
    const close = within(dialog).getByRole('button', { name: 'Close' });
    close.focus();
    await user.tab({ shift: true });
    const submit = within(dialog).getByRole('button', { name: 'Add problem' });
    expect(submit).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open form' })).toHaveFocus();
  });

  it('an untouched form closes on a backdrop click', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    await user.pointer({ keys: '[MouseLeft>]', target: dialog.parentElement! });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a dirty form ignores backdrop clicks and confirms before Escape / Cancel discard it', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByLabelText('Title'), 'Half typed');

    // Backdrop click: ignored, no prompt, input kept.
    await user.pointer({ keys: '[MouseLeft>]', target: dialog.parentElement! });
    expect(confirm).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Half typed');
    expect(within(dialog).getByLabelText('Title')).toHaveFocus();

    // Escape asks; declining keeps the form.
    confirm.mockReturnValueOnce(false);
    await user.keyboard('{Escape}');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Cancel asks; accepting closes.
    confirm.mockReturnValueOnce(true);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it('client-side validation mirrors the server and blocks the request', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    await user.type(
      within(dialog).getByLabelText(/Link/),
      'javascript:alert(1)',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add problem' }),
    );
    expect(within(dialog).getByLabelText('Title')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(dialog).getByText('Enter a title.')).toBeInTheDocument();
    expect(within(dialog).getByText(/http:\/\/ or https:\/\//)).toBeVisible();
    expect(within(dialog).getByText(/Choose 1–3 topics/)).toBeInTheDocument();
    expect(mockedApi.createProblem).not.toHaveBeenCalled();
  });

  it('at most 3 topics: the rest are disabled', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openForm(user);
    for (const name of ['Arrays & Hashing', 'Stack', 'Trees']) {
      await user.click(within(dialog).getByRole('checkbox', { name }));
    }
    expect(
      within(dialog).getByRole('checkbox', { name: 'Heap / Priority Queue' }),
    ).toBeDisabled();
  });

  it('pre-selects a topic and submits the normalised input', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    mockedApi.createProblem.mockResolvedValue(CREATED);
    render(<Harness onSaved={onSaved} initialTopics={['stack']} />);
    const dialog = await openForm(user);
    expect(
      within(dialog).getByRole('checkbox', { name: 'Stack' }),
    ).toBeChecked();
    await user.type(within(dialog).getByLabelText('Title'), '  My   Puzzle ');
    await user.selectOptions(
      within(dialog).getByLabelText('Difficulty'),
      'hard',
    );
    await user.type(
      within(dialog).getByLabelText(/Problem statement/),
      'Given n,{Enter}find x.',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add problem' }),
    );
    expect(mockedApi.createProblem).toHaveBeenCalledWith(
      {
        title: 'My Puzzle',
        statement: 'Given n,\nfind x.',
        difficulty: 'hard',
        topics: ['stack'],
      },
      { allowSimilarTitle: false },
    );
    expect(onSaved).toHaveBeenCalledWith(CREATED);
  });

  it('a hard duplicate offers "open it instead" (no override)', async () => {
    const user = userEvent.setup();
    mockedApi.createProblem.mockRejectedValue(
      new ProblemApiError(
        'this problem already exists',
        409,
        { problemId: 'lc-1', title: 'Two Sum', custom: false },
        false,
      ),
    );
    render(<Harness initialTopics={['arrays']} />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByLabelText('Title'), '1. Two Sum');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add problem' }),
    );
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'This looks like Two Sum — open it instead',
    );
    expect(
      within(alert).queryByRole('button', { name: 'Add anyway' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(alert).getByRole('link', { name: 'open it instead' }),
    );
    expect(window.location.pathname).toBe('/notes/lc-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a title-only duplicate can be added anyway (allowSimilarTitle)', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    mockedApi.createProblem
      .mockRejectedValueOnce(
        new ProblemApiError(
          'a problem with a similar title already exists',
          409,
          { problemId: 'u-two-sum-aaaaaa', title: 'Two sum', custom: true },
          true,
        ),
      )
      .mockResolvedValueOnce(CREATED);
    render(<Harness onSaved={onSaved} initialTopics={['arrays']} />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByLabelText('Title'), 'Two Sum!');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add problem' }),
    );
    await user.click(
      await within(dialog).findByRole('button', { name: 'Add anyway' }),
    );
    expect(mockedApi.createProblem).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Two Sum!' }),
      { allowSimilarTitle: true },
    );
    expect(onSaved).toHaveBeenCalledWith(CREATED);
  });

  it('server errors show inline (field 400, or a form-level message)', async () => {
    const user = userEvent.setup();
    mockedApi.createProblem
      .mockRejectedValueOnce(
        new ProblemApiError('title must be 1–200 characters', 400),
      )
      .mockRejectedValueOnce(
        new ProblemApiError(
          'at most 1000 custom problems per data folder',
          400,
        ),
      );
    render(<Harness initialTopics={['arrays']} />);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByLabelText('Title'), 'Fine');
    const submit = within(dialog).getByRole('button', { name: 'Add problem' });
    await user.click(submit);
    expect(
      await within(dialog).findByText('title must be 1–200 characters'),
    ).toBeInTheDocument();
    await user.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'at most 1000 custom problems per data folder',
    );
  });

  it('edit mode PATCHes with null to clear url/statement', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    mockedApi.updateProblem.mockResolvedValue(CREATED);
    render(
      <ProblemForm
        mode="edit"
        problemId="u-my-puzzle-abc123"
        topics={TOPICS}
        initial={{
          title: 'My Puzzle',
          url: 'https://example.com/p',
          statement: 'old',
          difficulty: 'easy',
          topics: ['arrays'],
        }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit problem' });
    await user.clear(within(dialog).getByLabelText(/Link/));
    await user.clear(within(dialog).getByLabelText(/Problem statement/));
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );
    expect(mockedApi.updateProblem).toHaveBeenCalledWith(
      'u-my-puzzle-abc123',
      {
        title: 'My Puzzle',
        url: null,
        statement: null,
        difficulty: 'easy',
        topics: ['arrays'],
      },
      { allowSimilarTitle: false },
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
