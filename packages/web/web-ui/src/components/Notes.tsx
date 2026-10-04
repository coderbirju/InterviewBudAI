import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Database,
  ExternalLink,
  Loader2,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import {
  ApiError,
  ProblemApiError,
  deleteProblem,
  fetchCatalog,
  fetchNote,
  fetchPreferences,
  normalizeDifficulty,
  saveNote,
  savePreferences,
} from '../lib/api';
import type {
  CatalogProblem,
  CatalogResponse,
  CodeLanguage,
  FullNote,
  NoteStatus,
  WireDifficulty,
} from '../lib/api';
import { setFlash } from '../lib/flash';
import { buildTemplate, isEmptyNote, starterFor } from '../lib/noteTemplate';
import { useProblemStatement } from '../lib/useProblemStatement';
import { lastHomeHref, navigate } from '../lib/router';
import { CustomBadge } from './CustomBadge';
import { DifficultyBadge } from './DifficultyBadge';
import { IntuitionCheck } from './IntuitionCheck';
import { Modal } from './Modal';
import { NoteContentField } from './NoteContentField';
import { ProblemStatementPane } from './ProblemStatementPane';
import { ProblemForm } from './ProblemForm';
import type { TopicOption } from './ProblemForm';
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
 *
 * w2b (ADR 0010 D5): for a custom problem the header shows a "Custom" badge,
 * its plain-text statement (escaped, line breaks kept) and Edit / Delete.
 * Delete confirms first; if the problem has a note (409 `hasNote`) a second,
 * explicit confirm deletes both (the server backs the folder up first), then
 * Home shows a notice with the backup path.
 *
 * ADR 0015 D5: a split view — the statement pane (left; first, in an open
 * `<details>`, on narrow screens) and the editor (right). D3: once the final
 * statement state is known, an empty note is prefilled with the starter code
 * and an existing note without the signature gets a fenced starter block
 * appended. Neither is saved on open: "Unsaved changes" shows until Save.
 */

/** The statement pane is labelled by the problem title (ADR 0015 D5). */
const TITLE_ID = 'notes-problem-title';

/** The delete flow: closed, first confirm, or the note-too confirm. */
type DeleteStep =
  | { readonly kind: 'closed' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'confirm-note' };

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
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>({
    kind: 'closed',
  });
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ADR 0015: the statement flow, the code language, the one-time template.
  const flow = useProblemStatement(problemId);
  const [language, setLanguage] = useState<CodeLanguage>('python');
  const [prefsSettled, setPrefsSettled] = useState(false);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [languageError, setLanguageError] = useState<string | null>(null);
  /** The template ran (or was skipped) for this problem. */
  const templateDone = useRef(false);
  /** The user edited the note text before the template could run. */
  const userTyped = useRef(false);
  /** The untouched empty-note template, for the language switch rule. */
  const untouched = useRef<{ lang: CodeLanguage; text: string } | null>(null);

  useEffect(() => {
    templateDone.current = false;
    userTyped.current = false;
    untouched.current = null;
  }, [problemId]);

  useEffect(() => {
    let cancelled = false;
    fetchPreferences()
      .then((prefs) => {
        if (!cancelled) setLanguage(prefs.language);
      })
      .catch(() => {
        // Keep the default (Python); the server is authoritative on save.
      })
      .finally(() => {
        if (!cancelled) setPrefsSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        // Defensive at the boundary: a partial payload must not crash the editor.
        setContent(note.content ?? '');
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
          setCatalog(catalog);
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
      setContent(persisted.content ?? '');
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

  const snippetFor = useCallback(
    (lang: CodeLanguage): string | null =>
      flow.statement && !flow.statement.custom && !problem?.custom
        ? flow.statement.snippets[lang]
        : null,
    [flow.statement, problem],
  );

  // D3: once, after the note loaded, the statement state is final and the
  // language is known. Skipped when the user already typed.
  useEffect(() => {
    if (templateDone.current) return;
    if (load.kind !== 'ready' || flow.phase !== 'done' || !prefsSettled) {
      return;
    }
    templateDone.current = true;
    if (userTyped.current) return;
    const next = starterFor(content, snippetFor(language), language);
    if (next === null) return;
    untouched.current = isEmptyNote(content)
      ? { lang: language, text: next }
      : null;
    setContent(next);
  }, [load.kind, flow.phase, prefsSettled, content, language, snippetFor]);

  const onLanguageChange = useCallback(
    async (next: CodeLanguage): Promise<void> => {
      setLanguageBusy(true);
      setLanguageError(null);
      try {
        const prefs = await savePreferences({ language: next });
        const prev = language;
        setLanguage(prefs.language);
        // An untouched template of the old language becomes the new one.
        const t = untouched.current;
        if (t && t.lang === prev && content === t.text) {
          const text = buildTemplate(
            snippetFor(prefs.language),
            prefs.language,
          );
          untouched.current = { lang: prefs.language, text };
          setContent(text);
        }
      } catch (err) {
        setLanguageError(
          err instanceof ApiError && err.status === 409
            ? 'Your data folder is read-only, so the language was not saved.'
            : 'Could not save the language. Please try again.',
        );
      } finally {
        setLanguageBusy(false);
      }
    },
    [language, content, snippetFor],
  );

  const unsaved =
    load.kind === 'ready' &&
    (content !== (load.note.content ?? '') ||
      status !== load.note.status ||
      timeComplexity !== (load.note.timeComplexity ?? '') ||
      spaceComplexity !== (load.note.spaceComplexity ?? ''));

  const title = useMemo(
    () => problem?.title ?? flow.statement?.title ?? problemId,
    [problem, flow.statement, problemId],
  );
  const difficulty =
    problem?.difficulty ??
    normalizeDifficulty(flow.statement?.difficulty) ??
    null;

  const topicOptions: readonly TopicOption[] = useMemo(
    () =>
      catalog?.topics.map((t) => ({
        id: t.topic,
        label: t.label ?? t.topic,
      })) ?? [],
    [catalog],
  );
  const problemTopics = useMemo(
    () =>
      catalog?.topics
        .filter((t) => t.problems.some((p) => p.id === problemId))
        .map((t) => t.topic) ?? [],
    [catalog, problemId],
  );

  /** Reload the catalog after an edit (title/url/statement/topics). */
  const refreshProblem = useCallback(async (): Promise<void> => {
    try {
      const next = await fetchCatalog();
      setCatalog(next);
      setProblem(findProblem(next, problemId));
    } catch {
      // Keep the current header; a reload will pick the edit up.
    }
  }, [problemId]);

  const closeDelete = useCallback((): void => {
    setDeleteStep({ kind: 'closed' });
    setDeleteError(null);
  }, []);

  const onDelete = useCallback(
    async (deleteNote: boolean): Promise<void> => {
      setDeleteBusy(true);
      setDeleteError(null);
      try {
        const result = await deleteProblem(problemId, { deleteNote });
        setFlash(
          result.noteDeleted && result.backup
            ? `Deleted “${title}” and its note. A backup was saved at ${result.backup}.`
            : `Deleted “${title}”.`,
        );
        navigate(lastHomeHref());
      } catch (err) {
        if (err instanceof ProblemApiError && err.hasNote && !deleteNote) {
          setDeleteStep({ kind: 'confirm-note' });
        } else {
          setDeleteError(
            err instanceof ApiError
              ? err.message
              : 'Could not reach the local API. Please try again.',
          );
        }
      } finally {
        setDeleteBusy(false);
      }
    },
    [problemId, title],
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

  const titleUrl = problem?.url ?? flow.statement?.url ?? null;
  const isCustom = problem?.custom === true || flow.statement?.custom === true;

  // ready — the split view: statement (left / first) and the editor form.
  return (
    <PageShell>
      <div className="lg:grid lg:grid-cols-2 lg:gap-8">
        <section
          aria-labelledby={TITLE_ID}
          className="min-w-0 lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto lg:pr-2"
        >
          {/* Problem title (links out to LeetCode when we know the url). */}
          <div className="flex flex-wrap items-center gap-3">
            {titleUrl ? (
              <a
                id={TITLE_ID}
                href={titleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-100 transition-all duration-200 hover:text-emerald-400"
              >
                {title}
                <ExternalLink className="h-4 w-4 text-slate-500" aria-hidden />
              </a>
            ) : (
              <h1
                id={TITLE_ID}
                className="text-2xl font-bold tracking-tight text-slate-100"
              >
                {title}
              </h1>
            )}
            {difficulty && <DifficultyBadge difficulty={difficulty} />}
            {problem?.custom && <CustomBadge />}
            {problem?.custom && (
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-emerald-500 hover:text-emerald-400"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteStep({ kind: 'confirm' })}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-status-blocked hover:text-status-blocked"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete
                </button>
              </span>
            )}
          </div>

          {/* Narrow screens: one column, the statement first in an open
          <details>. Wide screens: the summary is hidden. */}
          <details open className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-400 lg:hidden">
              Problem
            </summary>
            <div className="mt-3 lg:mt-0">
              <ProblemStatementPane
                flow={flow}
                url={titleUrl}
                custom={isCustom}
                customStatement={
                  problem?.custom ? problem.statement ?? null : null
                }
              />
            </div>
          </details>
        </section>

        <div className="mt-8 min-w-0 lg:mt-0 lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto lg:pr-2">
          {editing && problem && (
            <ProblemForm
              mode="edit"
              problemId={problemId}
              topics={topicOptions}
              initial={{
                title: problem.title,
                url: problem.url ?? '',
                statement: problem.statement ?? '',
                difficulty: problem.difficulty.toLowerCase() as WireDifficulty,
                topics: problemTopics,
              }}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                void refreshProblem();
              }}
            />
          )}

          {deleteStep.kind !== 'closed' && (
            <Modal
              role="alertdialog"
              title={
                deleteStep.kind === 'confirm'
                  ? 'Delete this problem?'
                  : 'This problem has a note'
              }
              onClose={closeDelete}
            >
              <p className="text-sm text-slate-300">
                {deleteStep.kind === 'confirm' ? (
                  <>
                    “{title}” will be removed from your problem list. Quiz
                    history is kept.
                  </>
                ) : (
                  <>
                    Deleting “{title}” also deletes your note for it. A backup
                    of your data folder is made first.
                  </>
                )}
              </p>
              {deleteError && (
                <p
                  role="alert"
                  className="mt-3 flex items-center gap-1.5 text-sm text-status-blocked"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  {deleteError}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDelete}
                  className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() =>
                    void onDelete(deleteStep.kind === 'confirm-note')
                  }
                  className="inline-flex items-center gap-2 rounded-md bg-status-blocked px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleteBusy && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  {deleteStep.kind === 'confirm'
                    ? 'Delete problem'
                    : 'Delete the problem AND its note (a backup is made first)'}
                </button>
              </div>
            </Modal>
          )}

          <form
            className="space-y-6"
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

            {/* Intuition / free-text content: CodeMirror or the textarea (ADR 0014 D2). */}
            <div>
              <NoteContentField
                value={content}
                onChange={(next) => {
                  userTyped.current = true;
                  untouched.current = null;
                  setContent(next);
                  clearSaved();
                }}
                language={language}
                onLanguageChange={(next) => void onLanguageChange(next)}
                languageBusy={languageBusy}
              />
              {languageError && (
                <p role="alert" className="mt-1 text-xs text-status-blocked">
                  {languageError}
                </p>
              )}
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

              {/* ADR 0013 D5: the coach — current editor text, never persisted. */}
              <IntuitionCheck
                problemId={problemId}
                content={content}
                timeComplexity={timeComplexity}
                spaceComplexity={spaceComplexity}
                status={status}
                untouchedTemplate={
                  untouched.current !== null &&
                  content === untouched.current.text
                }
              />

              {/* ADR 0015 D3: a prefill / append is not saved on open. */}
              <span aria-live="polite" className="text-sm text-slate-500">
                {unsaved ? 'Unsaved changes' : ''}
              </span>

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
        </div>
      </div>
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
