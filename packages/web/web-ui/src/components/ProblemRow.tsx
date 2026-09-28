import { ExternalLink, FileText } from 'lucide-react';
import type { CatalogProblem, NoteStatus } from '../lib/api';
import { navigate, notesHref } from '../lib/router';
import { CustomBadge } from './CustomBadge';
import { DifficultyBadge } from './DifficultyBadge';
import { StatusControl } from './StatusControl';

/**
 * A single problem row in a category's table.
 *
 * Columns (no Solution/Video/Code — we ship no answers, charter §6.2):
 *   1. Status — interactive 4-state control (parent handles optimistic + POST)
 *   2. Title  — links out to the problem url (new tab, noopener); plain text
 *      for a custom problem without one; a "Custom" badge for user-added ones
 *   3. Difficulty — Easy/Medium/Hard badge
 *   4. Notes — link to the notes editor for this problem
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
          {problem.url ? (
            <a
              href={problem.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-slate-100 transition-all duration-200 hover:text-emerald-400"
            >
              {problem.title}
              <ExternalLink
                className="h-3.5 w-3.5 text-slate-500"
                aria-hidden
              />
            </a>
          ) : (
            // A custom problem without a link: plain text, no dead anchor.
            <span className="font-medium text-slate-100">{problem.title}</span>
          )}
          {problem.custom && <CustomBadge />}
        </span>
      </td>
      <td className="px-4 py-2 align-middle">
        <DifficultyBadge difficulty={problem.difficulty} />
      </td>
      <td className="px-4 py-2 align-middle">
        {/*
          M3: link to the React notes editor within the SPA (/app/notes/<id>).
          Uses client-side navigation (History API) so there's no full reload;
          it still degrades to a normal link if JS/History is unavailable.
        */}
        <a
          href={notesHref(problem.id)}
          onClick={(e) => {
            if (
              !e.defaultPrevented &&
              e.button === 0 &&
              !e.metaKey &&
              !e.ctrlKey &&
              !e.shiftKey &&
              !e.altKey
            ) {
              e.preventDefault();
              navigate(notesHref(problem.id));
            }
          }}
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-all duration-200 hover:text-emerald-400"
          aria-label={`Open notes for ${problem.title}`}
        >
          <FileText className="h-4 w-4" aria-hidden />
          Notes
        </a>
      </td>
    </tr>
  );
}
