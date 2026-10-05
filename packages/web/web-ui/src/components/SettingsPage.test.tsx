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

  it('anthropic: provider card, key configured, billable note, env table, no key input', async () => {
    const user = userEvent.setup();
    mockedApi.fetchSettings.mockResolvedValue(ANTHROPIC);
    const { container } = render(<SettingsPage />);
    const model = await screen.findByRole('region', { name: 'AI provider' });
    expect(model).toHaveTextContent('Anthropic');
    expect(model).toHaveTextContent('claude-test');
    expect(within(model).getByText('Configured')).toBeInTheDocument();
    expect(model).toHaveTextContent(/billable call/i);
    expect(within(model).queryByText('Endpoint')).not.toBeInTheDocument();

    const envDetails = screen.getByTestId('env-vars');
    await user.click(
      within(envDetails).getByText('Environment variables (12)'),
    );
    const table = within(envDetails).getByRole('table', {
      name: /environment variables/i,
    });
    const keyRow = within(table).getByRole('row', {
      name: /^ANTHROPIC_API_KEY/,
    });
    expect(keyRow).toHaveTextContent('Set');
    const urlRow = within(table).getByRole('row', { name: /^IBAI_OLLAMA_URL/ });
    expect(urlRow).toHaveTextContent('Not set');
    // Every env var from the API is listed (nothing dropped).
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 12);

    expect(
      within(screen.getByTestId('provider-howto')).getByText(
        /restart the server/i,
      ),
    ).toBeInTheDocument();
    const data = screen.getByRole('region', { name: 'Data & app' });
    expect(data).toHaveTextContent('v20.12.0');
    expect(data).toHaveTextContent('0.0.0');
    expect(data).toHaveTextContent('/home/me/.interviewbudai/data');
    expect(data).toHaveTextContent('Default location');
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
    const model = await screen.findByRole('region', { name: 'AI provider' });
    expect(model).toHaveTextContent('Ollama');
    expect(model).toHaveTextContent('http://127.0.0.1:11434');
    expect(within(model).getByText('Not configured')).toBeInTheDocument();
    expect(model).not.toHaveTextContent(/billable/i);
  });

  it('openai: DMR label, endpoint, optional key row, test button, no billable note', async () => {
    mockedApi.fetchSettings.mockResolvedValue(DMR);
    const { container } = render(<SettingsPage />);
    const model = await screen.findByRole('region', { name: 'AI provider' });
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
    const model = await screen.findByRole('region', { name: 'AI provider' });
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
    const model = await screen.findByRole('region', { name: 'AI provider' });
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
    const howTo = await screen.findByTestId('provider-howto');
    await user.click(within(howTo).getByText('How to change the provider'));
    expect(howTo).toHaveAttribute('open');
    await user.click(
      within(howTo).getByRole('button', { name: /copy snippet/i }),
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

describe('SettingsPage layout (founder feedback 2026-10-05)', () => {
  it('reference detail sits in native <details>, collapsed by default, toggled by its summary', async () => {
    const user = userEvent.setup();
    mockedApi.fetchSettings.mockResolvedValue(ANTHROPIC);
    const { container } = render(<SettingsPage />);
    const provider = await screen.findByRole('region', { name: 'AI provider' });
    const howTo = within(provider).getByTestId('provider-howto');
    const envVars = screen.getByTestId('env-vars');
    for (const d of [howTo, envVars]) {
      expect(d.tagName).toBe('DETAILS');
      expect(d).not.toHaveAttribute('open');
    }
    expect(container.querySelectorAll('details')).toHaveLength(2);
    expect(container.querySelectorAll('details[open]')).toHaveLength(0);
    // The env table, precedence and .env snippet are inside the disclosures.
    expect(screen.getByRole('table').closest('details')).toBe(envVars);
    expect(
      screen.getByLabelText(/example \.env file/i).closest('details'),
    ).toBe(howTo);
    expect(
      within(howTo).getByText(/first complete one wins/i),
    ).toBeInTheDocument();
    // Summaries are plain toggle labels (no heading inside).
    const howToSummary = within(howTo).getByText('How to change the provider');
    const envSummary = within(envVars).getByText('Environment variables (12)');
    for (const s of [howToSummary, envSummary]) {
      expect(s.tagName).toBe('SUMMARY');
      expect(within(s).queryByRole('heading')).toBeNull();
    }
    for (const h of screen.getAllByRole('heading', { level: 2 })) {
      expect(h.closest('details')).toBeNull();
    }
    await user.click(envSummary);
    expect(envVars).toHaveAttribute('open');
    expect(howTo).not.toHaveAttribute('open');
    await user.click(envSummary);
    expect(envVars).not.toHaveAttribute('open');
  });

  it('at a glance: provider, model, endpoint and key status are outside any <details>', async () => {
    mockedApi.fetchSettings.mockResolvedValue(DMR);
    render(<SettingsPage />);
    const provider = await screen.findByRole('region', { name: 'AI provider' });
    for (const text of [
      'Docker Model Runner (local)',
      'ai/qwen3:4b-instruct-2507-q4_K_M',
      'http://localhost:12434',
      'Not configured',
      'Not tested yet',
    ]) {
      expect(within(provider).getByText(text).closest('details')).toBeNull();
    }
    expect(
      within(provider)
        .getByRole('button', { name: /test connection/i })
        .closest('details'),
    ).toBeNull();
  });

  it('warnings, the not-configured state and invalid endpoints sit outside any <details>', async () => {
    mockedApi.fetchSettings.mockResolvedValue({
      ...NONE,
      provider: {
        ...NONE.provider,
        hint: 'IBAI_OPENAI_MODEL is missing',
      },
    });
    const { unmount } = render(<SettingsPage />);
    const provider = await screen.findByRole('region', { name: 'AI provider' });
    const hint = within(provider).getByTestId('provider-hint');
    expect(hint).toHaveTextContent('IBAI_OPENAI_MODEL is missing');
    expect(hint.closest('details')).toBeNull();
    const notConfigured = within(provider).getByTestId('not-configured');
    expect(notConfigured).toHaveTextContent(/quiz master is off/i);
    expect(notConfigured.closest('details')).toBeNull();
    // No connection row when there is nothing to test.
    expect(within(provider).queryByText('Connection')).toBeNull();
    unmount();

    mockedApi.fetchSettings.mockResolvedValue({
      ...OLLAMA,
      provider: { ...OLLAMA.provider, endpoint: null },
    });
    render(<SettingsPage />);
    const invalid = await screen.findByText('Invalid IBAI_OLLAMA_URL');
    expect(invalid.closest('details')).toBeNull();
    expect(screen.queryByTestId('not-configured')).toBeNull();
  });

  it('test connection: status row and result update, all outside any <details>', async () => {
    const user = userEvent.setup();
    mockedApi.fetchSettings.mockResolvedValue(DMR);
    let resolveTest: (r: api.ProviderTestResult) => void = () => undefined;
    mockedApi.testProviderConnection
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveTest = r;
        }),
      )
      .mockResolvedValueOnce({
        ok: false,
        latencyMs: 9,
        detail:
          'The local model is starting or unavailable — try again in a moment.',
      })
      .mockRejectedValueOnce(
        new ApiError('please wait 5 s between connection tests', 429),
      );
    render(<SettingsPage />);
    const provider = await screen.findByRole('region', { name: 'AI provider' });
    expect(within(provider).getByText('Not tested yet')).toBeInTheDocument();
    expect(mockedApi.testProviderConnection).not.toHaveBeenCalled();

    await user.click(
      within(provider).getByRole('button', { name: /test connection/i }),
    );
    expect(within(provider).getByText('Checking')).toBeInTheDocument();
    expect(
      within(provider).getByRole('button', { name: /testing/i }),
    ).toBeDisabled();
    resolveTest({ ok: true, latencyMs: 12, detail: 'Model is listed.' });
    const ok = await within(provider).findByText(/connected in 12 ms/i);
    expect(ok).toHaveTextContent('Model is listed.');
    expect(ok.closest('details')).toBeNull();
    expect(within(provider).getByText('Reachable')).toBeInTheDocument();

    await user.click(
      within(provider).getByRole('button', { name: /test connection/i }),
    );
    const failed = await within(provider).findByText(
      /connection failed \(9 ms\)/i,
    );
    expect(failed).toHaveTextContent(/local model is starting/i);
    expect(failed.closest('details')).toBeNull();
    expect(within(provider).getByText('Failed')).toBeInTheDocument();

    await user.click(
      within(provider).getByRole('button', { name: /test connection/i }),
    );
    const err = await within(provider).findByText(/please wait 5 s/i);
    expect(err.closest('details')).toBeNull();
    expect(
      within(provider).getByText('Not tested — see below'),
    ).toBeInTheDocument();
    expect(mockedApi.testProviderConnection).toHaveBeenCalledTimes(3);
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
