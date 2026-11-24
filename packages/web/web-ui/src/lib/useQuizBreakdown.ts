import { useEffect, useState } from 'react';
import { fetchQuizBreakdown } from './api';
import type { QuizBreakdown } from './api';

export interface QuizBreakdownFlow {
  readonly breakdown: QuizBreakdown | null;
  readonly failed: boolean;
}

interface Loaded extends QuizBreakdownFlow {
  readonly sessionId: string;
}

/** Loads a session's breakdown; `null` loads nothing. Late replies for another id are dropped. */
export function useQuizBreakdown(sessionId: string | null): QuizBreakdownFlow {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    setLoaded(null);
    if (sessionId === null) return;
    let cancelled = false;
    fetchQuizBreakdown(sessionId)
      .then((breakdown) => {
        if (!cancelled) setLoaded({ sessionId, breakdown, failed: false });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ sessionId, breakdown: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return loaded !== null && loaded.sessionId === sessionId
    ? loaded
    : { breakdown: null, failed: false };
}
