import type { ProgressResponse } from '../lib/api';
import { formatFraction, percent } from '../lib/home';

/**
 * Global progress banner: "Overall Progress" with the completed/total fraction,
 * a sleek linear emerald progress bar, and a small status breakdown.
 * Presentational only — data is fetched by the parent and passed in.
 */
export function ProgressBanner({
  progress,
}: {
  progress: ProgressResponse;
}): JSX.Element {
  const { completed, total, byStatus } = progress;
  const pct = percent(completed, total);

  return (
    <section
      aria-label="Overall progress"
      className="rounded-xl border border-slate-800 bg-slate-800/40 p-6"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Overall Progress
        </h2>
        <span className="text-lg font-semibold text-slate-100">
          {formatFraction(completed, total)}
        </span>
      </div>

      <div
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-700/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-label={`${completed} of ${total} problems done`}
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Stat label="Done" value={byStatus.done} className="text-status-done" />
        <Stat
          label="To revisit"
          value={byStatus.to_revisit}
          className="text-status-revisit"
        />
        <Stat
          label="Didn't understand"
          value={byStatus.did_not_understand}
          className="text-status-blocked"
        />
        <Stat
          label="Not started"
          value={byStatus.none}
          className="text-slate-400"
        />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`font-semibold ${className}`}>{value}</dd>
    </div>
  );
}
