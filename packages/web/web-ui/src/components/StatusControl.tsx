import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { NoteStatus } from '../lib/api';
import { STATUS_LABELS, STATUS_ORDER, statusDotClasses } from '../lib/home';

/**
 * Interactive control reflecting a problem's 4-state status. Clicking the
 * trigger opens a small menu to set done / to_revisit / did_not_understand /
 * none. Selecting a value calls `onChange` (the parent performs the optimistic
 * update + POST). Not a plain checkbox — the status is a first-class 4-value.
 */
export function StatusControl({
  status,
  onChange,
  disabled = false,
  busy = false,
}: {
  status: NoteStatus;
  onChange: (next: NoteStatus) => void;
  disabled?: boolean;
  busy?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onDocClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function select(next: NoteStatus): void {
    setOpen(false);
    if (next !== status) {
      onChange(next);
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${STATUS_LABELS[status]}. Change status.`}
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[9.5rem] items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-sm text-slate-200 transition-all duration-200 hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${statusDotClasses(status)} ${
              busy ? 'animate-pulse' : ''
            }`}
            aria-hidden
          />
          {STATUS_LABELS[status]}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
      </button>

      {open && (
        <ul
          role="menu"
          className="absolute z-10 mt-1 min-w-[9.5rem] overflow-hidden rounded-md border border-slate-700 bg-slate-800 shadow-lg"
        >
          {STATUS_ORDER.map((value) => (
            <li key={value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={value === status}
                onClick={() => select(value)}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm text-slate-200 transition-all duration-200 hover:bg-slate-700"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${statusDotClasses(
                      value,
                    )}`}
                    aria-hidden
                  />
                  {STATUS_LABELS[value]}
                </span>
                {value === status && (
                  <Check className="h-4 w-4 text-emerald-500" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
