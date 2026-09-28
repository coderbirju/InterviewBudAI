import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/** Ask before discarding unsaved input; `true` = discard. */
export function confirmDiscard(): boolean {
  return window.confirm('Discard your unsaved changes?');
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * An accessible modal dialog (no dependency): `role="dialog"` +
 * `aria-modal`, labelled by its title; focus moves inside on open (the
 * `initialFocus` element, else the first focusable), Tab / Shift+Tab stay
 * inside, Escape and the close button call `onClose`, and on unmount focus
 * returns to whatever was focused before it opened. A backdrop click closes
 * it too, unless `dirty` (unsaved input): then backdrop clicks are ignored
 * and Escape / the close button ask before discarding (`confirmDiscard`).
 */
export function Modal({
  title,
  onClose,
  children,
  initialFocus,
  role = 'dialog',
  dirty = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  initialFocus?: React.RefObject<HTMLElement>;
  /** `alertdialog` for confirmations. */
  role?: 'dialog' | 'alertdialog';
  /** The dialog holds unsaved input: guard against silent discards. */
  dirty?: boolean;
}): JSX.Element {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  function requestClose(): void {
    if (dirtyRef.current && !confirmDiscard()) return;
    onCloseRef.current();
  }

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const first =
      initialFocus?.current ??
      panel.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel.current;
    first?.focus();
    return () => {
      // Return focus to the opener if it is still in the page.
      if (opener && opener.isConnected) opener.focus();
    };
    // Run once per open; `initialFocus` is a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(
      panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const firstItem = items[0]!;
    const lastItem = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === firstItem || active === panel.current)) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && active === lastItem) {
      e.preventDefault();
      firstItem.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // Never silently drop typed input on a stray backdrop click; keep
        // focus in the dialog so Escape still works.
        if (dirtyRef.current) e.preventDefault();
        else onCloseRef.current();
      }}
    >
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 transition-all duration-200 hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
