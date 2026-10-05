import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
} from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { indentOnInput, indentUnit } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { markdownLanguage } from '../lib/noteEditor/markdown';
import type { NoteEditorMode } from '../lib/noteTemplate';
import {
  noteEditorHighlighting,
  noteEditorTheme,
} from '../lib/noteEditor/theme';
import { minimalChange } from '../lib/noteEditor/fencedBlock';
import type {
  NoteEditorHandle,
  NoteEditorProps,
} from '../lib/noteEditor/types';

/**
 * The CodeMirror 6 note editor (ADR 0014 D2). LAZY CHUNK: only Notes loads it,
 * through `noteEditorLoader`. Markdown with python/go fences highlighted,
 * auto-indent, Tab/Shift-Tab indent (Esc then Tab leaves; Ctrl-M /
 * Shift-Alt-M toggles tab-focus mode), line wrapping, history, no
 * autocomplete UI or search panel.
 *
 * The style nonce goes in the INITIAL state: style-mod mounts the `<style>`
 * while the view is built. If construction throws, `onError` lets Notes keep
 * the textarea.
 */

/** Marks a transaction that mirrors an outside `value` (no `onChange`). */
const External = Annotation.define<boolean>();

/** ADR 0015 D3: a code-only note is edited as Python or Go, else Markdown. */
const LANGUAGES: Readonly<Record<NoteEditorMode, Extension>> = {
  markdown: markdownLanguage,
  python: python(),
  go: go(),
};

function clamp(n: number, len: number): number {
  return Math.max(0, Math.min(n, len));
}

function handleFor(view: EditorView): NoteEditorHandle {
  return { focus: () => view.focus() };
}

export default function NoteEditor(props: NoteEditorProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  // Latest callbacks without rebuilding the view.
  const latest = useRef(props);
  latest.current = props;

  // Build the view once per mount. Props read here are the initial ones.
  useLayoutEffect(() => {
    const p = latest.current;
    let view: EditorView;
    try {
      const len = p.value.length;
      const selection = p.initialSelection
        ? EditorSelection.create([
            EditorSelection.range(
              clamp(p.initialSelection.anchor, len),
              clamp(p.initialSelection.head, len),
            ),
          ])
        : undefined;
      view = new EditorView({
        parent: host.current ?? undefined,
        state: EditorState.create({
          doc: p.value,
          selection,
          extensions: [
            EditorView.cspNonce.of(p.nonce),
            history(),
            indentUnit.of('    '),
            indentOnInput(),
            language.current.of(LANGUAGES[p.mode ?? 'markdown']),
            noteEditorHighlighting,
            noteEditorTheme,
            EditorView.lineWrapping,
            placeholder(p.placeholder),
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            EditorView.contentAttributes.of({
              'aria-labelledby': p.labelId,
              'aria-describedby': p.describedById,
            }),
            EditorView.updateListener.of((u) => {
              if (
                u.docChanged &&
                !u.transactions.some((tr) => tr.annotation(External))
              ) {
                latest.current.onChange(u.state.doc.toString());
              }
            }),
          ],
        }),
      });
    } catch (err) {
      p.onError(err);
      return;
    }
    viewRef.current = view;
    if (p.autoFocus) view.focus();
    p.onReady(handleFor(view));
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  // The mode follows the note text (Notes debounces it).
  const mode = props.mode ?? 'markdown';
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: language.current.reconfigure(LANGUAGES[mode]),
    });
  }, [mode]);

  // An outside value (note load, save reconcile) replaces the doc only when it
  // differs, so typing never resets the cursor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== props.value) {
      view.dispatch({
        changes: minimalChange(current, props.value),
        annotations: External.of(true),
      });
    }
  }, [props.value]);

  return <div ref={host} className="mt-2" data-testid="note-editor" />;
}
