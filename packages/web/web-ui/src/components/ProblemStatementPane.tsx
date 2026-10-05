import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { ProblemStatement } from '../lib/api';
import type {
  ProblemStatementFlow,
  StatementProblem,
} from '../lib/useProblemStatement';
import { StatementView } from './StatementView';

/**
 * The statement half of the Notes split view (ADR 0015 D5): the rendered
 * statement (or pasted / custom text), a collapsed "Example test cases"
 * block, the fetched date with "Refresh", and the D1 fallback (reason,
 * "Open on LeetCode", "Paste the problem"). The title, difficulty and the
 * custom-problem actions are rendered by Notes above this, inside the same
 * region. Everything is JSX text (escaped); the tree goes through
 * `StatementView`, never through an HTML string.
 */

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition-all duration-200 hover:border-emerald-500 hover:text-emerald-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60';

/** The short reason shown above the fallback. */
export function fallbackReason(
  statement: ProblemStatement | null,
  problem: StatementProblem | null,
): string {
  if (problem === 'load_failed')
    return 'The problem statement could not be loaded';
  if (problem === 'disabled') return 'Fetching is turned off in Settings';
  if (problem === 'not_found')
    return 'LeetCode has no statement for this problem';
  if (problem === 'rate_limited') return 'Too many LeetCode fetches right now';
  if (problem === 'unreachable') return 'LeetCode could not be reached';
  if (statement?.invalidTree) return 'The saved statement could not be shown';
  switch (statement?.state) {
    case 'disabled':
      return statement.fetch.pinned
        ? 'Fetching is turned off by IBAI_LEETCODE_FETCH'
        : 'Fetching is turned off in Settings';
    case 'premium':
      return 'Premium problem';
    case 'unavailable':
      return 'LeetCode has no statement for this problem';
    default:
      return 'LeetCode could not be reached';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function PasteBox({
  onSave,
}: {
  readonly onSave: (text: string) => Promise<string | null>;
}): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() === '') return;
        setBusy(true);
        setError(null);
        void onSave(text).then((err) => {
          setBusy(false);
          setError(err);
          if (err === null) setText('');
        });
      }}
    >
      <label
        htmlFor="statement-paste"
        className="block text-sm font-semibold text-slate-300"
      >
        Paste the problem
      </label>
      <p className="mt-1 text-xs text-slate-500">
        Copy the problem text from LeetCode and paste it here. It is saved in
        your data folder and shown as plain text.
      </p>
      <textarea
        id="statement-paste"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="mt-2 w-full resize-y rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || text.trim() === ''}
          className={BUTTON}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save pasted text
        </button>
        {error && (
          <span role="alert" className="text-xs text-status-blocked">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

function OpenLink({
  url,
}: {
  readonly url: string | null;
}): JSX.Element | null {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 transition-all duration-200 hover:text-emerald-300"
    >
      Open on LeetCode
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

export function ProblemStatementPane({
  flow,
  url,
  custom,
  customStatement,
}: {
  readonly flow: ProblemStatementFlow;
  /** The catalog link (Notes knows it from the catalog when the GET fails). */
  readonly url: string | null;
  readonly custom: boolean;
  /** A custom problem's own statement, from the catalog (kept fresh on edit). */
  readonly customStatement: string | null;
}): JSX.Element {
  const { statement, phase, problem } = flow;
  const [clearError, setClearError] = useState<string | null>(null);

  if (custom) {
    const text = customStatement ?? statement?.text ?? null;
    return text ? (
      <section
        aria-label="Problem statement"
        className="rounded-md border border-slate-800 bg-slate-800/30 px-4 py-3"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Problem statement
        </h2>
        {/* Plain text via JSX (escaped); line breaks kept by CSS. */}
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-200">
          {text}
        </p>
      </section>
    ) : (
      <p className="text-sm text-slate-400">
        This problem has no statement yet. Use Edit to add one.
      </p>
    );
  }

  if (phase !== 'done') {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">
          {phase === 'fetching'
            ? 'Fetching the problem from LeetCode…'
            : 'Loading the problem…'}
        </span>
        <div className="h-4 w-3/4 animate-pulse rounded bg-slate-800" />
        <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-slate-800" />
        <div className="h-24 w-full animate-pulse rounded bg-slate-800" />
      </div>
    );
  }

  const link = statement?.url ?? url;
  const canFetch = statement !== null && statement.fetch.enabled;
  const refresh = canFetch ? (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
      {statement?.fetchedAt && (
        <span>Fetched {formatDate(statement.fetchedAt)}</span>
      )}
      <button
        type="button"
        onClick={() => void flow.refresh()}
        disabled={flow.refreshing}
        className={BUTTON}
      >
        {flow.refreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        )}
        Refresh
      </button>
      <span role="status" aria-live="polite" className="text-status-blocked">
        {flow.refreshError}
      </span>
    </div>
  ) : null;

  const examples = statement?.exampleTestcases ? (
    <details className="mt-4 rounded-md border border-slate-800 bg-slate-800/30 px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-slate-400">
        Example test cases
      </summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-slate-300">
        {statement.exampleTestcases}
      </pre>
    </details>
  ) : null;

  const fallback = (reason: string): ReactNode => (
    <div>
      <p className="flex items-start gap-2 text-sm text-slate-300">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-status-revisit"
          aria-hidden
        />
        {reason}
      </p>
      <div className="mt-2">
        <OpenLink url={link} />
      </div>
      <PasteBox onSave={flow.paste} />
    </div>
  );

  // Pasted text wins over a fetched statement (D1).
  if (problem === null && statement?.source === 'pasted' && statement.text) {
    return (
      <div>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-200">
          {statement.text}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <OpenLink url={link} />
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              setClearError(null);
              void flow.paste('').then(setClearError);
            }}
          >
            Remove pasted text
          </button>
          {clearError && (
            <span role="alert" className="text-xs text-status-blocked">
              {clearError}
            </span>
          )}
        </div>
        {examples}
        {refresh}
      </div>
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
            This statement was cut short. Open it on LeetCode for the full text.
          </p>
        )}
        <StatementView
          blocks={statement.blocks}
          fallback={fallback('The saved statement could not be shown')}
        />
        <div className="mt-3">
          <OpenLink url={link} />
        </div>
        {examples}
        {refresh}
      </div>
    );
  }

  return (
    <div>
      {fallback(fallbackReason(statement, problem))}
      {refresh}
    </div>
  );
}
