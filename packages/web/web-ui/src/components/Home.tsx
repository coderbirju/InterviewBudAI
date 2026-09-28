import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  Plus,
  SearchX,
  X,
} from 'lucide-react';
import {
  fetchCatalog,
  fetchConfig,
  fetchGuidance,
  fetchProgress,
  postNoteStatus,
} from '../lib/api';
import type {
  CatalogResponse,
  CustomProblem,
  ConfigResponse,
  GuidanceResponse,
  NoteStatus,
  ProgressResponse,
} from '../lib/api';
import { ProgressBanner } from './ProgressBanner';
import { CategoryAccordion } from './CategoryAccordion';
import { CatalogFilterBar } from './CatalogFilterBar';
import { GuidanceCard } from './GuidanceCard';
import { ProblemForm } from './ProblemForm';
import type { TopicOption } from './ProblemForm';
import { clearFlash, peekFlash } from '../lib/flash';
import {
  EMPTY_FILTER,
  filterCatalog,
  filterFromSearch,
  filtersEqual,
  isFilterActive,
  searchWithFilter,
} from '../lib/home';
import type { CatalogFilter } from '../lib/home';
import {
  currentSearch,
  navigate,
  notesHref,
  parseRoute,
  rememberHomeSearch,
  replaceSearch,
} from '../lib/router';

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
 *
 * w2a: a guidance card ("Where you stand / Next up", `GET /api/guidance`) sits
 * between the banner and the filter bar. It is fetched in parallel with the
 * catalog and refetched after each saved status change; Home remounts when
 * returning from Notes, so that refetches too. A guidance error never affects
 * the catalog: a failed first fetch shows no card, a failed refetch keeps the
 * last good card.
 *
 * w2b (ADR 0010 D5): "Add problem" above the catalog and a "+" on each topic
 * header (pre-selects that topic) open the custom-problem form. After a
 * create the catalog is refetched, the problem's topics expand, and a notice
 * links to its Notes. A one-shot flash (e.g. "Deleted …" from Notes) shows
 * as a dismissible notice.
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
  const [guidance, setGuidance] = useState<GuidanceResponse | null>(null);
  // Latest guidance request; older responses (and any after unmount) are dropped.
  const guidanceSeq = useRef(0);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CatalogFilter>(() =>
    filterFromSearch(currentSearch()),
  );
  // Rows whose status the user changed under an active filter stay visible
  // until the filter itself changes (so they don't vanish mid-interaction).
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  // Expansion is owned here: `openTopics` is the user's own (unfiltered) set;
  // while filtering, every matching topic is open except those the user
  // collapsed (`collapsedWhileFiltering`). Clearing restores `openTopics`.
  const [openTopics, setOpenTopics] = useState<ReadonlySet<string>>(new Set());
  const [collapsedWhileFiltering, setCollapsedWhileFiltering] = useState<
    ReadonlySet<string>
  >(new Set());
  // The add-problem form: closed, or open with the pre-selected topics.
  const [adding, setAdding] = useState<readonly string[] | null>(null);
  const [notice, setNotice] = useState<{
    readonly text: string;
    readonly problemId?: string;
  } | null>(() => {
    const flash = peekFlash();
    return flash === null ? null : { text: flash };
  });
  useEffect(() => clearFlash(), []);

  // Latest filter, read by the popstate listener without re-subscribing.
  const filterRef = useRef(filter);

  /** Every filter change goes through here (bar, reset button, URL). */
  const applyFilter = useCallback((next: CatalogFilter): void => {
    setFilter(next);
    setPinned(new Set());
    if (!isFilterActive(next)) {
      setCollapsedWhileFiltering(new Set());
    }
  }, []);

  // The URL is the source of truth for the filter. Re-derive it whenever the
  // location changes while Home stays mounted: browser Back/Forward, and
  // in-app `navigate()` (which dispatches `popstate`) — e.g. clicking the
  // Problems nav link / wordmark to a bare `/` clears the filter.
  useEffect(() => {
    function onPopState(): void {
      // Only while the location is still Home — navigating away to /notes/…
      // also fires popstate and must not wipe the remembered Home query.
      if (parseRoute(window.location.pathname).kind !== 'home') {
        return;
      }
      // A popstate that leaves the query unchanged (e.g. a same-URL
      // `navigate()`) must not re-apply the filter: that would un-pin rows
      // the user just changed, making them vanish mid-interaction.
      const next = filterFromSearch(currentSearch());
      if (!filtersEqual(next, filterRef.current)) {
        applyFilter(next);
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyFilter]);

  // Mirror user filter edits into the URL query (replace, not push).
  useEffect(() => {
    filterRef.current = filter;
    const search = searchWithFilter(currentSearch(), filter);
    replaceSearch(search);
    rememberHomeSearch(search);
  }, [filter]);

  /**
   * (Re)fetch guidance. A failure never touches the catalog: it keeps the last
   * good guidance, so the card is hidden only if no fetch has ever succeeded.
   */
  const loadGuidance = useCallback((): void => {
    const seq = ++guidanceSeq.current;
    fetchGuidance().then(
      (g) => {
        if (seq === guidanceSeq.current) setGuidance(g);
      },
      () => {
        // Keep whatever was last shown (null until a first success).
      },
    );
  }, []);

  useEffect(
    () => () => {
      guidanceSeq.current += 1;
    },
    [],
  );

  const filterActive = isFilterActive(filter);
  const filtered = useMemo(
    () => (catalog ? filterCatalog(catalog.topics, filter, pinned) : null),
    [catalog, filter, pinned],
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
        // In parallel with the catalog, but not awaited: it never blocks
        // or fails the catalog.
        loadGuidance();
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
  }, [loadGuidance]);

  const onStatusChange = useCallback(
    async (id: string, next: NoteStatus): Promise<void> => {
      if (!catalog) {
        return;
      }
      const previous = catalog;
      if (filterActive) {
        setPinned((prev) => new Set(prev).add(id));
      }
      const optimistic = withStatus(catalog, id, next);
      // Optimistic update: row + category badge + global bar, no reload.
      setCatalog(optimistic);
      setProgress(progressFromCatalog(optimistic));
      setToggleError(null);
      setBusyIds((prev) => new Set(prev).add(id));
      try {
        await postNoteStatus(id, next);
        loadGuidance();
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
    [catalog, filterActive, loadGuidance],
  );

  const topicOptions: readonly TopicOption[] = useMemo(
    () =>
      catalog
        ? catalog.topics.map((t) => ({
            id: t.topic,
            label: t.label ?? t.topic,
          }))
        : [],
    [catalog],
  );

  /** After a create: refetch, expand its topics, and link to its Notes. */
  const onProblemAdded = useCallback(
    async (problem: CustomProblem): Promise<void> => {
      setAdding(null);
      setNotice({ text: `Added “${problem.title}”.`, problemId: problem.id });
      setOpenTopics((prev) => new Set([...prev, ...problem.topics]));
      loadGuidance();
      try {
        const [cat, prog] = await Promise.all([
          fetchCatalog(),
          fetchProgress(),
        ]);
        setCatalog(cat);
        setProgress(prog);
      } catch {
        setToggleError(
          'The problem was added, but the list could not refresh. Reload the page to see it.',
        );
      }
    },
    [loadGuidance],
  );

  const toggleTopic = useCallback(
    (name: string): void => {
      const flip = (prev: ReadonlySet<string>): ReadonlySet<string> => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        return next;
      };
      if (filterActive) {
        setCollapsedWhileFiltering(flip);
      } else {
        setOpenTopics(flip);
      }
    },
    [filterActive],
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

  // No DB configured — call-to-action to create one (links to the /data page).
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
          href="/data"
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

      {guidance && <GuidanceCard guidance={guidance} />}

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-slate-200"
        >
          <CheckCircle2
            className="h-4 w-4 shrink-0 text-emerald-400"
            aria-hidden
          />
          <span className="min-w-0 flex-1 break-words">
            {notice.text}{' '}
            {notice.problemId !== undefined && (
              <a
                href={notesHref(notice.problemId)}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(notesHref(notice.problemId ?? ''));
                }}
                className="font-medium text-emerald-400 underline hover:text-emerald-300"
              >
                Open its notes
              </a>
            )}
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="rounded p-0.5 text-slate-400 hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {toggleError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-status-blocked/40 bg-status-blocked/10 px-4 py-2 text-sm text-status-blocked"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {toggleError}
        </div>
      )}

      {catalog && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setAdding([])}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-emerald-500 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add problem
          </button>
        </div>
      )}

      {adding !== null && (
        <ProblemForm
          mode="create"
          topics={topicOptions}
          initial={{ topics: adding }}
          onClose={() => setAdding(null)}
          onSaved={(p) => void onProblemAdded(p)}
        />
      )}

      {catalog && filtered && (
        <CatalogFilterBar
          filter={filter}
          onChange={applyFilter}
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
            onClick={() => applyFilter(EMPTY_FILTER)}
            className="mt-4 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            Show all problems
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered?.topics.map(({ topic, matches }) => (
            <CategoryAccordion
              key={topic.topic}
              topic={topic}
              open={
                filterActive
                  ? !collapsedWhileFiltering.has(topic.topic)
                  : openTopics.has(topic.topic)
              }
              onToggle={() => toggleTopic(topic.topic)}
              onAdd={() => setAdding([topic.topic])}
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
