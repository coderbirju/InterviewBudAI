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

beforeEach(() => {
  vi.clearAllMocks();
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
});
