import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Interview } from './Interview';
import ready from '../test/fixtures/statement/statement-ready.json';
import readyTruncated from '../test/fixtures/statement/statement-ready-truncated.json';
import notCached from '../test/fixtures/statement/statement-not-cached.json';
import disabled from '../test/fixtures/statement/statement-disabled.json';
import premium from '../test/fixtures/statement/statement-premium.json';
import unavailable from '../test/fixtures/statement/statement-unavailable.json';
import pasted from '../test/fixtures/statement/statement-pasted.json';
import custom from '../test/fixtures/statement/statement-custom.json';
import errDisabled from '../test/fixtures/statement/fetch-error-403-fetch_disabled.json';
import errRateLimited from '../test/fixtures/statement/fetch-error-429-rate_limited.json';
import errFailed from '../test/fixtures/statement/fetch-error-502-fetch_failed.json';

/* ADR 0007 amendment (2026-10-08): the quiz question card shows the
 * ADR 0015 cached statement, display only. Only `fetch` is faked; the real
 * api.ts clients and the shared Notes statement flow run. No request ever
 * leaves the process (and none goes to leetcode.com). */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Reply = Response | Promise<Response> | (() => Promise<Response>);

interface Fixture {
  readonly id: string;
  readonly title: string;
  readonly difficulty: string;
  readonly url: string | null;
}

const STATE = (index = 0) => ({
  sessionId: 's1',
  deckSize: 3,
  index,
  answered: index,
  status: 'active' as const,
});

function questionOf(f: Fixture, probe?: string): Record<string, unknown> {
  return {
    problemId: f.id,
    wrapped: `${f.title} (${f.difficulty})`,
    title: f.title,
    difficulty: f.difficulty,
    ...(f.url ? { url: f.url } : {}),
    ...(probe ? { probe } : {}),
  };
}

interface Server {
  question: Record<string, unknown>;
  /** GET …/statement reply per problem id. */
  gets: Record<string, Reply>;
  /** One entry per POST …/statement/fetch, in order. */
  posts: Reply[];
  /** One entry per POST /api/quiz/answer, in order. */
  answers: Reply[];
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

const statementGets = (id: string): number =>
  calls('GET', `/api/problems/${id}/statement`).length;

/** A reply that the test resolves by hand (to deliver it late). */
function deferred(): {
  reply: Promise<Response>;
  resolve: (r: Response) => void;
} {
  let resolve: (r: Response) => void = () => undefined;
  const reply = new Promise<Response>((r) => {
    resolve = r;
  });
  return { reply, resolve };
}

beforeEach(() => {
  server = {
    question: questionOf(ready),
    gets: {},
    posts: [],
    answers: [],
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/quiz/session') {
      return json({
        active: true,
        session: STATE(),
        question: server.question,
        transcript: [],
      });
    }
    if (url === '/api/quiz/sessions') return json({ sessions: [] });
    if (url === '/api/quiz/answer' && method === 'POST') {
      return resolveReply(server.answers.shift());
    }
    const m = /^\/api\/problems\/([^/]+)\/statement(\/fetch)?$/.exec(url);
    if (m) {
      const id = decodeURIComponent(m[1] ?? '');
      if (m[2] && method === 'POST') return resolveReply(server.posts.shift());
      if (!m[2] && method === 'GET') return resolveReply(server.gets[id]);
    }
    return json({ error: 'unexpected' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const card = (): HTMLElement =>
  screen.getByRole('group', { name: /current question/i });

/** The statement box, found through the toggle's `aria-controls` (it may be hidden). */
function statementRegion(): HTMLElement {
  const toggle = within(card()).getByRole('button', {
    name: /^(hide|show) problem$/i,
  });
  const el = document.getElementById(
    toggle.getAttribute('aria-controls') ?? '',
  );
  if (!el) throw new Error('no statement region');
  return el;
}

async function start(f: Fixture, get: Reply): Promise<void> {
  server.question = questionOf(f);
  server.gets[f.id] = get;
  render(<Interview />);
  await screen.findByRole('group', { name: /current question/i });
}

describe('Quiz card: problem statement states', () => {
  it('ready (leetcode): renders the statement and examples with StatementView, no snippets', async () => {
    await start(ready, json(ready));
    const region = statementRegion();
    await within(region).findByTestId('statement');
    expect(region).toHaveTextContent('Example 1:');
    expect(region).toHaveTextContent('Input: s = "abca"');
    expect(region).toHaveTextContent('Constraints:');
    // Starter code (snippets) is never shown in the quiz.
    expect(card()).not.toHaveTextContent('class Solution');
    expect(card()).not.toHaveTextContent('longestRun');
    // Cached: no LeetCode fetch.
    expect(calls('POST', '/statement/fetch')).toHaveLength(0);
    // The statement scrolls inside a capped box (class only, no inline style).
    expect(region).toHaveClass('max-h-80', 'overflow-auto');
    expect(region.getAttribute('style')).toBeNull();
    // No paste box in the quiz: the only textarea is the answer.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('ready with truncated: true shows the cut-short note', async () => {
    await start(readyTruncated, json(readyTruncated));
    expect(
      await within(statementRegion()).findByText(/cut short/i),
    ).toBeInTheDocument();
    expect(
      within(statementRegion()).getByTestId('statement'),
    ).toBeInTheDocument();
  });

  it('not-cached + fetching on: POSTs the fetch once and shows the result', async () => {
    server.posts = [json(ready)];
    await start(notCached, json(notCached));
    await within(statementRegion()).findByTestId('statement');
    expect(calls('POST', '/api/problems/lc-3/statement/fetch')).toHaveLength(1);
    expect(statementRegion()).toHaveTextContent('Example 1:');
  });

  it('not-cached: a 429 is retried once, a second 429 shows the fallback (no loop)', async () => {
    server.posts = [json(errRateLimited, 429), json(errRateLimited, 429)];
    await start(notCached, json(notCached));
    expect(
      await within(statementRegion()).findByText(
        /too many leetcode fetches/i,
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(calls('POST', '/statement/fetch')).toHaveLength(2);
  });

  it('not-cached: a 502 fetch error shows the fallback with the Notes link', async () => {
    server.posts = [json(errFailed, 502)];
    await start(notCached, json(notCached));
    expect(
      await within(statementRegion()).findByText(
        /leetcode could not be reached/i,
      ),
    ).toBeInTheDocument();
    const link = within(statementRegion()).getByRole('link', {
      name: /add it from the notes page/i,
    });
    expect(link).toHaveAttribute('href', '/notes/lc-3');
  });

  it('not-cached: a 403 fetch_disabled shows the "turned off" line', async () => {
    server.posts = [json(errDisabled, 403)];
    await start(notCached, json(notCached));
    expect(
      await within(statementRegion()).findByText(/fetching is turned off/i),
    ).toBeInTheDocument();
  });

  it('disabled: no fetch is sent; short line + Notes link + the LeetCode link', async () => {
    await start(disabled, json(disabled));
    expect(
      await within(statementRegion()).findByText(
        /fetching is turned off in settings/i,
      ),
    ).toBeInTheDocument();
    expect(calls('POST', '/statement/fetch')).toHaveLength(0);
    expect(
      within(statementRegion()).getByRole('link', {
        name: /add it from the notes page/i,
      }),
    ).toHaveAttribute('href', '/notes/lc-11');
    expect(
      within(card()).getByRole('link', { name: /open problem/i }),
    ).toHaveAttribute('href', disabled.url);
    expect(screen.queryByLabelText(/paste the problem/i)).toBeNull();
  });

  it('premium: shows "Premium problem"', async () => {
    await start(premium, json(premium));
    expect(
      await within(statementRegion()).findByText(/premium problem/i),
    ).toBeInTheDocument();
    expect(calls('POST', '/statement/fetch')).toHaveLength(0);
  });

  it('unavailable: shows the no-statement line', async () => {
    await start(unavailable, json(unavailable));
    expect(
      await within(statementRegion()).findByText(
        /leetcode has no statement for this problem/i,
      ),
    ).toBeInTheDocument();
  });

  it('a failed GET shows the could-not-load line (no retry loop)', async () => {
    await start(ready, json({ error: 'boom' }, 500));
    expect(
      await within(statementRegion()).findByText(/could not be loaded/i),
    ).toBeInTheDocument();
    expect(statementGets('lc-3')).toBe(1);
    expect(calls('POST', '/statement/fetch')).toHaveLength(0);
  });

  it('pasted text renders as plain text', async () => {
    await start(pasted, json(pasted));
    expect(
      await within(statementRegion()).findByText(
        /my own notes on the problem/i,
      ),
    ).toBeInTheDocument();
    expect(card()).not.toHaveTextContent('class Solution');
  });

  it('a custom problem renders its own statement as text and is never fetched', async () => {
    await start(custom, json(custom));
    expect(
      await within(statementRegion()).findByText(custom.text),
    ).toBeInTheDocument();
    expect(calls('POST', '/statement/fetch')).toHaveLength(0);
  });

  it('a custom problem without a statement points to the Notes page', async () => {
    await start(custom, json({ ...custom, state: 'unavailable', text: null }));
    expect(
      await within(statementRegion()).findByText(/no statement yet/i),
    ).toBeInTheDocument();
    expect(
      within(statementRegion()).getByRole('link', {
        name: /add it from the notes page/i,
      }),
    ).toHaveAttribute('href', `/notes/${custom.id}`);
  });
});

describe('Quiz card: question changes', () => {
  const next = { ...premium, id: 'lc-253', title: 'Meeting Rooms II' };

  it('ignores a late reply for the previous question (no flicker of the wrong problem)', async () => {
    const user = userEvent.setup();
    const late = deferred();
    server.answers = [
      json({
        verdict: 'correct',
        feedback: 'Nice.',
        terminal: true,
        complete: false,
        session: STATE(1),
        question: questionOf(next),
      }),
    ];
    server.gets[next.id] = json(premium);
    await start(ready, () => late.reply);

    await user.type(screen.getByLabelText(/your answer/i), 'sliding window');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await within(card()).findByText('Meeting Rooms II');
    expect(
      await within(statementRegion()).findByText(/premium problem/i),
    ).toBeInTheDocument();

    // The previous question's GET resolves only now.
    late.resolve(json(ready));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(statementRegion()).queryByTestId('statement')).toBeNull();
    expect(statementRegion()).not.toHaveTextContent('Example 1:');
    expect(statementRegion()).toHaveTextContent(/premium problem/i);
  });

  it('an on_track probe keeps the statement and does not refetch it', async () => {
    const user = userEvent.setup();
    server.answers = [
      json({
        verdict: 'on_track',
        feedback: 'What about repeats?',
        terminal: false,
        session: STATE(),
        question: questionOf(ready, 'What about repeats?'),
      }),
    ];
    await start(ready, json(ready));
    await within(statementRegion()).findByTestId('statement');
    expect(statementGets('lc-3')).toBe(1);

    await user.type(screen.getByLabelText(/your answer/i), 'two pointers');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));
    expect(await screen.findByText(/on the right track/i)).toBeInTheDocument();

    expect(
      within(statementRegion()).getByTestId('statement'),
    ).toBeInTheDocument();
    expect(statementGets('lc-3')).toBe(1);
    expect(calls('POST', '/statement/fetch')).toHaveLength(0);
  });
});

describe('Quiz card: Hide problem / Show problem', () => {
  it('is open by default, collapses and expands, keeps focus, and is remembered across questions', async () => {
    const user = userEvent.setup();
    server.answers = [
      json({
        verdict: 'incorrect',
        feedback: 'Not quite.',
        terminal: true,
        complete: false,
        session: STATE(1),
        question: questionOf(disabled),
      }),
    ];
    server.gets[disabled.id] = json(disabled);
    await start(ready, json(ready));
    await within(statementRegion()).findByTestId('statement');

    const hide = within(card()).getByRole('button', { name: 'Hide problem' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', statementRegion().id);
    expect(statementRegion()).toBeVisible();

    await user.click(hide);
    const show = within(card()).getByRole('button', { name: 'Show problem' });
    expect(show).toBe(hide);
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveFocus();
    expect(statementRegion()).not.toBeVisible();

    // The choice survives the next question.
    await user.type(screen.getByLabelText(/your answer/i), 'brute force');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));
    await within(card()).findByText(disabled.title);
    expect(
      within(card()).getByRole('button', { name: 'Show problem' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(statementRegion()).not.toBeVisible();

    // Keyboard: Enter on the button expands it again.
    within(card()).getByRole('button', { name: 'Show problem' }).focus();
    await user.keyboard('{Enter}');
    expect(
      within(card()).getByRole('button', { name: 'Hide problem' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(statementRegion()).toBeVisible();
    expect(
      await within(statementRegion()).findByText(/fetching is turned off/i),
    ).toBeInTheDocument();
  });
});

describe('Quiz grader request is unchanged (ADR 0012 D2 prompt diet)', () => {
  it('POST /api/quiz/answer sends only { answer, problemId }, never the statement', async () => {
    const user = userEvent.setup();
    server.answers = [
      json({
        verdict: 'correct',
        feedback: 'Good.',
        terminal: true,
        complete: true,
        session: { ...STATE(3), status: 'complete' },
        question: null,
      }),
    ];
    await start(ready, json(ready));
    await within(statementRegion()).findByTestId('statement');

    await user.type(screen.getByLabelText(/your answer/i), 'sliding window');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));
    await waitFor(() =>
      expect(calls('POST', '/api/quiz/answer')).toHaveLength(1),
    );

    const [init] = calls('POST', '/api/quiz/answer');
    expect(JSON.parse(String(init?.body))).toEqual({
      answer: 'sliding window',
      problemId: 'lc-3',
    });
    expect(String(init?.body)).not.toContain('Example');
  });
});
