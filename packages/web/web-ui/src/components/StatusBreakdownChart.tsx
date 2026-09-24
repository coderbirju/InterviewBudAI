import type { StatusCounts } from '../lib/api';
import { barLength, statusSlices, totalCount } from '../lib/analytics';

/**
 * Status-breakdown chart (M4, ADR 0006): a hand-built inline-SVG vertical bar
 * chart of the four note statuses (done / to_revisit / did_not_understand /
 * none) from `GET /api/progress` `byStatus`, using the design-system status
 * colors. No external chart library/CDN — just `<rect>`/`<text>` driven by the
 * pure `analytics` geometry helpers so it stays local-first and testable.
 *
 * All values render as JSX text (auto-escaped); nothing uses
 * dangerouslySetInnerHTML. The SVG carries a `<title>` + role="img" for a11y.
 */

// Fixed drawing geometry (SVG user units; scales responsively via viewBox).
const WIDTH = 480;
const HEIGHT = 220;
const PAD_TOP = 16;
const PAD_BOTTOM = 44; // room for the x-axis labels + counts
const PAD_X = 16;
const AXIS_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;

export function StatusBreakdownChart({
  byStatus,
}: {
  byStatus: StatusCounts;
}): JSX.Element {
  const slices = statusSlices(byStatus);
  const total = totalCount(byStatus);
  // Scale bars to the largest single-status count so the tallest bar fills the
  // axis; guard a zero max (all-zero) via barLength's own guard.
  const maxCount = slices.reduce((m, s) => Math.max(m, s.count), 0);

  const n = slices.length;
  const gap = 20;
  const bandWidth = (WIDTH - PAD_X * 2 - gap * (n - 1)) / n;
  const baseline = PAD_TOP + AXIS_HEIGHT;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="Problems by status"
      preserveAspectRatio="xMidYMid meet"
    >
      <title>Problems by status</title>

      {/* Baseline axis line. */}
      <line
        x1={PAD_X}
        y1={baseline}
        x2={WIDTH - PAD_X}
        y2={baseline}
        stroke="#334155" /* slate-700 */
        strokeWidth={1}
      />

      {slices.map((slice, i) => {
        const x = PAD_X + i * (bandWidth + gap);
        const h = barLength(slice.count, maxCount, AXIS_HEIGHT);
        const y = baseline - h;
        const cx = x + bandWidth / 2;
        return (
          <g key={slice.status}>
            {/* Bar (rounded top). Zero-count bars render as a thin baseline tick. */}
            <rect
              x={x}
              y={y}
              width={bandWidth}
              height={h}
              rx={4}
              fill={slice.color}
            />
            {/* Count above the bar. */}
            <text
              x={cx}
              y={y - 6}
              textAnchor="middle"
              fontSize={13}
              fontWeight={600}
              fill="#e2e8f0" /* slate-200 */
            >
              {slice.count}
            </text>
            {/* Status label below the axis. */}
            <text
              x={cx}
              y={baseline + 18}
              textAnchor="middle"
              fontSize={12}
              fill="#94a3b8" /* slate-400 */
            >
              {slice.label}
            </text>
          </g>
        );
      })}

      {/* Total caption (bottom-right). */}
      <text
        x={WIDTH - PAD_X}
        y={HEIGHT - 8}
        textAnchor="end"
        fontSize={11}
        fill="#64748b" /* slate-500 */
      >
        {total} tracked
      </text>
    </svg>
  );
}
