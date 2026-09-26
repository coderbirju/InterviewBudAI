import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Database,
  ExternalLink,
  Loader2,
  Save,
} from 'lucide-react';
import { ApiError, fetchCatalog, fetchNote, saveNote } from '../lib/api';
import type {
  CatalogProblem,
  CatalogResponse,
  FullNote,
  NoteStatus,
} from '../lib/api';
import { lastHomeHref, navigate } from '../lib/router';
import { StatusControl } from './StatusControl';

/**
 * The M3 Notes / intuition editor page (ADR 0006). Replaces the server-rendered
 * `/notes/<id>` for SPA users. It:
 *  - fetches GET /api/notes/:id (the saved note) + /api/catalog (title/url);
 *  - pre-fills status / intuition / time & space complexity from the saved note;
 *  - saves via POST /api/notes/:id and shows a "Saved" confirmation;
 *  - degrades gracefully: no-DB → create-database CTA (links /data); unknown
 *    problem (404) → friendly not-found; network/API error → inline error.
 *
 * All values render via JSX (auto-escaped) — no dangerouslySetInnerHTML. The
 * server stays the storage owner; this view only calls the same-origin M1 API.
 */

/** Top-level load outcome for the page. */
type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'no-db' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly note: FullNote };

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string };

/** A single labelled shell used for every page state (keeps the chrome consistent). */
function PageShell({ children }: { children: React.ReactNode }): JSX.Element {
  // Return to Home with the user's last search/filter (W3), not a bare `/`.
  const backHref = lastHomeHref();
  return (
    <div>
      <a
        href={backHref}
        onClick={(e) => {
          // Client-side nav (no full reload) when the browser supports it.
          if (
            !e.defaultPrevented &&
            e.button === 0 &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.shiftKey &&
            !e.altKey
          ) {
            e.preventDefault();
            navigate(backHref);
          }
        }}
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-all duration-200 hover:text-emerald-400"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to problems
      </a>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function Notes({ problemId }: { problemId: string }): JSX.Element {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [problem, setProblem] = useState<CatalogProblem | null>(null);

  // Editable form fields (initialized once the note loads).
  const [status, setStatus] = useState<NoteStatus>('none');
  const [content, setContent] = useState('');
  const [timeComplexity, setTimeComplexity] = useState('');
  const [spaceComplexity, setSpaceComplexity] = useState('');

  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      setLoad({ kind: 'loading' });
      setSave({ kind: 'idle' });
      try {
        const result = await fetchNote(problemId);
        if (cancelled) {
          return;
        }
        if ('dbConfigured' in result && result.dbConfigured === false) {
          setLoad({ kind: 'no-db' });
          return;
        }
        const note = result as FullNote;
        // Pre-fill the form from the saved note.
        setStatus(note.status);
        setContent(note.content);
        setTimeComplexity(note.timeComplexity ?? '');
        setSpaceComplexity(note.spaceComplexity ?? '');
        setLoad({ kind: 'ready', note });

        // Best-effort title/url lookup from the catalog. A catalog failure must
        // not break the editor — the id is already valid, so fall back to the id.
        try {
          const catalog: CatalogResponse = await fetchCatalog();
          if (cancelled) {
            return;
          }
          setProblem(findProblem(catalog, problemId));
        } catch {
          // Leave `problem` null; the page shows the id as the title.
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setLoad({ kind: 'not-found' });
        } else {
          setLoad({ kind: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [problemId]);

  const onSave = useCallback(async (): Promise<void> => {
    setSave({ kind: 'saving' });
    try {
      const persisted = await saveNote(problemId, {
        content,
        status,
        timeComplexity,
        spaceComplexity,
      });
      // Reconcile local state with what the server persisted.
      setStatus(persisted.status);
      setContent(persisted.content);
      setTimeComplexity(persisted.timeComplexity ?? '');
      setSpaceComplexity(persisted.spaceComplexity ?? '');
      setLoad({ kind: 'ready', note: persisted });
      setSave({ kind: 'saved' });
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 400
          ? 'No database configured — create one to save notes.'
          : 'Could not save your note. Please try again.';
      setSave({ kind: 'error', message });
    }
  }, [problemId, content, status, timeComplexity, spaceComplexity]);

  // Any edit clears a prior "Saved" confirmation so it never looks stale.
  const clearSaved = useCallback(() => {
    setSave((prev) => (prev.kind === 'saved' ? { kind: 'idle' } : prev));
  }, []);

  const title = useMemo(
    () => problem?.title ?? problemId,
    [problem, problemId],
  );

  if (load.kind === 'loading') {
    return (
      <PageShell>
        <div
          className="flex items-center gap-2 text-slate-400"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Loading your note…
        </div>
      </PageShell>
    );
  }

  if (load.kind === 'no-db') {
    return (
      <PageShell>
        <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-8 text-center">
          <Database
            className="mx-auto h-10 w-10 text-emerald-500"
            aria-hidden
          />
          <h2 className="mt-4 text-xl font-semibold text-slate-100">
            Create your database
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            InterviewBudAI stores your notes in a local folder you own. Create
            one to start saving your intuition and complexity analysis.
          </p>
          <a
            href="/data"
            className="mt-5 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400"
          >
            Create your database
          </a>
        </div>
      </PageShell>
    );
  }

  if (load.kind === 'not-found') {
    return (
      <PageShell>
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-status-revisit/40 bg-status-revisit/10 p-5 text-slate-200"
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-status-revisit"
            aria-hidden
          />
          <div>
            <p className="font-semibold">Problem not found</p>
            <p className="mt-1 text-sm text-slate-400">
              We couldn&apos;t find a problem with id{' '}
              <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                {problemId}
              </code>{' '}
              in the catalog. Head back to the problem list and pick one from
              there.
            </p>
          </div>
        </div>
      </PageShell>
    );
  }

  if (load.kind === 'error') {
    return (
      <PageShell>
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-status-blocked/40 bg-status-blocked/10 p-5 text-slate-200"
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-status-blocked"
            aria-hidden
          />
          <div>
            <p className="font-semibold">Couldn&apos;t load this note</p>
            <p className="mt-1 text-sm text-slate-400">
              The app couldn&apos;t reach the local API. Make sure the server is
              running, then reload the page.
            </p>
          </div>
        </div>
      </PageShell>
    );
  }

  // ready — the editor form.
  return (
    <PageShell>
      {/* Problem title (links out to LeetCode when we know the url). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {problem?.url ? (
          <a
            href={problem.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-100 transition-all duration-200 hover:text-emerald-400"
          >
            {title}
            <ExternalLink className="h-4 w-4 text-slate-500" aria-hidden />
          </a>
        ) : (
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            {title}
          </h1>
        )}
      </div>

      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
      >
        {/* Status */}
        <div>
          <label
            className="block text-sm font-semibold text-slate-300"
            id="status-label"
          >
            Status
          </label>
          <div className="mt-2" aria-labelledby="status-label">
            <StatusControl
              status={status}
              onChange={(next) => {
                setStatus(next);
                clearSaved();
              }}
            />
          </div>
        </div>

        {/* Intuition / free-text content */}
        <div>
          <label
            htmlFor="note-content"
            className="block text-sm font-semibold text-slate-300"
          >
            Intuition &amp; approach
          </label>
          <textarea
            id="note-content"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              clearSaved();
            }}
            rows={10}
            placeholder="Jot down your intuition, the key insight, edge cases, and how you'd approach it next time…"
            className="mt-2 w-full resize-y rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Complexity */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="time-complexity"
              className="block text-sm font-semibold text-slate-300"
            >
              Time complexity
            </label>
            <input
              id="time-complexity"
              type="text"
              value={timeComplexity}
              onChange={(e) => {
                setTimeComplexity(e.target.value);
                clearSaved();
              }}
              placeholder="e.g. O(n)"
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label
              htmlFor="space-complexity"
              className="block text-sm font-semibold text-slate-300"
            >
              Space complexity
            </label>
            <input
              id="space-complexity"
              type="text"
              value={spaceComplexity}
              onChange={(e) => {
                setSpaceComplexity(e.target.value);
                clearSaved();
              }}
              placeholder="e.g. O(1)"
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Save + confirmation / error */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={save.kind === 'saving'}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {save.kind === 'saving' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            {save.kind === 'saving' ? 'Saving…' : 'Save'}
          </button>

          {save.kind === 'saved' && (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-status-done"
            >
              <Check className="h-4 w-4" aria-hidden />
              Saved
            </span>
          )}

          {save.kind === 'error' && (
            <span
              role="alert"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-status-blocked"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {save.message}
            </span>
          )}
        </div>
      </form>
    </PageShell>
  );
}

/** Find a problem across every topic in the catalog (first match wins). */
function findProblem(
  catalog: CatalogResponse,
  problemId: string,
): CatalogProblem | null {
  for (const topic of catalog.topics) {
    for (const p of topic.problems) {
      if (p.id === problemId) {
        return p;
      }
    }
  }
  return null;
}
