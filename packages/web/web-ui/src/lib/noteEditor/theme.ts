import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Dark editor theme matching the design system (ADR 0014 D2): the same
 * slate/emerald look as the other Notes inputs, Tailwind palette token
 * colours. EDITOR CHUNK ONLY. No theme package.
 */

const slate100 = '#f1f5f9';
const slate400 = '#94a3b8';
const slate500 = '#64748b';
const slate700 = '#334155';
const emerald500 = '#10b981';

export const noteEditorTheme = EditorView.theme(
  {
    '&': {
      color: slate100,
      backgroundColor: 'rgba(30, 41, 59, 0.6)', // slate-800/60
      border: `1px solid ${slate700}`,
      borderRadius: '0.375rem',
      fontSize: '0.875rem',
      maxHeight: '60vh',
      transition: 'border-color 200ms, box-shadow 200ms',
    },
    '&.cm-focused': {
      outline: 'none',
      borderColor: emerald500,
      boxShadow: `0 0 0 1px ${emerald500}`,
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      lineHeight: '1.5',
    },
    // 10 rows minimum (1.5 line height), then grow to 60vh and scroll.
    '.cm-content': {
      minHeight: 'calc(10 * 1.5em)',
      padding: '0.5rem 0',
      caretColor: emerald500,
    },
    '.cm-line': { padding: '0 0.75rem' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: emerald500 },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: 'rgba(16, 185, 129, 0.25)' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-placeholder': { color: slate500 },
  },
  { dark: true },
);

export const noteHighlightStyle = HighlightStyle.define([
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.operatorKeyword,
    ],
    color: '#c4b5fd',
  }, // violet-300
  { tag: [t.string, t.special(t.string)], color: '#6ee7b7' }, // emerald-300
  { tag: [t.number, t.bool, t.null], color: '#fcd34d' }, // amber-300
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: slate500,
    fontStyle: 'italic',
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.function(t.definition(t.variableName)),
    ],
    color: '#7dd3fc',
  }, // sky-300
  { tag: t.heading, color: slate100, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: [t.link, t.url], color: '#7dd3fc', textDecoration: 'underline' },
  { tag: [t.processingInstruction, t.monospace, t.meta], color: slate400 },
]);

export const noteEditorHighlighting = syntaxHighlighting(noteHighlightStyle);
