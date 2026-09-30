import { useEffect, useState } from 'react';
import { ArrowRight, FolderSearch, History, X } from 'lucide-react';
import { fetchDataDir } from '../lib/api';
import type { DataDirStatus } from '../lib/api';
import { dataHref, isPlainClick, navigate } from '../lib/router';
import { DockerNotices } from './DockerNotices';

/**
 * "Don't see your solved problems?" banner on Home and Analytics (ADR 0009
 * D1). It is the recovery path for the w2d data-dir change, so:
 *
 *  - active folder has 0 notes → shown, NOT dismissible (links to /data);
 *  - another notes folder was found → neutral "review it" variant; dismissible
 *    (this browser tab only, `sessionStorage`) once the active folder has notes.
 *
 * Fails closed: if `/api/data-dir` cannot be read, nothing is shown.
 */

/** sessionStorage key for the (per-tab) dismissal of the restore banner. */
export const DATA_BANNER_DISMISSED_KEY = 'ibai.dataBanner.dismissed';

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DATA_BANNER_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function DataFolderBanner(): JSX.Element | null {
  const [status, setStatus] = useState<DataDirStatus | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);

  useEffect(() => {
    let cancelled = false;
    fetchDataDir()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // No banner when the status cannot be read.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === null) return null;
  // Docker-only notices (ADR 0011 D3): never dismissible.
  const docker =
    status.docker &&
    (!status.docker.writable ||
      status.docker.hostConfigDataDir !== undefined) ? (
      <DockerNotices docker={status.docker} />
    ) : null;
  const empty = status.noteCount === 0;
  const hasCandidate = status.legacyCandidates.length > 0;
  // Dismissible only when there are notes already (0 notes → always shown).
  const dismissible = !empty;
  if ((!empty && !hasCandidate) || (dismissible && dismissed)) {
    return docker === null ? null : <div className="mb-6">{docker}</div>;
  }

  const Icon = hasCandidate ? History : FolderSearch;
  const message = hasCandidate
    ? 'A folder with InterviewBudAI notes was found — review it'
    : "Don't see your solved problems? Point InterviewBudAI at your existing folder or import a CSV";

  return (
    <>
      {docker !== null && <div className="mb-3">{docker}</div>}
      <div
        role="region"
        aria-label="Data folder"
        className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-slate-200"
      >
        <Icon className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
        <p className="flex-1">{message}</p>
        <a
          href={dataHref()}
          onClick={(e) => {
            if (isPlainClick(e)) {
              e.preventDefault();
              navigate(dataHref());
            }
          }}
          className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400"
        >
          Your data
          <ArrowRight className="h-4 w-4" aria-hidden />
        </a>
        {dismissible && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              try {
                window.sessionStorage.setItem(DATA_BANNER_DISMISSED_KEY, '1');
              } catch {
                // Storage unavailable: dismiss for this render only.
              }
              setDismissed(true);
            }}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-all duration-200 hover:bg-slate-800 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </>
  );
}
