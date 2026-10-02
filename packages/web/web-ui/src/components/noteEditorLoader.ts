import type { ComponentType } from 'react';
import type { NoteEditorProps } from '../lib/noteEditor/types';

/**
 * Loads the CodeMirror note editor as a separate same-origin `/assets/*.js`
 * chunk (ADR 0014 D2). Only the Notes page calls this.
 */
export type NoteEditorLoader = () => Promise<ComponentType<NoteEditorProps>>;

export const loadNoteEditor: NoteEditorLoader = () =>
  import('./NoteEditor').then((m) => m.default);
