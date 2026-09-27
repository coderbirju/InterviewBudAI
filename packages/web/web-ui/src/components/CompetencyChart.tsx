import type { CompetencyResponse } from '../lib/api';
import { competencyBars } from '../lib/competency';

/**
 * Competency chart (ADR 0007 Q4): the quiz-derived competency-intelligence
 * signals, rendered as hand-built inline SVG + lists in the same design-system
 * style as the M4 charts (`StatusBreakdownChart` / `TopicCompletionChart`). No
 * external chart library/CDN — `<rect>`/`<text>` + list rows only, driven by
 * the pure `competency` geometry helpers so it stays local-first and testable.
 *
 * Two parts:
 *  1. A per-topic STRENGTH bar chart, one horizontal row per topic. The fill
 *     color encodes the derived strength band (weak=red, improving=amber,
 *     strong=emerald, unknown=slate); the bar length encodes the correct ratio.
 *     Each row shows the correct/incorrect tally. Rows are worst-first (the
 *     server sorts weak→strong then by most misses) so gaps are scannable.
 *  2. A concise RECURRING MISS PATTERNS list — the recurring things the user
 *     gets wrong / topics to focus next.
 *
 * All values render as JSX text (auto-escaped); nothing uses
 * dangerouslySetInnerHTML (§6.2 / §7.3). The user's OWN outcomes/patterns only.
 */

// Row geometry (SVG user units). Mirrors TopicCompletionChart's track sizing.
const ROW_WIDTH = 480;
const TRACK_HEIGHT = 12;
const AXIS_LENGTH = ROW_WIDTH;

export function CompetencyChart({
  data,
}: {
  data: CompetencyResponse;
}): JSX.Element {
  const bars = competencyBars(data.topics, AXIS_LENGTH);

  return (
    <div className="space-y-6">
      {/* Per-topic strength bars. */}
      {bars.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Topic strength
          </h3>
          <ul className="mt-3 space-y-3">
            {bars.map((bar) => (
              <li key={bar.topicId}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-slate-200">
                    {bar.topicLabel}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums text-slate-400">
                    <span
                      className="rounded px-1.5 py-0.5 text-xs font-semibold"
                      style={{ color: bar.color }}
                    >
                      {bar.label}
                    </span>
                    <span>
                      <span className="text-emerald-400">{bar.correct}</span>
                      {' / '}
                      <span className="text-red-400">{bar.incorrect}</span>
                      <span className="ml-1 text-slate-500">(✓ / ✗)</span>
                    </span>
                  </span>
                </div>
                <svg
                  viewBox={`0 0 ${ROW_WIDTH} ${TRACK_HEIGHT}`}
                  className="h-3 w-full"
                  role="img"
                  aria-label={`${bar.topicLabel}: ${bar.label}, ${bar.correct} correct, ${bar.incorrect} incorrect`}
                  preserveAspectRatio="none"
                >
                  <title>
                    {bar.topicLabel}: {bar.label} ({bar.correct} correct,{' '}
                    {bar.incorrect} incorrect)
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
                  {/* Strength-colored correct-ratio fill. */}
                  {bar.length > 0 && (
                    <rect
                      x={0}
                      y={0}
                      width={bar.length}
                      height={TRACK_HEIGHT}
                      rx={TRACK_HEIGHT / 2}
                      fill={bar.color}
                    />
                  )}
                </svg>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          No per-topic tallies yet — answer a few quiz questions to build them.
        </p>
      )}

      {/* Recurring miss patterns. */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Recurring miss patterns
        </h3>
        {data.patterns.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {data.patterns.map((pattern) => (
              <li
                key={pattern.id}
                className="rounded-lg border border-slate-800 bg-slate-900/40 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-slate-200">
                    {pattern.description}
                  </p>
                  <span
                    className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-300"
                    aria-label={`seen ${pattern.occurrences} times`}
                  >
                    ×{pattern.occurrences}
                  </span>
                </div>
                {pattern.topics.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    {pattern.topics.join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No recurring miss patterns yet. Keep taking quizzes and we&apos;ll
            surface the topics to focus next.
          </p>
        )}
      </div>
    </div>
  );
}
