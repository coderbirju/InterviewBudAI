import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Sparkles,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import {
  ApiError,
  answerQuiz,
  getQuizSession,
  newQuiz,
  startQuiz,
} from '../lib/api';
import type {
  QuizAnswerResult,
  QuizQuestion,
  QuizState,
  QuizTranscriptEntry,
  QuizVerdict,
} from '../lib/api';
import { homeHref } from '../lib/router';

/**
 * The Quickfire Quiz Master (ADR 0007 Q3). This SPA page at `/interview`
 * REPLACES the old generic interview chat (ADR 0005 D6 / ADR 0006 M5) with a
 * structured quiz: the model quizzes the user on the problems they marked
 * `done`, presenting each one WRAPPED (a short rephrasing — no title, no
 * hints), reads the user's typed approach, and evaluates the DIRECTION of their
 * reasoning without ever handing over the answer.
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

  // ON LOAD: resume the active session if one exists.
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const result = await getQuizSession();
        if (cancelled) {
          return;
        }
        if (result.active) {
          setSession(result.session);
          setQuestion(result.question);
          setTranscript(result.transcript);
          setPhase({ kind: 'active' });
        } else {
          setPhase({ kind: 'idle' });
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [describeError]);

  // Keep the newest content in view. Guarded for jsdom (no scrollIntoView).
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ block: 'end' });
    }
  }, [question, verdictCard, busy, phase]);

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
      setVerdictCard({
        verdict: result.verdict,
        feedback: result.feedback,
        ...(result.optimalNudge ? { optimalNudge: result.optimalNudge } : {}),
      });

      if (result.verdict === 'on_track') {
        // Non-terminal: stay on the SAME question, clear the draft to re-answer.
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
        setQuestion(null);
        setPhase({ kind: 'complete' });
        return;
      }
      // Advance to the next wrapped question.
      setQuestion(result.question);
    } catch (err) {
      // Preserve the session + transcript; surface an inline message.
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, question, describeError]);

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
            A rapid drill over the problems you&apos;ve marked done. Each
            question is a short rephrasing — recognise the pattern, type your
            approach, get a direction check. No answers handed over.
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
      {/* Progress bar. */}
      {session && (
        <div aria-label="Quiz progress" role="group">
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
      )}

      {/* Prior transcript (resumed sessions / earlier turns this session). */}
      {transcript.length > 0 && <TranscriptHistory entries={transcript} />}

      {/* Current wrapped question (model-authored, JSX-escaped). */}
      {question && (
        <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-emerald-400">
            Question {session ? session.index + 1 : ''}
            {session ? ` of ${session.deckSize}` : ''}
          </span>
          <p className="whitespace-pre-wrap text-base text-slate-100">
            {question.wrapped}
          </p>
        </div>
      )}

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
