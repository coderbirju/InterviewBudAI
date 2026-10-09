import { AlertTriangle } from 'lucide-react';
import { useProblemStatement } from '../lib/useProblemStatement';
import { isPlainClick, navigate, notesHref } from '../lib/router';
import { fallbackReason } from './ProblemStatementPane';
import { StatementView } from './StatementView';

/**
 * The problem statement on the quiz question card (ADR 0007 amendment
 * 2026-10-08). It reuses the Notes flow as is: `useProblemStatement` (the
 * cached `GET …/statement`, one `POST …/statement/fetch` only when the GET
 * says `not-cached` and fetching is on, a single 429 retry) and the same
 * `StatementView` renderer. Display only: the statement is never sent to the
 * model (ADR 0012 D2, ADR 0015 D1).
 *
 * Unlike Notes there is no paste box, no Refresh and no starter code. The
 * fallback is a short reason plus a link to the Notes page, where the user
 * can paste the problem. The card's own "Open problem" link stays above.
 *
 * The parent keys this component by problem id, so a new question mounts a
 * fresh flow (no stale statement is shown) and the hook's cleanup drops any
 * reply that arrives for the previous question.
 */
export function QuizStatement({
  problemId,
}: {
  readonly problemId: string;
}): JSX.Element {
  const { statement, phase, problem } = useProblemStatement(problemId);

  if (phase !== 'done') {
    return (
      <div role="status" aria-live="polite" className="space-y-2">
        <span className="sr-only">
          {phase === 'fetching'
            ? 'Fetching the problem from LeetCode…'
            : 'Loading the problem…'}
        </span>
        <div className="h-3 w-3/4 animate-pulse rounded bg-slate-800" />
        <div className="h-3 w-full animate-pulse rounded bg-slate-800" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-slate-800" />
      </div>
    );
  }

  const notesLink = (
    <a
      href={notesHref(problemId)}
      onClick={(e) => {
        if (isPlainClick(e)) {
          e.preventDefault();
          navigate(notesHref(problemId));
        }
      }}
      className="font-medium text-emerald-400 transition-all duration-200 hover:text-emerald-300"
    >
      Add it from the Notes page
    </a>
  );

  const fallback = (reason: string): JSX.Element => (
    <p className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm text-slate-400">
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-status-revisit"
        aria-hidden
      />
      <span>{reason}.</span>
      {notesLink}
    </p>
  );

  // Pasted text and custom statements are plain text (JSX-escaped), as on Notes.
  if (
    problem === null &&
    (statement?.source === 'pasted' || statement?.source === 'custom') &&
    statement.text
  ) {
    return (
      <p className="whitespace-pre-wrap break-words text-sm text-slate-300">
        {statement.text}
      </p>
    );
  }

  if (
    problem === null &&
    statement?.source === 'leetcode' &&
    statement.blocks
  ) {
    return (
      <div>
        {statement.truncated && (
          <p className="mb-2 text-xs text-status-revisit">
            This statement was cut short. Open the problem for the full text.
          </p>
        )}
        <StatementView
          blocks={statement.blocks}
          fallback={fallback('The saved statement could not be shown')}
        />
      </div>
    );
  }

  if (statement?.custom) {
    return fallback('This problem has no statement yet');
  }
  return fallback(fallbackReason(statement, problem));
}
