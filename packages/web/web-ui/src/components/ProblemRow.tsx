import type { CatalogProblem, NoteStatus } from '../lib/api';
import { CustomBadge } from './CustomBadge';
import { DifficultyBadge } from './DifficultyBadge';
import { ProblemTitleLink } from './ProblemTitleLink';
import { StatusControl } from './StatusControl';

/**
 * A single problem row in a category's table.
 *
 * Columns (no Solution/Video/Code — we ship no answers, charter §6.2):
 *   1. Status — interactive 4-state control (parent handles optimistic + POST)
 *   2. Problem — the title opens this problem's Notes page in-app; a small
 *      external-link icon opens the problem url in a new tab (no icon for a
 *      custom problem without one); a "Custom" badge for user-added ones
 *   3. Difficulty — Easy/Medium/Hard badge
 *
 * A `done` problem gets an emerald row highlight.
 */
export function ProblemRow({
  problem,
  busy = false,
  onStatusChange,
}: {
  problem: CatalogProblem;
  busy?: boolean;
  onStatusChange: (id: string, next: NoteStatus) => void;
}): JSX.Element {
  const isDone = problem.status === 'done';
  return (
    <tr
      className={`border-t border-slate-800 transition-all duration-200 ${
        isDone
          ? 'bg-emerald-500/5 hover:bg-emerald-500/10'
          : 'hover:bg-slate-800/40'
      }`}
    >
      <td className="px-4 py-2 align-middle">
        <StatusControl
          status={problem.status}
          busy={busy}
          onChange={(next) => onStatusChange(problem.id, next)}
        />
      </td>
      <td className="px-4 py-2 align-middle">
        <span className="inline-flex flex-wrap items-center gap-2">
          <ProblemTitleLink
            problemId={problem.id}
            title={problem.title}
            url={problem.url}
          />
          {problem.custom && <CustomBadge />}
        </span>
      </td>
      <td className="px-4 py-2 align-middle">
        <DifficultyBadge difficulty={problem.difficulty} />
      </td>
    </tr>
  );
}
