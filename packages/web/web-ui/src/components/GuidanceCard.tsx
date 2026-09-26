import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Compass,
  ExternalLink,
  FileText,
  RotateCcw,
  Sparkles,
  TrendingDown,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  GuidanceNextUp,
  GuidanceResponse,
  GuidanceStanding,
  NextUpKind,
} from '../lib/api';
import { STRENGTH_COLORS, STRENGTH_LABELS } from '../lib/competency';
import {
  analyticsHref,
  interviewHref,
  isPlainClick,
  navigate,
  notesHref,
} from '../lib/router';
import { DifficultyBadge } from './DifficultyBadge';

/**
 * Home "Where you stand / Next up" card (ADR 0007 amendment w2a).
 *
 * Presentational: Home fetches `GET /api/guidance` and passes the response in.
 *  - `no_db` → nothing (Home already shows the create/choose-data CTA);
 *  - `empty` → "Start here" with the starter problems;
 *  - `ready` → up to 6 topic chips (band color + label shared with Analytics),
 *    up to 3 next-up rows, and a quiz nudge when `quiz.suggested`.
 *
 * Collapsible; the choice is remembered in localStorage. Everything renders as
 * JSX text (auto-escaped) — no dangerouslySetInnerHTML (charter §7.3).
 */

/** localStorage key for the collapsed state ('1' = collapsed). */
export const GUIDANCE_COLLAPSED_KEY = 'ibai.guidance.collapsed';

/** Most topic chips shown under "Where you stand". */
export const MAX_STANDING_CHIPS = 6;

/** Most rows shown under "Next up". */
export const MAX_NEXT_UP_ROWS = 3;

const KIND_META: Record<NextUpKind, { icon: LucideIcon; label: string }> = {
  revisit: { icon: RotateCcw, label: 'Revisit' },
  weak_topic: { icon: TrendingDown, label: 'Weak topic' },
  continue: { icon: ArrowRight, label: 'Continue' },
  start: { icon: Sparkles, label: 'Start' },
};

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(GUIDANCE_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) {
      window.localStorage.setItem(GUIDANCE_COLLAPSED_KEY, '1');
    } else {
      window.localStorage.removeItem(GUIDANCE_COLLAPSED_KEY);
    }
  } catch {
    // Storage unavailable: the choice lasts for this render only.
  }
}

/** An in-app link (client-side navigation on a plain click). */
function SpaLink({
  href,
  className,
  children,
  ariaLabel,
}: {
  href: string;
  className: string;
  children: ReactNode;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (isPlainClick(e)) {
          e.preventDefault();
          navigate(href);
        }
      }}
      className={className}
    >
      {children}
    </a>
  );
}

function StandingChip({ s }: { s: GuidanceStanding }): JSX.Element {
  const { done, total, toRevisit, didNotUnderstand } = s.notes;
  const review = toRevisit + didNotUnderstand;
  const color = STRENGTH_COLORS[s.band];
  // Counts lead: with little quiz data most bands are `unknown`, so the
  // done/total and review tallies are what make the chip informative.
  return (
    <li
      className="min-w-[9rem] rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm transition-all duration-200"
      data-testid="standing-chip"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-slate-200">{s.topicId}</span>
        <span className="tabular-nums font-semibold text-slate-100">
          {total > 0 ? `${done}/${total}` : done}
          <span className="sr-only"> done</span>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span
          className="inline-flex items-center gap-1 font-medium"
          style={{ color }}
          data-band={s.band}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          {STRENGTH_LABELS[s.band]}
        </span>
        {s.needsReview && (
          <span className="rounded bg-status-revisit/15 px-1.5 py-0.5 font-medium text-status-revisit">
            {review > 0
              ? `${review} need${review === 1 ? 's' : ''} review`
              : 'needs review'}
          </span>
        )}
      </div>
    </li>
  );
}

function NextUpRow({ item }: { item: GuidanceNextUp }): JSX.Element {
  const { icon: Icon, label } = KIND_META[item.kind] ?? KIND_META.start;
  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5 transition-all duration-200 hover:bg-slate-800/40">
      <span className="mt-0.5 shrink-0 text-emerald-400" title={label}>
        <Icon className="h-4 w-4" aria-hidden data-kind={item.kind} />
        <span className="sr-only">{label}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-medium text-slate-100 transition-all duration-200 hover:text-emerald-400"
          >
            {item.title}
            <ExternalLink className="h-3.5 w-3.5 text-slate-500" aria-hidden />
          </a>
          <DifficultyBadge difficulty={item.difficulty} />
        </div>
        <p className="mt-0.5 text-sm text-slate-400">{item.reason}</p>
      </div>
      <SpaLink
        href={notesHref(item.problemId)}
        ariaLabel={`Notes for ${item.title}`}
        className="inline-flex shrink-0 items-center gap-1.5 text-sm text-slate-400 transition-all duration-200 hover:text-emerald-400"
      >
        <FileText className="h-4 w-4" aria-hidden />
        Notes
      </SpaLink>
    </li>
  );
}

export function GuidanceCard({
  guidance,
}: {
  guidance: GuidanceResponse;
}): JSX.Element | null {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const bodyId = useId();

  if (guidance.state === 'no_db') {
    return null;
  }
  const empty = guidance.state === 'empty';
  const standing = empty ? [] : guidance.standing.slice(0, MAX_STANDING_CHIPS);
  const nextUp = guidance.nextUp.slice(0, MAX_NEXT_UP_ROWS);
  const nudge = guidance.quiz.suggested;
  if (standing.length === 0 && nextUp.length === 0 && !nudge) {
    return null;
  }

  const title = empty ? 'Start here' : 'Your guidance';

  return (
    <section
      aria-label={title}
      className="rounded-xl border border-slate-800 bg-slate-800/40 p-6"
    >
      <h2>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => {
            const next = !collapsed;
            writeCollapsed(next);
            setCollapsed(next);
          }}
          className="flex w-full items-center gap-2 rounded-md text-left text-sm font-semibold uppercase tracking-wide text-slate-400 transition-all duration-200 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <Compass className="h-4 w-4 text-emerald-500" aria-hidden />
          <span className="flex-1">{title}</span>
          <ChevronDown
            className={`h-4 w-4 transition-all duration-200 ${
              collapsed ? '-rotate-90' : ''
            }`}
            aria-hidden
          />
        </button>
      </h2>

      {!collapsed && (
        <div id={bodyId} className="mt-4 space-y-5">
          {empty && (
            <p className="text-sm text-slate-400">
              Nothing tracked yet. Pick one of these to begin — set a status on
              it when you&apos;re done.
            </p>
          )}

          {standing.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Where you stand
                </h3>
                <SpaLink
                  href={analyticsHref()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 transition-all duration-200 hover:text-emerald-300"
                >
                  See all in Analytics
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </SpaLink>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {standing.map((s) => (
                  <StandingChip key={s.topicId} s={s} />
                ))}
              </ul>
            </div>
          )}

          {nextUp.length > 0 && (
            <div>
              {!empty && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Next up
                </h3>
              )}
              <ul className={`space-y-2 ${empty ? '' : 'mt-2'}`}>
                {nextUp.map((item) => (
                  <NextUpRow key={item.problemId} item={item} />
                ))}
              </ul>
            </div>
          )}

          {nudge && (
            <SpaLink
              href={interviewHref()}
              className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-all duration-200 hover:text-emerald-400"
            >
              <Sparkles className="h-4 w-4 text-emerald-500" aria-hidden />
              {guidance.quiz.lastQuizAt === null
                ? 'Test what you’ve done — quiz yourself'
                : 'It’s been a while — quiz yourself'}
            </SpaLink>
          )}
        </div>
      )}
    </section>
  );
}
