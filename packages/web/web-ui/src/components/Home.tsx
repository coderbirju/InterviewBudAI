import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Database, Loader2, SearchX } from 'lucide-react';
import {
  fetchCatalog,
  fetchConfig,
  fetchProgress,
  postNoteStatus,
} from '../lib/api';
import type {
  CatalogResponse,
  ConfigResponse,
  NoteStatus,
  ProgressResponse,
} from '../lib/api';
import { ProgressBanner } from './ProgressBanner';
import { CategoryAccordion } from './CategoryAccordion';
import { CatalogFilterBar } from './CatalogFilterBar';
import {
  EMPTY_FILTER,
  filterCatalog,
  filterFromSearch,
  isFilterActive,
  searchWithFilter,
} from '../lib/home';
import type { CatalogFilter } from '../lib/home';
import { currentSearch, replaceSearch } from '../lib/router';

/**
 * The M2 Home view. Fetches config + progress + catalog, and renders:
 *  - a "Create your database" CTA if no DB is configured;
 *  - otherwise the global progress banner + a categorized accordion list.
 *
 * Status toggles are optimistic: the row + category badge + global bar update
 * immediately, a POST persists the change, and on failure the previous state is
 * restored with a subtle error message. All state is client-side (no reload).
 *
 * W3: a search box + difficulty/status chips filter the catalog client-side
 * (pure helpers in `lib/home.ts`). The filter is mirrored into the URL query
 * (`?q=&difficulty=&status=`) via `replaceState`, so reload and back-from-notes
 * restore it. While a filter is active, matching topics auto-expand, empty
 * topics are hidden, and each header shows its match count.
 */

type LoadState = 'loading' | 'ready' | 'error';

/** Recompute progress from a catalog snapshot (single source of truth). */
function progressFromCatalog(catalog: CatalogResponse): ProgressResponse {
  const byStatus = {
    none: 0,
    done: 0,
    to_revisit: 0,
    did_not_understand: 0,
  };
  for (const topic of catalog.topics) {
    for (const problem of topic.problems) {
      byStatus[problem.status] += 1;
    }
  }
  // A problem can appear under multiple topics; totals from the API are the
  // authoritative de-duplicated counts, so use those for the fraction.
  return {
    completed: catalog.totals.byStatus.done,
    total: catalog.totals.total,
    byStatus: catalog.totals.byStatus,
  };
}

/** Immutably set one problem's status across every topic it appears in. */
function withStatus(
  catalog: CatalogResponse,
  id: string,
  status: NoteStatus,
): CatalogResponse {
  const topics = catalog.topics.map((topic) => ({
    ...topic,
    problems: topic.problems.map((p) =>
      p.id === id ? { ...p, status, completed: status === 'done' } : p,
    ),
  }));
  // Recompute de-duplicated totals.byStatus from a per-id map.
  const seen = new Map<string, NoteStatus>();
  for (const topic of topics) {
    for (const p of topic.problems) {
      seen.set(p.id, p.status);
    }
  }
  const byStatus = {
    none: 0,
    done: 0,
    to_revisit: 0,
    did_not_understand: 0,
  };
  for (const s of seen.values()) {
    byStatus[s] += 1;
  }
  return { topics, totals: { total: catalog.totals.total, byStatus } };
}

export function Home(): JSX.Element {
  const [state, setState] = useState<LoadState>('loading');
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CatalogFilter>(() =>
    filterFromSearch(currentSearch()),
  );

  // The URL is the source of truth for the filter. Re-derive it whenever the
  // location changes while Home stays mounted: browser Back/Forward, and
  // in-app `navigate()` (which dispatches `popstate`) — e.g. clicking the
  // Problems nav link / wordmark to a bare `/` clears the filter.
  useEffect(() => {
    function onPopState(): void {
      setFilter(filterFromSearch(currentSearch()));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Mirror user filter edits into the URL query (replace, not push).
  useEffect(() => {
    replaceSearch(searchWithFilter(currentSearch(), filter));
  }, [filter]);

  const filterActive = isFilterActive(filter);
  const filtered = useMemo(
    () => (catalog ? filterCatalog(catalog.topics, filter) : null),
    [catalog, filter],
  );

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        setState('loading');
        const cfg = await fetchConfig();
        if (cancelled) {
          return;
        }
        setConfig(cfg);
        if (!cfg.dbConfigured) {
          // No DB — show the CTA; skip catalog/progress fetches.
          setState('ready');
          return;
        }
        const [cat, prog] = await Promise.all([
          fetchCatalog(),
          fetchProgress(),
        ]);
        if (cancelled) {
          return;
        }
        setCatalog(cat);
        setProgress(prog);
        setState('ready');
      } catch {
        if (!cancelled) {
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onStatusChange = useCallback(
    async (id: string, next: NoteStatus): Promise<void> => {
      if (!catalog) {
        return;
      }
      const previous = catalog;
      const optimistic = withStatus(catalog, id, next);
      // Optimistic update: row + category badge + global bar, no reload.
      setCatalog(optimistic);
      setProgress(progressFromCatalog(optimistic));
      setToggleError(null);
      setBusyIds((prev) => new Set(prev).add(id));
      try {
        await postNoteStatus(id, next);
      } catch {
        // Revert on failure and surface a subtle error.
        setCatalog(previous);
        setProgress(progressFromCatalog(previous));
        setToggleError('Could not save that change. Please try again.');
      } finally {
        setBusyIds((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(id);
          return nextSet;
        });
      }
    },
    [catalog],
  );

  if (state === 'loading') {
    return (
      <div
        className="flex items-center gap-2 text-slate-400"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Loading your problems…
      </div>
    );
  }

  if (state === 'error') {
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
          <p className="font-semibold">Couldn&apos;t load your data</p>
          <p className="mt-1 text-sm text-slate-400">
            The app couldn&apos;t reach the local API. Make sure the server is
            running, then reload the page.
          </p>
        </div>
      </div>
    );
  }

  // No DB configured — call-to-action to create one (links to existing /setup).
  if (config && !config.dbConfigured) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
        <Database className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold text-slate-100">
          Create your database
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          InterviewBudAI stores your progress in a local folder you own. Create
          one to start tracking problems, statuses, and notes.
        </p>
        <a
          href="/setup"
          className="mt-5 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400"
        >
          Create your database
        </a>
      </div>
    );
  }

  // DB configured — banner + categorized list.
  return (
    <div className="space-y-6">
      {progress && <ProgressBanner progress={progress} />}

      {toggleError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-status-blocked/40 bg-status-blocked/10 px-4 py-2 text-sm text-status-blocked"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {toggleError}
        </div>
      )}

      {catalog && filtered && (
        <CatalogFilterBar
          filter={filter}
          onChange={setFilter}
          matched={filtered.matched}
          total={catalog.totals.total}
        />
      )}

      {filtered && filterActive && filtered.topics.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-8 text-center">
          <SearchX className="mx-auto h-8 w-8 text-slate-500" aria-hidden />
          <p className="mt-3 font-semibold text-slate-100">
            No problems match your filters
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Try a different search or fewer chips.
          </p>
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="mt-4 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            Show all problems
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered?.topics.map(({ topic, matches }) => (
            <CategoryAccordion
              // Remount when filtering starts/stops so matching topics
              // auto-expand (and collapse back when cleared) while a user's
              // manual toggle still sticks as they keep typing.
              key={`${topic.topic}:${filterActive ? 'filtered' : 'all'}`}
              topic={topic}
              defaultOpen={filterActive}
              matches={filterActive ? matches : undefined}
              busyIds={busyIds}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
