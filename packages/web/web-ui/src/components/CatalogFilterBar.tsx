import { Search, X } from 'lucide-react';
import type { Difficulty, NoteStatus } from '../lib/api';
import {
  DIFFICULTY_ORDER,
  EMPTY_FILTER,
  STATUS_LABELS,
  STATUS_ORDER,
  difficultyBadgeClasses,
  isFilterActive,
  statusDotClasses,
  statusPillClasses,
  toggleValue,
} from '../lib/home';
import type { CatalogFilter } from '../lib/home';

/**
 * Home's search box + difficulty/status filter chips (W3). Controlled: the
 * parent owns the `CatalogFilter` (and mirrors it into the URL); this component
 * only renders it and reports changes. Chips are toggle buttons (`aria-pressed`)
 * so they are keyboard-operable with Tab + Enter/Space.
 */

const CHIP_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';
const CHIP_OFF =
  'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-slate-200';

export function CatalogFilterBar({
  filter,
  onChange,
  matched,
  total,
}: {
  filter: CatalogFilter;
  onChange: (next: CatalogFilter) => void;
  /** Distinct problems matching the current filter. */
  matched: number;
  /** Distinct problems in the whole catalog. */
  total: number;
}): JSX.Element {
  const active = isFilterActive(filter);

  return (
    <section
      aria-label="Search and filter problems"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-800/30 p-4"
    >
      <div className="relative">
        <label htmlFor="catalog-search" className="sr-only">
          Search problems
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          aria-hidden
        />
        <input
          id="catalog-search"
          type="search"
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          placeholder="Search by title or id…"
          autoComplete="off"
          className="w-full rounded-md border border-slate-700 bg-slate-800/60 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div
          role="group"
          aria-labelledby="filter-difficulty-label"
          className="flex flex-wrap items-center gap-2"
        >
          <span
            id="filter-difficulty-label"
            className="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            Difficulty
          </span>
          {DIFFICULTY_ORDER.map((d: Difficulty) => {
            const on = filter.difficulties.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    ...filter,
                    difficulties: toggleValue(
                      filter.difficulties,
                      d,
                      DIFFICULTY_ORDER,
                    ),
                  })
                }
                className={`${CHIP_BASE} ${
                  on
                    ? `border-transparent ${difficultyBadgeClasses(d)}`
                    : CHIP_OFF
                }`}
              >
                {d}
              </button>
            );
          })}
        </div>

        <div
          role="group"
          aria-labelledby="filter-status-label"
          className="flex flex-wrap items-center gap-2"
        >
          <span
            id="filter-status-label"
            className="text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            Status
          </span>
          {STATUS_ORDER.map((s: NoteStatus) => {
            const on = filter.statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    ...filter,
                    statuses: toggleValue(filter.statuses, s, STATUS_ORDER),
                  })
                }
                className={`${CHIP_BASE} ${
                  on ? `border-transparent ${statusPillClasses(s)}` : CHIP_OFF
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${statusDotClasses(s)}`}
                  aria-hidden
                />
                {STATUS_LABELS[s]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-[2rem] items-center justify-between gap-3">
        <p className="text-sm text-slate-400" role="status" aria-live="polite">
          {active ? `${matched} of ${total} problems` : `${total} problems`}
        </p>
        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTER)}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-slate-300 transition-all duration-200 hover:bg-slate-800 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <X className="h-4 w-4" aria-hidden />
            Clear filters
          </button>
        )}
      </div>
    </section>
  );
}
