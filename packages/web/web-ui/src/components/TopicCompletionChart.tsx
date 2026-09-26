import type { CatalogResponse } from '../lib/api';
import { completionPercent, topicCompletionBars } from '../lib/analytics';

/**
 * Per-topic completion chart (M4, ADR 0006): hand-built inline-SVG horizontal
 * bars, one per catalog topic, with an emerald fill proportional to that
 * topic's done/total completion (from `GET /api/catalog`). No external chart
 * library/CDN — `<rect>`/`<text>` only, driven by the pure `analytics`
 * geometry helpers so it stays local-first and unit-testable.
 *
 * Each row is a self-contained SVG so the list scales to any number of topics
 * without a fixed-height overflow. Values render as JSX text (auto-escaped).
 */

// Row geometry (SVG user units). The track spans the full width; the label
// sits above each track so long topic names never clip the bar.
const ROW_WIDTH = 480;
const TRACK_HEIGHT = 12;
const AXIS_LENGTH = ROW_WIDTH; // bar fills the full track width at 100%

export function TopicCompletionChart({
  catalog,
}: {
  catalog: CatalogResponse;
}): JSX.Element {
  const bars = topicCompletionBars(catalog, AXIS_LENGTH);

  return (
    <ul className="space-y-3">
      {bars.map((bar) => {
        const pct = completionPercent(bar.done, bar.total);
        return (
          <li key={bar.topic}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-slate-200">
                {bar.label}
              </span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {bar.done} / {bar.total}
                <span className="ml-2 text-slate-500">({pct}%)</span>
              </span>
            </div>
            <svg
              viewBox={`0 0 ${ROW_WIDTH} ${TRACK_HEIGHT}`}
              className="h-3 w-full"
              role="img"
              aria-label={`${bar.label}: ${bar.done} of ${bar.total} done (${pct}%)`}
              preserveAspectRatio="none"
            >
              <title>
                {bar.label}: {bar.done} of {bar.total} done ({pct}%)
              </title>
              {/* Track. */}
              <rect
                x={0}
                y={0}
                width={ROW_WIDTH}
                height={TRACK_HEIGHT}
                rx={TRACK_HEIGHT / 2}
                fill="#334155" /* slate-700 */
              />
              {/* Emerald completion fill. */}
              {bar.length > 0 && (
                <rect
                  x={0}
                  y={0}
                  width={bar.length}
                  height={TRACK_HEIGHT}
                  rx={TRACK_HEIGHT / 2}
                  fill="#22c55e" /* emerald-500 / status.done */
                />
              )}
            </svg>
          </li>
        );
      })}
    </ul>
  );
}
