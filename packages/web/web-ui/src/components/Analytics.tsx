import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Brain,
  Database,
  Loader2,
} from 'lucide-react';
import {
  fetchCatalog,
  fetchCompetency,
  fetchConfig,
  fetchProgress,
} from '../lib/api';
import type {
  CatalogResponse,
  CompetencyResponse,
  ConfigResponse,
  ProgressResponse,
} from '../lib/api';
import {
  completionPercent,
  hasTrackedData,
  statusSlices,
} from '../lib/analytics';
import { hasCompetencyData } from '../lib/competency';
import { homeHref, interviewHref } from '../lib/router';
import { StatusBreakdownChart } from './StatusBreakdownChart';
import { TopicCompletionChart } from './TopicCompletionChart';
import { CompetencyChart } from './CompetencyChart';

/**
 * The M4 Analytics view (ADR 0006). A React SPA page at `/app/analytics` that
 * fetches `GET /api/config` + `GET /api/progress` + `GET /api/catalog` and
 * renders real, hand-built inline-SVG visualizations of the user's progress:
 *
 *  1. A status-breakdown bar chart (counts by done / to_revisit /
 *     did_not_understand / none) using the design-system status colors.
 *  2. A per-topic completion chart (horizontal emerald bars, done/total).
 *  3. A concise summary (overall completed/total + a per-status count table).
 *  4. A COMPETENCY section (ADR 0007 Q4) fed by `GET /api/competency`:
 *     per-topic strength bars (weak=red / improving=amber / strong=emerald)
 *     with correct/incorrect tallies + a recurring miss-patterns list, with its
 *     own safe empty state ("Take a quiz session to build your competency map").
 *
 * States mirror Home/Notes: friendly loading + API-error; and a safe empty
 * state (no DB configured, or zero tracked problems) that points back to Home
 * instead of crashing. All values render via JSX (auto-escaped); no external
 * chart lib/CDN — everything is Vite-bundled and local-first.
 */

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'ready';
      readonly config: ConfigResponse;
      readonly progress: ProgressResponse;
      readonly catalog: CatalogResponse | null;
      readonly competency: CompetencyResponse;
    };

/** Zero progress used for the no-DB state (server returns all-none there too). */
const EMPTY_PROGRESS: ProgressResponse = {
  completed: 0,
  total: 0,
  byStatus: { none: 0, done: 0, to_revisit: 0, did_not_understand: 0 },
};

/** Empty competency signals used for the no-DB state. */
const EMPTY_COMPETENCY: CompetencyResponse = { topics: [], patterns: [] };

export function Analytics(): JSX.Element {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      setLoad({ kind: 'loading' });
      try {
        const config = await fetchConfig();
        if (cancelled) {
          return;
        }
        if (!config.dbConfigured) {
          // No DB — nothing to visualize; skip catalog/progress fetches.
          setLoad({
            kind: 'ready',
            config,
            progress: EMPTY_PROGRESS,
            catalog: null,
            competency: EMPTY_COMPETENCY,
          });
          return;
        }
        const [progress, catalog, competency] = await Promise.all([
          fetchProgress(),
          fetchCatalog(),
          fetchCompetency(),
        ]);
        if (cancelled) {
          return;
        }
        setLoad({ kind: 'ready', config, progress, catalog, competency });
      } catch {
        if (!cancelled) {
          setLoad({ kind: 'error' });
        }
      }
    })();
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

  const { config, progress, catalog, competency } = load;

  // Safe empty state: no DB configured, or a DB with nothing tracked yet.
  if (!hasTrackedData(config.dbConfigured, progress.byStatus)) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
        <BarChart3 className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold text-slate-100">
          No data yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          {config.dbConfigured
            ? 'Set a status on some problems and your progress charts will show up here. Start practicing from the catalog.'
            : 'InterviewBudAI stores your progress in a local folder you own. Create one, then start tracking problems to see your analytics.'}
        </p>
        {config.dbConfigured ? (
          <a
            href={homeHref()}
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400"
          >
            <Database className="h-4 w-4" aria-hidden />
            Go to the catalog
          </a>
        ) : (
          <a
            href="/setup"
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400"
          >
            <Database className="h-4 w-4" aria-hidden />
            Create your database
          </a>
        )}
      </div>
    );
  }

  const pct = completionPercent(progress.completed, progress.total);
  const slices = statusSlices(progress.byStatus);

  return (
    <div className="space-y-8">
      {/* Summary header. */}
      <section
        aria-label="Overall summary"
        className="rounded-xl border border-slate-800 bg-slate-800/40 p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Overall Progress
          </h2>
          <span className="text-lg font-semibold text-slate-100">
            {progress.completed} / {progress.total}
            <span className="ml-2 text-sm font-normal text-slate-400">
              ({pct}% done)
            </span>
          </span>
        </div>

        {/* Per-status summary table. */}
        <table className="mt-4 w-full text-sm">
          <caption className="sr-only">Problem counts by status</caption>
          <thead>
            <tr className="text-left text-slate-400">
              <th scope="col" className="pb-2 font-medium">
                Status
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Count
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {slices.map((slice) => (
              <tr key={slice.status} className="border-t border-slate-800">
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: slice.color }}
                      aria-hidden
                    />
                    <span className="text-slate-200">{slice.label}</span>
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-200">
                  {slice.count}
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-400">
                  {Math.round(slice.fraction * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Status breakdown chart. */}
      <section
        aria-label="Problems by status"
        className="rounded-xl border border-slate-800 bg-slate-800/40 p-6"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          By Status
        </h2>
        <div className="mt-4">
          <StatusBreakdownChart byStatus={progress.byStatus} />
        </div>
      </section>

      {/* Per-topic completion chart. */}
      {catalog && catalog.topics.length > 0 && (
        <section
          aria-label="Completion by topic"
          className="rounded-xl border border-slate-800 bg-slate-800/40 p-6"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            By Topic
          </h2>
          <div className="mt-4">
            <TopicCompletionChart catalog={catalog} />
          </div>
        </section>
      )}

      {/* Competency intelligence (ADR 0007 Q4): weak/strong topics + patterns. */}
      <section
        aria-label="Competency intelligence"
        className="rounded-xl border border-slate-800 bg-slate-800/40 p-6"
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-emerald-400" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Competency
          </h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Quiz-derived signals: the topics you&apos;re strong on, the ones to
          focus next, and the mistakes that keep recurring.
        </p>
        <div className="mt-4">
          {hasCompetencyData(competency) ? (
            <CompetencyChart data={competency} />
          ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center">
              <Brain className="mx-auto h-8 w-8 text-emerald-500" aria-hidden />
              <p className="mt-3 text-sm text-slate-300">
                Take a quiz session to build your competency map.
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
                As the Quiz Master evaluates your answers, we track which topics
                you&apos;re strong on and where you recurringly go wrong.
              </p>
              <a
                href={interviewHref()}
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400"
              >
                <Brain className="h-4 w-4" aria-hidden />
                Start a quiz
              </a>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
