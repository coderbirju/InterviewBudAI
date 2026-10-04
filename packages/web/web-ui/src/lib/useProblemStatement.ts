import { useCallback, useEffect, useState } from 'react';
import {
  StatementApiError,
  fetchStatement,
  fetchStatementFromLeetcode,
  pasteStatement,
} from './api';
import type { ProblemStatement } from './api';

/**
 * The Notes page's statement flow (ADR 0015 D1/D3/D5):
 *
 *  1. `GET …/statement` (cache only).
 *  2. Only when it says `not-cached` and fetching is enabled: one
 *     `POST …/statement/fetch`. A 429 is retried ONCE after `retryAfterMs`
 *     (capped at 2 s), which covers React StrictMode's double effect; a
 *     second 429 shows the fallback.
 *  3. `phase` becomes `done` once, after the final state is known (the GET
 *     failed, or it settled without a fetch, or the fetch settled). Notes
 *     runs its template prefill / append at that point and never before.
 *
 * A failed GET is a final state too (no retry loop): the page shows the
 * link + paste fallback and the generic template.
 */

/** Why the left pane shows the fallback, when the reply alone does not say. */
export type StatementProblem =
  | 'load_failed' // the local GET failed (network or HTTP error)
  | 'disabled' // POST 403 fetch_disabled
  | 'not_found' // POST 404 not_found: same as `unavailable`
  | 'rate_limited' // a second 429
  | 'unreachable'; // 502 / 504 / network / bad reply

export type StatementPhase = 'loading' | 'fetching' | 'done';

export const RETRY_CAP_MS = 2000;

function problemOf(err: unknown): StatementProblem {
  if (err instanceof StatementApiError) {
    if (err.fetchCode === 'fetch_disabled') return 'disabled';
    if (err.fetchCode === 'not_found') return 'not_found';
    if (err.status === 429) return 'rate_limited';
  }
  return 'unreachable';
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** One POST, plus the single retry on a 429. */
async function fetchOnceWithRetry(
  problemId: string,
  refresh: boolean,
): Promise<ProblemStatement> {
  try {
    return await fetchStatementFromLeetcode(problemId, { refresh });
  } catch (err) {
    if (!(err instanceof StatementApiError) || err.status !== 429) throw err;
    await wait(Math.min(err.retryAfterMs ?? RETRY_CAP_MS, RETRY_CAP_MS));
    return fetchStatementFromLeetcode(problemId, { refresh });
  }
}

export interface ProblemStatementFlow {
  readonly statement: ProblemStatement | null;
  readonly phase: StatementPhase;
  readonly problem: StatementProblem | null;
  /** "Refresh": `POST …/fetch { refresh: true }`. */
  readonly refresh: () => Promise<void>;
  readonly refreshing: boolean;
  readonly refreshError: string | null;
  /** Save (or, with `''`, clear) pasted text. Resolves to an error or null. */
  readonly paste: (text: string) => Promise<string | null>;
}

const REFRESH_ERROR: Readonly<Record<StatementProblem, string>> = {
  load_failed: 'Could not reach the local server.',
  disabled: 'Fetching is turned off in Settings.',
  not_found: 'LeetCode has no problem at this link.',
  rate_limited: 'Too many fetches right now. Try again in a few minutes.',
  unreachable: 'LeetCode could not be reached.',
};

export function useProblemStatement(problemId: string): ProblemStatementFlow {
  const [statement, setStatement] = useState<ProblemStatement | null>(null);
  const [phase, setPhase] = useState<StatementPhase>('loading');
  const [problem, setProblem] = useState<StatementProblem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatement(null);
    setPhase('loading');
    setProblem(null);
    setRefreshError(null);
    (async (): Promise<void> => {
      let data: ProblemStatement;
      try {
        data = await fetchStatement(problemId);
      } catch {
        if (cancelled) return;
        setProblem('load_failed');
        setPhase('done');
        return;
      }
      if (cancelled) return;
      setStatement(data);
      if (data.state === 'not-cached' && data.fetch.enabled && !data.custom) {
        setPhase('fetching');
        try {
          const fetched = await fetchOnceWithRetry(problemId, false);
          if (cancelled) return;
          setStatement(fetched);
        } catch (err) {
          if (cancelled) return;
          setProblem(problemOf(err));
        }
      }
      setPhase('done');
    })();
    return () => {
      cancelled = true;
    };
  }, [problemId]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const fetched = await fetchOnceWithRetry(problemId, true);
      setStatement(fetched);
      setProblem(null);
    } catch (err) {
      const why = problemOf(err);
      setRefreshError(REFRESH_ERROR[why]);
      if (why === 'not_found' || why === 'disabled') setProblem(why);
    } finally {
      setRefreshing(false);
    }
  }, [problemId]);

  const paste = useCallback(
    async (text: string): Promise<string | null> => {
      try {
        const saved = await pasteStatement(problemId, text);
        setStatement(saved);
        setProblem(null);
        return null;
      } catch (err) {
        if (err instanceof StatementApiError) {
          if (err.status === 409) {
            return 'Your data folder is read-only, so the text was not saved.';
          }
          if (err.status === 413) {
            return 'That text is too long (64 KB at most).';
          }
        }
        return 'Could not save the pasted text. Please try again.';
      }
    },
    [problemId],
  );

  return {
    statement,
    phase,
    problem,
    refresh,
    refreshing,
    refreshError,
    paste,
  };
}
