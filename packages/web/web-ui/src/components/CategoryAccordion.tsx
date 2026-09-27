import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CatalogProblem, CatalogTopic, NoteStatus } from '../lib/api';
import { formatFraction, topicCompletion } from '../lib/home';
import { ProblemRow } from './ProblemRow';

/**
 * A collapsible category: header with the topic name, an expand/collapse
 * chevron, and a fractional completion badge (e.g. "2 / 9"). Expanding reveals
 * a spreadsheet-style table of the topic's problems.
 *
 * When Home's search/filter is active it passes `matches` (the subset of the
 * topic's problems to show) — the header then also shows an emerald "N
 * matches" badge. The done-fraction badge always reflects the whole topic.
 * Home also controls `open`/`onToggle` so it can auto-expand on filter and
 * restore the user's own expanded set on Clear.
 */
export function CategoryAccordion({
  topic,
  defaultOpen = false,
  busyIds,
  onStatusChange,
  matches,
  open: controlledOpen,
  onToggle,
}: {
  topic: CatalogTopic;
  defaultOpen?: boolean;
  /** Filtered subset to render; omitted = all of the topic's problems. */
  matches?: readonly CatalogProblem[];
  /** Controlled expansion (Home owns it); omitted = internal state. */
  open?: boolean;
  onToggle?: () => void;
  busyIds: ReadonlySet<string>;
  onStatusChange: (id: string, next: NoteStatus) => void;
}): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const toggle = onToggle ?? ((): void => setInternalOpen((v) => !v));
  const { done, total } = topicCompletion(topic);
  const panelId = `topic-panel-${topic.topic.replace(/\s+/g, '-')}`;
  const rows = matches ?? topic.problems;
  const label = topic.label ?? topic.topic;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-800/30">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-all duration-200 hover:bg-slate-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
      >
        <span className="flex items-center gap-2">
          <ChevronRight
            className={`h-5 w-5 text-slate-400 transition-transform duration-200 ${
              open ? 'rotate-90' : ''
            }`}
            aria-hidden
          />
          <span className="text-base font-semibold text-slate-100">
            {label}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {matches && (
            <span
              className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400"
              aria-label={`${matches.length} matching in ${label}`}
            >
              {matches.length} {matches.length === 1 ? 'match' : 'matches'}
            </span>
          )}
          <span
            className="rounded-full bg-slate-700/50 px-2.5 py-0.5 text-xs font-medium text-slate-300"
            aria-label={`${done} of ${total} done in ${label}`}
          >
            {formatFraction(done, total)}
          </span>
        </span>
      </button>

      {open && (
        <div id={panelId} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Problem</th>
                <th className="px-4 py-2 font-medium">Difficulty</th>
                <th className="px-4 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((problem) => (
                <ProblemRow
                  key={problem.id}
                  problem={problem}
                  busy={busyIds.has(problem.id)}
                  onStatusChange={onStatusChange}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
