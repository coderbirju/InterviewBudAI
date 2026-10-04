import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Notes } from './Notes';
import {
  GENERIC_TEMPLATES,
  buildTemplate,
  fencedStarter,
} from '../lib/noteTemplate';
import ready from '../test/fixtures/statement/get-ready.json';
import readyTruncated from '../test/fixtures/statement/get-ready-truncated.json';
import notCached from '../test/fixtures/statement/get-not-cached.json';
import disabled from '../test/fixtures/statement/get-disabled.json';
import premium from '../test/fixtures/statement/get-premium.json';
import unavailable from '../test/fixtures/statement/get-unavailable.json';
import pasted from '../test/fixtures/statement/get-pasted.json';
import custom from '../test/fixtures/statement/get-custom.json';
import errDisabled from '../test/fixtures/statement/fetch-error-fetch_disabled.json';
import errNotFound from '../test/fixtures/statement/fetch-error-not_found.json';
import errRateLimited from '../test/fixtures/statement/fetch-error-rate_limited.json';
import errFailed from '../test/fixtures/statement/fetch-error-fetch_failed.json';
import errTimeout from '../test/fixtures/statement/fetch-error-fetch_timeout.json';
import prefsUnpinned from '../test/fixtures/statement/preferences-unpinned.json';

/* ADR 0015 PR B: the Notes split view against the PR A fixtures — statement
 * states, the fetch + single 429 retry, the paste fallback, the code-first
 * template (timing, prefill, append, no write on open), "Unsaved changes",
 * the language picker, "Copy code", and the coach still working. Only
 * `fetch` is faked: the real api.ts clients run. */

const ID = 'lc-1';
const PY_TEMPLATE = buildTemplate(ready.snippets.python, 'python');
const GO_TEMPLATE = buildTemplate(ready.snippets.go, 'go');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CATALOG = {
  topics: [
    {
      topic: 'arrays',
      label: 'Arrays & Hashing',
      problems: [
        {
          id: ID,
          title: 'Pair Sum',
          url: 'https://leetcode.com/problems/two-sum/',
          difficulty: 'easy',
          status: 'none',
          completed: false,
        },
        {
          id: custom.id,
          title: custom.title,
          difficulty: 'hard',
          status: 'none',
          completed: false,
          custom: true,
          statement: custom.text,
        },
      ],
    },
  ],
  totals: {
    total: 2,
    byStatus: { none: 2, done: 0, to_revisit: 0, did_not_understand: 0 },
  },
};

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

function note(content: string, id = ID): Record<string, unknown> {
  return {
    problemId: id,
    content,
    status: 'none',
    completed: false,
    timeComplexity: null,
    spaceComplexity: null,
    lastUpdated: null,
  };
}

type Reply = Response | Promise<Response> | (() => Promise<Response>);

interface Server {
  noteContent: string;
  get: Reply;
  /** One entry per POST …/fetch, in order. */
  posts: Reply[];
  put: (body: { text: string }) => Response;
  prefs: Record<string, unknown>;
  prefsPut: (body: Record<string, unknown>) => Response;
}

let server: Server;
let fetchMock: ReturnType<
  typeof vi.fn<[url: string, init?: RequestInit], Promise<Response>>
>;

function resolveReply(r: Reply | undefined): Promise<Response> {
  if (r === undefined) return Promise.resolve(json({ error: 'none' }, 500));
  return typeof r === 'function' ? r() : Promise.resolve(r);
}

function calls(method: string, suffix: string): RequestInit[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        String(url).endsWith(suffix) && (init?.method ?? 'GET') === method,
    )
    .map(([, init]) => init ?? {});
}

beforeEach(() => {
  window.history.pushState({}, '', `/notes/${ID}`);
  server = {
    noteContent: '',
    get: json(ready),
    posts: [],
    put: () => json(pasted),
    prefs: prefsUnpinned,
    prefsPut: (body) => json({ ...prefsUnpinned, ...body }),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : {};
    if (url === '/api/settings') return json(SETTINGS_OK);
    if (url === '/api/catalog') return json(CATALOG);
    if (url === '/api/preferences') {
      return method === 'PUT' ? server.prefsPut(body) : json(server.prefs);
    }
    const n = /^\/api\/notes\/([^/]+)$/.exec(url);
    if (n) {
      const id = decodeURIComponent(n[1] ?? '');
      return method === 'POST'
        ? json({ ...note(String(body.content ?? '')), problemId: id })
        : json(note(server.noteContent, id));
    }
    if (url.endsWith('/statement/fetch') && method === 'POST') {
      return resolveReply(server.posts.shift());
    }
    if (url.endsWith('/statement')) {
      if (method === 'PUT') return server.put(body as { text: string });
      return resolveReply(server.get);
    }
    if (url.endsWith('/check')) {
      return json({
        assessment: 'on_track',
        questions: [],
        readyToCode: true,
        note: '',
        miss: null,
        missLabel: null,
        firstCheck: true,
        truncated: { note: false, statement: false },
        checkedAt: '2026-10-04T12:00:00.000Z',
        recorded: true,
      });
    }
    return json({ error: 'unexpected' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const editor = (): Promise<HTMLElement> =>
  screen.findByLabelText(/intuition & approach/i);

/** The editor once the template step has run (or was skipped). */
async function settledEditor(expected: string): Promise<HTMLElement> {
  const ed = await editor();
  await waitFor(() => expect(ed).toHaveValue(expected));
  return ed;
}

function pane(): HTMLElement {
  return screen.getByRole('region', { name: /Pair Sum|Book Puzzle/ });
}

function noNoteWrites(): void {
  expect(calls('POST', `/api/notes/${ID}`)).toHaveLength(0);
}

describe('statement states', () => {
  it('ready: renders the tree, difficulty, link, examples, fetched date; no POST; prefills the snippet template without saving', async () => {
    render(<Notes problemId={ID} />);
    await settledEditor(PY_TEMPLATE);
    const region = pane();
    expect(
      within(region).getByText(/Given a list of numbers/),
    ).toBeInTheDocument();
    expect(within(region).getByText('Easy')).toBeInTheDocument();
    const open = within(region).getByRole('link', {
      name: /open on leetcode/i,
    });
    expect(open).toHaveAttribute('href', ready.url);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(region).getByText('Example test cases')).toBeInTheDocument();
    expect(within(region).getByText(/^Fetched /)).toBeInTheDocument();
    expect(within(region).queryByLabelText('Paste the problem')).toBeNull();
    expect(calls('POST', '/statement/fetch')).toHaveLength(0);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    noNoteWrites();
  });

  it('ready + truncated shows the cut-short notice', async () => {
    server.get = json(readyTruncated);
    render(<Notes problemId={ID} />);
    expect(await screen.findByText(/cut short/)).toBeInTheDocument();
  });

  it('not-cached: one POST, then the fetched statement; the template uses the FETCHED snippet (never the generic one first)', async () => {
    server.get = json(notCached);
    server.posts = [json(ready)];
    // Record every value React writes into the textarea.
    const seen: string[] = [];
    const proto = HTMLTextAreaElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return desc?.get?.call(this);
      },
      set(this: HTMLTextAreaElement, v: string) {
        seen.push(v);
        desc?.set?.call(this, v);
      },
    });
    try {
      render(<Notes problemId={ID} />);
      const ed = await editor();
      await waitFor(() => expect(ed).toHaveValue(PY_TEMPLATE));
    } finally {
      if (desc) Object.defineProperty(proto, 'value', desc);
    }
    expect(seen).toContain(PY_TEMPLATE);
    expect(seen).not.toContain(GENERIC_TEMPLATES.python);
    expect(calls('POST', '/statement/fetch')).toHaveLength(1);
    expect(screen.getByText(/Given a list of numbers/)).toBeInTheDocument();
  });

  it('not-cached + 429: retries ONCE after retryAfterMs, then shows the statement', async () => {
    server.get = json(notCached);
    server.posts = [
      json({ ...errRateLimited, retryAfterMs: 10 }, 429),
      json(ready),
    ];
    render(<Notes problemId={ID} />);
    await settledEditor(PY_TEMPLATE);
    expect(calls('POST', '/statement/fetch')).toHaveLength(2);
  });

  it('the retry wait is capped at 2 s', async () => {
    server.get = json(notCached);
    server.posts = [
      json({ ...errRateLimited, retryAfterMs: 600000 }, 429),
      json(ready),
    ];
    const started = Date.now();
    render(<Notes problemId={ID} />);
    await waitFor(
      () => expect(calls('POST', '/statement/fetch')).toHaveLength(2),
      {
        timeout: 3500,
      },
    );
    expect(Date.now() - started).toBeLessThan(3500);
  });

  it('a second 429 shows the fallback and the generic template', async () => {
    server.get = json(notCached);
    server.posts = [
      json({ ...errRateLimited, retryAfterMs: 5 }, 429),
      json({ ...errRateLimited, retryAfterMs: 5 }, 429),
    ];
    render(<Notes problemId={ID} />);
    await settledEditor(GENERIC_TEMPLATES.python);
    expect(calls('POST', '/statement/fetch')).toHaveLength(2);
    expect(
      screen.getByText('Too many LeetCode fetches right now'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Paste the problem')).toBeInTheDocument();
  });

  it.each([
    [errFailed, 502],
    [errTimeout, 504],
  ])(
    'fetch error %j: "LeetCode could not be reached" + link + paste',
    async (body, status) => {
      server.get = json(notCached);
      server.posts = [json(body, status)];
      render(<Notes problemId={ID} />);
      await settledEditor(GENERIC_TEMPLATES.python);
      expect(
        screen.getByText('LeetCode could not be reached'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /open on leetcode/i }),
      ).toHaveAttribute('href', notCached.url);
      expect(screen.getByLabelText('Paste the problem')).toBeInTheDocument();
    },
  );

  it('fetch 403 fetch_disabled: "Fetching is turned off in Settings"', async () => {
    server.get = json(notCached);
    server.posts = [json(errDisabled, 403)];
    render(<Notes problemId={ID} />);
    await settledEditor(GENERIC_TEMPLATES.python);
    expect(
      screen.getByText('Fetching is turned off in Settings'),
    ).toBeInTheDocument();
  });

  it('disabled: no POST, the reason, link and paste box', async () => {
    server.get = json(disabled);
    render(<Notes problemId={ID} />);
    await settledEditor(GENERIC_TEMPLATES.python);
    expect(calls('POST', '/statement/fetch')).toHaveLength(0);
    expect(
      screen.getByText('Fetching is turned off in Settings'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Paste the problem')).toBeInTheDocument();
    // Off means no Refresh either.
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('disabled and pinned by env names the variable', async () => {
    server.get = json({ ...disabled, fetch: { enabled: false, pinned: true } });
    render(<Notes problemId={ID} />);
    expect(
      await screen.findByText('Fetching is turned off by IBAI_LEETCODE_FETCH'),
    ).toBeInTheDocument();
  });

  it('premium: "Premium problem" + Open on LeetCode + paste', async () => {
    server.get = json({ ...premium, id: ID });
    render(<Notes problemId={ID} />);
    await settledEditor(GENERIC_TEMPLATES.python);
    expect(screen.getByText('Premium problem')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /open on leetcode/i }),
    ).toHaveAttribute('href', premium.url);
    expect(screen.getByLabelText('Paste the problem')).toBeInTheDocument();
  });

  it('unavailable (GET) and POST 404 not_found are shown the same way', async () => {
    server.get = json(unavailable);
    const first = render(<Notes problemId={ID} />);
    await settledEditor(GENERIC_TEMPLATES.python);
    const reason = 'LeetCode has no statement for this problem';
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByLabelText('Paste the problem')).toBeInTheDocument();
    first.unmount();

    server.get = json(notCached);
    server.posts = [json(errNotFound, 404)];
    render(<Notes problemId={ID} />);
    await settledEditor(GENERIC_TEMPLATES.python);
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByLabelText('Paste the problem')).toBeInTheDocument();
  });

  it.each([
    ['a 5xx', () => Promise.resolve(json({ error: 'boom' }, 500))],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])(
    'a failed GET (%s) is final: link + paste, generic template appended, no retry loop',
    async (_l, get) => {
      server.noteContent = 'My idea.';
      server.get = get;
      render(<Notes problemId={ID} />);
      await settledEditor(
        `My idea.\n\n${fencedStarter(GENERIC_TEMPLATES.python, 'python')}`,
      );
      expect(
        screen.getByText('The problem statement could not be loaded'),
      ).toBeInTheDocument();
      // The link comes from the catalog when the GET failed.
      await waitFor(() =>
        expect(
          screen.getByRole('link', { name: /open on leetcode/i }),
        ).toHaveAttribute('href', CATALOG.topics[0]?.problems[0]?.url),
      );
      expect(screen.getByLabelText('Paste the problem')).toBeInTheDocument();
      expect(calls('GET', '/statement')).toHaveLength(1);
      expect(calls('POST', '/statement/fetch')).toHaveLength(0);
      noNoteWrites();
    },
  );

  it('a hostile / invalid tree is rejected: fallback, nothing rendered from it', async () => {
    server.get = json({
      ...ready,
      blocks: [
        { t: 'script', c: [{ t: 'text', v: 'alert(1)' }] },
        { t: 'p', c: [], onclick: 'alert(2)' },
      ],
    });
    const { container } = render(<Notes problemId={ID} />);
    expect(
      await screen.findByText('The saved statement could not be shown'),
    ).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(screen.queryByText('alert(1)')).toBeNull();
    expect(screen.getByLabelText('Paste the problem')).toBeInTheDocument();
  });

  it('loading shows a skeleton status while the GET is pending', async () => {
    server.get = () => new Promise<Response>(() => {});
    render(<Notes problemId={ID} />);
    expect(await screen.findByText('Loading the problem…')).toBeInTheDocument();
  });
});

describe('paste fallback', () => {
  it('saves pasted text with PUT, shows it as plain text, and can remove it', async () => {
    const user = userEvent.setup();
    server.get = json(disabled);
    server.put = (body) =>
      body.text === ''
        ? json(disabled)
        : json({ ...pasted, text: body.text, snippets: disabled.snippets });
    const { container } = render(<Notes problemId={ID} />);
    const box = await screen.findByLabelText('Paste the problem');
    await user.type(box, 'Pasted <b>statement</b>');
    await user.click(screen.getByRole('button', { name: 'Save pasted text' }));
    expect(await screen.findByText('Pasted <b>statement</b>')).toHaveClass(
      'whitespace-pre-wrap',
    );
    expect(container.querySelector('b')).toBeNull();
    expect(calls('PUT', '/statement')[0]?.body).toBe(
      JSON.stringify({ text: 'Pasted <b>statement</b>' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Remove pasted text' }),
    );
    expect(
      await screen.findByText('Fetching is turned off in Settings'),
    ).toBeInTheDocument();
    expect(calls('PUT', '/statement')[1]?.body).toBe('{"text":""}');
  });

  it('a read-only folder (409) says so', async () => {
    const user = userEvent.setup();
    server.get = json(disabled);
    server.put = () => json({ error: 'read-only' }, 409);
    render(<Notes problemId={ID} />);
    await user.type(await screen.findByLabelText('Paste the problem'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save pasted text' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/read-only/);
  });

  it('a pasted statement wins over the fetched one and keeps its snippets', async () => {
    server.get = json(pasted);
    render(<Notes problemId={ID} />);
    await settledEditor(PY_TEMPLATE);
    expect(screen.getByText(/Return two positions/)).toBeInTheDocument();
    expect(screen.queryByText(/Given a list of numbers/)).toBeNull();
  });
});

describe('code-first template', () => {
  it('custom problem: its own statement, the generic template, no fetch, no paste box', async () => {
    window.history.pushState({}, '', `/notes/${custom.id}`);
    server.get = json(custom);
    render(<Notes problemId={custom.id} />);
    await settledEditor(GENERIC_TEMPLATES.python);
    expect(
      screen.getByRole('region', { name: 'Problem statement' }),
    ).toHaveTextContent(custom.text);
    expect(screen.queryByLabelText('Paste the problem')).toBeNull();
    expect(calls('POST', '/statement/fetch')).toHaveLength(0);
  });

  it('an existing note without the signature gets the fenced starter appended (unsaved)', async () => {
    server.noteContent = 'Hash map of value to index.\n';
    render(<Notes problemId={ID} />);
    await settledEditor(
      `Hash map of value to index.\n\n${fencedStarter(PY_TEMPLATE, 'python')}`,
    );
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    noNoteWrites();
  });

  it('a note that already has the signature is left alone', async () => {
    const saved = `Idea\n\n${fencedStarter(PY_TEMPLATE, 'python')}\n`;
    server.noteContent = saved;
    render(<Notes problemId={ID} />);
    const ed = await editor();
    await waitFor(() =>
      expect(screen.getByText(/Given a list of numbers/)).toBeInTheDocument(),
    );
    // Let the template step run; nothing changes.
    await new Promise((r) => setTimeout(r, 20));
    expect(ed).toHaveValue(saved);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('typing before the final state means no prefill', async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => {};
    server.get = () => new Promise<Response>((r) => (release = r));
    render(<Notes problemId={ID} />);
    const ed = await editor();
    await user.type(ed, 'mine');
    release(json(ready));
    await screen.findByText(/Given a list of numbers/);
    await new Promise((r) => setTimeout(r, 20));
    expect(ed).toHaveValue('mine');
  });

  it('Save writes the template and clears "Unsaved changes"', async () => {
    const user = userEvent.setup();
    render(<Notes problemId={ID} />);
    await settledEditor(PY_TEMPLATE);
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await screen.findByText(/^Saved$/);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    const body = JSON.parse(
      String(calls('POST', `/api/notes/${ID}`)[0]?.body),
    ) as { content: string };
    expect(body.content).toBe(PY_TEMPLATE);
  });

  it('the saved language (Go) picks the Go snippet', async () => {
    server.prefs = { ...prefsUnpinned, language: 'go' };
    render(<Notes problemId={ID} />);
    await settledEditor(GO_TEMPLATE);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('language picker (Notes toolbar)', () => {
  it('persists with PUT /api/preferences and swaps an untouched template', async () => {
    const user = userEvent.setup();
    render(<Notes problemId={ID} />);
    await settledEditor(PY_TEMPLATE);
    const group = screen.getByRole('group', { name: 'Code language' });
    await user.click(within(group).getByRole('button', { name: 'Go' }));
    await settledEditor(GO_TEMPLATE);
    expect(calls('PUT', '/api/preferences')[0]?.body).toBe('{"language":"go"}');
    expect(within(group).getByRole('button', { name: 'Go' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('an edited note is not changed by a language switch', async () => {
    const user = userEvent.setup();
    render(<Notes problemId={ID} />);
    const ed = await settledEditor(PY_TEMPLATE);
    await user.type(ed, '!');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() =>
      expect(calls('PUT', '/api/preferences')).toHaveLength(1),
    );
    expect(ed).toHaveValue(PY_TEMPLATE + '!');
  });

  it('a failed save (409) keeps the old language and says why', async () => {
    const user = userEvent.setup();
    server.prefsPut = () => json({ error: 'read-only' }, 409);
    render(<Notes problemId={ID} />);
    await settledEditor(PY_TEMPLATE);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/read-only/);
    expect(screen.getByRole('button', { name: 'Python' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText(/intuition & approach/i)).toHaveValue(
      PY_TEMPLATE,
    );
  });
});

describe('Copy code', () => {
  it('copies the appended fenced block, not the whole note', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    server.noteContent = 'Idea first.';
    render(<Notes problemId={ID} />);
    await settledEditor(
      `Idea first.\n\n${fencedStarter(PY_TEMPLATE, 'python')}`,
    );
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenLastCalledWith(PY_TEMPLATE);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy note' }));
    expect(writeText).toHaveBeenLastCalledWith(
      `Idea first.\n\n${fencedStarter(PY_TEMPLATE, 'python')}`,
    );
  });
});

describe('coach', () => {
  it('"Check my intuition" still checks the current editor text', async () => {
    const user = userEvent.setup();
    render(<Notes problemId={ID} />);
    await settledEditor(PY_TEMPLATE);
    await user.click(
      screen.getByRole('button', { name: 'Check my intuition' }),
    );
    await screen.findByText('On track');
    const body = JSON.parse(String(calls('POST', '/check')[0]?.body)) as {
      content: string;
    };
    expect(body.content).toBe(PY_TEMPLATE);
    noNoteWrites();
  });
});
