import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { fetchPractice, resetPractice } from '../lib/api';
import type { PracticeResponse, PracticeSlip } from '../lib/api';
import {
  arcDash,
  assessmentSegments,
  assessmentSummary,
  missLabel,
  shortDate,
} from '../lib/analytics';

/**
 * The compact "Practice (intuition checks)" section on Analytics (ADR 0013
 * D5), fed by `GET /api/practice`. Practice trends are kept SEPARATE from the
 * quiz sections: it shares no numbers with them.
 *
 *  - Rendered only when `state === 'ready'`. `no_db`, `empty`, a 404 from a
 *    server without the route, or any fetch error just hide it — the rest of
 *    the page is never affected.
 *  - First-check outcomes donut, top practice slips (≤ 3), "Fixed after
 *    re-check", "Ready to code on first check", "since <date>".
 *  - "Reset practice history": a two-step inline confirm →
 *    `POST /api/practice/reset`; shows the backup path, then refetches (an
 *    empty history hides the section; the backup notice stays).
 *
 * Visually subordinate to the quiz sections (founder: keep the page simple).
 * Every string renders as JSX text (auto-escaped).
 */

const MAX_SLIPS = 3;
const MAX_SLIP_TOPICS = 3;

type ResetStep = 'idle' | 'confirm' | 'busy';

type Notice =
  | { readonly kind: 'success'; readonly backup: string }
  | {
      readonly kind: 'error';
      readonly text: string;
      readonly backup?: string;
    };

const WARNING =
  'Deletes all practice history. Quiz analytics are not affected. A backup is saved first.';

const BTN =
  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60';

export function PracticeSection(): JSX.Element | null {
  const [data, setData] = useState<PracticeResponse | null>(null);
  const [step, setStep] = useState<ResetStep>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);
  const mounted = useRef(true);
  const resetBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // Where focus goes once the inline confirm closes (it unmounts the focused
  // button, so without this focus would fall to <body>).
  const pendingFocus = useRef<'reset' | 'notice' | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await fetchPractice();
      if (mounted.current) {
        setData(next);
      }
    } catch {
      // 404 (older server), 5xx or network: hide the section, never break the page.
      if (mounted.current) {
        setData(null);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (step === 'confirm') {
      cancelBtn.current?.focus();
    } else if (step === 'idle' && pendingFocus.current !== null) {
      const target = pendingFocus.current;
      pendingFocus.current = null;
      (target === 'notice' ? noticeRef.current : resetBtn.current)?.focus();
    }
  }, [step]);

  const cancel = (): void => {
    pendingFocus.current = 'reset';
    setStep('idle');
  };

  const onConfirmKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && step === 'confirm') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  const confirm = async (): Promise<void> => {
    setStep('busy');
    setNotice(null);
    let succeeded = false;
    try {
      const res = await resetPractice();
      if (!mounted.current) {
        return;
      }
      if (res.ok) {
        succeeded = true;
        setNotice({ kind: 'success', backup: res.backup });
      } else {
        setNotice({
          kind: 'error',
          text: res.error,
          ...(res.backup !== undefined ? { backup: res.backup } : {}),
        });
      }
    } catch {
      if (mounted.current) {
        setNotice({
          kind: 'error',
          text: "Couldn't reach the local API. Practice history was not reset.",
        });
      }
    }
    if (mounted.current) {
      // Success: the body may unmount, so land on the notice. Error: the
      // section stays, so return to the Reset button.
      pendingFocus.current = succeeded ? 'notice' : 'reset';
      setStep('idle');
      await load();
    }
  };

  const ready = data !== null && data.state === 'ready';
  if (!ready && notice === null) {
    return null;
  }

  return (
    <section
      aria-labelledby="an-practice"
      className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-4"
    >
      <h2
        id="an-practice"
        className="text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        Practice (intuition checks)
      </h2>

      {/* Always mounted (empty until a successful reset) so screen readers
          that ignore live regions inserted already filled still announce it.
          Errors use role="alert" below, which announces on insertion. */}
      <div role="status" aria-live="polite" data-testid="practice-live">
        {notice?.kind === 'success' && (
          <SuccessLine ref={noticeRef} backup={notice.backup} />
        )}
      </div>
      {notice?.kind === 'error' && <ErrorLine notice={notice} />}

      {ready && data !== null && (
        <>
          <PracticeBody data={data} />
          <div className="mt-4 border-t border-slate-800 pt-3">
            {step === 'idle' ? (
              <button
                ref={resetBtn}
                type="button"
                onClick={() => setStep('confirm')}
                className={`${BTN} border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200`}
              >
                Reset practice history
              </button>
            ) : (
              <div
                role="group"
                onKeyDown={onConfirmKeyDown}
                aria-labelledby="an-practice-reset-warning"
                className="flex flex-wrap items-center gap-3 rounded-lg border border-status-blocked/40 bg-status-blocked/10 p-3"
              >
                <p
                  id="an-practice-reset-warning"
                  className="text-xs text-slate-200"
                >
                  {WARNING}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void confirm()}
                    disabled={step === 'busy'}
                    aria-describedby="an-practice-reset-warning"
                    className={`${BTN} inline-flex items-center gap-1.5 border-status-blocked/60 bg-status-blocked/20 text-slate-100 hover:bg-status-blocked/30`}
                  >
                    {step === 'busy' && (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    )}
                    {step === 'busy' ? 'Resetting…' : 'Confirm reset'}
                  </button>
                  <button
                    ref={cancelBtn}
                    type="button"
                    onClick={cancel}
                    disabled={step === 'busy'}
                    className={`${BTN} border-slate-700 text-slate-300 hover:border-slate-500`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const SuccessLine = forwardRef<HTMLParagraphElement, { backup: string }>(
  function SuccessLine({ backup }, ref): JSX.Element {
    return (
      <p
        ref={ref}
        tabIndex={-1}
        className="mt-2 flex items-start gap-2 text-xs text-slate-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-500"
      >
        <CheckCircle2
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-done"
          aria-hidden
        />
        <span>
          Practice history reset.
          {backup !== '' && (
            <>
              {' '}
              Backup saved to{' '}
              <code className="break-all text-slate-200">{backup}</code>
            </>
          )}
        </span>
      </p>
    );
  },
);

function ErrorLine({
  notice,
}: {
  notice: Extract<Notice, { kind: 'error' }>;
}): JSX.Element {
  return (
    <p
      role="alert"
      className="mt-2 flex items-start gap-2 text-xs text-slate-300"
    >
      <AlertTriangle
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-blocked"
        aria-hidden
      />
      <span>
        {notice.text}
        {notice.backup !== undefined && (
          <>
            {' '}
            Backup saved to{' '}
            <code className="break-all text-slate-200">{notice.backup}</code>
          </>
        )}
      </span>
    </p>
  );
}

const DONUT_R = 42;
const DONUT_C = 2 * Math.PI * DONUT_R;

function PracticeBody({ data }: { data: PracticeResponse }): JSX.Element {
  const segments = assessmentSegments(data.firstCheck);
  const summary = assessmentSummary(data.firstCheck);
  const total = segments.reduce((a, s) => a + s.count, 0);
  const since = shortDate(data.since);
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        <svg
          viewBox="0 0 100 100"
          className="h-20 w-20 shrink-0"
          role="img"
          aria-label={`First-check outcomes. ${summary}`}
        >
          <title>{`First-check outcomes. ${summary}`}</title>
          <circle
            cx={50}
            cy={50}
            r={DONUT_R}
            fill="none"
            stroke="#1e293b" /* slate-800 track */
            strokeWidth={12}
          />
          <g transform="rotate(-90 50 50)">
            {segments
              .filter((s) => s.length > 0)
              .map((s) => {
                const dash = arcDash(s.start, s.length, DONUT_C);
                return (
                  <circle
                    key={s.key}
                    data-testid={`practice-donut-${s.key}`}
                    cx={50}
                    cy={50}
                    r={DONUT_R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={12}
                    strokeDasharray={dash.dasharray}
                    strokeDashoffset={dash.dashoffset}
                  />
                );
              })}
          </g>
          <text
            x={50}
            y={50}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-slate-200 text-[20px] font-semibold"
          >
            {total}
          </text>
        </svg>
        <div className="space-y-1.5">
          <p className="text-xs text-slate-500">First-check outcomes</p>
          <ul
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
            aria-label="First-check outcome counts"
          >
            {segments.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-slate-400">{s.label}</span>
                <span className="tabular-nums font-semibold text-slate-200">
                  {s.count}
                </span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-slate-400">Fixed after re-check</dt>
            <dd
              className="tabular-nums text-slate-200"
              data-testid="practice-fixed"
            >
              {data.fixedAfterRecheck.count} of {data.fixedAfterRecheck.of}
            </dd>
            <dt className="text-slate-400">Ready to code on first check</dt>
            <dd
              className="tabular-nums text-slate-200"
              data-testid="practice-ready"
            >
              {data.readyToCodeFirstTry.count} of {data.readyToCodeFirstTry.of}
            </dd>
          </dl>
        </div>
      </div>

      <PracticeSlips items={data.slips.slice(0, MAX_SLIPS)} />

      {since !== null && (
        <p className="text-xs text-slate-500" data-testid="practice-since">
          Since {since}
        </p>
      )}
    </div>
  );
}

function PracticeSlips({
  items,
}: {
  items: readonly PracticeSlip[];
}): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="text-xs text-slate-500">Top practice slips</h3>
      <ul className="mt-1 divide-y divide-slate-800/80">
        {items.map((s, i) => (
          <li
            key={`${s.code}-${i}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-xs"
          >
            <span className="font-medium text-slate-200">
              {missLabel(s.code, s.label)}
            </span>
            <span
              className="tabular-nums text-slate-400"
              data-testid="practice-slip-count"
            >
              <span aria-hidden>×{s.count}</span>
              <span className="sr-only">{`${s.count} times`}</span>
            </span>
            <span className="flex flex-wrap gap-1">
              {s.topics.slice(0, MAX_SLIP_TOPICS).map((t) => (
                <span
                  key={t.topicId}
                  className="rounded-full border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400"
                >
                  {t.label.trim() !== '' ? t.label : t.topicId}{' '}
                  <span className="tabular-nums">{t.count}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
