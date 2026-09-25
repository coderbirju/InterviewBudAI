import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Interview } from './Interview';
import * as api from '../lib/api';
import type {
  QuizAnswerResult,
  QuizSessionResult,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getQuizSession.mockResolvedValue(NO_SESSION);
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

    // Verdict shown.
    expect(await screen.findByText(/Correct/)).toBeInTheDocument();
    expect(
      screen.getByText('Great — a hash map in one pass.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Consider the space tradeoff.'),
    ).toBeInTheDocument();
    // Advanced to the next question + progress incremented.
    expect(
      await screen.findByText('A second wrapped question.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 / 3 answered')).toBeInTheDocument();
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

    expect(await screen.findByText(/marked for revisit/i)).toBeInTheDocument();
    expect(
      screen.getByText('That misses the sorted-array insight.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Next wrapped question.'),
    ).toBeInTheDocument();
  });

  it('an on_track verdict stays on the same question and shows the probe', async () => {
    const user = userEvent.setup();
    mockedApi.startQuiz.mockResolvedValue(START_OK);
    mockedApi.answerQuiz.mockResolvedValue({
      verdict: 'on_track',
      feedback: 'Good start — what is the time complexity?',
      terminal: false,
      session: STATE({ index: 0, answered: 0 }),
      question: {
        problemId: 'lc-1',
        wrapped: 'Good start — what is the time complexity?',
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
});
