import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';
import {
  ApiError,
  commitCsvImport,
  fetchCatalog,
  previewCsvImport,
} from '../lib/api';
import type {
  ImportAction,
  ImportCommitResult,
  ImportCustomDecision,
  ImportDecision,
  ImportFileInput,
  ImportPreview,
  ImportPreviewRow,
  ImportUnmatchedRow,
  NoteStatus,
  WireDifficulty,
} from '../lib/api';
import { STATUS_LABELS, STATUS_ORDER } from '../lib/home';
import { homeHref, isPlainClick, navigate, notesHref } from '../lib/router';

/**
 * "Import notes from CSV" (ADR 0009 D2) — the CSV section of `/data`.
 *
 * Flow: pick files (read client-side as text) → Preview (server parses and
 * matches; no writes) → choose per-problem actions (conflicts default to
 * skip) and a default status → Import (server re-checks the preview hash,
 * backs up the data folder, writes) → summary with the backup path.
 *
 * Unmatched rows (ADR 0010 D4) can each be ticked "Add as custom problem",
 * with a difficulty (default Medium) and a required topic chosen in the row;
 * the server creates the problem from the row's title (and its link if
 * http(s)), then writes the row's note to it.
 *
 * Every CSV value is rendered as JSX text (auto-escaped); no raw HTML.
 */

/** An unmatched row the user ticked "Add as custom problem" (topic '' = not chosen yet). */
interface CustomRowChoice {
  readonly difficulty: WireDifficulty;
  readonly topic: string;
}

/** Topic choices for custom rows (from `/api/catalog`). */
type TopicList =
  | { readonly kind: 'idle' | 'loading' | 'error' }
  | {
      readonly kind: 'ready';
      readonly topics: readonly { id: string; label: string }[];
    };

/** Client-side mirrors of the server limits (the server re-checks). */
export const CSV_MAX_FILES = 64;
export const CSV_MAX_REQUEST_BYTES = 1024 * 1024;

const CARD = 'rounded-xl border border-slate-800 bg-slate-800/40 p-6';
const PRIMARY_BTN =
  'rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition-all duration-200 hover:border-emerald-500 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-50';
const SELECT =
  'rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 transition-all duration-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50';

const ACTION_LABEL: Record<ImportAction, string> = {
  create: 'Import',
  skip: 'Skip',
  overwrite: 'Overwrite',
  merge: 'Merge',
};

interface PickedFile extends ImportFileInput {
  readonly size: number;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'previewing' }
  | { readonly kind: 'preview'; readonly preview: ImportPreview }
  | { readonly kind: 'committing'; readonly preview: ImportPreview }
  | {
      readonly kind: 'done';
      readonly result: ImportCommitResult;
      /** Row key -> "file line N: title", to label per-row failures. */
      readonly rowLabels: Readonly<Record<string, string>>;
    };

/** "812 B" / "12.3 KB" / "1.1 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function readAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** The unmatched rows as plain text (one per line) for copy / download. */
export function unmatchedAsText(rows: readonly ImportUnmatchedRow[]): string {
  return rows
    .map(
      (r) =>
        `${r.file} line ${r.line}: ${r.title || '(blank title)'}${r.url ? ` — ${r.url}` : ''}`,
    )
    .join('\n');
}

/** Keep custom-row choices whose row is still unmatched after a re-preview. */
function keepCustomRows(
  preview: ImportPreview,
  previous: Readonly<Record<string, CustomRowChoice>>,
): Record<string, CustomRowChoice> {
  const out: Record<string, CustomRowChoice> = {};
  for (const row of preview.unmatched) {
    const prior = previous[row.key];
    if (prior) out[row.key] = prior;
  }
  return out;
}

/** Default decisions: create new notes, skip conflicts, the chosen row. */
function initialDecisions(
  preview: ImportPreview,
  previous: Readonly<Record<string, ImportDecision>> = {},
): Record<string, ImportDecision> {
  const out: Record<string, ImportDecision> = {};
  for (const row of preview.rows) {
    if (!row.match || !row.chosen) continue;
    const id = row.match.problemId;
    const conflict = row.existing === 'note';
    const prior = previous[id];
    const valid =
      prior !== undefined &&
      (conflict
        ? prior.action !== 'create'
        : prior.action === 'create' || prior.action === 'skip');
    out[id] = valid
      ? prior
      : { action: conflict ? 'skip' : 'create', rowKey: row.key };
  }
  return out;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong talking to the local server. Please try again.';
}

export function CsvImport({
  folderExists,
  onImported,
}: {
  /** The active data folder exists (import needs it). */
  folderExists: boolean;
  /** Called after a successful import (e.g. to refresh the note count). */
  onImported?: () => void;
}): JSX.Element {
  const [files, setFiles] = useState<readonly PickedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<NoteStatus>('done');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>(
    {},
  );
  const [customRows, setCustomRows] = useState<Record<string, CustomRowChoice>>(
    {},
  );
  const [topicList, setTopicList] = useState<TopicList>({ kind: 'idle' });
  const [error, setError] = useState<{
    message: string;
    stale: boolean;
  } | null>(null);
  const [bulk, setBulk] = useState<ImportAction>('merge');
  const [copied, setCopied] = useState<string | null>(null);

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const tooBig =
    files.length > CSV_MAX_FILES || totalBytes > CSV_MAX_REQUEST_BYTES;

  const onPick = useCallback(async (list: FileList | null): Promise<void> => {
    setPhase({ kind: 'idle' });
    setError(null);
    setCopied(null);
    setFileError(null);
    const picked = Array.from(list ?? []);
    if (picked.length === 0) {
      setFiles([]);
      return;
    }
    if (picked.length > CSV_MAX_FILES) {
      setFiles([]);
      setFileError(
        `You picked ${picked.length} files; the limit is ${CSV_MAX_FILES} per import. Import them in batches.`,
      );
      return;
    }
    try {
      const read = await Promise.all(
        picked.map(async (f) => {
          const text = await readAsText(f);
          return { name: f.name, text, size: utf8Bytes(text) };
        }),
      );
      setFiles(read);
      const total = read.reduce((n, f) => n + f.size, 0);
      if (total > CSV_MAX_REQUEST_BYTES) {
        setFileError(
          `These files total ${formatBytes(total)}; the limit is ${formatBytes(CSV_MAX_REQUEST_BYTES)} per import. Import them in smaller batches.`,
        );
      }
    } catch {
      setFiles([]);
      setFileError("Couldn't read the selected files. Try picking them again.");
    }
  }, []);

  const runPreview = useCallback(
    async (status: NoteStatus): Promise<void> => {
      const payload = files.map(({ name, text }) => ({ name, text }));
      if (
        utf8Bytes(JSON.stringify({ files: payload, defaultStatus: status })) >
        CSV_MAX_REQUEST_BYTES
      ) {
        setFileError(
          `These files are too large to send in one import (limit ${formatBytes(CSV_MAX_REQUEST_BYTES)}). Import them in smaller batches.`,
        );
        return;
      }
      const previous = decisions;
      const previousCustom = customRows;
      setPhase({ kind: 'previewing' });
      setError(null);
      try {
        const preview = await previewCsvImport(payload, status);
        setDecisions(initialDecisions(preview, previous));
        setCustomRows(keepCustomRows(preview, previousCustom));
        setPhase({ kind: 'preview', preview });
      } catch (err) {
        setError({ message: errorMessage(err), stale: false });
        setPhase({ kind: 'idle' });
      }
    },
    [files, decisions, customRows],
  );

  const runCommit = useCallback(
    async (preview: ImportPreview): Promise<void> => {
      setPhase({ kind: 'committing', preview });
      setError(null);
      const all: Record<string, ImportDecision | ImportCustomDecision> = {
        ...decisions,
      };
      for (const [key, choice] of Object.entries(customRows)) {
        all[key] = {
          action: 'add-custom',
          difficulty: choice.difficulty,
          topics: [choice.topic],
        };
      }
      const rowLabels: Record<string, string> = {};
      for (const row of preview.unmatched) {
        rowLabels[row.key] =
          `${row.file} line ${row.line}: ${row.title || '(blank title)'}`;
      }
      try {
        const result = await commitCsvImport(
          files.map(({ name, text }) => ({ name, text })),
          preview.previewHash,
          defaultStatus,
          all,
        );
        setPhase({ kind: 'done', result, rowLabels });
        onImported?.();
      } catch (err) {
        const stale = err instanceof ApiError && err.status === 409;
        setError({ message: errorMessage(err), stale });
        setPhase({ kind: 'preview', preview });
      }
    },
    [files, defaultStatus, decisions, customRows, onImported],
  );

  const reset = (): void => {
    setFiles([]);
    setDecisions({});
    setCustomRows({});
    setError(null);
    setFileError(null);
    setCopied(null);
    setPhase({ kind: 'idle' });
  };

  const preview =
    phase.kind === 'preview' || phase.kind === 'committing'
      ? phase.preview
      : null;
  const busy = phase.kind === 'previewing' || phase.kind === 'committing';
  const needsTopics = (preview?.unmatched.length ?? 0) > 0;

  // Topics for "Add as custom problem": fetched once, when first needed.
  useEffect(() => {
    if (!needsTopics || topicList.kind !== 'idle') return;
    setTopicList({ kind: 'loading' });
    fetchCatalog().then(
      (catalog) =>
        setTopicList({
          kind: 'ready',
          topics: catalog.topics.map((t) => ({
            id: t.topic,
            label: t.label ?? t.topic,
          })),
        }),
      () => setTopicList({ kind: 'error' }),
    );
  }, [needsTopics, topicList.kind]);

  return (
    <section aria-labelledby="import-csv" className={CARD}>
      <h2
        id="import-csv"
        className="flex items-center gap-2 font-semibold text-slate-100"
      >
        <FileSpreadsheet className="h-5 w-5 text-emerald-400" aria-hidden />
        Import notes from CSV
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Bring in a Notion export (pick every <code>.csv</code> in it; the{' '}
        <code>_all.csv</code> copies are de-duplicated). Rows are matched to the
        catalog and shown for review first — nothing is written until you press
        Import, and your data folder is backed up right before.
      </p>

      {phase.kind === 'done' ? (
        <ImportSummary
          result={phase.result}
          rowLabels={phase.rowLabels}
          onAgain={reset}
        />
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label
                htmlFor="csv-files"
                className="block text-sm text-slate-300"
              >
                CSV files
              </label>
              <input
                id="csv-files"
                type="file"
                accept=".csv,text/csv"
                multiple
                disabled={busy}
                onChange={(e) => void onPick(e.target.files)}
                className="mt-1 block text-sm text-slate-300 file:mr-3 file:rounded-md file:border file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1.5 file:text-slate-200"
              />
            </div>
            <div>
              <label
                htmlFor="csv-default-status"
                className="block text-sm text-slate-300"
              >
                Status for imported problems
              </label>
              <select
                id="csv-default-status"
                className={`mt-1 ${SELECT}`}
                value={defaultStatus}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value as NoteStatus;
                  setDefaultStatus(next);
                  // The preview hash covers the default status: re-preview.
                  if (preview) void runPreview(next);
                }}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={PRIMARY_BTN}
              disabled={files.length === 0 || tooBig || busy}
              onClick={() => void runPreview(defaultStatus)}
            >
              {phase.kind === 'previewing' ? 'Previewing…' : 'Preview'}
            </button>
          </div>

          {files.length > 0 && (
            <ul
              aria-label="Selected files"
              className="flex flex-wrap gap-2 text-xs text-slate-400"
            >
              {files.map((f, i) => (
                <li
                  key={`${i}:${f.name}`}
                  className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1"
                >
                  <span className="text-slate-200">{f.name}</span>{' '}
                  {formatBytes(f.size)}
                </li>
              ))}
              <li className="px-2 py-1">
                Total {formatBytes(totalBytes)} of{' '}
                {formatBytes(CSV_MAX_REQUEST_BYTES)}
              </li>
            </ul>
          )}

          {fileError && (
            <p role="alert" className="text-sm text-status-blocked">
              {fileError}
            </p>
          )}
          {!folderExists && (
            <p className="text-sm text-status-revisit">
              The active data folder doesn&apos;t exist yet — choose or create
              it above before importing. You can still preview.
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-status-blocked/40 bg-status-blocked/10 p-3 text-sm text-slate-200"
            >
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-status-blocked"
                aria-hidden
              />
              <div className="space-y-2">
                <p>{error.message}</p>
                {error.stale && (
                  <button
                    type="button"
                    className={SECONDARY_BTN}
                    disabled={busy}
                    onClick={() => void runPreview(defaultStatus)}
                  >
                    Re-run preview
                  </button>
                )}
              </div>
            </div>
          )}
          {phase.kind === 'previewing' && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-slate-400"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Reading and matching your rows…
            </p>
          )}

          {preview && (
            <PreviewPanel
              preview={preview}
              decisions={decisions}
              setDecisions={setDecisions}
              customRows={customRows}
              setCustomRows={setCustomRows}
              topicList={topicList}
              defaultStatus={defaultStatus}
              bulk={bulk}
              setBulk={setBulk}
              busy={busy}
              copied={copied}
              setCopied={setCopied}
              canImport={folderExists}
              committing={phase.kind === 'committing'}
              onImport={() => void runCommit(preview)}
            />
          )}
        </div>
      )}
    </section>
  );
}

function PreviewPanel({
  preview,
  decisions,
  setDecisions,
  customRows,
  setCustomRows,
  topicList,
  defaultStatus,
  bulk,
  setBulk,
  busy,
  copied,
  setCopied,
  canImport,
  committing,
  onImport,
}: {
  preview: ImportPreview;
  decisions: Record<string, ImportDecision>;
  setDecisions: (
    next: (
      prev: Record<string, ImportDecision>,
    ) => Record<string, ImportDecision>,
  ) => void;
  customRows: Record<string, CustomRowChoice>;
  setCustomRows: (
    next: (
      prev: Record<string, CustomRowChoice>,
    ) => Record<string, CustomRowChoice>,
  ) => void;
  topicList: TopicList;
  defaultStatus: NoteStatus;
  bulk: ImportAction;
  setBulk: (a: ImportAction) => void;
  busy: boolean;
  copied: string | null;
  setCopied: (s: string | null) => void;
  canImport: boolean;
  committing: boolean;
  onImport: () => void;
}): JSX.Element {
  const conflictIds = useMemo(
    () =>
      preview.rows
        .filter((r) => r.match && r.chosen && r.existing === 'note')
        .map(
          (r) => (r.match as NonNullable<ImportPreviewRow['match']>).problemId,
        ),
    [preview],
  );
  const counts = useMemo(() => {
    const all = Object.values(decisions);
    const custom = Object.values(customRows);
    return {
      problems: all.length,
      create: all.filter((d) => d.action === 'create').length + custom.length,
      writes: all.filter((d) => d.action !== 'skip').length + custom.length,
      conflicts: conflictIds.length,
      custom: custom.length,
      customMissingTopic: custom.filter((c) => c.topic === '').length,
    };
  }, [decisions, customRows, conflictIds]);

  const setCustom = (key: string, next: CustomRowChoice | null): void =>
    setCustomRows((prev) => {
      const out = { ...prev };
      if (next === null) delete out[key];
      else out[key] = next;
      return out;
    });

  const update = (id: string, patch: Partial<ImportDecision>): void =>
    setDecisions((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const rowKey = patch.rowKey ?? current.rowKey;
      const status = 'status' in patch ? patch.status : current.status;
      return {
        ...prev,
        [id]: {
          action: patch.action ?? current.action,
          ...(rowKey !== undefined && { rowKey }),
          ...(status !== undefined && { status }),
        },
      };
    });

  const unmatchedText = unmatchedAsText(preview.unmatched);

  const copyUnmatched = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(unmatchedText);
      setCopied('Copied the unmatched list.');
    } catch {
      setCopied("Couldn't copy — select the list below and copy it.");
    }
  };

  const downloadUnmatched = (): void => {
    if (typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(
      new Blob([`${unmatchedText}\n`], { type: 'text/plain;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'unmatched-rows.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <dl
        aria-label="Preview summary"
        className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6"
      >
        <Stat label="Problems matched" value={counts.problems} />
        <Stat label="New notes" value={counts.create} />
        <Stat label="Conflicts" value={counts.conflicts} />
        <Stat
          label="Unmatched rows"
          value={preview.unmatched.length - counts.custom}
        />
        <Stat
          label="Duplicates collapsed"
          value={preview.duplicatesCollapsed}
        />
        <Stat label="Blank rows skipped" value={preview.blankRows} />
      </dl>

      {preview.errors.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-status-blocked/40 bg-status-blocked/10 p-3 text-sm text-slate-200"
        >
          <p className="font-medium">
            These files could not be read and are skipped entirely:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {preview.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono">{e.file}</span>: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {conflictIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
          <label htmlFor="csv-bulk">Apply to all conflicts:</label>
          <select
            id="csv-bulk"
            className={SELECT}
            value={bulk}
            disabled={busy}
            onChange={(e) => setBulk(e.target.value as ImportAction)}
          >
            {(['skip', 'overwrite', 'merge'] as const).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={busy}
            onClick={() =>
              setDecisions((prev) => {
                const next = { ...prev };
                for (const id of conflictIds) {
                  const d = next[id];
                  if (d) next[id] = { ...d, action: bulk };
                }
                return next;
              })
            }
          >
            Apply
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2">
                Row
              </th>
              <th scope="col" className="px-3 py-2">
                Matched problem
              </th>
              <th scope="col" className="px-3 py-2">
                State
              </th>
              <th scope="col" className="px-3 py-2">
                Action
              </th>
              <th scope="col" className="px-3 py-2">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {preview.rows.map((row) => (
              <PreviewTableRow
                key={row.key}
                row={row}
                decision={
                  row.match ? decisions[row.match.problemId] : undefined
                }
                defaultStatus={defaultStatus}
                busy={busy}
                onChange={update}
              />
            ))}
          </tbody>
        </table>
      </div>

      {preview.unmatched.length > 0 && (
        <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-slate-300">
              {preview.unmatched.length} row
              {preview.unmatched.length === 1 ? '' : 's'} matched no catalog
              problem. Tick &ldquo;Add as custom problem&rdquo; to keep a row
              (pick its difficulty and topic); the rest won&apos;t be imported.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className={SECONDARY_BTN}
                onClick={() => void copyUnmatched()}
              >
                <Copy className="h-4 w-4" aria-hidden />
                Copy list
              </button>
              <button
                type="button"
                className={SECONDARY_BTN}
                onClick={downloadUnmatched}
              >
                <Download className="h-4 w-4" aria-hidden />
                Download list
              </button>
            </div>
          </div>
          {copied && (
            <p role="status" className="mt-2 text-xs text-slate-400">
              {copied}
            </p>
          )}
          {topicList.kind === 'error' && (
            <p role="alert" className="mt-2 text-xs text-status-blocked">
              Couldn&apos;t load the topic list, so rows can&apos;t be added as
              custom problems right now. Reload the page to try again.
            </p>
          )}
          <ul aria-label="Unmatched rows to add" className="mt-3 space-y-2">
            {preview.unmatched.map((row) => (
              <UnmatchedRowChoice
                key={row.key}
                row={row}
                choice={customRows[row.key]}
                topicList={topicList}
                busy={busy}
                onChange={(next) => setCustom(row.key, next)}
              />
            ))}
          </ul>
          <pre
            aria-label="Unmatched rows"
            className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-slate-400"
          >
            {unmatchedText}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={PRIMARY_BTN}
          disabled={
            busy ||
            !canImport ||
            counts.writes === 0 ||
            counts.customMissingTopic > 0
          }
          onClick={onImport}
        >
          {committing
            ? 'Importing…'
            : `Import ${counts.writes} note${counts.writes === 1 ? '' : 's'}`}
        </button>
        {counts.writes === 0 && (
          <span className="text-sm text-slate-500">
            Nothing to import with the current choices.
          </span>
        )}
        {counts.customMissingTopic > 0 && (
          <span className="text-sm text-status-revisit">
            Choose a topic for every row you&apos;re adding as a custom problem.
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-100">{value}</dd>
    </div>
  );
}

function PreviewTableRow({
  row,
  decision,
  defaultStatus,
  busy,
  onChange,
}: {
  row: ImportPreviewRow;
  decision: ImportDecision | undefined;
  defaultStatus: NoteStatus;
  busy: boolean;
  onChange: (id: string, patch: Partial<ImportDecision>) => void;
}): JSX.Element {
  const match = row.match;
  const selected = match !== null && decision?.rowKey === row.key;
  const conflict = row.existing === 'note';
  const titleText = row.title || '(blank title)';
  let state: string;
  if (!match) state = 'Unmatched';
  else if (!selected) state = 'Another row is used';
  else state = conflict ? 'Conflict (note exists)' : 'New';
  const actions: readonly ImportAction[] = conflict
    ? ['skip', 'overwrite', 'merge']
    : ['create', 'skip'];

  return (
    <tr data-testid={`import-row-${row.key}`} className="align-top">
      <td className="px-3 py-2">
        <p className="break-words text-slate-100">{titleText}</p>
        <p className="text-xs text-slate-500">
          {row.file}, line {row.line}
        </p>
        {row.fields.referenceApproach !== undefined && (
          <p
            data-testid={`import-reference-${row.key}`}
            className="mt-1 break-words text-xs text-slate-400"
          >
            <span className="font-semibold text-slate-300">
              Reference approach (from “{row.fields.referenceColumn ?? ''}”):
            </span>{' '}
            {row.fields.referenceApproach}
          </p>
        )}
        {row.warnings.map((w, i) => (
          <p key={i} className="mt-1 text-xs text-status-revisit">
            {w}
          </p>
        ))}
      </td>
      <td className="px-3 py-2">
        {match ? (
          <>
            <p className="text-slate-200">{match.title}</p>
            <p className="text-xs text-slate-500">
              {match.problemId} · by {match.by}
            </p>
          </>
        ) : (
          <span className="text-slate-500">Unmatched</span>
        )}
      </td>
      <td
        className={`px-3 py-2 ${conflict && selected ? 'text-status-revisit' : 'text-slate-300'}`}
      >
        {state}
      </td>
      <td className="px-3 py-2">
        {match && selected && decision ? (
          <select
            aria-label={`Action for ${match.title}`}
            className={SELECT}
            value={decision.action}
            disabled={busy}
            onChange={(e) =>
              onChange(match.problemId, {
                action: e.target.value as ImportAction,
              })
            }
          >
            {actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        ) : match && decision ? (
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={busy}
            aria-label={`Use ${row.file} line ${row.line} for ${match.title}`}
            onClick={() => onChange(match.problemId, { rowKey: row.key })}
          >
            Use this row
          </button>
        ) : null}
      </td>
      <td className="px-3 py-2">
        {match && selected && decision && decision.action !== 'skip' && (
          <select
            aria-label={`Status for ${match.title}`}
            className={SELECT}
            value={decision.status ?? ''}
            disabled={busy}
            onChange={(e) =>
              onChange(match.problemId, {
                status:
                  e.target.value === ''
                    ? undefined
                    : (e.target.value as NoteStatus),
              })
            }
          >
            <option value="">
              {decision.action === 'merge'
                ? 'Keep existing'
                : `Default (${STATUS_LABELS[defaultStatus]})`}
            </option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        )}
      </td>
    </tr>
  );
}

/** One unmatched row: "Add as custom problem" + difficulty + topic. */
function UnmatchedRowChoice({
  row,
  choice,
  topicList,
  busy,
  onChange,
}: {
  row: ImportUnmatchedRow;
  choice: CustomRowChoice | undefined;
  topicList: TopicList;
  busy: boolean;
  onChange: (next: CustomRowChoice | null) => void;
}): JSX.Element {
  const title = row.title || '(blank title)';
  const topics = topicList.kind === 'ready' ? topicList.topics : [];
  return (
    <li
      data-testid={`unmatched-row-${row.key}`}
      className="flex flex-wrap items-center gap-3 rounded-md border border-slate-800 px-3 py-2"
    >
      <label className="flex min-w-0 flex-1 items-center gap-2 text-slate-200">
        <input
          type="checkbox"
          checked={choice !== undefined}
          disabled={busy || topicList.kind === 'error' || row.title === ''}
          onChange={(e) =>
            onChange(
              e.target.checked ? { difficulty: 'medium', topic: '' } : null,
            )
          }
          aria-label={`Add “${title}” as a custom problem`}
          className="accent-emerald-500"
        />
        <span className="min-w-0 break-words">
          {title}
          <span className="ml-2 text-xs text-slate-500">
            {row.file}, line {row.line}
          </span>
        </span>
      </label>
      {choice && (
        <span className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Difficulty for ${title}`}
            className={SELECT}
            value={choice.difficulty}
            disabled={busy}
            onChange={(e) =>
              onChange({
                ...choice,
                difficulty: e.target.value as WireDifficulty,
              })
            }
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <select
            aria-label={`Topic for ${title}`}
            aria-invalid={choice.topic === '' ? true : undefined}
            className={SELECT}
            value={choice.topic}
            disabled={busy || topicList.kind !== 'ready'}
            onChange={(e) => onChange({ ...choice, topic: e.target.value })}
          >
            <option value="">
              {topicList.kind === 'loading'
                ? 'Loading topics…'
                : 'Choose a topic…'}
            </option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </span>
      )}
    </li>
  );
}

function ImportSummary({
  result,
  rowLabels,
  onAgain,
}: {
  result: ImportCommitResult;
  rowLabels: Readonly<Record<string, string>>;
  onAgain: () => void;
}): JSX.Element {
  const failures = result.failed.length;
  const customAdded = result.customCreated?.length ?? 0;
  return (
    <div
      role="status"
      aria-label="Import summary"
      className={`mt-4 space-y-3 rounded-md border p-4 text-sm text-slate-200 ${failures > 0 ? 'border-status-blocked/40 bg-status-blocked/10' : 'border-emerald-500/40 bg-emerald-500/5'}`}
    >
      <p className="flex items-center gap-2 font-semibold text-slate-100">
        {failures > 0 ? (
          <AlertTriangle className="h-5 w-5 text-status-blocked" aria-hidden />
        ) : (
          <CircleCheck className="h-5 w-5 text-emerald-400" aria-hidden />
        )}
        {failures > 0
          ? `Import finished with ${failures} failure${failures === 1 ? '' : 's'}`
          : 'Import finished'}
      </p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <Stat label="Created" value={result.created} />
        <Stat label="Overwritten" value={result.overwritten} />
        <Stat label="Merged" value={result.merged} />
        <Stat label="Skipped" value={result.skipped} />
        {customAdded > 0 && (
          <Stat label="Custom problems added" value={customAdded} />
        )}
        <Stat label="Unmatched" value={result.unmatched} />
        {failures > 0 && <Stat label="Failed" value={failures} />}
      </dl>
      {result.failed.length > 0 && (
        <div role="alert" className="text-status-blocked">
          <p>These notes could not be written:</p>
          <ul className="list-disc pl-5">
            {result.failed.map((f, i) => {
              // The problem was created but its note write failed: say so,
              // so the row is not mistaken for "nothing happened".
              const made =
                f.rowKey !== undefined && f.problemId !== ''
                  ? result.customCreated?.find(
                      (c) =>
                        c.rowKey === f.rowKey && c.problemId === f.problemId,
                    )
                  : undefined;
              return (
                <li key={`${i}:${f.rowKey ?? f.problemId}`}>
                  {made ? (
                    <>
                      Added <span className="font-semibold">{made.title}</span>{' '}
                      as a custom problem, but its note couldn&apos;t be written
                      —{' '}
                      <a
                        href={notesHref(made.problemId)}
                        onClick={(e) => {
                          if (isPlainClick(e)) {
                            e.preventDefault();
                            navigate(notesHref(made.problemId));
                          }
                        }}
                        className="underline"
                      >
                        open it
                      </a>{' '}
                      and add your notes
                    </>
                  ) : (
                    <>
                      <span className="font-mono">
                        {f.rowKey !== undefined
                          ? rowLabels[f.rowKey] ?? f.rowKey
                          : f.problemId}
                      </span>
                      : {f.error}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p>
        Backup saved to{' '}
        <span className="break-all font-mono text-slate-100">
          {result.backup}
        </span>
        . To undo, copy its contents back into your data folder.
      </p>
      <div className="flex gap-2">
        <a
          href={homeHref()}
          onClick={(e) => {
            if (isPlainClick(e)) {
              e.preventDefault();
              navigate(homeHref());
            }
          }}
          className={PRIMARY_BTN}
        >
          Go to your problems
        </a>
        <button type="button" className={SECONDARY_BTN} onClick={onAgain}>
          Import more
        </button>
      </div>
    </div>
  );
}
