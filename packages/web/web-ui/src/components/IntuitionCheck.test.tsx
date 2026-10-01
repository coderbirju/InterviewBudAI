import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { IntuitionCheck } from './IntuitionCheck';
import { Notes } from './Notes';
import { IntuitionCheckError, checkIntuition } from '../lib/intuitionCheck';
import type { IntuitionCheckResult } from '../lib/intuitionCheck';

/** A D2 `200` fixture (ADR 0013). */
function reply(over: Partial<IntuitionCheckResult> = {}): IntuitionCheckResult {
  return {
    assessment: 'partial',
    questions: [
      'Your loops are O(n^2). What does n ≤ 1e5 suggest you can afford?',
    ],
    readyToCode: false,
    note: 'The pairing idea is clear; the cost is the gap.',
    miss: 'complexity',
    missLabel: 'Complexity analysis off',
    firstCheck: true,
    truncated: { note: false, reference: false, statement: false },
    checkedAt: '2026-10-01T12:00:00.000Z',
    recorded: true,
    ...over,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SETTINGS_OK = {
  provider: {
    kind: 'ollama',
    model: 'm',
    endpoint: null,
    keyConfigured: false,
  },
  dataDir: { path: '/d', source: 'default', pinned: false },
  app: { version: '0', node: '20' },
  envHelp: [],
};

type CheckHandler = (body: Record<string, unknown>) => Response;

let checkHandler: CheckHandler;
let settingsBody: unknown;
let fetchMock: ReturnType<
  typeof vi.fn<[url: string, init?: RequestInit], Promise<Response>>
>;

function checkCalls(): Array<{ url: string; body: Record<string, unknown> }> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/check'))
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String((init as RequestInit).body)) as Record<
        string,
        unknown
      >,
    }));
}

beforeEach(() => {
  checkHandler = () => json(200, reply());
  settingsBody = SETTINGS_OK;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings') return json(200, settingsBody);
    if (url.endsWith('/check')) {
      return checkHandler(
        JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      );
    }
    return json(404, { error: 'nope' });
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A tiny editor harness: a textarea + the coach, like the Notes page. */
function Harness({ initial = 'Sort, then two loops.' }: { initial?: string }) {
  const [content, setContent] = useState(initial);
  return (
    <div>
      <label htmlFor="c">Note</label>
      <textarea
        id="c"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <IntuitionCheck
        problemId="two-sum"
        content={content}
        timeComplexity="O(n^2)"
        spaceComplexity=""
        status="none"
      />
    </div>
  );
}

const checkButton = (): HTMLElement =>
  screen.getByRole('button', { name: /check my intuition|re-check|checking/i });

/** A check reply the test releases by hand. */
function deferCheck(): { release: (r: Response) => void } {
  const handle = { release: (_r: Response): void => undefined };
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/settings') return json(200, settingsBody);
    return new Promise<Response>((r) => {
      handle.release = r;
    });
  });
  return handle;
}

const BASE = {
  problemId: 'a',
  content: 'x',
  timeComplexity: '',
  spaceComplexity: '',
  status: 'none' as const,
};

async function settle(): Promise<void> {
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.anything()),
  );
}

describe('IntuitionCheck', () => {
  it('is disabled with a hint when the note is empty', async () => {
    render(<Harness initial="   " />);
    await settle();
    const btn = checkButton();
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription('Write your intuition first.');
  });

  it('is disabled with a hint when no provider is configured (settings)', async () => {
    settingsBody = {
      ...SETTINGS_OK,
      provider: { ...SETTINGS_OK.provider, kind: 'none' },
    };
    render(<Harness />);
    await waitFor(() => expect(checkButton()).toBeDisabled());
    expect(checkButton()).toHaveAccessibleDescription(
      'Set up an AI provider in Settings to use this.',
    );
  });

  it('disables itself after a no_provider error', async () => {
    const user = userEvent.setup();
    checkHandler = () =>
      json(400, { error: 'no model configured', code: 'no_provider' });
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    await waitFor(() => expect(checkButton()).toBeDisabled());
    expect(
      screen.getByText('Set up an AI provider in Settings to use this.'),
    ).toBeInTheDocument();
  });

  it('sends the current (unsaved) text and only non-blank optional fields', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await settle();
    await user.type(screen.getByLabelText('Note'), ' Unsaved edit.');
    await user.click(checkButton());
    await screen.findByText('Partly there');
    const calls = checkCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/notes/two-sum/check');
    expect(calls[0]!.body).toEqual({
      content: 'Sort, then two loops. Unsaved edit.',
      timeComplexity: 'O(n^2)',
      status: 'none',
    });
  });

  it('shows "Checking…" while loading and keeps the editor editable', async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => undefined;
    checkHandler = () => undefined as unknown as Response;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/settings') return json(200, settingsBody);
      return new Promise<Response>((r) => {
        release = r;
      });
    });
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    expect(checkButton()).toHaveTextContent('Checking…');
    expect(checkButton()).toBeDisabled();
    expect(screen.getByLabelText('Note')).not.toBeDisabled();
    await act(async () => release(json(200, reply())));
    await screen.findByText('Partly there');
  });

  it.each([
    ['on_track', 'On track'],
    ['partial', 'Partly there'],
    ['off_track', 'Off track'],
  ] as const)('renders the %s assessment chip', async (assessment, label) => {
    const user = userEvent.setup();
    checkHandler = () =>
      json(
        200,
        reply({
          assessment,
          readyToCode: assessment === 'on_track',
          ...(assessment === 'on_track' && {
            miss: undefined,
            missLabel: undefined,
          }),
        }),
      );
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    const panel = await screen.findByRole('region', {
      name: 'Intuition check',
    });
    expect(panel).toHaveTextContent(label);
    expect(screen.queryByText('Ready to code') !== null).toBe(
      assessment === 'on_track',
    );
    expect(panel).toHaveTextContent('Not saved. Edit and re-check anytime.');
  });

  it('renders questions, note, slip label, first-check tag and truncation notices', async () => {
    const user = userEvent.setup();
    checkHandler = () =>
      json(
        200,
        reply({
          questions: ['Q one?', 'Q two?', 'Q three?', 'Q four?'],
          truncated: { note: true, reference: true, statement: false },
        }),
      );
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    await screen.findByText('Partly there');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Q one?', 'Q two?', 'Q three?']);
    expect(
      screen.getByText('The pairing idea is clear; the cost is the gap.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Slip: Complexity analysis off'),
    ).toBeInTheDocument();
    expect(screen.getByText('First check')).toBeInTheDocument();
    expect(
      screen.getByText('Only the start of your note was checked.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Only the start of your reference approach was used.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/problem statement/)).toBeNull();
  });

  it('shows the fallback copy for on_track with 0 questions and no note', async () => {
    const user = userEvent.setup();
    checkHandler = () =>
      json(
        200,
        reply({
          assessment: 'on_track',
          questions: [],
          note: '',
          readyToCode: true,
          miss: undefined,
          missLabel: undefined,
          firstCheck: false,
        }),
      );
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    expect(
      await screen.findByText('This is the right direction — go ahead.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Ready to code')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('First check')).toBeNull();
  });

  it('puts results in a polite live region', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    const panel = await screen.findByRole('region', {
      name: 'Intuition check',
    });
    expect(panel.parentElement).toHaveAttribute('aria-live', 'polite');
  });

  it('marks the panel stale on edit and re-checks with the new text', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    const panel = await screen.findByRole('region', {
      name: 'Intuition check',
    });
    expect(panel).toHaveAttribute('data-stale', 'false');
    expect(screen.queryByText('Your note changed')).toBeNull();

    await user.type(screen.getByLabelText('Note'), ' Use the constraint.');
    expect(panel).toHaveAttribute('data-stale', 'true');
    expect(screen.getByText('Your note changed')).toBeInTheDocument();
    const recheck = screen.getByRole('button', { name: 'Re-check' });

    checkHandler = () =>
      json(200, reply({ assessment: 'on_track', readyToCode: true }));
    await user.click(recheck);
    await screen.findByText('On track');
    const calls = checkCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.content).toBe(
      'Sort, then two loops. Use the constraint.',
    );
    expect(
      screen.getByRole('region', { name: 'Intuition check' }),
    ).toHaveAttribute('data-stale', 'false');
    expect(checkButton()).toHaveTextContent('Check my intuition');
  });

  it('shows the model-unavailable card with the hint and retries', async () => {
    const user = userEvent.setup();
    checkHandler = () =>
      json(503, {
        error: 'model unavailable',
        code: 'model_unavailable',
        detail: 'The model is loading.',
        hint: 'Run `docker model pull` first.',
      });
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    const card = await screen.findByRole('status', { name: 'Model not ready' });
    expect(card).toHaveTextContent('The model is loading.');
    expect(card).toHaveTextContent('Run `docker model pull` first.');

    checkHandler = () => json(200, reply());
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Partly there');
    expect(
      screen.queryByRole('status', { name: 'Model not ready' }),
    ).toBeNull();
    expect(checkCalls()).toHaveLength(2);
  });

  it('disables the button for retryAfterMs with a countdown on rate_limited', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    checkHandler = () =>
      json(429, {
        error: 'too many',
        code: 'rate_limited',
        retryAfterMs: 2500,
      });
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    expect(
      await screen.findByText('One check at a time — try again in a moment.'),
    ).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
    expect(screen.getByText('Try again in 3s.')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('Try again in 2s.')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(checkButton()).not.toBeDisabled();
    expect(screen.queryByText(/Try again in/)).toBeNull();
  });

  it('shows the empty-note hint text for a 400 empty_note', async () => {
    const user = userEvent.setup();
    checkHandler = () => json(400, { error: 'empty note', code: 'empty_note' });
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Write your intuition first.',
    );
  });

  it('shows the unusable-reply text on 502 and on a malformed 200', async () => {
    const user = userEvent.setup();
    checkHandler = () => json(502, { error: 'bad reply' });
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The model gave an unusable reply. Try again.',
    );
    checkHandler = () => json(200, { assessment: 'maybe' });
    await user.click(checkButton());
    await waitFor(() => expect(checkCalls()).toHaveLength(2));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The model gave an unusable reply. Try again.',
    );
  });

  it('shows other errors inline (server text, network failure)', async () => {
    const user = userEvent.setup();
    checkHandler = () => json(404, { error: 'unknown problem' });
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'unknown problem',
    );
    checkHandler = () => {
      throw new TypeError('Failed to fetch');
    };
    await user.click(checkButton());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not reach the local API. Please try again.',
      ),
    );
  });

  it('persists nothing (no localStorage / sessionStorage writes)', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      render(<Harness />);
      await settle();
      await user.click(checkButton());
      await screen.findByText('Partly there');
      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      // Only the settings read and the check itself hit the network.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      setItem.mockRestore();
    }
  });

  it('renders model text as plain text (XSS-safe)', async () => {
    const user = userEvent.setup();
    const evil =
      '<img src=x onerror="window.__pwned=1"><script>alert(1)</script>';
    checkHandler = () =>
      json(200, reply({ questions: [evil], note: '<b>bold</b>' }));
    const { container } = render(<Harness />);
    await settle();
    await user.click(checkButton());
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
    expect(container.querySelector('img, script, b')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('treats a non-JSON 200 as the 502 unusable-reply error', async () => {
    const user = userEvent.setup();
    checkHandler = () =>
      new Response('<html>oops</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    await expect(checkIntuition('a', { content: 'x' })).rejects.toMatchObject({
      status: 502,
    });
    await expect(checkIntuition('a', { content: 'x' })).rejects.toBeInstanceOf(
      IntuitionCheckError,
    );
    render(<Harness />);
    await settle();
    await user.click(checkButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The model gave an unusable reply. Try again.',
    );
  });

  it('announces the no_provider hint politely and moves focus to it', async () => {
    const user = userEvent.setup();
    checkHandler = () =>
      json(400, { error: 'no model configured', code: 'no_provider' });
    render(<Harness />);
    await settle();
    const live = screen.getByTestId('intuition-check-hint-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toBeEmptyDOMElement();
    await user.click(checkButton());
    await waitFor(() => expect(checkButton()).toBeDisabled());
    const hint = screen.getByText(
      'Set up an AI provider in Settings to use this.',
    );
    expect(live).toContainElement(hint);
    expect(hint).toHaveFocus();
    expect(checkButton()).toHaveAccessibleDescription(
      'Set up an AI provider in Settings to use this.',
    );
  });

  it('sends one request when onCheck fires twice before a re-render', async () => {
    const handle = deferCheck();
    render(<IntuitionCheck {...BASE} />);
    await settle();
    const btn = checkButton();
    const propsKey = Object.keys(btn).find((k) =>
      k.startsWith('__reactProps'),
    )!;
    const { onClick } = (
      btn as unknown as Record<string, { onClick: () => void }>
    )[propsKey]!;
    act(() => {
      onClick();
      onClick();
    });
    await waitFor(() => expect(checkButton()).toHaveTextContent('Checking…'));
    expect(checkCalls()).toHaveLength(1);
    await act(async () => handle.release(json(200, reply())));
    await screen.findByText('Partly there');
    expect(checkCalls()).toHaveLength(1);
  });

  it('drops a late reply after unmount without setState warnings', async () => {
    const user = userEvent.setup();
    const handle = deferCheck();
    const { unmount } = render(<IntuitionCheck {...BASE} />);
    await settle();
    await user.click(checkButton());
    expect(checkButton()).toHaveTextContent('Checking…');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      unmount();
      await act(async () => handle.release(json(200, reply())));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('drops a late reply that arrives after the problem changed', async () => {
    const user = userEvent.setup();
    const handle = deferCheck();
    const { rerender } = render(<IntuitionCheck {...BASE} />);
    await settle();
    await user.click(checkButton());
    expect(checkButton()).toHaveTextContent('Checking…');
    rerender(<IntuitionCheck {...BASE} problemId="b" />);
    expect(checkButton()).toHaveTextContent('Check my intuition');
    await act(async () => handle.release(json(200, reply())));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText('Partly there')).toBeNull();
    expect(checkButton()).not.toBeDisabled();
  });

  it.each([
    ['timeComplexity', 'O(n)'],
    ['spaceComplexity', 'O(1)'],
  ] as const)('marks the panel stale when %s is edited', async (key, value) => {
    const user = userEvent.setup();
    const props: ComponentProps<typeof IntuitionCheck> = BASE;
    const { rerender } = render(<IntuitionCheck {...props} />);
    await settle();
    await user.click(checkButton());
    const panel = await screen.findByRole('region', {
      name: 'Intuition check',
    });
    expect(panel).toHaveAttribute('data-stale', 'false');
    rerender(<IntuitionCheck {...props} {...{ [key]: value }} />);
    expect(panel).toHaveAttribute('data-stale', 'true');
    expect(checkButton()).toHaveTextContent('Re-check');
    rerender(<IntuitionCheck {...props} />);
    expect(panel).toHaveAttribute('data-stale', 'false');
  });

  it('sends referenceApproach and includes it in the stale snapshot', async () => {
    const user = userEvent.setup();
    const props = { ...BASE, referenceApproach: 'Hash map of seen values.' };
    const { rerender } = render(<IntuitionCheck {...props} />);
    await settle();
    await user.click(checkButton());
    const panel = await screen.findByRole('region', {
      name: 'Intuition check',
    });
    expect(checkCalls()[0]!.body).toEqual({
      content: 'x',
      referenceApproach: 'Hash map of seen values.',
      status: 'none',
    });
    expect(panel).toHaveAttribute('data-stale', 'false');
    rerender(<IntuitionCheck {...props} referenceApproach="Sort first." />);
    expect(panel).toHaveAttribute('data-stale', 'true');
  });

  it('clears the cooldown timer when unmounted mid rate-limit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    try {
      checkHandler = () =>
        json(429, {
          error: 'too many',
          code: 'rate_limited',
          retryAfterMs: 5000,
        });
      const { unmount } = render(<IntuitionCheck {...BASE} />);
      await settle();
      await user.click(checkButton());
      await screen.findByText('Try again in 5s.');
      // The component's 250ms ticker (waitFor uses its own intervals).
      const timers = setIntervalSpy.mock.calls
        .map((call, i) => ({
          delay: call[1],
          id: setIntervalSpy.mock.results[i]!.value as unknown,
        }))
        .filter((t) => t.delay === 250);
      expect(timers).toHaveLength(1);
      const cooldownTimer = timers[0]!.id;
      expect(clearIntervalSpy).not.toHaveBeenCalledWith(cooldownTimer);
      unmount();
      expect(clearIntervalSpy).toHaveBeenCalledWith(cooldownTimer);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it('clears the panel when the problem changes', async () => {
    const user = userEvent.setup();
    const props = {
      content: 'x',
      timeComplexity: '',
      spaceComplexity: '',
      status: 'none' as const,
    };
    const { rerender } = render(<IntuitionCheck problemId="a" {...props} />);
    await settle();
    await user.click(checkButton());
    await screen.findByText('Partly there');
    rerender(<IntuitionCheck problemId="b" {...props} />);
    expect(screen.queryByText('Partly there')).toBeNull();
  });
});

describe('Notes page mounts the coach', () => {
  it('checks the unsaved editor text without saving', async () => {
    const user = userEvent.setup();
    const saved = {
      problemId: 'two-sum',
      content: 'Saved text.',
      status: 'to_revisit',
      completed: false,
      lastUpdated: '2026-09-24T00:00:00.000Z',
    };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/settings') return json(200, settingsBody);
      if (url === '/api/notes/two-sum' && !init?.method) {
        return json(200, saved);
      }
      if (url === '/api/catalog') {
        return json(200, {
          topics: [],
          totals: {
            total: 0,
            byStatus: {
              none: 0,
              done: 0,
              to_revisit: 0,
              did_not_understand: 0,
            },
          },
        });
      }
      if (url.endsWith('/check')) return json(200, reply());
      return json(500, { error: 'unexpected' });
    });
    render(<Notes problemId="two-sum" />);
    const editor = await screen.findByLabelText(/intuition & approach/i);
    await user.type(editor, ' Plus an edit.');
    await user.click(
      screen.getByRole('button', { name: 'Check my intuition' }),
    );
    await screen.findByText('Partly there');
    const calls = checkCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      content: 'Saved text. Plus an edit.',
      status: 'to_revisit',
    });
    // No save (POST /api/notes/two-sum) happened.
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === '/api/notes/two-sum' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);
  });
});
