import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CsvImport, CSV_MAX_FILES, unmatchedAsText } from './CsvImport';
import * as api from '../lib/api';
import { ApiError } from '../lib/api';
import type { ImportCommitResult, ImportPreview } from '../lib/api';

/* All CSV content and rows here are SYNTHETIC (charter §6.1). */

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    previewCsvImport: vi.fn(),
    commitCsvImport: vi.fn(),
    fetchCatalog: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const XSS = '<img src=x onerror="alert(1)">';

const PREVIEW: ImportPreview = {
  previewHash: 'a'.repeat(64),
  defaultStatus: 'done',
  rows: [
    {
      key: '0:2',
      file: 'Arrays.csv',
      line: 2,
      title: 'Longest Substring Without Repeating Characters',
      match: {
        problemId: 'lc-3',
        title: 'Longest Substring Without Repeating Characters',
        by: 'url',
      },
      existing: 'none',
      chosen: true,
      fields: { status: 'done', lastUpdated: null, bodyPreview: 'x' },
      warnings: [],
    },
    {
      key: '0:3',
      file: 'Arrays.csv',
      line: 3,
      title: '11. Container With Most Water',
      match: {
        problemId: 'lc-11',
        title: 'Container With Most Water',
        by: 'number',
      },
      existing: 'note',
      chosen: true,
      fields: { status: 'done', lastUpdated: null, bodyPreview: 'y' },
      warnings: [],
    },
    {
      key: '0:4',
      file: 'Arrays.csv',
      line: 4,
      title: XSS,
      match: null,
      existing: 'none',
      chosen: false,
      fields: { status: 'done', lastUpdated: null, bodyPreview: XSS },
      warnings: [],
    },
  ],
  unmatched: [{ key: '0:4', file: 'Arrays.csv', line: 4, title: XSS, url: '' }],
  duplicatesCollapsed: 2,
  blankRows: 1,
  errors: [],
};

const RESULT: ImportCommitResult = {
  created: 1,
  overwritten: 0,
  merged: 1,
  skipped: 0,
  unmatched: 1,
  failed: [],
  backup: '/home/me/.interviewbudai/data/.backups/20260925T120000Z',
};

function csvFile(name: string, text: string): File {
  return new File([text], name, { type: 'text/csv' });
}

async function pickAndPreview(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.upload(
    screen.getByLabelText('CSV files'),
    csvFile('Arrays.csv', 'Problem,URL\nsynthetic,\n'),
  );
  expect(await screen.findByText('Arrays.csv')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  await screen.findByRole('table');
}

const CATALOG: api.CatalogResponse = {
  topics: [
    { topic: 'arrays', label: 'Arrays & Hashing', problems: [] },
    { topic: 'stack', label: 'Stack', problems: [] },
  ],
  totals: {
    total: 0,
    byStatus: { none: 0, done: 0, to_revisit: 0, did_not_understand: 0 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.fetchCatalog.mockResolvedValue(CATALOG);
});

describe('CsvImport', () => {
  it('select files → preview → choose → import → summary with backup + Home link', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
    mockedApi.commitCsvImport.mockResolvedValue(RESULT);
    render(<CsvImport folderExists onImported={onImported} />);

    await pickAndPreview(user);
    expect(mockedApi.previewCsvImport).toHaveBeenCalledWith(
      [{ name: 'Arrays.csv', text: 'Problem,URL\nsynthetic,\n' }],
      'done',
    );

    const summary = screen.getByLabelText('Preview summary');
    expect(
      within(summary).getByText('Conflicts').nextSibling,
    ).toHaveTextContent('1');
    expect(
      within(summary).getByText('Unmatched rows').nextSibling,
    ).toHaveTextContent('1');
    expect(
      within(summary).getByText('Duplicates collapsed').nextSibling,
    ).toHaveTextContent('2');

    const newRow = screen.getByTestId('import-row-0:2');
    expect(within(newRow).getByText('New')).toBeInTheDocument();
    const conflictRow = screen.getByTestId('import-row-0:3');
    expect(
      within(conflictRow).getByText('Conflict (note exists)'),
    ).toBeInTheDocument();
    const action = within(conflictRow).getByLabelText(
      'Action for Container With Most Water',
    );
    expect(action).toHaveValue('skip');
    expect(
      within(screen.getByTestId('import-row-0:4')).getAllByText('Unmatched')
        .length,
    ).toBe(2);

    // Only the new note is written by default.
    expect(screen.getByRole('button', { name: 'Import 1 note' })).toBeEnabled();

    await user.selectOptions(action, 'merge');
    await user.selectOptions(
      within(conflictRow).getByLabelText(
        'Status for Container With Most Water',
      ),
      'to_revisit',
    );
    await user.click(screen.getByRole('button', { name: 'Import 2 notes' }));

    expect(mockedApi.commitCsvImport).toHaveBeenCalledWith(
      [{ name: 'Arrays.csv', text: 'Problem,URL\nsynthetic,\n' }],
      PREVIEW.previewHash,
      'done',
      {
        'lc-3': { action: 'create', rowKey: '0:2' },
        'lc-11': { action: 'merge', rowKey: '0:3', status: 'to_revisit' },
      },
    );
    const done = await screen.findByLabelText('Import summary');
    expect(within(done).getByText('Import finished')).toBeInTheDocument();
    expect(within(done).queryByText('Failed')).not.toBeInTheDocument();
    expect(within(done).getByText('Created').nextSibling).toHaveTextContent(
      '1',
    );
    expect(within(done).getByText('Merged').nextSibling).toHaveTextContent('1');
    expect(within(done).getByText(RESULT.backup)).toBeInTheDocument();
    expect(
      within(done).getByRole('link', { name: 'Go to your problems' }),
    ).toHaveAttribute('href', '/');
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('bulk "apply to all conflicts" sets every conflict action', async () => {
    const user = userEvent.setup();
    mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
    render(<CsvImport folderExists />);
    await pickAndPreview(user);
    await user.selectOptions(
      screen.getByLabelText('Apply to all conflicts:'),
      'overwrite',
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(
      screen.getByLabelText('Action for Container With Most Water'),
    ).toHaveValue('overwrite');
  });

  it('changing the default status re-runs the preview (the hash covers it)', async () => {
    const user = userEvent.setup();
    mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
    render(<CsvImport folderExists />);
    await pickAndPreview(user);
    await user.selectOptions(
      screen.getByLabelText('Status for imported problems'),
      'to_revisit',
    );
    await waitFor(() =>
      expect(mockedApi.previewCsvImport).toHaveBeenLastCalledWith(
        expect.any(Array),
        'to_revisit',
      ),
    );
  });

  it('409 on commit → "re-run preview" message with a button', async () => {
    const user = userEvent.setup();
    mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
    mockedApi.commitCsvImport.mockRejectedValue(
      new ApiError('your notes changed since the preview: re-run preview', 409),
    );
    render(<CsvImport folderExists />);
    await pickAndPreview(user);
    await user.click(screen.getByRole('button', { name: 'Import 1 note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /re-run preview/,
    );
    await user.click(screen.getByRole('button', { name: 'Re-run preview' }));
    await waitFor(() =>
      expect(mockedApi.previewCsvImport).toHaveBeenCalledTimes(2),
    );
  });

  it('CSV values are rendered as text, never HTML (XSS-safe)', async () => {
    const user = userEvent.setup();
    mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
    const { container } = render(<CsvImport folderExists />);
    await pickAndPreview(user);
    expect(screen.getAllByText(XSS).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Unmatched rows')).toHaveTextContent(
      unmatchedAsText(PREVIEW.unmatched),
    );
  });

  it('rejects too many files and oversized totals before sending anything', async () => {
    const user = userEvent.setup();
    render(<CsvImport folderExists />);
    const many = Array.from({ length: CSV_MAX_FILES + 1 }, (_, i) =>
      csvFile(`f${i}.csv`, 'a\n'),
    );
    await user.upload(screen.getByLabelText('CSV files'), many);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `the limit is ${CSV_MAX_FILES}`,
    );
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();

    await user.upload(
      screen.getByLabelText('CSV files'),
      csvFile('big.csv', 'x'.repeat(1024 * 1024 + 1)),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /limit is 1\.0 MB/,
    );
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    expect(mockedApi.previewCsvImport).not.toHaveBeenCalled();
  });

  it('a missing data folder disables Import (preview still works)', async () => {
    const user = userEvent.setup();
    mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
    render(<CsvImport folderExists={false} />);
    await pickAndPreview(user);
    expect(
      screen.getByRole('button', { name: 'Import 1 note' }),
    ).toBeDisabled();
  });

  it('several rows for one problem: each "Use" button has a unique accessible name', async () => {
    const user = userEvent.setup();
    const base = PREVIEW.rows[0]!;
    const multi: ImportPreview = {
      ...PREVIEW,
      rows: [
        { ...base, key: '0:2', line: 2, chosen: true },
        { ...base, key: '0:5', line: 5, chosen: false },
        { ...base, key: '1:7', file: 'Arrays_all.csv', line: 7, chosen: false },
      ],
      unmatched: [],
    };
    mockedApi.previewCsvImport.mockResolvedValue(multi);
    mockedApi.commitCsvImport.mockResolvedValue(RESULT);
    render(<CsvImport folderExists />);
    await pickAndPreview(user);
    const title = 'Longest Substring Without Repeating Characters';
    const a = screen.getByRole('button', {
      name: `Use Arrays.csv line 5 for ${title}`,
    });
    expect(
      screen.getByRole('button', {
        name: `Use Arrays_all.csv line 7 for ${title}`,
      }),
    ).toBeInTheDocument();
    await user.click(a);
    await user.click(screen.getByRole('button', { name: 'Import 1 note' }));
    expect(mockedApi.commitCsvImport).toHaveBeenCalledWith(
      expect.any(Array),
      multi.previewHash,
      'done',
      { 'lc-3': { action: 'create', rowKey: '0:5' } },
    );
  });

  it('a partial failure is called out in the summary and listed', async () => {
    const user = userEvent.setup();
    mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
    mockedApi.commitCsvImport.mockResolvedValue({
      ...RESULT,
      created: 0,
      failed: [{ problemId: 'lc-3', error: 'EACCES: permission denied' }],
    });
    render(<CsvImport folderExists />);
    await pickAndPreview(user);
    await user.click(screen.getByRole('button', { name: 'Import 1 note' }));
    const done = await screen.findByLabelText('Import summary');
    expect(
      within(done).getByText('Import finished with 1 failure'),
    ).toBeInTheDocument();
    expect(within(done).getByRole('alert')).toHaveTextContent(
      'lc-3: EACCES: permission denied',
    );
    expect(within(done).getByText('Failed').nextSibling).toHaveTextContent('1');
  });

  it('a preview error is shown', async () => {
    const user = userEvent.setup();
    mockedApi.previewCsvImport.mockRejectedValue(
      new ApiError('too many rows (the limit is 5000 across all files)', 413),
    );
    render(<CsvImport folderExists />);
    await user.upload(
      screen.getByLabelText('CSV files'),
      csvFile('a.csv', 'a\n'),
    );
    await screen.findByText('a.csv');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many rows/);
  });

  describe('Add as custom problem (ADR 0010 D4)', () => {
    it('tick → difficulty + required topic → commit sends add-custom keyed by row key; summary counts it', async () => {
      const user = userEvent.setup();
      mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
      mockedApi.commitCsvImport.mockResolvedValue({
        ...RESULT,
        created: 2,
        unmatched: 0,
        customCreated: [
          { rowKey: '0:4', problemId: 'u-img-abc123', title: XSS },
        ],
      });
      const { container } = render(<CsvImport folderExists />);
      await pickAndPreview(user);

      const row = screen.getByTestId('unmatched-row-0:4');
      const tick = within(row).getByRole('checkbox', {
        name: `Add “${XSS}” as a custom problem`,
      });
      await waitFor(() => expect(tick).toBeEnabled());
      await user.click(tick);
      // A topic is required: Import waits for it.
      const importBtn = screen.getByRole('button', { name: /^Import \d/ });
      expect(importBtn).toBeDisabled();
      expect(
        screen.getByText(/choose a topic for every row/i),
      ).toBeInTheDocument();
      const difficulty = within(row).getByLabelText(`Difficulty for ${XSS}`);
      expect(difficulty).toHaveValue('medium');
      await user.selectOptions(difficulty, 'hard');
      await user.selectOptions(
        within(row).getByLabelText(`Topic for ${XSS}`),
        'stack',
      );
      expect(
        within(screen.getByLabelText('Preview summary')).getByText(
          'Unmatched rows',
        ).nextSibling,
      ).toHaveTextContent('0');
      expect(importBtn).toBeEnabled();
      await user.click(importBtn);

      expect(mockedApi.commitCsvImport).toHaveBeenCalledWith(
        expect.any(Array),
        PREVIEW.previewHash,
        'done',
        expect.objectContaining({
          'lc-3': { action: 'create', rowKey: '0:2' },
          '0:4': {
            action: 'add-custom',
            difficulty: 'hard',
            topics: ['stack'],
          },
        }),
      );
      const done = await screen.findByLabelText('Import summary');
      expect(
        within(done).getByText('Custom problems added').nextSibling,
      ).toHaveTextContent('1');
      // The row title is text, never HTML.
      expect(container.querySelector('img')).toBeNull();
    });

    it('unticking removes the decision; nothing custom is sent', async () => {
      const user = userEvent.setup();
      mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
      mockedApi.commitCsvImport.mockResolvedValue(RESULT);
      render(<CsvImport folderExists />);
      await pickAndPreview(user);
      const tick = within(screen.getByTestId('unmatched-row-0:4')).getByRole(
        'checkbox',
      );
      await waitFor(() => expect(tick).toBeEnabled());
      await user.click(tick);
      await user.click(tick);
      await user.click(screen.getByRole('button', { name: /^Import \d/ }));
      const decisions = mockedApi.commitCsvImport.mock.calls[0]?.[3] ?? {};
      expect(Object.keys(decisions)).not.toContain('0:4');
    });

    it('a 409 keeps the custom choice through "Re-run preview"', async () => {
      const user = userEvent.setup();
      mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
      mockedApi.commitCsvImport.mockRejectedValueOnce(
        new ApiError(
          'your notes or the data folder changed since the preview: re-run preview',
          409,
        ),
      );
      render(<CsvImport folderExists />);
      await pickAndPreview(user);
      const row = screen.getByTestId('unmatched-row-0:4');
      const tick = within(row).getByRole('checkbox');
      await waitFor(() => expect(tick).toBeEnabled());
      await user.click(tick);
      await user.selectOptions(
        within(row).getByLabelText(`Topic for ${XSS}`),
        'arrays',
      );
      await user.click(screen.getByRole('button', { name: /^Import \d/ }));
      await user.click(
        await screen.findByRole('button', { name: /re-run preview/i }),
      );
      await waitFor(() =>
        expect(mockedApi.previewCsvImport).toHaveBeenCalledTimes(2),
      );
      const again = await screen.findByTestId('unmatched-row-0:4');
      expect(within(again).getByRole('checkbox')).toBeChecked();
      expect(within(again).getByLabelText(`Topic for ${XSS}`)).toHaveValue(
        'arrays',
      );
    });

    it('per-row failures are listed by file and line', async () => {
      const user = userEvent.setup();
      mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
      mockedApi.commitCsvImport.mockResolvedValue({
        ...RESULT,
        customCreated: [],
        failed: [
          {
            problemId: '',
            rowKey: '0:4',
            error: 'a problem with a similar title already exists: Twin',
          },
        ],
      });
      render(<CsvImport folderExists />);
      await pickAndPreview(user);
      const row = screen.getByTestId('unmatched-row-0:4');
      const tick = within(row).getByRole('checkbox');
      await waitFor(() => expect(tick).toBeEnabled());
      await user.click(tick);
      await user.selectOptions(
        within(row).getByLabelText(`Topic for ${XSS}`),
        'arrays',
      );
      await user.click(screen.getByRole('button', { name: /^Import \d/ }));
      const done = await screen.findByLabelText('Import summary');
      expect(within(done).getByRole('alert')).toHaveTextContent(
        `Arrays.csv line 4: ${XSS}: a problem with a similar title already exists: Twin`,
      );
    });

    it('if the topic list cannot load, rows cannot be ticked (and say why)', async () => {
      const user = userEvent.setup();
      mockedApi.fetchCatalog.mockRejectedValue(new ApiError('boom', 500));
      mockedApi.previewCsvImport.mockResolvedValue(PREVIEW);
      render(<CsvImport folderExists />);
      await pickAndPreview(user);
      expect(
        await screen.findByText(/couldn't load the topic list/i),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId('unmatched-row-0:4')).getByRole('checkbox'),
      ).toBeDisabled();
    });
  });
});
