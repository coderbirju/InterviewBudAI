import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Loader2,
  RotateCcw,
  Rocket,
  Sparkles,
} from 'lucide-react';
import { fetchSettings } from '../lib/api';
import type { NoteStatus } from '../lib/api';
import { IntuitionCheckError, checkIntuition } from '../lib/intuitionCheck';
import type {
  CoachAssessment,
  IntuitionCheckResult,
} from '../lib/intuitionCheck';

/**
 * "Check my intuition" (ADR 0013 D5) — Notes page only. One shot, on click:
 * sends the CURRENT editor text (unsaved edits included) to
 * POST /api/notes/:id/check and shows the coach's assessment, up to three
 * questions and a one-line note.
 *
 * The feedback is throwaway: it lives in this component's state only (never
 * localStorage) and is cleared when the problem changes or the page unmounts.
 * Any later edit marks the panel stale and the button reads "Re-check".
 * All text renders via JSX (auto-escaped) — no dangerouslySetInnerHTML.
 */

export const NO_PROVIDER_HINT =
  'Set up an AI provider in Settings to use this.';
export const EMPTY_NOTE_HINT = 'Write your intuition first.';
export const ON_TRACK_FALLBACK = 'This is the right direction — go ahead.';
const RATE_LIMITED_TEXT = 'One check at a time — try again in a moment.';
const MALFORMED_TEXT = 'The model gave an unusable reply. Try again.';

const ASSESSMENT_CHIP: Record<
  CoachAssessment,
  { readonly label: string; readonly className: string }
> = {
  on_track: {
    label: 'On track',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
  partial: {
    label: 'Partly there',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  off_track: {
    label: 'Off track',
    className: 'border-red-500/40 bg-red-500/10 text-red-300',
  },
};

export interface IntuitionCheckProps {
  readonly problemId: string;
  readonly content: string;
  readonly timeComplexity: string;
  readonly spaceComplexity: string;
  readonly referenceApproach?: string;
  readonly status: NoteStatus;
}

type CheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'result';
      readonly result: IntuitionCheckResult;
      /** The inputs the result was computed for (stale detection). */
      readonly snapshot: string;
    }
  | {
      readonly kind: 'unavailable';
      readonly detail?: string;
      readonly hint?: string;
    }
  | { readonly kind: 'error'; readonly message: string };

function snapshotOf(props: IntuitionCheckProps): string {
  return JSON.stringify([
    props.content,
    props.timeComplexity,
    props.spaceComplexity,
    props.referenceApproach ?? '',
  ]);
}

export function IntuitionCheck(props: IntuitionCheckProps): JSX.Element {
  const {
    problemId,
    content,
    timeComplexity,
    spaceComplexity,
    referenceApproach,
    status,
  } = props;

  // null = unknown (settings not loaded / failed): the server decides.
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // Bumped per request, on problem change and on unmount so late replies are
  // dropped (never setState after unmount or for a different problem).
  const requestId = useRef(0);
  // Explicit in-flight guard (on top of `disabled`): one request at a time,
  // even if onCheck fires twice before React re-renders.
  const inFlight = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  // Set when a no_provider reply disabled the button the user was on.
  const focusHintPending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((s) => {
        if (!cancelled) setProviderReady(s.provider.kind !== 'none');
      })
      .catch(() => {
        // Unknown — leave the button enabled; a `no_provider` reply disables it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Leaving the problem clears the panel (nothing is kept anywhere).
  useEffect(() => {
    requestId.current += 1;
    inFlight.current = false;
    setState({ kind: 'idle' });
    setCooldownUntil(0);
    return () => {
      // Problem change or unmount: any reply still in flight is now stale.
      requestId.current += 1;
      inFlight.current = false;
    };
  }, [problemId]);

  // Tick once a second while a rate-limit cooldown is running.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return undefined;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldownUntil) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  const noteEmpty = content.trim() === '';
  const cooldownMs = Math.max(0, cooldownUntil - now);
  const coolingDown = cooldownMs > 0;
  const loading = state.kind === 'loading';
  const currentSnapshot = snapshotOf(props);
  const stale = state.kind === 'result' && state.snapshot !== currentSnapshot;

  const disabledHint =
    providerReady === false
      ? NO_PROVIDER_HINT
      : noteEmpty
        ? EMPTY_NOTE_HINT
        : null;
  const disabled = disabledHint !== null || loading || coolingDown;

  // The button can't keep focus once disabled: hand it to the hint so the
  // keyboard user lands on the explanation (also announced via the live region).
  useEffect(() => {
    if (focusHintPending.current && disabledHint !== null) {
      focusHintPending.current = false;
      hintRef.current?.focus();
    }
  }, [disabledHint]);

  const onCheck = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    if (content.trim() === '') {
      setState({ kind: 'error', message: EMPTY_NOTE_HINT });
      return;
    }
    inFlight.current = true;
    const id = ++requestId.current;
    const snapshot = currentSnapshot;
    setState({ kind: 'loading' });
    try {
      const result = await checkIntuition(problemId, {
        content,
        timeComplexity,
        spaceComplexity,
        ...(referenceApproach !== undefined && { referenceApproach }),
        status,
      });
      if (id !== requestId.current) return;
      setState({ kind: 'result', result, snapshot });
    } catch (err) {
      if (id !== requestId.current) return;
      if (!(err instanceof IntuitionCheckError)) {
        setState({
          kind: 'error',
          message: 'Could not reach the local API. Please try again.',
        });
        return;
      }
      if (err.code === 'no_provider') {
        const active = document.activeElement;
        focusHintPending.current =
          active === null ||
          active === document.body ||
          active === buttonRef.current;
        setProviderReady(false);
        setState({ kind: 'idle' });
      } else if (err.code === 'model_unavailable' || err.status === 503) {
        setState({
          kind: 'unavailable',
          ...(err.extra.detail !== undefined && { detail: err.extra.detail }),
          ...(err.extra.hint !== undefined && { hint: err.extra.hint }),
        });
      } else if (err.code === 'rate_limited') {
        const t = Date.now();
        setNow(t);
        setCooldownUntil(t + (err.retryAfterMs ?? 1000));
        setState({ kind: 'error', message: RATE_LIMITED_TEXT });
      } else if (err.code === 'empty_note') {
        setState({ kind: 'error', message: EMPTY_NOTE_HINT });
      } else if (err.status === 502) {
        setState({ kind: 'error', message: MALFORMED_TEXT });
      } else {
        setState({ kind: 'error', message: err.message });
      }
    } finally {
      if (id === requestId.current) inFlight.current = false;
    }
  }, [
    problemId,
    content,
    timeComplexity,
    spaceComplexity,
    referenceApproach,
    status,
    currentSnapshot,
  ]);

  const label = loading
    ? 'Checking…'
    : stale
      ? 'Re-check'
      : 'Check my intuition';

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => void onCheck()}
          disabled={disabled}
          aria-describedby={
            disabledHint !== null || coolingDown
              ? 'intuition-check-hint'
              : undefined
          }
          className="inline-flex items-center gap-2 rounded-md border border-emerald-500/60 px-4 py-2 text-sm font-semibold text-emerald-300 transition-all duration-200 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : stale ? (
            <RotateCcw className="h-4 w-4" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          {label}
        </button>
        {/* Always mounted so a hint that appears later (e.g. no_provider) is
            announced politely. The ticking countdown stays outside it. */}
        <span aria-live="polite" data-testid="intuition-check-hint-live">
          {disabledHint !== null && (
            <span
              id="intuition-check-hint"
              ref={hintRef}
              tabIndex={-1}
              className="text-xs text-slate-400 outline-none"
            >
              {disabledHint}
            </span>
          )}
        </span>
        {disabledHint === null && coolingDown && (
          <span id="intuition-check-hint" className="text-xs text-slate-400">
            {`Try again in ${Math.ceil(cooldownMs / 1000)}s.`}
          </span>
        )}
      </span>

      {/* Results: a polite live region so screen readers hear the outcome. */}
      <div
        aria-live="polite"
        aria-busy={loading}
        className="order-last w-full basis-full empty:hidden"
      >
        {state.kind === 'result' && (
          <CheckPanel result={state.result} stale={stale} />
        )}
        {state.kind === 'unavailable' && (
          <ModelUnavailableCard
            detail={state.detail}
            hint={state.hint}
            canRetry={!noteEmpty && !coolingDown}
            onRetry={() => void onCheck()}
          />
        )}
        {state.kind === 'error' && (
          <p
            role="alert"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-status-blocked"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {state.message}
          </p>
        )}
      </div>
    </>
  );
}

/** The coach's result panel. Every string is JSX text (auto-escaped). */
function CheckPanel({
  result,
  stale,
}: {
  readonly result: IntuitionCheckResult;
  readonly stale: boolean;
}): JSX.Element {
  const chip = ASSESSMENT_CHIP[result.assessment];
  const note = result.note.trim();
  const fallback = result.questions.length === 0 && note === '';
  const truncations = [
    result.truncated.note && 'Only the start of your note was checked.',
    result.truncated.reference &&
      'Only the start of your reference approach was used.',
    result.truncated.statement &&
      'Only the start of the problem statement was used.',
  ].filter((t): t is string => typeof t === 'string');

  return (
    <section
      aria-label="Intuition check"
      data-stale={stale ? 'true' : 'false'}
      className={`mt-2 rounded-xl border border-slate-800 bg-slate-800/40 p-4 transition-opacity duration-200 ${
        stale ? 'opacity-60' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chip.className}`}
        >
          {chip.label}
        </span>
        {result.readyToCode && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-semibold text-slate-900">
            <Rocket className="h-3 w-3" aria-hidden />
            Ready to code
          </span>
        )}
        {result.firstCheck && (
          <span className="text-xs text-slate-500">First check</span>
        )}
        {stale && (
          <span className="ml-auto text-xs font-medium text-amber-300">
            Your note changed
          </span>
        )}
      </div>

      {result.questions.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-200">
          {result.questions.map((q, i) => (
            <li key={i} className="break-words">
              {q}
            </li>
          ))}
        </ul>
      )}

      {note !== '' && (
        <p className="mt-3 break-words text-sm text-slate-300">{note}</p>
      )}
      {fallback && (
        <p className="mt-3 text-sm text-slate-300">{ON_TRACK_FALLBACK}</p>
      )}

      {result.missLabel && (
        <p className="mt-2 text-xs text-slate-500">Slip: {result.missLabel}</p>
      )}
      {truncations.map((t) => (
        <p key={t} className="mt-2 text-xs text-amber-300/80">
          {t}
        </p>
      ))}

      <p className="mt-3 text-xs text-slate-500">
        Not saved. Edit and re-check anytime.
      </p>
    </section>
  );
}

/**
 * The "model isn't ready yet" card (ADR 0011 D4; same pattern as the quiz).
 * Retry re-sends the current editor text; nothing was checked or saved.
 */
function ModelUnavailableCard({
  detail,
  hint,
  canRetry,
  onRetry,
}: {
  readonly detail?: string;
  readonly hint?: string;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Model not ready"
      className="mt-2 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-slate-200"
    >
      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
      <div className="space-y-2">
        <p className="font-semibold">The model isn&apos;t ready yet</p>
        <p className="text-sm text-slate-300">
          {detail ??
            'The model is starting or unavailable — try again in a moment.'}
        </p>
        {hint && <p className="text-sm text-slate-400">{hint}</p>}
        <p className="text-sm text-slate-400">
          Your note was not checked and is still in the editor.
        </p>
        <button
          type="button"
          onClick={onRetry}
          disabled={!canRetry}
          className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Retry
        </button>
      </div>
    </div>
  );
}
