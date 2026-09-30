import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  FolderOpen,
  History,
  Info,
  Loader2,
  Lock,
} from 'lucide-react';
import { CsvImport } from './CsvImport';
import { DockerNotices } from './DockerNotices';
import {
  ApiError,
  checkDataDir,
  dismissLegacyData,
  dockerPinnedText,
  fetchDataDir,
  switchDataDir,
} from '../lib/api';
import type {
  DataDirInspection,
  DataDirSource,
  DataDirStatus,
  LegacyCandidate,
} from '../lib/api';

/**
 * "Your data" (`/data`, ADR 0009 D1) — the SPA's data-setup page:
 *
 *  1. Active folder — path, where it came from, note count; read-only with an
 *     "how to unpin" explanation when pinned by `--data-dir` / `IBAI_DATA_DIR`.
 *  2. Found previous data — one card per legacy candidate (cookie-era folder
 *     or `~/.ibai/data`): "Use it" = a normal `POST /api/data-dir { path }`
 *     (re-validated server-side), "Dismiss" = forget them.
 *  3. Use an existing folder — path field, "Check" (dry run: what is there)
 *     and "Use this folder" (switch); inline server validation errors.
 *  4. Import CSV — `CsvImport` (ADR 0009 D2): preview, choose, import.
 *
 * Every path is rendered as JSX text (auto-escaped); no raw HTML.
 */

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly status: DataDirStatus };

const SOURCE_LABEL: Record<DataDirSource, string> = {
  flag: 'Pinned by the --data-dir flag',
  env: 'Pinned by the IBAI_DATA_DIR environment variable',
  config: 'Chosen by you (saved in ~/.interviewbudai/config.json)',
  default: 'Default location',
};

/** "1 note" / "25 notes". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong talking to the local server. Please try again.';
}

const CARD = 'rounded-xl border border-slate-800 bg-slate-800/40 p-6';
const PRIMARY_BTN =
  'rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BTN =
  'rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-emerald-500 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-50';

export function DataPage(): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [pathInput, setPathInput] = useState('');
  const [busy, setBusy] = useState<'check' | 'switch' | 'legacy' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<DataDirInspection | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDataDir()
      .then((status) => {
        if (!cancelled) setLoad({ kind: 'ready', status });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error' });
      });
    return () => {
      cancelled = true;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((message: string): void => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  /** Switch to `path` (from the form or a legacy card). */
  const chooseFolder = useCallback(
    async (path: string, from: 'switch' | 'legacy'): Promise<void> => {
      setBusy(from);
      setFormError(null);
      setLegacyError(null);
      try {
        const status = await switchDataDir(path);
        setLoad({ kind: 'ready', status });
        setInspection(null);
        setPathInput('');
        showToast(
          `Now using ${status.dataDir} — ${plural(status.noteCount, 'note')} found.`,
        );
      } catch (err) {
        if (from === 'legacy') setLegacyError(errorMessage(err));
        else setFormError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [showToast],
  );

  const onCheck = useCallback(async (): Promise<void> => {
    setBusy('check');
    setFormError(null);
    setInspection(null);
    try {
      setInspection(await checkDataDir(pathInput));
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [pathInput]);

  const onDismiss = useCallback(async (): Promise<void> => {
    setBusy('legacy');
    setLegacyError(null);
    try {
      setLoad({ kind: 'ready', status: await dismissLegacyData() });
    } catch (err) {
      setLegacyError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, []);

  if (load.kind === 'loading') {
    return (
      <div
        className="flex items-center gap-2 text-slate-400"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Loading your data folder…
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
          <p className="font-semibold">Couldn&apos;t load your data folder</p>
          <p className="mt-1 text-sm text-slate-400">
            The app couldn&apos;t reach the local API. Make sure the server is
            running, then reload the page.
          </p>
        </div>
      </div>
    );
  }

  const { status } = load;
  const trimmed = pathInput.trim();

  return (
    <div className="space-y-6">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-10 flex max-w-md items-start gap-2 rounded-xl border border-emerald-500/40 bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-lg transition-all duration-200"
        >
          <CircleCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
            aria-hidden
          />
          <span className="break-all">{toast}</span>
        </div>
      )}

      {/* 1. Active folder */}
      <section aria-labelledby="active-folder" className={CARD}>
        <h2
          id="active-folder"
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400"
        >
          <FolderOpen className="h-4 w-4" aria-hidden />
          Active folder
        </h2>
        <p
          className="mt-3 break-all font-mono text-slate-100"
          data-testid="active-path"
        >
          {status.dataDir}
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Source</dt>
            <dd className="text-slate-200" data-testid="data-source">
              {status.docker
                ? dockerPinnedText(status.docker)
                : SOURCE_LABEL[status.source]}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Notes</dt>
            <dd className="text-slate-200" data-testid="note-count">
              {plural(status.noteCount, 'note')}
            </dd>
          </div>
        </dl>
        {!status.exists && (
          <p className="mt-3 text-sm text-status-revisit">
            This folder does not exist yet. It is created when you choose it
            below (or create it yourself).
          </p>
        )}
        {status.docker && (
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="break-all" data-testid="docker-pinned">
                {dockerPinnedText(status.docker)}. Inside Docker this folder is
                shown as <code>{status.dataDir}</code>
                {status.docker.hostDataDir !== null && (
                  <>
                    {' '}
                    (on your computer: <code>{status.docker.hostDataDir}</code>)
                  </>
                )}
                , including backups under <code>{status.dataDir}/.backups</code>
                . To use another folder, set <code>IBAI_HOST_DATA_DIR</code> in{' '}
                <code>.env</code> and restart <code>docker compose up</code>.
              </p>
            </div>
            <DockerNotices docker={status.docker} />
          </div>
        )}
        {status.pinned && !status.docker && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              This folder is pinned by{' '}
              {status.source === 'flag' ? (
                <code>--data-dir</code>
              ) : (
                <code>IBAI_DATA_DIR</code>
              )}
              , so it can&apos;t be changed here. To choose a folder on this
              page, restart the server without the <code>--data-dir</code> flag
              and with <code>IBAI_DATA_DIR</code> unset.
            </p>
          </div>
        )}
      </section>

      {/* 2. Found previous data */}
      {status.legacyCandidates.length > 0 && (
        <section
          aria-labelledby="previous-data"
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6"
        >
          <h2
            id="previous-data"
            className="flex items-center gap-2 font-semibold text-slate-100"
          >
            <History className="h-5 w-5 text-emerald-400" aria-hidden />
            Found previous data
          </h2>
          <ul className="mt-3 space-y-3">
            {status.legacyCandidates.map((c: LegacyCandidate) => (
              <li
                key={c.path}
                className="rounded-md border border-slate-800 bg-slate-900/60 p-4"
              >
                <p className="text-sm text-slate-300">
                  A folder with InterviewBudAI notes was found at{' '}
                  <span className="break-all font-mono text-slate-100">
                    {c.path}
                  </span>{' '}
                  ({plural(c.noteCount, 'note')}). Only use it if you recognise
                  it.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {c.origin === 'legacy-default'
                    ? 'Found at the old default location (~/.ibai/data).'
                    : 'Suggested by an old browser setting — any local page can set it, so check the path.'}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className={PRIMARY_BTN}
                    disabled={busy !== null}
                    onClick={() => void chooseFolder(c.path, 'legacy')}
                  >
                    Use it
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={`mt-3 ${SECONDARY_BTN}`}
            disabled={busy !== null}
            onClick={() => void onDismiss()}
          >
            Dismiss
          </button>
          {legacyError && (
            <p role="alert" className="mt-3 text-sm text-status-blocked">
              {legacyError}
            </p>
          )}
        </section>
      )}

      {/* 3. Use an existing folder (never offered under Docker: pinned) */}
      {!status.docker && (
        <section aria-labelledby="use-existing" className={CARD}>
          <h2 id="use-existing" className="font-semibold text-slate-100">
            Use an existing notes folder
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Point InterviewBudAI at a folder that already holds your notes (the
            one containing <code>notes/</code>), or a new folder to start fresh.
            Use an absolute path or one starting with <code>~/</code>.
          </p>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (trimmed) void chooseFolder(pathInput, 'switch');
            }}
          >
            <label htmlFor="data-path" className="block text-sm text-slate-300">
              Folder path
            </label>
            <input
              id="data-path"
              type="text"
              value={pathInput}
              disabled={status.pinned}
              onChange={(e) => {
                setPathInput(e.target.value);
                setInspection(null);
                setFormError(null);
              }}
              placeholder="~/Documents/interview-notes"
              aria-invalid={formError ? true : undefined}
              aria-describedby={formError ? 'data-path-error' : undefined}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 transition-all duration-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className={SECONDARY_BTN}
                disabled={status.pinned || !trimmed || busy !== null}
                onClick={() => void onCheck()}
              >
                {busy === 'check' ? 'Checking…' : 'Check'}
              </button>
              <button
                type="submit"
                className={PRIMARY_BTN}
                disabled={status.pinned || !trimmed || busy !== null}
              >
                {busy === 'switch' ? 'Switching…' : 'Use this folder'}
              </button>
            </div>
            {formError && (
              <p
                id="data-path-error"
                role="alert"
                className="text-sm text-status-blocked"
              >
                {formError}
              </p>
            )}
            {inspection && (
              <InspectionResult
                inspection={inspection}
                onUsePath={setPathInput}
              />
            )}
          </form>
        </section>
      )}

      {/* 4. Import CSV (ADR 0009 D2) */}
      <CsvImport
        folderExists={status.exists}
        onImported={() => {
          fetchDataDir()
            .then((next) => setLoad({ kind: 'ready', status: next }))
            .catch(() => undefined);
        }}
      />
    </div>
  );
}

function InspectionResult({
  inspection,
  onUsePath,
}: {
  inspection: DataDirInspection;
  onUsePath: (path: string) => void;
}): JSX.Element {
  const { hint } = inspection;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
      <div className="space-y-1">
        <p>
          <span className="break-all font-mono text-slate-100">
            {inspection.path}
          </span>
          {': '}
          {inspection.exists
            ? `${plural(inspection.noteCount, 'note')}, ${plural(inspection.quizSessionCount, 'quiz session')}.`
            : "doesn't exist yet — it will be created (empty) if you use it."}
        </p>
        {hint?.kind === 'use-parent' && (
          <p>
            This looks like the <code>notes/</code> folder itself. Your data
            folder is its parent:{' '}
            <button
              type="button"
              className="break-all font-mono text-emerald-400 underline transition-all duration-200 hover:text-emerald-300"
              onClick={() => onUsePath(hint.path)}
            >
              {hint.path}
            </button>
          </p>
        )}
        {hint?.kind === 'not-ibai-format' && (
          <p>
            This folder has Markdown files, but not in InterviewBudAI&apos;s
            format (<code>notes/&lt;id&gt;.md</code>). If they came from Notion,
            use CSV import below instead.
          </p>
        )}
      </div>
    </div>
  );
}
