import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  ListChecks,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Target,
  Trash2,
  Trophy,
  Zap,
} from 'lucide-react';
import {
  ApiError,
  answerQuiz,
  deleteQuizSession,
  endQuiz,
  getQuizSession,
  listQuizSessions,
  newQuiz,
  resumeQuiz,
  startQuiz,
} from '../lib/api';
import type {
  Difficulty,
  QuizAnswerResult,
  QuizQuestion,
  QuizSessionSummary,
  QuizState,
  QuizTranscriptEntry,
  QuizVerdict,
} from '../lib/api';
import { homeHref } from '../lib/router';
import { DifficultyBadge } from './DifficultyBadge';

/**
 * The Quickfire Quiz Master (ADR 0007 Q3). This SPA page at `/interview`
 * REPLACES the old generic interview chat (ADR 0005 D6 / ADR 0006 M5) with a
 * structured quiz: the model quizzes the user on the problems they marked
 * `done`, presenting each one DIRECTLY (its real title, difficulty and
 * LeetCode link from the catalog — ADR 0007 A1/A8, no hints), reads the user's
 * typed approach, and evaluates the DIRECTION of their reasoning without ever
 * handing over the answer.
 *
 * Flow (quickfire feel — question → answer → verdict → next):
 *  1. ON LOAD it calls `GET /api/quiz/session` to RESUME the single active
 *     session (current wrapped question + prior transcript + progress). With no
 *     active session it shows a "Start quiz" entry (`POST /api/quiz/start`).
 *  2. EMPTY: if the done-set is empty (`{ empty: true }`) it shows a friendly
 *     "mark some problems as Done first" state with a link Home.
 *  3. NO PROVIDER: a provider-required `400 (no model configured)` shows the
 *     "configure a model" state (same env-var guidance as the old chat).
 *  4. On submit it POSTs `/api/quiz/answer { answer }` and reflects the VERDICT:
 *     `correct` (emerald ✓ + optional optimal nudge) → advance; `incorrect`
 *     (amber "Marked for revisit" + feedback + nudge) → advance; `on_track` →
 *     show the probe and let them answer the SAME question again.
 *  5. When the deck is exhausted → a "Session complete" summary + "New session"
 *     (`POST /api/quiz/new`, reshuffle from the current done-set).
 *
 * The MODEL authors every question + verdict (charter §6.2) — this component
 * ships NO canned content. All model text renders via JSX (auto-escaped);
 * there is no `dangerouslySetInnerHTML` (charter §7.3). A failed turn shows an
 * inline banner and PRESERVES the session/transcript rather than crashing.
 */

/** The verdict + feedback of the most recent answered turn, shown as a card. */
interface VerdictCard {
  readonly verdict: QuizVerdict;
  readonly feedback: string;
  readonly optimalNudge?: string;
}

/**
 * On resume, re-show a probe already given for the current question (the
 * server's `question.probe`) as the on_track card, separate from the problem.
 */
function probeCard(question: QuizQuestion): VerdictCard | null {
  return question.probe
    ? { verdict: 'on_track', feedback: question.probe }
    : null;
}

/** A local tally of terminal verdicts, for the session-complete summary. */
interface ResultTally {
  readonly correct: number;
  readonly revisit: number;
}

/** The page phase (a small explicit state machine). */
type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'no-provider' }
  | { readonly kind: 'empty'; readonly message: string }
  | { readonly kind: 'idle' } // no active session — offer to start
  | { readonly kind: 'active' }
  | { readonly kind: 'complete' };

export function Interview(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  const [session, setSession] = useState<QuizState | null>(null);
  const [transcript, setTranscript] = useState<readonly QuizTranscriptEntry[]>(
    [],
  );
  const [verdictCard, setVerdictCard] = useState<VerdictCard | null>(null);
  const [tally, setTally] = useState<ResultTally>({ correct: 0, revisit: 0 });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session management (quiz-fix-b): the list of past + active sessions shown
  // in the idle / complete states, plus per-row busy tracking for Resume/Delete.
  const [sessions, setSessions] = useState<readonly QuizSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  /** Map a provider-required 400 to the no-provider phase; return the message. */
  const describeError = useCallback((err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.status === 400 && /no model configured/i.test(err.message)) {
        setPhase({ kind: 'no-provider' });
      }
      return err.message;
    }
    return 'Could not reach the Quiz Master. Please try again.';
  }, []);

  /** Load (or reload) the list of past + active sessions. Never throws. */
  const refreshSessions = useCallback(async (): Promise<void> => {
    setSessionsLoading(true);
    try {
      const result = await listQuizSessions();
      setSessions(result.sessions);
    } catch {
      // A list failure should not block the page; show an empty list.
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // ON LOAD: resume the active session if one exists.
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const result = await getQuizSession();
        if (cancelled) {
          return;
        }
        if (result.active && result.question) {
          setSession(result.session);
          setQuestion(result.question);
          setTranscript(result.transcript);
          setVerdictCard(probeCard(result.question));
          setPhase({ kind: 'active' });
        } else {
          setPhase({ kind: 'idle' });
          void refreshSessions();
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        // A resume failure should not hard-block — let them start a quiz. The
        // start path re-checks the provider and surfaces the same states.
        setError(describeError(err));
        setPhase((prev) =>
          prev.kind === 'no-provider' ? prev : { kind: 'idle' },
        );
        void refreshSessions();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [describeError, refreshSessions]);

  // Keep the newest content in view. Guarded for jsdom (no scrollIntoView).
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ block: 'end' });
    }
  }, [question, verdictCard, busy, phase]);

  // When a deck completes, refresh the list so the finished session shows up
  // (with a Resume button) alongside earlier ones.
  useEffect(() => {
    if (phase.kind === 'complete') {
      void refreshSessions();
    }
  }, [phase, refreshSessions]);

  /** Start (or restart) a quiz via the given loader (startQuiz | newQuiz). */
  const beginQuiz = useCallback(
    async (loader: typeof startQuiz): Promise<void> => {
      if (busy) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await loader();
        if (result.empty) {
          setPhase({ kind: 'empty', message: result.message });
          return;
        }
        // Fresh session — reset all per-session state.
        setSession(result.session);
        setQuestion(result.question);
        setTranscript([]);
        setVerdictCard(null);
        setTally({ correct: 0, revisit: 0 });
        setDraft('');
        setPhase({ kind: 'active' });
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, describeError],
  );

  const onSubmit = useCallback(async (): Promise<void> => {
    const answer = draft.trim();
    if (!answer || busy || !question) {
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const result: QuizAnswerResult = await answerQuiz(answer);
      setSession(result.session);

      if (result.verdict === 'on_track') {
        // Non-terminal: stay on the SAME question. Show the probe verdict card
        // (it belongs to the current question) and clear the draft to re-answer.
        setVerdictCard({
          verdict: result.verdict,
          feedback: result.feedback,
          ...(result.optimalNudge ? { optimalNudge: result.optimalNudge } : {}),
        });
        setDraft('');
        return;
      }

      // Terminal verdict — tally it.
      setTally((prev) =>
        result.verdict === 'correct'
          ? { ...prev, correct: prev.correct + 1 }
          : { ...prev, revisit: prev.revisit + 1 },
      );
      setDraft('');

      if (result.complete || !result.question) {
        // Session finished: the completion summary owns the screen, so the
        // per-answer verdict card must not linger.
        setVerdictCard(null);
        setQuestion(null);
        setPhase({ kind: 'complete' });
        return;
      }
      // Advance to the next wrapped question. CLEAR the prior verdict card so
      // the previous answer's verdict does not linger over the fresh question
      // (quiz-fix-a Fix 3): a new question must never show the old verdict.
      setVerdictCard(null);
      setQuestion(result.question);
    } catch (err) {
      // Preserve the session + transcript; surface an inline message.
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, question, describeError]);

  /**
   * End the active session (quiz-fix-b): persist it complete + clear the active
   * pointer server-side, then drop back to the idle view with the refreshed
   * sessions list (where the just-ended session appears with a Resume button).
   */
  const onEndSession = useCallback(async (): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await endQuiz();
      // Reset per-session view state and return to idle + list.
      setQuestion(null);
      setSession(null);
      setTranscript([]);
      setVerdictCard(null);
      setDraft('');
      setPhase({ kind: 'idle' });
      await refreshSessions();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [busy, describeError, refreshSessions]);

  /**
   * Resume a listed session (quiz-fix-b): re-activate it server-side and load
   * its current question + transcript into the active view.
   */
  const onResume = useCallback(
    async (sessionId: string): Promise<void> => {
      if (rowBusyId) {
        return;
      }
      setRowBusyId(sessionId);
      setError(null);
      try {
        const result = await resumeQuiz(sessionId);
        setSession(result.session);
        setQuestion(result.question);
        setTranscript(result.transcript);
        setDraft('');
        if (!result.question) {
          // Nothing left to answer (deck exhausted): show it as complete with
          // the tallies from its list summary — never an empty active view.
          const summary = sessions.find((s) => s.sessionId === sessionId);
          const correct = summary?.correctCount ?? 0;
          setTally({
            correct,
            revisit: Math.max(0, (summary?.answeredCount ?? 0) - correct),
          });
          setVerdictCard(null);
          setPhase({ kind: 'complete' });
          return;
        }
        setTally({ correct: 0, revisit: 0 });
        setVerdictCard(probeCard(result.question));
        setPhase({ kind: 'active' });
      } catch (err) {
        setError(describeError(err));
      } finally {
        setRowBusyId(null);
      }
    },
    [rowBusyId, sessions, describeError],
  );

  /**
   * Delete a listed session (quiz-fix-b) after a small confirm, then remove it
   * from the list (optimistically) and reconcile with a refresh.
   */
  const onDelete = useCallback(
    async (sessionId: string): Promise<void> => {
      if (rowBusyId) {
        return;
      }
      if (
        typeof window !== 'undefined' &&
        typeof window.confirm === 'function' &&
        !window.confirm('Delete this quiz session? This cannot be undone.')
      ) {
        return;
      }
      setRowBusyId(sessionId);
      setError(null);
      // Optimistic removal for immediate feedback.
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      try {
        await deleteQuizSession(sessionId);
        await refreshSessions();
      } catch (err) {
        setError(describeError(err));
        // Reconcile the list on failure (undo the optimistic removal).
        await refreshSessions();
      } finally {
        setRowBusyId(null);
      }
    },
    [rowBusyId, describeError, refreshSessions],
  );

  // ----- No provider configured -----
  if (phase.kind === 'no-provider') {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold text-slate-100">
          Configure a model to start
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          The Quiz Master needs a language model. Set{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
            ANTHROPIC_API_KEY
          </code>{' '}
          +{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
            IBAI_ANTHROPIC_MODEL
          </code>{' '}
          or{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
            IBAI_OLLAMA_MODEL
          </code>
          , then restart the server and reload this page.
        </p>
      </div>
    );
  }

  // ----- Empty done-set -----
  if (phase.kind === 'empty') {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
        <Target className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold text-slate-100">
          Build your quiz deck first
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          Mark some problems as <span className="text-emerald-400">Done</span>{' '}
          first to build your quiz deck. The Quiz Master quizzes you on the
          problems you&apos;ve completed.
        </p>
        <a
          href={homeHref()}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400"
        >
          Go to the catalog
        </a>
      </div>
    );
  }

  // ----- Loading (resolving the active session) -----
  if (phase.kind === 'loading') {
    return (
      <div
        className="flex items-center gap-2 text-slate-400"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Preparing your quiz…
      </div>
    );
  }

  // ----- Idle (no active session) — offer to start -----
  if (phase.kind === 'idle') {
    return (
      <div className="space-y-6">
        {error && <InlineError message={error} />}
        <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
          <Zap className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
          <h2 className="mt-4 text-xl font-semibold text-slate-100">
            Quickfire Quiz Master
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            A rapid drill over the problems you&apos;ve marked Done. You&apos;ll
            be shown each real problem and asked to explain your approach, then
            get a direction check. No answers handed over.
          </p>
          <button
            type="button"
            onClick={() => void beginQuiz(startQuiz)}
            disabled={busy}
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Zap className="h-4 w-4" aria-hidden />
            )}
            Start quiz
          </button>
        </div>
        <SessionsList
          sessions={sessions}
          loading={sessionsLoading}
          rowBusyId={rowBusyId}
          onResume={(id) => void onResume(id)}
          onDelete={(id) => void onDelete(id)}
        />
      </div>
    );
  }

  // ----- Session complete -----
  if (phase.kind === 'complete') {
    const total = tally.correct + tally.revisit;
    return (
      <div className="space-y-6">
        {error && <InlineError message={error} />}
        <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
          <Trophy className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
          <h2 className="mt-4 text-xl font-semibold text-slate-100">
            Session complete
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            You answered {total} question{total === 1 ? '' : 's'} in this deck.
          </p>
          <div className="mx-auto mt-5 flex max-w-xs items-center justify-center gap-4">
            <div className="flex-1 rounded-lg border border-status-done/40 bg-status-done/10 p-3">
              <div className="text-2xl font-bold text-status-done">
                {tally.correct}
              </div>
              <div className="text-xs uppercase tracking-wide text-slate-400">
                Correct
              </div>
            </div>
            <div className="flex-1 rounded-lg border border-status-revisit/40 bg-status-revisit/10 p-3">
              <div className="text-2xl font-bold text-status-revisit">
                {tally.revisit}
              </div>
              <div className="text-xs uppercase tracking-wide text-slate-400">
                To revisit
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void beginQuiz(newQuiz)}
            disabled={busy}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden />
            )}
            New session
          </button>
        </div>
        <SessionsList
          sessions={sessions}
          loading={sessionsLoading}
          rowBusyId={rowBusyId}
          onResume={(id) => void onResume(id)}
          onDelete={(id) => void onDelete(id)}
        />
      </div>
    );
  }

  // ----- Active session -----
  const progressLabel = session
    ? `${session.answered} / ${session.deckSize} answered`
    : '';
  const progressPercent =
    session && session.deckSize > 0
      ? Math.round((session.answered / session.deckSize) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Active-session header: progress + End session control. */}
      <div className="flex items-center justify-between gap-3">
        {session ? (
          <div
            className="min-w-0 flex-1"
            aria-label="Quiz progress"
            role="group"
          >
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                Quickfire quiz
              </span>
              <span>{progressLabel}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <button
          type="button"
          onClick={() => void onEndSession()}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-all duration-200 hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Square className="h-3.5 w-3.5" aria-hidden />
          End session
        </button>
      </div>

      {/* Prior transcript (resumed sessions / earlier turns this session). */}
      {transcript.length > 0 && <TranscriptHistory entries={transcript} />}

      {/* Current question: the real problem from the catalog (JSX-escaped). */}
      {question && <QuestionCard question={question} session={session} />}

      {/* Verdict card for the most recent answered turn. */}
      {verdictCard && <VerdictBlock card={verdictCard} />}

      {/* Inline error (preserves the session/transcript). */}
      {error && <InlineError message={error} />}

      {/* Evaluating indicator. */}
      {busy && (
        <div
          className="flex items-center gap-2 text-sm text-slate-400"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Evaluating your answer…
        </div>
      )}

      {/* Answer composer. */}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <label htmlFor="quiz-answer" className="sr-only">
          Your answer
        </label>
        <textarea
          id="quiz-answer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter inserts a newline.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSubmit();
            }
          }}
          rows={3}
          placeholder="Type your approach — the pattern, the data structure, the key steps…"
          className="min-h-[3rem] w-full resize-y rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ArrowRight className="h-4 w-4" aria-hidden />
            )}
            Submit answer
          </button>
        </div>
      </form>

      <div ref={scrollAnchorRef} />
    </div>
  );
}

/**
 * Normalise the catalog difficulty (`'easy'|'medium'|'hard'`, any case) to the
 * badge's `Easy|Medium|Hard`; `null` when absent/unknown (no badge shown).
 */
function displayDifficulty(raw: string | undefined): Difficulty | null {
  switch ((raw ?? '').toLowerCase()) {
    case 'easy':
      return 'Easy';
    case 'medium':
      return 'Medium';
    case 'hard':
      return 'Hard';
    default:
      return null;
  }
}

/**
 * The current question card: the real problem title, its difficulty badge and
 * an external link to the problem (new tab, `rel="noopener noreferrer"`). The
 * title stays put across an `on_track` probe — the probe renders separately in
 * the verdict card. Falls back to `wrapped` for older payloads. JSX-escaped.
 */
function QuestionCard({
  question,
  session,
}: {
  readonly question: QuizQuestion;
  readonly session: QuizState | null;
}): JSX.Element {
  const difficulty = displayDifficulty(question.difficulty);
  return (
    <div
      className="rounded-xl border border-slate-800 bg-slate-800/60 p-5"
      aria-label="Current question"
      role="group"
    >
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-emerald-400">
        Question {session ? session.index + 1 : ''}
        {session ? ` of ${session.deckSize}` : ''}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <p className="whitespace-pre-wrap text-base font-semibold text-slate-100">
          {question.title ?? question.wrapped}
        </p>
        {difficulty && <DifficultyBadge difficulty={difficulty} />}
      </div>
      {question.url && (
        <a
          href={question.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-emerald-400 transition-all duration-200 hover:text-emerald-300"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Open problem
        </a>
      )}
      <p className="mt-3 text-sm text-slate-400">
        Explain your approach — the pattern, the data structure, the key steps.
      </p>
    </div>
  );
}

/**
 * The verdict card for the most recent answered turn. `correct` is emerald
 * (Correct ✓), `incorrect` is amber (Marked for revisit), `on_track` is a
 * neutral slate probe prompting the user to refine and answer again. Feedback +
 * optional optimal nudge render via JSX (auto-escaped), never as HTML.
 */
function VerdictBlock({ card }: { readonly card: VerdictCard }): JSX.Element {
  if (card.verdict === 'correct') {
    return (
      <div
        role="status"
        className="rounded-xl border border-status-done/40 bg-status-done/10 p-4"
      >
        <p className="flex items-center gap-2 font-semibold text-status-done">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          Correct ✓
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
          {card.feedback}
        </p>
        {card.optimalNudge && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">
            {card.optimalNudge}
          </p>
        )}
      </div>
    );
  }

  if (card.verdict === 'incorrect') {
    return (
      <div
        role="status"
        className="rounded-xl border border-status-revisit/40 bg-status-revisit/10 p-4"
      >
        <p className="flex items-center gap-2 font-semibold text-status-revisit">
          <AlertTriangle className="h-5 w-5" aria-hidden />
          Marked for revisit
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
          {card.feedback}
        </p>
        {card.optimalNudge && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">
            {card.optimalNudge}
          </p>
        )}
      </div>
    );
  }

  // on_track — non-terminal probe, same question stays.
  return (
    <div
      role="status"
      className="rounded-xl border border-slate-700 bg-slate-800/60 p-4"
    >
      <p className="flex items-center gap-2 font-semibold text-slate-200">
        <Sparkles className="h-5 w-5 text-emerald-400" aria-hidden />
        On the right track — keep going
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">
        {card.feedback}
      </p>
      {card.optimalNudge && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">
          {card.optimalNudge}
        </p>
      )}
    </div>
  );
}

/**
 * A compact history of earlier turns in the session (shown mainly after a
 * resume). Kept intentionally lightweight to preserve the quickfire feel — the
 * live interaction is driven by the current question + verdict card, not a
 * scrolling chat. All content renders via JSX (auto-escaped), never as HTML.
 */
function TranscriptHistory({
  entries,
}: {
  readonly entries: readonly QuizTranscriptEntry[];
}): JSX.Element {
  return (
    <details className="rounded-xl border border-slate-800 bg-slate-800/30 p-4">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">
        Earlier in this session
      </summary>
      <ol className="mt-3 space-y-3">
        {entries.map((entry, i) => (
          <li key={i} className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              {entry.role === 'user' ? 'You' : 'Quiz Master'}
            </span>
            <p className="whitespace-pre-wrap text-slate-300">
              {entry.content}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** A dismissible-looking inline error banner that never loses the session. */
function InlineError({ message }: { readonly message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-status-blocked/40 bg-status-blocked/10 p-4 text-slate-200"
    >
      <AlertTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-status-blocked"
        aria-hidden
      />
      <div>
        <p className="font-semibold">Something went wrong</p>
        <p className="mt-1 text-sm text-slate-400">{message}</p>
      </div>
    </div>
  );
}

/**
 * The list of past + active quiz sessions (quiz-fix-b). Each row shows the
 * created time, progress (answered/deckSize), correct tally, and status, with a
 * Resume button (re-activates + continues) and a Delete button (with a confirm
 * handled by the caller). All text renders via JSX (auto-escaped); no HTML
 * injection. Empty + loading states are handled gracefully.
 */
function SessionsList({
  sessions,
  loading,
  rowBusyId,
  onResume,
  onDelete,
}: {
  readonly sessions: readonly QuizSessionSummary[];
  readonly loading: boolean;
  readonly rowBusyId: string | null;
  readonly onResume: (sessionId: string) => void;
  readonly onDelete: (sessionId: string) => void;
}): JSX.Element {
  return (
    <section aria-label="Past sessions" className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
        <ListChecks className="h-4 w-4 text-emerald-500" aria-hidden />
        Your sessions
      </h3>

      {loading ? (
        <div
          className="flex items-center gap-2 text-sm text-slate-400"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading sessions…
        </div>
      ) : sessions.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-800/30 p-4 text-sm text-slate-400">
          No past sessions yet. Start a quiz to build your history.
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <SessionRow
              key={s.sessionId}
              session={s}
              busy={rowBusyId === s.sessionId}
              disabled={rowBusyId !== null && rowBusyId !== s.sessionId}
              onResume={() => onResume(s.sessionId)}
              onDelete={() => onDelete(s.sessionId)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A single session row/card in the {@link SessionsList}. */
function SessionRow({
  session,
  busy,
  disabled,
  onResume,
  onDelete,
}: {
  readonly session: QuizSessionSummary;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onResume: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const progress = `${session.answeredCount} / ${session.deckSize} answered`;
  const correct = `${session.correctCount} correct`;
  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-800/40 p-3 transition-all duration-200 hover:border-slate-700">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {formatCreatedAt(session.createdAt)}
          </span>
          {session.isActive ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
              Active
            </span>
          ) : session.status === 'complete' ? (
            <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Complete
            </span>
          ) : (
            <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Paused
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-slate-300">
          {progress} · {correct}
        </p>
      </div>

      <button
        type="button"
        onClick={onResume}
        disabled={busy || disabled}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Play className="h-3.5 w-3.5" aria-hidden />
        )}
        Resume
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy || disabled}
        aria-label="Delete session"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition-all duration-200 hover:border-status-blocked/50 hover:text-status-blocked disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Delete
      </button>
    </li>
  );
}

/**
 * Format an ISO timestamp for the sessions list. Falls back to the raw string
 * if it is not a parseable date (tolerant — the value is user data).
 */
function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
