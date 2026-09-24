import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CatalogTopic, NoteStatus } from '../lib/api';
import { formatFraction, topicCompletion } from '../lib/home';
import { ProblemRow } from './ProblemRow';

/**
 * A collapsible category: header with the topic name, an expand/collapse
 * chevron, and a fractional completion badge (e.g. "2 / 9"). Expanding reveals
 * a spreadsheet-style table of the topic's problems.
 */
export function CategoryAccordion({
  topic,
  defaultOpen = false,
  busyIds,
  onStatusChange,
}: {
  topic: CatalogTopic;
  defaultOpen?: boolean;
  busyIds: ReadonlySet<string>;
  onStatusChange: (id: string, next: NoteStatus) => void;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const { done, total } = topicCompletion(topic);
  const panelId = `topic-panel-${topic.topic.replace(/\s+/g, '-')}`;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-800/30">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-all duration-200 hover:bg-slate-800/60"
      >
        <span className="flex items-center gap-2">
          <ChevronRight
            className={`h-5 w-5 text-slate-400 transition-transform duration-200 ${
              open ? 'rotate-90' : ''
            }`}
            aria-hidden
          />
          <span className="text-base font-semibold text-slate-100">
            {topic.topic}
          </span>
        </span>
        <span
          className="rounded-full bg-slate-700/50 px-2.5 py-0.5 text-xs font-medium text-slate-300"
          aria-label={`${done} of ${total} done in ${topic.topic}`}
        >
          {formatFraction(done, total)}
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
              {topic.problems.map((problem) => (
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
