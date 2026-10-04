import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';
import prefsUnpinned from '../test/fixtures/statement/preferences-unpinned.json';
import prefsPinned from '../test/fixtures/statement/preferences-pinned.json';

/* ADR 0015 D1/D4: the Settings "Code language" select and the LeetCode
 * fetch toggle, through GET/PUT /api/preferences (PR A fixtures). */

const SETTINGS = {
  provider: { kind: 'none', model: null, endpoint: null, keyConfigured: false },
  dataDir: { path: '/d', source: 'default', pinned: false },
  app: { version: '0', node: '20' },
  envHelp: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let prefs: Record<string, unknown>;
let putReply: (body: Record<string, unknown>) => Response;
let fetchMock: ReturnType<
  typeof vi.fn<[url: string, init?: RequestInit], Promise<Response>>
>;

function puts(): string[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) => url === '/api/preferences' && init?.method === 'PUT',
    )
    .map(([, init]) => String(init?.body));
}

beforeEach(() => {
  prefs = prefsUnpinned;
  putReply = (body) => {
    const next = {
      language: body.language ?? prefs.language,
      leetcodeFetch: {
        enabled:
          typeof body.leetcodeFetch === 'boolean'
            ? body.leetcodeFetch
            : (prefs.leetcodeFetch as { enabled: boolean }).enabled,
        pinned: false,
      },
    };
    prefs = next;
    return json(next);
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings') return json(SETTINGS);
    if (url === '/api/preferences') {
      return init?.method === 'PUT'
        ? putReply(JSON.parse(String(init.body)) as Record<string, unknown>)
        : json(prefs);
    }
    return json({ error: 'nope' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function section(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Problems & code' });
}

describe('Settings: Problems & code', () => {
  it('the language select persists with PUT and shows the saved value', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    const s = await section();
    const select = await within(s).findByLabelText('Code language');
    expect(select).toHaveValue('python');
    await user.selectOptions(select, 'go');
    await waitFor(() => expect(puts()).toEqual(['{"language":"go"}']));
    await waitFor(() => expect(select).toHaveValue('go'));
  });

  it('the fetch toggle PUTs leetcodeFetch', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    const s = await section();
    const toggle = await within(s).findByRole('checkbox', {
      name: 'Fetch problem statements from LeetCode',
    });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/fetches that one problem/);
    await user.click(toggle);
    await waitFor(() => expect(puts()).toEqual(['{"leetcodeFetch":false}']));
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('pinned by env: the toggle is read-only with "Set by IBAI_LEETCODE_FETCH"', async () => {
    prefs = prefsPinned;
    render(<SettingsPage />);
    const s = await section();
    const toggle = await within(s).findByRole('checkbox', {
      name: 'Fetch problem statements from LeetCode',
    });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/Set by IBAI_LEETCODE_FETCH/);
    expect(s).toHaveTextContent('Set by IBAI_LEETCODE_FETCH.');
    // The language stays editable.
    expect(within(s).getByLabelText('Code language')).toBeEnabled();
  });

  it('a 409 (read-only folder) keeps the old value and says why', async () => {
    const user = userEvent.setup();
    putReply = () => json({ error: 'read-only' }, 409);
    render(<SettingsPage />);
    const s = await section();
    const select = await within(s).findByLabelText('Code language');
    await user.selectOptions(select, 'go');
    expect(await within(s).findByRole('alert')).toHaveTextContent(/read-only/);
    expect(select).toHaveValue('python');
  });

  it('a failed GET shows a short message and no controls', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/settings' ? json(SETTINGS) : json({ error: 'x' }, 500),
    );
    render(<SettingsPage />);
    const s = await section();
    expect(
      await within(s).findByText(/Couldn't load your preferences/),
    ).toBeInTheDocument();
    expect(within(s).queryByRole('checkbox')).toBeNull();
  });
});
