import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Brain,
  Database,
  Loader2,
} from 'lucide-react';
import { fetchInsights } from '../lib/api';
import type {
  InsightsFocus,
  InsightsResponse,
  InsightsSlip,
  InsightsStatus,
  InsightsStrength,
  InsightsTopic,
  TopicStrength,
} from '../lib/api';
import {
  arcDash,
  donutSegments,
  donutSummary,
  donutTotal,
  missLabel,
  ringFraction,
} from '../lib/analytics';
import { PracticeSection } from './PracticeSection';
import { STRENGTH_COLORS, STRENGTH_LABELS } from '../lib/competency';
import { dataHref, interviewHref } from '../lib/router';

/**
 * Analytics v2 (ADR 0012 D3) at `/analytics`, fed by one `GET /api/insights`.
 *
 *  - `no_db` → the create/choose-data CTA.
 *  - `locked` (< 2 counted quiz sessions) → status donut, a "take a quiz" CTA
 *    with `counted / required`, compact topic tiles. Nothing else.
 *  - `unlocked` → donut, Focus next (≤ 3), Where you keep slipping (≤ 3),
 *    Strengths (≤ 5, never a Focus topic), compact topic tiles. `state` comes
 *    from the session count alone, so each section has its own empty line.
 *  - Labels fall back to the topic id.
 *
 * Below the quiz sections, a separate compact Practice section (ADR 0013 D5,
 * `PracticeSection`) shows intuition-check trends; it shares no numbers with
 * the quiz sections and hides itself unless `GET /api/practice` is ready.
 *
 * Kept short and calm on purpose (founder: "keep it simple"). Hand-built SVG,
 * no chart library. Every string renders via JSX (auto-escaped); color is
 * never the only signal (labels/counts sit beside every swatch).
 */

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly data: InsightsResponse };

const MAX_FOCUS = 3;
const MAX_SLIPS = 3;
const MAX_SLIP_TOPICS = 3;
const MAX_STRENGTHS = 5;

// Spacing scale (founder 2026-10-04: "too cramped"): sections 2rem apart,
// cards padded 1.25rem → 1.5rem from `sm`, section body 1rem under its heading.
const CARD = 'rounded-xl border border-slate-800 bg-slate-800/40 p-5 sm:p-6';
const HEADING = 'text-base font-semibold text-slate-100';
const BODY_GAP = 'mt-4';
const CTA =
  'inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400';

export function Analytics(): JSX.Element {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchInsights().then(
      (data) => {
        if (!cancelled) {
          setLoad({ kind: 'ready', data });
        }
      },
      () => {
        if (!cancelled) {
          setLoad({ kind: 'error' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.kind === 'loading') {
    return (
      <div
        className="flex items-center gap-2 text-slate-400"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Loading your analytics…
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-status-blocked/40 bg-status-blocked/10 p-5 text-slate-200"
      >
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-status-blocked"
          aria-hidden
        />
        <div>
          <p className="font-semibold">Couldn&apos;t load your analytics</p>
          <p className="mt-1 text-sm text-slate-400">
            The app couldn&apos;t reach the local API. Make sure the server is
            running, then reload the page.
          </p>
        </div>
      </div>
    );
  }

  const { data } = load;

  if (data.state === 'no_db') {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
        <BarChart3 className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold text-slate-100">
          No data yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          InterviewBudAI stores your progress in a local folder you own. Create
          one, then start tracking problems to see your analytics.
        </p>
        <a href={dataHref()} className={`mt-5 ${CTA}`}>
          <Database className="h-4 w-4" aria-hidden />
          Create your database
        </a>
      </div>
    );
  }

  const unlocked = data.state === 'unlocked';

  return (
    <div className="space-y-8">
      <section aria-labelledby="an-status" className={CARD}>
        <h2 id="an-status" className={HEADING}>
          Your problems
        </h2>
        <div className={BODY_GAP}>
          <StatusDonut status={data.status} />
        </div>
        {!unlocked && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4 sm:px-5">
            <p className="text-sm text-slate-300">
              Take a quiz to see your gaps and patterns —{' '}
              <span className="font-semibold text-slate-100">
                {data.sessions.counted} of {data.sessions.required}
              </span>{' '}
              sessions done
            </p>
            <a href={interviewHref()} className={CTA}>
              <Brain className="h-4 w-4" aria-hidden />
              Take a quiz
            </a>
          </div>
        )}
      </section>

      {unlocked && (
        <>
          <FocusNext items={data.focus.slice(0, MAX_FOCUS)} />
          <Slips items={data.slips.slice(0, MAX_SLIPS)} />
          <Strengths
            items={data.strengths
              .filter((s) => !data.focus.some((f) => f.topicId === s.topicId))
              .slice(0, MAX_STRENGTHS)}
          />
        </>
      )}

      <section aria-labelledby="an-topics" className={CARD}>
        <h2 id="an-topics" className={HEADING}>
          By topic
        </h2>
        <TopicTiles topics={data.topics} />
      </section>

      {/* Practice trends (ADR 0013 D5): separate, compact, hidden unless ready. */}
      <PracticeSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

const DONUT_R = 42;
const DONUT_C = 2 * Math.PI * DONUT_R;

function StatusDonut({ status }: { status: InsightsStatus }): JSX.Element {
  const segments = donutSegments(status);
  const summary = donutSummary(status);
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
      <svg
        viewBox="0 0 100 100"
        className="h-36 w-36 shrink-0"
        role="img"
        aria-label={`Problems by status. ${summary}`}
      >
        <title>{`Problems by status. ${summary}`}</title>
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
                  data-testid={`donut-${s.key}`}
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
          className="fill-slate-100 text-[18px] font-semibold"
        >
          {donutTotal(status)}
        </text>
      </svg>
      <ul
        className="grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm min-[380px]:grid-cols-2"
        aria-label="Status counts"
      >
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="text-slate-300">{s.label}</span>
            <span className="tabular-nums font-semibold text-slate-100">
              {s.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unlocked sections
// ---------------------------------------------------------------------------

/** Display label: the API's label, else the raw topic id. */
function labelOf(x: {
  readonly label?: string;
  readonly topicId: string;
}): string {
  return typeof x.label === 'string' && x.label.trim() !== ''
    ? x.label
    : x.topicId;
}

const EMPTY_SECTION = 'Not enough quiz data yet in this section.';

function bandOf(band: string): TopicStrength {
  return Object.prototype.hasOwnProperty.call(STRENGTH_LABELS, band)
    ? (band as TopicStrength)
    : 'unknown';
}

function FocusNext({
  items,
}: {
  items: readonly InsightsFocus[];
}): JSX.Element {
  return (
    <section aria-labelledby="an-focus" className={CARD}>
      <h2 id="an-focus" className={HEADING}>
        Focus next
      </h2>
      {items.length === 0 ? (
        <p className={`${BODY_GAP} text-sm text-slate-400`}>{EMPTY_SECTION}</p>
      ) : (
        <ul className={`${BODY_GAP} divide-y divide-slate-800`}>
          {items.map((f) => {
            const band = bandOf(f.band);
            return (
              <li
                key={f.topicId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 first:pt-0 last:pb-0"
              >
                <span className="font-medium text-slate-100">{labelOf(f)}</span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300"
                  data-testid="band-chip"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: STRENGTH_COLORS[band] }}
                    aria-hidden
                  />
                  {STRENGTH_LABELS[band]}
                </span>
                <span className="text-sm text-slate-400">{f.reason}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Slips({ items }: { items: readonly InsightsSlip[] }): JSX.Element {
  return (
    <section aria-labelledby="an-slips" className={CARD}>
      <h2 id="an-slips" className={HEADING}>
        Where you keep slipping
      </h2>
      {items.length === 0 ? (
        <p className={`${BODY_GAP} text-sm text-slate-400`}>
          {EMPTY_SECTION} Slips are tagged from your next quiz.
        </p>
      ) : (
        <ul className={`${BODY_GAP} divide-y divide-slate-800`}>
          {items.map((s, i) => (
            <li
              key={`${s.code}-${i}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 first:pt-0 last:pb-0"
            >
              <span className="font-medium text-slate-100">
                {missLabel(s.code, s.label)}
              </span>
              <span
                className="tabular-nums text-sm text-slate-400"
                data-testid="slip-count"
              >
                <span aria-hidden>×{s.count}</span>
                <span className="sr-only">{`${s.count} times`}</span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {(s.topics ?? []).slice(0, MAX_SLIP_TOPICS).map((t) => (
                  <span
                    key={t.topicId}
                    className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300"
                  >
                    {labelOf(t)} <span className="tabular-nums">{t.count}</span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Strengths({
  items,
}: {
  items: readonly InsightsStrength[];
}): JSX.Element {
  return (
    <section aria-labelledby="an-strengths" className={CARD}>
      <h2 id="an-strengths" className={HEADING}>
        Strengths
      </h2>
      {items.length === 0 ? (
        <p className={`${BODY_GAP} text-sm text-slate-400`}>{EMPTY_SECTION}</p>
      ) : (
        <ul className={`${BODY_GAP} flex flex-wrap gap-3`}>
          {items.map((s) => (
            <li
              key={s.topicId}
              className="rounded-full border border-status-done/40 bg-status-done/10 px-3.5 py-1.5 text-sm text-slate-200"
            >
              {labelOf(s)}{' '}
              <span className="tabular-nums text-xs text-slate-400">
                {s.correct} correct · {s.incorrect} incorrect
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compact topic tiles
// ---------------------------------------------------------------------------

const RING_R = 14;
const RING_C = 2 * Math.PI * RING_R;

function TopicTiles({
  topics,
}: {
  topics: readonly InsightsTopic[];
}): JSX.Element {
  // Auto-fill with an 11rem floor: tiles never squeeze on narrow widths, they
  // wrap to fewer columns (one column on the narrowest phones).
  return (
    <ul
      className={`${BODY_GAP} grid grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] gap-3`}
      aria-label="Completion by topic"
    >
      {topics.map((t) => {
        const dash = arcDash(0, ringFraction(t.done, t.total), RING_C);
        return (
          <li
            key={t.topicId}
            data-testid="topic-tile"
            aria-label={`${labelOf(t)}: ${t.done} of ${t.total} done`}
            className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-3"
          >
            <svg viewBox="0 0 36 36" className="h-10 w-10 shrink-0" aria-hidden>
              <circle
                cx={18}
                cy={18}
                r={RING_R}
                fill="none"
                stroke="#334155" /* slate-700 */
                strokeWidth={4}
              />
              <circle
                cx={18}
                cy={18}
                r={RING_R}
                fill="none"
                stroke="#22c55e" /* emerald — done */
                strokeWidth={4}
                strokeDasharray={dash.dasharray}
                strokeDashoffset={dash.dashoffset}
                transform="rotate(-90 18 18)"
              />
            </svg>
            <span className="min-w-0">
              <span className="block break-words text-sm font-medium leading-snug text-slate-200">
                {labelOf(t)}
              </span>
              <span className="mt-0.5 block tabular-nums text-xs text-slate-400">
                {t.done}/{t.total}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
