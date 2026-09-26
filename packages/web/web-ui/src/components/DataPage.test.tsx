import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataPage } from './DataPage';
import {
  DataFolderBanner,
  DATA_BANNER_DISMISSED_KEY,
} from './DataFolderBanner';
import * as api from '../lib/api';
import { ApiError } from '../lib/api';
import type { DataDirStatus } from '../lib/api';
import { parseRoute, dataHref } from '../lib/router';

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchDataDir: vi.fn(),
    checkDataDir: vi.fn(),
    switchDataDir: vi.fn(),
    dismissLegacyData: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const DEFAULT_STATUS: DataDirStatus = {
  dataDir: '/home/me/.interviewbudai/data',
  source: 'default',
  pinned: false,
  exists: true,
  noteCount: 0,
  formatVersion: 1,
  legacyCandidates: [],
};

const WITH_LEGACY: DataDirStatus = {
  ...DEFAULT_STATUS,
  legacyCandidates: [
    { path: '/Users/me/Desktop/old-notes', noteCount: 25, origin: 'cookie' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('router: /data', () => {
  it('parses /data and builds its href', () => {
    expect(parseRoute('/data')).toEqual({ kind: 'data' });
    expect(parseRoute('/data/')).toEqual({ kind: 'data' });
    expect(parseRoute('/data/x')).toEqual({ kind: 'home' });
    expect(dataHref()).toBe('/data');
  });
});

describe('DataPage', () => {
  it('default state: active folder, source, note count, CSV import section', async () => {
    mockedApi.fetchDataDir.mockResolvedValue({
      ...DEFAULT_STATUS,
      noteCount: 3,
    });
    render(<DataPage />);
    expect(await screen.findByTestId('active-path')).toHaveTextContent(
      '/home/me/.interviewbudai/data',
    );
    expect(screen.getByText('Default location')).toBeInTheDocument();
    expect(screen.getByTestId('note-count')).toHaveTextContent('3 notes');
    expect(screen.queryByText(/Found previous data/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Import notes from CSV' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Folder path')).toBeEnabled();
  });

  it('pinned state: read-only form with how-to-unpin', async () => {
    mockedApi.fetchDataDir.mockResolvedValue({
      ...DEFAULT_STATUS,
      dataDir: '/srv/pinned',
      source: 'env',
      pinned: true,
    });
    render(<DataPage />);
    expect(
      await screen.findByText(
        'Pinned by the IBAI_DATA_DIR environment variable',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/can.t be changed here/)).toBeInTheDocument();
    expect(screen.getByText(/restart the server without/)).toBeInTheDocument();
    expect(screen.getByLabelText('Folder path')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Use this folder' }),
    ).toBeDisabled();
  });

  it('legacy state: "Use it" switches via POST /api/data-dir { path } and toasts', async () => {
    const user = userEvent.setup();
    mockedApi.fetchDataDir.mockResolvedValue(WITH_LEGACY);
    mockedApi.switchDataDir.mockResolvedValue({
      ...DEFAULT_STATUS,
      dataDir: '/Users/me/Desktop/old-notes',
      source: 'config',
      noteCount: 25,
    });
    render(<DataPage />);
    const card = (await screen.findByText(/Found previous data/)).closest(
      'section',
    ) as HTMLElement;
    expect(card).toHaveTextContent('/Users/me/Desktop/old-notes');
    expect(card).toHaveTextContent('25 notes');
    expect(card).toHaveTextContent(/only if you recognise this folder/);

    await user.click(within(card).getByRole('button', { name: 'Use it' }));
    expect(mockedApi.switchDataDir).toHaveBeenCalledWith(
      '/Users/me/Desktop/old-notes',
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Now using /Users/me/Desktop/old-notes — 25 notes found.',
    );
    expect(screen.getByTestId('note-count')).toHaveTextContent('25 notes');
    expect(screen.queryByText(/Found previous data/)).not.toBeInTheDocument();
  });

  it('legacy state: Dismiss clears the card', async () => {
    const user = userEvent.setup();
    mockedApi.fetchDataDir.mockResolvedValue(WITH_LEGACY);
    mockedApi.dismissLegacyData.mockResolvedValue(DEFAULT_STATUS);
    render(<DataPage />);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(mockedApi.dismissLegacyData).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText(/Found previous data/)).not.toBeInTheDocument(),
    );
  });

  it('switch success: toast + counts refresh', async () => {
    const user = userEvent.setup();
    mockedApi.fetchDataDir.mockResolvedValue(DEFAULT_STATUS);
    mockedApi.switchDataDir.mockResolvedValue({
      ...DEFAULT_STATUS,
      dataDir: '/Users/me/notes-folder',
      source: 'config',
      noteCount: 7,
    });
    render(<DataPage />);
    await user.type(
      await screen.findByLabelText('Folder path'),
      '~/notes-folder',
    );
    await user.click(screen.getByRole('button', { name: 'Use this folder' }));
    expect(mockedApi.switchDataDir).toHaveBeenCalledWith('~/notes-folder');
    expect(await screen.findByRole('status')).toHaveTextContent(
      '7 notes found',
    );
    expect(screen.getByTestId('active-path')).toHaveTextContent(
      '/Users/me/notes-folder',
    );
    expect(
      screen.getByText(
        'Chosen by you (saved in ~/.interviewbudai/config.json)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('note-count')).toHaveTextContent('7 notes');
  });

  it('switch error: shows the server message inline', async () => {
    const user = userEvent.setup();
    mockedApi.fetchDataDir.mockResolvedValue(DEFAULT_STATUS);
    mockedApi.switchDataDir.mockRejectedValue(
      new ApiError(
        'Path must be absolute (or start with ~/ for your home directory).',
        400,
      ),
    );
    render(<DataPage />);
    await user.type(await screen.findByLabelText('Folder path'), 'relative');
    await user.click(screen.getByRole('button', { name: 'Use this folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Path must be absolute',
    );
    expect(screen.getByLabelText('Folder path')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByTestId('active-path')).toHaveTextContent(
      DEFAULT_STATUS.dataDir,
    );
  });

  it('Check (dry run) shows what is there and the use-parent hint', async () => {
    const user = userEvent.setup();
    mockedApi.fetchDataDir.mockResolvedValue(DEFAULT_STATUS);
    mockedApi.checkDataDir.mockResolvedValue({
      dryRun: true,
      path: '/Users/me/old/notes',
      exists: true,
      noteCount: 0,
      quizSessionCount: 0,
      hint: { kind: 'use-parent', path: '/Users/me/old' },
    });
    render(<DataPage />);
    const input = await screen.findByLabelText('Folder path');
    await user.type(input, '/Users/me/old/notes');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(mockedApi.checkDataDir).toHaveBeenCalledWith('/Users/me/old/notes');
    expect(mockedApi.switchDataDir).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/0 notes, 0 quiz sessions/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '/Users/me/old' }));
    expect(input).toHaveValue('/Users/me/old');
  });

  it('renders hostile paths as text (XSS-safe)', async () => {
    const evil = '/tmp/<img src=x onerror=alert(1)>';
    mockedApi.fetchDataDir.mockResolvedValue({
      ...DEFAULT_STATUS,
      dataDir: evil,
      legacyCandidates: [
        { path: `${evil}/old`, noteCount: 1, origin: 'cookie' },
      ],
    });
    const { container } = render(<DataPage />);
    expect(await screen.findByTestId('active-path')).toHaveTextContent(evil);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(`${evil}/old`)).toBeInTheDocument();
  });

  it('load error: friendly alert', async () => {
    mockedApi.fetchDataDir.mockRejectedValue(new ApiError('boom', 500));
    render(<DataPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Couldn.t load your data folder/,
    );
  });
});

describe('DataFolderBanner', () => {
  it('shows on an empty folder, links to /data, and is not dismissible', async () => {
    mockedApi.fetchDataDir.mockResolvedValue(DEFAULT_STATUS);
    render(<DataFolderBanner />);
    const banner = await screen.findByRole('region', { name: 'Data folder' });
    expect(banner).toHaveTextContent("Don't see your solved problems?");
    expect(
      within(banner).getByRole('link', { name: /Your data/ }),
    ).toHaveAttribute('href', '/data');
    expect(
      within(banner).queryByRole('button', { name: 'Dismiss' }),
    ).not.toBeInTheDocument();
  });

  it('link navigates client-side to /data', async () => {
    const user = userEvent.setup();
    mockedApi.fetchDataDir.mockResolvedValue(DEFAULT_STATUS);
    render(<DataFolderBanner />);
    await user.click(await screen.findByRole('link', { name: /Your data/ }));
    expect(window.location.pathname).toBe('/data');
  });

  it('is hidden when the folder has notes and nothing was found', async () => {
    mockedApi.fetchDataDir.mockResolvedValue({
      ...DEFAULT_STATUS,
      noteCount: 12,
    });
    const { container } = render(<DataFolderBanner />);
    await waitFor(() => expect(mockedApi.fetchDataDir).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('previous data found → "restore them" variant', async () => {
    mockedApi.fetchDataDir.mockResolvedValue(WITH_LEGACY);
    render(<DataFolderBanner />);
    expect(
      await screen.findByText('We found your previous notes — restore them'),
    ).toBeInTheDocument();
  });

  it('with notes + a candidate: dismiss hides it for this tab (sessionStorage)', async () => {
    const user = userEvent.setup();
    const status = { ...WITH_LEGACY, noteCount: 4 };
    mockedApi.fetchDataDir.mockResolvedValue(status);
    const first = render(<DataFolderBanner />);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(
      screen.queryByRole('region', { name: 'Data folder' }),
    ).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(DATA_BANNER_DISMISSED_KEY)).toBe('1');
    first.unmount();

    // Remounting in the same tab keeps it dismissed.
    const again = render(<DataFolderBanner />);
    await waitFor(() =>
      expect(mockedApi.fetchDataDir).toHaveBeenCalledTimes(2),
    );
    await Promise.resolve();
    expect(again.container).toBeEmptyDOMElement();
  });

  it('a stale dismissal never hides the empty-folder banner', async () => {
    window.sessionStorage.setItem(DATA_BANNER_DISMISSED_KEY, '1');
    mockedApi.fetchDataDir.mockResolvedValue(DEFAULT_STATUS);
    render(<DataFolderBanner />);
    expect(
      await screen.findByRole('region', { name: 'Data folder' }),
    ).toBeInTheDocument();
  });

  it('renders nothing when /api/data-dir fails', async () => {
    mockedApi.fetchDataDir.mockRejectedValue(new ApiError('nope', 404));
    const { container } = render(<DataFolderBanner />);
    await waitFor(() => expect(mockedApi.fetchDataDir).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });
});
