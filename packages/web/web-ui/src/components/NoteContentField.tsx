import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ComponentType } from 'react';
import { Check, Copy, FileCode } from 'lucide-react';
import { fencedBlockEdit } from '../lib/noteEditor/fencedBlock';
import type { FenceLanguage } from '../lib/noteEditor/fencedBlock';
import { readStyleNonce } from '../lib/noteEditor/nonce';
import type {
  NoteEditorHandle,
  NoteEditorProps,
  NoteEditorSelection,
} from '../lib/noteEditor/types';
import { loadNoteEditor } from './noteEditorLoader';
import type { NoteEditorLoader } from './noteEditorLoader';

/**
 * The "Intuition & approach" field (ADR 0014 D2): a toolbar plus either the
 * lazy CodeMirror editor or today's `<textarea id="note-content">`.
 *
 * The textarea is shown while the chunk loads and stays if the style nonce is
 * missing/invalid, the import rejects or the view throws (a `console.warn`,
 * no banner). When the editor replaces it, it starts with the same value and,
 * if the textarea had focus, takes focus with the same selection.
 */

export const NOTE_PLACEHOLDER =
  "Jot down your intuition, the key insight, edge cases, and how you'd approach it next time… Use ```python or ```go for code.";

const LABEL_ID = 'note-content-label';
const HINT_ID = 'note-content-hint';
const TEXTAREA_ID = 'note-content';
const COPIED_MS = 2000;

type Mode =
  | { readonly kind: 'textarea' }
  | {
      readonly kind: 'editor';
      readonly Editor: ComponentType<NoteEditorProps>;
      readonly nonce: string;
      readonly autoFocus: boolean;
      readonly initialSelection?: NoteEditorSelection;
    };

let warnedNoNonce = false;

function warnFallback(reason: string, err?: unknown): void {
  console.warn(
    `Note editor unavailable (${reason}); using the plain textarea.`,
    err ?? '',
  );
}

const toolbarButton =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition-all duration-200 hover:border-emerald-500 hover:text-emerald-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500';

export function NoteContentField({
  value,
  onChange,
  loadEditor = loadNoteEditor,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Injected in tests; defaults to the real lazy chunk. */
  loadEditor?: NoteEditorLoader;
}): JSX.Element {
  const [mode, setMode] = useState<Mode>({ kind: 'textarea' });
  const [copyMsg, setCopyMsg] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleRef = useRef<NoteEditorHandle | null>(null);
  const pendingCursor = useRef<number | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Swap in the editor once its chunk loads (only with a valid nonce).
  useEffect(() => {
    const nonce = readStyleNonce();
    if (nonce === null) {
      // Once per page load: every Notes visit would repeat it.
      if (!warnedNoNonce) warnFallback('no valid style nonce');
      warnedNoNonce = true;
      return;
    }
    let cancelled = false;
    loadEditor().then(
      (Editor) => {
        if (cancelled) return;
        const ta = textareaRef.current;
        const focused = ta !== null && ta === document.activeElement;
        const backward = ta?.selectionDirection === 'backward';
        setMode({
          kind: 'editor',
          Editor,
          nonce,
          autoFocus: focused,
          initialSelection:
            focused && ta
              ? {
                  anchor: backward ? ta.selectionEnd : ta.selectionStart,
                  head: backward ? ta.selectionStart : ta.selectionEnd,
                }
              : undefined,
        });
      },
      (err: unknown) => {
        if (!cancelled) warnFallback('the editor chunk failed to load', err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loadEditor]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  // Textarea path: put the cursor inside a just-inserted block.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (pendingCursor.current === null || !ta) return;
    const at = pendingCursor.current;
    pendingCursor.current = null;
    ta.focus();
    ta.setSelectionRange(at, at);
  }, [value]);

  const onEditorError = useCallback((err: unknown) => {
    handleRef.current = null;
    warnFallback('the editor failed to start', err);
    setMode({ kind: 'textarea' });
  }, []);

  const onEditorReady = useCallback((handle: NoteEditorHandle) => {
    handleRef.current = handle;
  }, []);

  const insertFence = (lang: FenceLanguage): void => {
    if (mode.kind === 'editor' && handleRef.current) {
      handleRef.current.insertFence(lang);
      return;
    }
    const ta = textareaRef.current;
    const from = ta?.selectionStart ?? value.length;
    const to = ta?.selectionEnd ?? value.length;
    const next = fencedBlockEdit(value, from, to, lang);
    pendingCursor.current = next.cursor;
    onChange(next.text);
  };

  const onCopy = async (): Promise<void> => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = null;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(value);
      setCopyMsg('Copied');
      copyTimer.current = setTimeout(() => setCopyMsg(''), COPIED_MS);
    } catch {
      setCopyMsg('Copy failed — select all and copy.');
    }
  };

  const editor = mode.kind === 'editor';

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label
          id={LABEL_ID}
          htmlFor={editor ? undefined : TEXTAREA_ID}
          onClick={editor ? () => handleRef.current?.focus() : undefined}
          className="block text-sm font-semibold text-slate-300"
        >
          Intuition &amp; approach
        </label>
        <div
          role="toolbar"
          aria-label="Note tools"
          className="flex flex-wrap items-center gap-2"
        >
          <button
            type="button"
            aria-label="Insert Python code block"
            onClick={() => insertFence('python')}
            className={toolbarButton}
          >
            <FileCode className="h-3.5 w-3.5" aria-hidden />
            Python block
          </button>
          <button
            type="button"
            aria-label="Insert Go code block"
            onClick={() => insertFence('go')}
            className={toolbarButton}
          >
            <FileCode className="h-3.5 w-3.5" aria-hidden />
            Go block
          </button>
          <button
            type="button"
            onClick={() => void onCopy()}
            className={toolbarButton}
          >
            {copyMsg === 'Copied' ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden />
            )}
            Copy note
          </button>
          <span
            role="status"
            aria-live="polite"
            className={`text-xs ${copyMsg === 'Copied' ? 'text-status-done' : 'text-status-blocked'}`}
          >
            {copyMsg}
          </span>
        </div>
      </div>

      {mode.kind === 'editor' ? (
        <>
          <mode.Editor
            value={value}
            onChange={onChange}
            nonce={mode.nonce}
            labelId={LABEL_ID}
            describedById={HINT_ID}
            placeholder={NOTE_PLACEHOLDER}
            autoFocus={mode.autoFocus}
            initialSelection={mode.initialSelection}
            onReady={onEditorReady}
            onError={onEditorError}
          />
          <p id={HINT_ID} className="mt-1 text-xs text-slate-500">
            Tab indents. Press Esc then Tab to leave the editor.
          </p>
        </>
      ) : (
        <textarea
          ref={textareaRef}
          id={TEXTAREA_ID}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={10}
          placeholder={NOTE_PLACEHOLDER}
          className="mt-2 w-full resize-y rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-500 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      )}
    </div>
  );
}
