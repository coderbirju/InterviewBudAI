import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DataPage } from './DataPage';
import { DataFolderBanner } from './DataFolderBanner';
import * as api from '../lib/api';
import type { DataDirStatus } from '../lib/api';

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

/** Under Docker (ADR 0011 D3): `/data` pinned by the image's IBAI_DATA_DIR. */
const DOCKER_STATUS: DataDirStatus = {
  dataDir: '/data',
  source: 'env',
  pinned: true,
  exists: true,
  noteCount: 4,
  formatVersion: 1,
  legacyCandidates: [],
  docker: {
    hostDataDir: '/Users/me/.interviewbudai/data',
    writable: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe('under Docker (ADR 0011 D3)', () => {
  it('/data: "Pinned by Docker (IBAI_HOST_DATA_DIR=…)", never offers switching', async () => {
    mockedApi.fetchDataDir.mockResolvedValue(DOCKER_STATUS);
    render(<DataPage />);
    expect(await screen.findByTestId('data-source')).toHaveTextContent(
      'Pinned by Docker (IBAI_HOST_DATA_DIR=/Users/me/.interviewbudai/data)',
    );
    expect(screen.getByTestId('docker-pinned')).toHaveTextContent(
      'on your computer: /Users/me/.interviewbudai/data',
    );
    expect(screen.queryByLabelText('Folder path')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Use this folder' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/restart the server without/i)).toBeNull();
  });

  it('/data + Home banner: mismatch copy names the non-Docker folder', async () => {
    mockedApi.fetchDataDir.mockResolvedValue({
      ...DOCKER_STATUS,
      docker: {
        hostDataDir: '/Users/me/.interviewbudai/data',
        writable: true,
        hostConfigDataDir: '/Users/me/Desktop/testBuai',
      },
    });
    const { unmount } = render(<DataPage />);
    expect(
      await screen.findByRole('region', { name: 'Docker data folder' }),
    ).toHaveTextContent(
      'Your non-Docker setup uses /Users/me/Desktop/testBuai. To use the same notes in Docker, set IBAI_HOST_DATA_DIR=/Users/me/Desktop/testBuai in .env and restart.',
    );
    unmount();

    // Home banner: shown even though the folder has notes (not dismissible).
    render(<DataFolderBanner />);
    expect(
      await screen.findByRole('region', { name: 'Docker data folder' }),
    ).toHaveTextContent('IBAI_HOST_DATA_DIR=/Users/me/Desktop/testBuai');
  });

  it('banner: not-writable alert with the fix', async () => {
    mockedApi.fetchDataDir.mockResolvedValue({
      ...DOCKER_STATUS,
      docker: {
        hostDataDir: '/home/me/.interviewbudai/data',
        writable: false,
        writableHelp: 'The data folder is not writable by the app (fix it).',
      },
    });
    render(<DataFolderBanner />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('not writable in Docker');
    expect(alert).toHaveTextContent('(fix it)');
  });

  it('banner: nothing when Docker has no notices and the folder has notes', async () => {
    mockedApi.fetchDataDir.mockResolvedValue(DOCKER_STATUS);
    const { container } = render(<DataFolderBanner />);
    await waitFor(() => expect(mockedApi.fetchDataDir).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
