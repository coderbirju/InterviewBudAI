import { AlertTriangle, Container } from 'lucide-react';
import type { DockerDataInfo } from '../lib/api';

/**
 * Docker-only notices for the data folder (ADR 0011 D3), shown on Home,
 * Analytics and /data:
 *
 *  - `/data` is not writable → the fix (never a silent fallback);
 *  - the /setup choice outside Docker (host config.json) is another folder → how to use
 *    the same notes here. Only the path is shown; the container cannot read
 *    that folder, so no note count.
 *
 * Paths render as JSX text (auto-escaped). Renders nothing when neither
 * applies.
 */
export function DockerNotices({
  docker,
}: {
  docker: DockerDataInfo;
}): JSX.Element | null {
  const notWritable = !docker.writable;
  const mismatch = docker.hostConfigDataDir;
  if (!notWritable && mismatch === undefined) return null;
  return (
    <div className="space-y-3">
      {notWritable && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-status-blocked/40 bg-status-blocked/10 px-4 py-3 text-sm text-slate-200"
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-status-blocked"
            aria-hidden
          />
          <div>
            <p className="font-semibold">
              Your data folder is not writable in Docker
            </p>
            <p className="mt-1 break-all text-slate-300">
              {docker.writableHelp ??
                'Fix the folder ownership and restart with docker compose up.'}
            </p>
          </div>
        </div>
      )}
      {mismatch !== undefined && (
        <div
          role="region"
          aria-label="Docker data folder"
          className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-slate-200"
        >
          <Container
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
            aria-hidden
          />
          {/* The value is the /setup choice (host config.json); npm start
              ignores it when IBAI_DATA_DIR is set, so name the source. */}
          <p className="break-all">
            Your <code>/setup</code> choice outside Docker is{' '}
            <code>{mismatch}</code> (saved in{' '}
            <code>~/.interviewbudai/config.json</code>; <code>npm start</code>{' '}
            ignores it when <code>IBAI_DATA_DIR</code> is set). To use that
            folder in Docker, set <code>IBAI_HOST_DATA_DIR={mismatch}</code> in{' '}
            <code>.env</code> and restart.
          </p>
        </div>
      )}
    </div>
  );
}
