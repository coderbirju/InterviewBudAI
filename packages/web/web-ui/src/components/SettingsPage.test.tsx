import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage, ENV_SNIPPET } from './SettingsPage';
import App from '../App';
import * as api from '../lib/api';
import { ApiError } from '../lib/api';
import type { SettingsResponse } from '../lib/api';
import { parseRoute, settingsHref } from '../lib/router';

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchSettings: vi.fn(),
    testProviderConnection: vi.fn(),
    fetchDataDir: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

function envHelp(
  set: Record<string, boolean> = {},
): SettingsResponse['envHelp'] {
  return [
    'ANTHROPIC_API_KEY',
    'IBAI_ANTHROPIC_API_KEY',
    'IBAI_ANTHROPIC_MODEL',
    'IBAI_OPENAI_BASE_URL',
    'IBAI_OPENAI_MODEL',
    'IBAI_OPENAI_API_KEY',
    'OPENAI_API_KEY',
    'IBAI_OPENAI_TIMEOUT_MS',
    'IBAI_OLLAMA_MODEL',
    'IBAI_OLLAMA_URL',
    'IBAI_DATA_DIR',
    'IBAI_WEB_PORT',
  ].map((v) => ({ var: v, purpose: `purpose of ${v}`, set: set[v] ?? false }));
}

const BASE: Omit<SettingsResponse, 'provider'> = {
  dataDir: {
    path: '/home/me/.interviewbudai/data',
    source: 'default',
    pinned: false,
  },
  app: { version: '0.0.0', node: 'v20.12.0' },
  envHelp: envHelp(),
};

const ANTHROPIC: SettingsResponse = {
  ...BASE,
  provider: {
    kind: 'anthropic',
    model: 'claude-test',
    endpoint: null,
    keyConfigured: true,
  },
  envHelp: envHelp({ ANTHROPIC_API_KEY: true, IBAI_ANTHROPIC_MODEL: true }),
};

const OLLAMA: SettingsResponse = {
  ...BASE,
  provider: {
    kind: 'ollama',
    model: 'llama3',
    endpoint: 'http://127.0.0.1:11434',
    keyConfigured: false,
  },
  envHelp: envHelp({ IBAI_OLLAMA_MODEL: true }),
};

const DMR: SettingsResponse = {
  ...BASE,
  provider: {
    kind: 'openai',
    model: 'ai/qwen3:4b-instruct-2507-q4_K_M',
    endpoint: 'http://localhost:12434',
    keyConfigured: false,
    label: 'Docker Model Runner (local)',
  },
  envHelp: envHelp({ IBAI_OPENAI_BASE_URL: true, IBAI_OPENAI_MODEL: true }),
};

const NONE: SettingsResponse = {
  ...BASE,
  provider: { kind: 'none', model: null, endpoint: null, keyConfigured: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

function expectNoKeyInput(container: HTMLElement): void {
  expect(
    container.querySelectorAll('input, textarea, select, form'),
  ).toHaveLength(0);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
}

describe('router: /settings', () => {
  it('parses /settings and builds its href', () => {
    expect(parseRoute('/settings')).toEqual({ kind: 'settings' });
    expect(parseRoute('/settings/')).toEqual({ kind: 'settings' });
    expect(parseRoute('/settings/x')).toEqual({ kind: 'home' });
    expect(settingsHref()).toBe('/settings');
  });
});

describe('SettingsPage', () => {
  it('shows a loading state, then an error state when the API fails', async () => {
    mockedApi.fetchSettings.mockRejectedValue(new Error('down'));
    render(<SettingsPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading settings/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't load settings/i,
    );
  });

  it('anthropic: model card, key configured, billable note, env table, no key input', async () => {
    mockedApi.fetchSettings.mockResolvedValue(ANTHROPIC);
    const { container } = render(<SettingsPage />);
    const model = await screen.findByRole('region', { name: 'Model' });
    expect(model).toHaveTextContent('Anthropic');
    expect(model).toHaveTextContent('claude-test');
    expect(within(model).getByText('Configured')).toBeInTheDocument();
    expect(model).toHaveTextContent(/billable call/i);
    expect(within(model).queryByText('Endpoint')).not.toBeInTheDocument();

    const table = screen.getByRole('table', {
      name: /environment variables/i,
    });
    const keyRow = within(table).getByRole('row', {
      name: /^ANTHROPIC_API_KEY/,
    });
    expect(keyRow).toHaveTextContent('Set');
    const urlRow = within(table).getByRole('row', { name: /^IBAI_OLLAMA_URL/ });
    expect(urlRow).toHaveTextContent('Not set');

    expect(screen.getByText(/restart the server/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'App' })).toHaveTextContent(
      'v20.12.0',
    );
    const data = screen.getByRole('region', { name: 'Data' });
    expect(
      within(data).getByRole('link', { name: /manage your data/i }),
    ).toHaveAttribute('href', '/data');
    expectNoKeyInput(container);
    // The test is only ever run on an explicit click.
    expect(mockedApi.testProviderConnection).not.toHaveBeenCalled();
  });

  it('ollama: shows the endpoint and not the billable note', async () => {
    mockedApi.fetchSettings.mockResolvedValue(OLLAMA);
    render(<SettingsPage />);
    const model = await screen.findByRole('region', { name: 'Model' });
    expect(model).toHaveTextContent('Ollama');
    expect(model).toHaveTextContent('http://127.0.0.1:11434');
    expect(within(model).getByText('Not configured')).toBeInTheDocument();
    expect(model).not.toHaveTextContent(/billable/i);
  });

  it('openai: DMR label, endpoint, optional key row, test button, no billable note', async () => {
    mockedApi.fetchSettings.mockResolvedValue(DMR);
    const { container } = render(<SettingsPage />);
    const model = await screen.findByRole('region', { name: 'Model' });
    expect(model).toHaveTextContent('Docker Model Runner (local)');
    expect(model).toHaveTextContent('ai/qwen3:4b-instruct-2507-q4_K_M');
    expect(model).toHaveTextContent('http://localhost:12434');
    expect(model).toHaveTextContent('API key (optional)');
    expect(model).not.toHaveTextContent('Anthropic API key');
    expect(model).not.toHaveTextContent(/billable/i);
    expect(
      within(model).getByRole('button', { name: /test connection/i }),
    ).toBeInTheDocument();
    expectNoKeyInput(container);
  });

  it('openai without a label falls back to "OpenAI-compatible"', async () => {
    mockedApi.fetchSettings.mockResolvedValue({
      ...DMR,
      provider: { ...DMR.provider, label: undefined },
    });
    render(<SettingsPage />);
    const model = await screen.findByRole('region', { name: 'Model' });
    expect(model).toHaveTextContent('OpenAI-compatible');
  });

  it('the .env snippet includes the OpenAI-compatible vars as placeholders', () => {
    expect(ENV_SNIPPET).toContain(
      'IBAI_OPENAI_BASE_URL=<openai-compatible-base-url>',
    );
    expect(ENV_SNIPPET).toContain('IBAI_OPENAI_MODEL=<model-id>');
    expect(ENV_SNIPPET).toContain('IBAI_OPENAI_API_KEY=<your-api-key>');
  });

  it('none: no test button; hint shown; still no input', async () => {
    mockedApi.fetchSettings.mockResolvedValue({
      ...NONE,
      provider: {
        ...NONE.provider,
        keyConfigured: true,
        hint: 'IBAI_ANTHROPIC_MODEL is missing',
      },
    });
    const { container } = render(<SettingsPage />);
    const model = await screen.findByRole('region', { name: 'Model' });
    expect(model).toHaveTextContent('None configured');
    expect(model).toHaveTextContent('IBAI_ANTHROPIC_MODEL is missing');
    expect(
      within(model).queryByRole('button', { name: /test connection/i }),
    ).not.toBeInTheDocument();
    expectNoKeyInput(container);
  });

  it('test button: success shows latency + detail', async () => {
    const user = userEvent.setup();
    mockedApi.fetchSettings.mockResolvedValue(OLLAMA);
    let resolveTest: (r: api.ProviderTestResult) => void = () => undefined;
    mockedApi.testProviderConnection.mockReturnValue(
      new Promise((r) => {
        resolveTest = r;
      }),
    );
    render(<SettingsPage />);
    await user.click(
      await screen.findByRole('button', { name: /test connection/i }),
    );
    expect(screen.getByRole('button', { name: /testing/i })).toBeDisabled();
    resolveTest({ ok: true, latencyMs: 37, detail: 'Ollama is reachable.' });
    expect(await screen.findByText(/connected in 37 ms/i)).toHaveTextContent(
      'Ollama is reachable.',
    );
    expect(mockedApi.testProviderConnection).toHaveBeenCalledTimes(1);
  });

  it('test button: failure detail and a 429 message are shown', async () => {
    const user = userEvent.setup();
    mockedApi.fetchSettings.mockResolvedValue(ANTHROPIC);
    mockedApi.testProviderConnection
      .mockResolvedValueOnce({
        ok: false,
        latencyMs: 120,
        detail: 'Anthropic rejected the API key (HTTP 401).',
      })
      .mockRejectedValueOnce(
        new ApiError('please wait 5 s between connection tests', 429),
      );
    render(<SettingsPage />);
    const button = await screen.findByRole('button', {
      name: /test connection/i,
    });
    await user.click(button);
    expect(
      await screen.findByText(/connection failed \(120 ms\)/i),
    ).toHaveTextContent('rejected the API key');
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    expect(await screen.findByText(/please wait 5 s/i)).toBeInTheDocument();
  });

  it('copy snippet: placeholders only, copies to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mockedApi.fetchSettings.mockResolvedValue(ANTHROPIC);
    render(<SettingsPage />);
    await user.click(
      await screen.findByRole('button', { name: /copy snippet/i }),
    );
    expect(writeText).toHaveBeenCalledWith(ENV_SNIPPET);
    expect(
      await screen.findByText(/copied to the clipboard/i),
    ).toBeInTheDocument();
    // Every assignment in the snippet is a placeholder or the public default URL.
    for (const line of ENV_SNIPPET.split('\n')) {
      if (line.startsWith('#') || !line.includes('=')) continue;
      const value = line.slice(line.indexOf('=') + 1);
      expect(
        value === 'http://127.0.0.1:11434' || /^<[a-z-]+>$/.test(value),
      ).toBe(true);
    }
  });
});

describe('App: Settings nav', () => {
  it('the Settings nav link opens the page client-side', async () => {
    const user = userEvent.setup();
    mockedApi.fetchSettings.mockResolvedValue(NONE);
    mockedApi.fetchDataDir.mockRejectedValue(new Error('not needed'));
    window.history.pushState({}, '', '/settings');
    render(<App />);
    const nav = screen.getByRole('link', { name: /^Settings$/ });
    expect(nav).toHaveAttribute('href', '/settings');
    expect(nav).toHaveAttribute('aria-current', 'page');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Settings' }),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole('link', { name: /manage your data/i }),
    );
    expect(window.location.pathname).toBe('/data');
  });
});
