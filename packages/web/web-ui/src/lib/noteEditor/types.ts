import type { FenceLanguage } from './fencedBlock';
import type { NoteEditorMode } from '../noteTemplate';

/**
 * The contract between Notes (main chunk) and the lazy `NoteEditor` chunk
 * (ADR 0014 D2). Types only, so the main chunk never imports CodeMirror.
 */

/** What the toolbar and the label need from the mounted editor. */
export interface NoteEditorHandle {
  focus(): void;
  insertFence(lang: FenceLanguage): void;
}

export interface NoteEditorSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface NoteEditorProps {
  readonly value: string;
  /** Called for user edits only (never for an outside `value` change). */
  readonly onChange: (next: string) => void;
  /** A nonce that already passed `isValidStyleNonce`. */
  readonly nonce: string;
  readonly labelId: string;
  readonly describedById: string;
  readonly placeholder: string;
  /**
   * The language mode (ADR 0015 D3, `noteEditorMode`). Optional: Markdown
   * when absent. A change reconfigures the view (no rebuild).
   */
  readonly mode?: NoteEditorMode;
  /** Take focus on mount (the textarea it replaces had focus). */
  readonly autoFocus: boolean;
  /** The replaced textarea's selection (clamped to the doc). */
  readonly initialSelection?: NoteEditorSelection;
  readonly onReady: (handle: NoteEditorHandle) => void;
  /** The view could not be built: Notes falls back to the textarea. */
  readonly onError: (err: unknown) => void;
}
