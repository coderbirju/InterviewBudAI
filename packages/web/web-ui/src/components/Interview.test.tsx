import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Interview } from './Interview';
import * as api from '../lib/api';
import type {
  QuizAnswerResult,
  QuizSessionResult,
  QuizSessionSummary,
  QuizStartResult,
  QuizState,
} from '../lib/api';

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    getQuizSession: vi.fn(),
    startQuiz: vi.fn(),
    answerQuiz: vi.fn(),
    newQuiz: vi.fn(),
    listQuizSessions: vi.fn(),
    endQuiz: vi.fn(),
    resumeQuiz: vi.fn(),
    deleteQuizSession: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const STATE = (over: Partial<QuizState> = {}): QuizState => ({
  sessionId: 's1',
  deckSize: 3,
  index: 0,
  answered: 0,
  status: 'active',
  ...over,
});

const NO_SESSION: QuizSessionResult = { active: false };

const ACTIVE_SESSION: QuizSessionResult = {
  active: true,
  session: STATE({ index: 1, answered: 1 }),
  question: {
    problemId: 'lc-1',
    wrapped: 'Find two numbers that sum to a target.',
  },
  transcript: [
    {
      role: 'assistant',
      content: 'A prior wrapped question.',
      at: '2026-01-01T00:00:00Z',
    },
    { role: 'user', content: 'My prior answer.', at: '2026-01-01T00:01:00Z' },
  ],
};

const START_OK: QuizStartResult = {
  empty: false,
  session: STATE(),
  question: { problemId: 'lc-1', wrapped: 'A wrapped question about arrays.' },
};

const START_EMPTY: QuizStartResult = {
  empty: true,
  message: 'mark problems complete first',
};

const SUMMARY = (
  over: Partial<QuizSessionSummary> = {},
): QuizSessionSummary => ({
  sessionId: 'sess-1',
  createdAt: '2026-01-01T00:00:00Z',
  status: 'complete',
  deckSize: 3,
  answeredCount: 3,
  correctCount: 2,
  isActive: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getQuizSession.mockResolvedValue(NO_SESSION);
  mockedApi.listQuizSessions.mockResolvedValue({ sessions: [] });
});

describe('Quickfire Quiz Master', () => {
  it('resumes an active session: shows its current question + progress', async () => {
    mockedApi.getQuizSession.mockResolvedValue(ACTIVE_SESSION);

    render(<Interview />);

    expect(
      await screen.findByText('Find two numbers that sum to a target.'),
    ).toBeInTheDocument();
    // Progress reflects the resumed session (answered / deckSize).
    expect(screen.getByText('1 / 3 answered')).toBeInTheDocument();
    // Answer composer is present.
    expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument();
  });

  it('with no active session, shows a Start quiz entry that calls startQuiz', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_OK);

    render(<Interview />);

    const startBtn = await screen.findByRole('button', { name: /start quiz/i });
    expect(startBtn).toBeInTheDocument();

    await user.click(startBtn);

    expect(mockedApi.startQuiz).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText('A wrapped question about arrays.'),
    ).toBeInTheDocument();
  });

  it('shows the empty-deck state with a link Home when start returns empty', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_EMPTY);

    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );

    expect(
      await screen.findByText(/mark some problems as/i),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /go to the catalog/i });
    expect(link).toHaveAttribute('href', '/');
  });

  it('shows the configure-a-model state on a provider-required 400', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockRejectedValue(
      new api.ApiError('no model configured', 400),
    );

    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );

    expect(
      await screen.findByText(/configure a model to start/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/IBAI_OLLAMA_MODEL/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /open settings/i }),
    ).toHaveAttribute('href', '/settings');
  });

  it('submitting a correct answer shows Correct + advances to the next question + increments progress', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_OK);
    const answerResult: QuizAnswerResult = {
      verdict: 'correct',
      feedback: 'Great — a hash map in one pass.',
      optimalNudge: 'Consider the space tradeoff.',
      terminal: true,
      complete: false,
      session: STATE({ index: 1, answered: 1 }),
      question: { problemId: 'lc-2', wrapped: 'A second wrapped question.' },
    };
    mockedApi.answerQuiz.mockResolvedValue(answerResult);

    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );
    await screen.findByText('A wrapped question about arrays.');

    await user.type(screen.getByLabelText(/your answer/i), 'Use a hash map');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    // Advanced to the next question + progress incremented. On advance the
    // prior verdict card is cleared (quiz-fix-a Fix 3): the fresh question must
    // not carry the previous answer's verdict/feedback.
    expect(
      await screen.findByText('A second wrapped question.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 / 3 answered')).toBeInTheDocument();
    expect(screen.queryByText('Great — a hash map in one pass.')).toBeNull();
    expect(screen.queryByText('Consider the space tradeoff.')).toBeNull();
  });

  it('submitting an incorrect answer shows revisit + advances', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_OK);
    mockedApi.answerQuiz.mockResolvedValue({
      verdict: 'incorrect',
      feedback: 'That misses the sorted-array insight.',
      terminal: true,
      complete: false,
      session: STATE({ index: 1, answered: 1 }),
      question: { problemId: 'lc-2', wrapped: 'Next wrapped question.' },
    });

    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );
    await screen.findByText('A wrapped question about arrays.');

    await user.type(
      screen.getByLabelText(/your answer/i),
      'Brute force nested loops',
    );
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    // Advanced to the next question; the prior verdict card is cleared on
    // advance (quiz-fix-a Fix 3) so it does not linger over the fresh question.
    expect(
      await screen.findByText('Next wrapped question.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/marked for revisit/i)).toBeNull();
    expect(
      screen.queryByText('That misses the sorted-array insight.'),
    ).toBeNull();
  });

  it('clears the prior verdict card when the next question renders (quiz-fix-a Fix 3)', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_OK);
    // First answer: correct, advances to a second question.
    mockedApi.answerQuiz.mockResolvedValueOnce({
      verdict: 'correct',
      feedback: 'First verdict feedback text.',
      terminal: true,
      complete: false,
      session: STATE({ index: 1, answered: 1 }),
      question: { problemId: 'lc-2', wrapped: 'The second wrapped question.' },
    });

    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );
    await screen.findByText('A wrapped question about arrays.');

    await user.type(screen.getByLabelText(/your answer/i), 'Use a hash map');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    // Next question is shown …
    expect(
      await screen.findByText('The second wrapped question.'),
    ).toBeInTheDocument();
    // … and the PRIOR verdict card is gone (no lingering "Correct" / feedback).
    expect(screen.queryByText('First verdict feedback text.')).toBeNull();
    expect(screen.queryByText(/^Correct/)).toBeNull();
  });

  it('an on_track verdict stays on the same question and shows the probe', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_OK);
    mockedApi.answerQuiz.mockResolvedValue({
      verdict: 'on_track',
      feedback: 'Good start — what is the time complexity?',
      terminal: false,
      session: STATE({ index: 0, answered: 0 }),
      // The server keeps the problem in `question` and sends the probe apart.
      question: {
        problemId: 'lc-1',
        wrapped: 'A wrapped question about arrays.',
        probe: 'Good start — what is the time complexity?',
      },
    });

    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );
    await screen.findByText('A wrapped question about arrays.');

    await user.type(screen.getByLabelText(/your answer/i), 'A hash map');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    // Probe shown, same question still present, progress unchanged.
    expect(await screen.findByText(/on the right track/i)).toBeInTheDocument();
    expect(
      screen.getByText('A wrapped question about arrays.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Good start — what is the time complexity?'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 / 3 answered')).toBeInTheDocument();
  });

  it('completes the deck: shows the summary + a New session button that calls newQuiz', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_OK);
    mockedApi.answerQuiz.mockResolvedValue({
      verdict: 'correct',
      feedback: 'Nailed it.',
      terminal: true,
      complete: true,
      session: STATE({ index: 3, answered: 3, status: 'complete' }),
      question: null,
    });
    mockedApi.newQuiz.mockResolvedValue({
      empty: false,
      session: STATE(),
      question: { problemId: 'lc-9', wrapped: 'A brand-new question.' },
    });

    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );
    await screen.findByText('A wrapped question about arrays.');

    await user.type(screen.getByLabelText(/your answer/i), 'final answer');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();

    const newBtn = screen.getByRole('button', { name: /new session/i });
    await user.click(newBtn);
    expect(mockedApi.newQuiz).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText('A brand-new question.'),
    ).toBeInTheDocument();
  });

  it('on an answer error shows an inline banner and PRESERVES the question', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_OK);
    mockedApi.answerQuiz.mockRejectedValue(
      new api.ApiError('The model returned an unusable verdict.', 502),
    );

    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );
    await screen.findByText('A wrapped question about arrays.');

    await user.type(screen.getByLabelText(/your answer/i), 'my approach');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /unusable verdict/i,
    );
    // The current question is still visible — nothing lost, no crash.
    expect(
      screen.getByText('A wrapped question about arrays.'),
    ).toBeInTheDocument();
  });

  it('on a 409 (shown card deleted) sends problemId, shows the next card and a not-graded notice', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_OK);
    mockedApi.answerQuiz.mockRejectedValue(
      new api.ApiError('question changed', 409),
    );

    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );
    await screen.findByText('A wrapped question about arrays.');
    mockedApi.getQuizSession.mockResolvedValue(ACTIVE_SESSION);

    await user.type(screen.getByLabelText(/your answer/i), 'my approach');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    expect(mockedApi.answerQuiz).toHaveBeenCalledWith('my approach', 'lc-1');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That question changed — your answer wasn't graded. Here's the current one.",
    );
    expect(
      await screen.findByText('Find two numbers that sum to a target.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('A wrapped question about arrays.'),
    ).not.toBeInTheDocument();
  });

  it('renders model text as plain text (XSS-safe via JSX, no HTML injection)', async () => {
    const user = userEvent.setup();
    const payload = '<img src=x onerror="alert(1)">';
    mockedApi.startQuiz.mockResolvedValue({
      empty: false,
      session: STATE(),
      question: { problemId: 'lc-1', wrapped: payload },
    });

    const { container } = render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );

    // The payload appears as literal text, not an injected element.
    expect(await screen.findByText(payload)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows an empty sessions-list state when idle with no past sessions', async () => {
    render(<Interview />);
    // Idle Start entry is shown, plus the (empty) sessions list.
    await screen.findByRole('button', { name: /start quiz/i });
    expect(await screen.findByText(/your sessions/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/no past sessions yet/i),
    ).toBeInTheDocument();
  });

  it('renders the sessions list with Resume + Delete for each session', async () => {
    mockedApi.listQuizSessions.mockResolvedValue({
      sessions: [SUMMARY({ sessionId: 'sess-1' })],
    });

    render(<Interview />);

    expect(await screen.findByText(/3 \/ 3 answered/)).toBeInTheDocument();
    expect(screen.getByText(/2 correct/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete session/i }),
    ).toBeInTheDocument();
  });

  it('End session ends the active quiz and returns to the list with the ended session', async () => {
    const user = userEvent.setup();
    mockedApi.getQuizSession.mockResolvedValue(ACTIVE_SESSION);
    mockedApi.endQuiz.mockResolvedValue({
      ok: true,
      session: STATE({ status: 'complete' }),
    });
    // After ending, the list shows the just-ended session.
    mockedApi.listQuizSessions.mockResolvedValue({
      sessions: [SUMMARY({ sessionId: 's1', status: 'complete' })],
    });

    render(<Interview />);
    // Active session resumed → End session button visible.
    const endBtn = await screen.findByRole('button', {
      name: /end session/i,
    });
    await user.click(endBtn);

    expect(mockedApi.endQuiz).toHaveBeenCalledTimes(1);
    // Back on the idle/list view with the ended session listed.
    expect(await screen.findByText(/your sessions/i)).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /resume/i }),
    ).toBeInTheDocument();
  });

  it('Resume re-activates a listed session and shows its question', async () => {
    const user = userEvent.setup();
    mockedApi.listQuizSessions.mockResolvedValue({
      sessions: [SUMMARY({ sessionId: 'sess-1' })],
    });
    mockedApi.resumeQuiz.mockResolvedValue({
      ok: true,
      session: STATE({ sessionId: 'sess-1', index: 2, answered: 2 }),
      question: { problemId: 'lc-7', wrapped: 'A resumed wrapped question.' },
      transcript: [],
    });

    render(<Interview />);
    const resumeBtn = await screen.findByRole('button', { name: /resume/i });
    await user.click(resumeBtn);

    expect(mockedApi.resumeQuiz).toHaveBeenCalledWith('sess-1');
    expect(
      await screen.findByText('A resumed wrapped question.'),
    ).toBeInTheDocument();
    // Now in the active view — the End session control is present.
    expect(
      screen.getByRole('button', { name: /end session/i }),
    ).toBeInTheDocument();
  });

  it('Delete removes the row after confirm', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockedApi.listQuizSessions
      .mockResolvedValueOnce({ sessions: [SUMMARY({ sessionId: 'sess-1' })] })
      .mockResolvedValue({ sessions: [] });
    mockedApi.deleteQuizSession.mockResolvedValue({ ok: true });

    render(<Interview />);
    const delBtn = await screen.findByRole('button', {
      name: /delete session/i,
    });
    await user.click(delBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockedApi.deleteQuizSession).toHaveBeenCalledWith('sess-1');
    // Row removed → empty state shows.
    expect(
      await screen.findByText(/no past sessions yet/i),
    ).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('Delete is cancelled when the confirm is declined', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockedApi.listQuizSessions.mockResolvedValue({
      sessions: [SUMMARY({ sessionId: 'sess-1' })],
    });

    render(<Interview />);
    const delBtn = await screen.findByRole('button', {
      name: /delete session/i,
    });
    await user.click(delBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockedApi.deleteQuizSession).not.toHaveBeenCalled();
    // Row still present.
    expect(screen.getByText(/3 \/ 3 answered/)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});

describe('Quiz reliability (W1) — catalog question card', () => {
  const CATALOG_Q = {
    problemId: 'lc-1',
    wrapped: 'Two Sum (easy)',
    title: 'Two Sum',
    difficulty: 'easy',
    url: 'https://leetcode.com/problems/two-sum/',
  };

  it('idle copy describes real problems, not rephrasings', async () => {
    render(<Interview />);
    await screen.findByRole('button', { name: /start quiz/i });
    expect(screen.queryByText(/rephrasing/i)).toBeNull();
    expect(
      screen.getByText(/shown each real problem and asked to explain/i),
    ).toBeInTheDocument();
  });

  it('shows the title, a difficulty badge and a safe external problem link', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue({
      empty: false,
      session: STATE(),
      question: CATALOG_Q,
    });
    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );

    expect(await screen.findByText('Two Sum')).toBeInTheDocument();
    expect(screen.getByText('Easy')).toHaveClass('text-difficulty-easy');
    const link = screen.getByRole('link', { name: /open problem/i });
    expect(link).toHaveAttribute('href', CATALOG_Q.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
  });

  it('on_track keeps the problem title and shows the probe in its own card', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue({
      empty: false,
      session: STATE(),
      question: CATALOG_Q,
    });
    mockedApi.answerQuiz.mockResolvedValue({
      verdict: 'on_track',
      feedback: 'What about duplicates?',
      terminal: false,
      session: STATE(),
      question: { ...CATALOG_Q, probe: 'What about duplicates?' },
    });
    render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );
    await screen.findByText('Two Sum');
    await user.type(screen.getByLabelText(/your answer/i), 'hash map');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    expect(await screen.findByText(/on the right track/i)).toBeInTheDocument();
    const card = screen.getByRole('group', { name: /current question/i });
    expect(card).toHaveTextContent('Two Sum');
    expect(card).not.toHaveTextContent('What about duplicates?');
    expect(screen.getByText('What about duplicates?')).toBeInTheDocument();
  });

  it('a resumed session re-shows its question and any pending probe', async () => {
    mockedApi.getQuizSession.mockResolvedValue({
      active: true,
      session: STATE(),
      question: { ...CATALOG_Q, probe: 'Can you do it in one pass?' },
      transcript: [],
    });
    render(<Interview />);
    expect(await screen.findByText('Two Sum')).toBeInTheDocument();
    expect(screen.getByText(/on the right track/i)).toBeInTheDocument();
    expect(screen.getByText('Can you do it in one pass?')).toBeInTheDocument();
    expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument();
  });

  it('an active session with no question falls back to idle (never an empty active view)', async () => {
    mockedApi.getQuizSession.mockResolvedValue({
      active: true,
      session: STATE(),
      question: null,
      transcript: [],
    });
    render(<Interview />);
    expect(
      await screen.findByRole('button', { name: /start quiz/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/your answer/i)).toBeNull();
  });

  it('resuming an exhausted session shows it as complete', async () => {
    const user = userEvent.setup();
    mockedApi.listQuizSessions.mockResolvedValue({
      sessions: [SUMMARY({ sessionId: 'sess-1' })],
    });
    mockedApi.resumeQuiz.mockResolvedValue({
      ok: true,
      session: STATE({ sessionId: 'sess-1', status: 'complete' }),
      question: null,
      transcript: [],
    });
    render(<Interview />);
    await user.click(await screen.findByRole('button', { name: /resume/i }));
    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/your answer/i)).toBeNull();
  });

  it('escapes HTML in the problem title (XSS-safe via JSX)', async () => {
    const user = userEvent.setup();
    const payload = '<img src=x onerror="alert(1)">';
    mockedApi.startQuiz.mockResolvedValue({
      empty: false,
      session: STATE(),
      question: { ...CATALOG_Q, title: payload },
    });
    const { container } = render(<Interview />);
    await user.click(
      await screen.findByRole('button', { name: /start quiz/i }),
    );
    expect(await screen.findByText(payload)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
