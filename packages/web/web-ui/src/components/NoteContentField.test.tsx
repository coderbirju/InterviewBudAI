import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ComponentType } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { NoteContentField } from './NoteContentField';
import NoteEditor from './NoteEditor';
import type { NoteEditorLoader } from './noteEditorLoader';
import type { NoteEditorProps } from '../lib/noteEditor/types';

/**
 * ADR 0014 D2 — the note field: lazy CodeMirror editor vs textarea fallback,
 * toolbar, copy, label focus and the lazy swap. Uses the REAL editor (jsdom
 * with the Range rect polyfills from vitest.setup.ts).
 */

const VALID = 'AAECAwQFBgcICQoLDA0ODw==';
const realLoader: NoteEditorLoader = () => Promise.resolve(NoteEditor);

function setNonce(nonce: string | null): void {
  document.head.querySelector('meta[name="ibai-style-nonce"]')?.remove();
  if (nonce === null) return;
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'ibai-style-nonce');
  meta.setAttribute('nonce', nonce);
  document.head.appendChild(meta);
}

/** A controlled host like Notes: state + a spy on every change. */
function Host({
  initial = '',
  loadEditor,
  onChange,
}: {
  initial?: string;
  loadEditor: NoteEditorLoader;
  onChange?: (v: string) => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NoteContentField
        value={value}
        loadEditor={loadEditor}
        onChange={(v) => {
          onChange?.(v);
          setValue(v);
        }}
      />
      <output data-testid="value">{value}</output>
      <button type="button" onClick={() => setValue('from outside')}>
        set outside
      </button>
    </>
  );
}

function viewOf(): EditorView {
  const content = document.querySelector('.cm-content');
  if (!content) throw new Error('editor not mounted');
  const view = EditorView.findFromDOM(content as HTMLElement);
  if (!view) throw new Error('no view');
  return view;
}

async function editorMounted(): Promise<EditorView> {
  await screen.findByTestId('note-editor');
  await waitFor(() =>
    expect(document.querySelector('.cm-content')).not.toBeNull(),
  );
  return viewOf();
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setNonce(null);
  warn.mockRestore();
  vi.restoreAllMocks();
});

describe('fallback to the textarea', () => {
  it.each([
    ['no nonce', null],
    ['the placeholder', '__IBAI_STYLE_NONCE__'],
    ['an empty nonce', ''],
    ['a malformed nonce', 'abc'],
  ])('%s: the loader is never called', async (_l, nonce) => {
    setNonce(nonce);
    const loader = vi.fn(realLoader);
    render(<Host initial="hi" loadEditor={loader} />);
    expect(screen.getByLabelText(/Intuition/)).toHaveValue('hi');
    await act(async () => {});
    expect(loader).not.toHaveBeenCalled();
    expect(screen.queryByTestId('note-editor')).toBeNull();
  });

  it('keeps the textarea when the chunk import rejects', async () => {
    setNonce(VALID);
    const loader = vi.fn(() => Promise.reject(new Error('chunk 404')));
    render(<Host initial="hi" loadEditor={loader} />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(loader).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Intuition/)).toHaveValue('hi');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back when the view constructor throws', async () => {
    setNonce(VALID);
    vi.spyOn(EditorState, 'create').mockImplementation(() => {
      throw new Error('boom');
    });
    render(<Host initial="kept" loadEditor={realLoader} />);
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('failed to start'),
        expect.any(Error),
      ),
    );
    expect(screen.getByLabelText(/Intuition/)).toHaveValue('kept');
    expect(document.querySelector('.cm-editor')).toBeNull();
  });

  it('textarea toolbar: inserts a block and puts the cursor inside', async () => {
    const user = userEvent.setup();
    render(<Host initial="abc" loadEditor={realLoader} />);
    const ta = screen.getByLabelText(/Intuition/) as HTMLTextAreaElement;
    ta.setSelectionRange(3, 3);
    await user.click(
      screen.getByRole('button', { name: 'Insert Go code block' }),
    );
    expect(ta).toHaveValue('abc\n```go\n\n```');
    expect(ta).toHaveFocus();
    expect(ta.selectionStart).toBe('abc\n```go\n'.length);
  });
});

describe('the CodeMirror editor', () => {
  beforeEach(() => setNonce(VALID));

  it('mounts with the nonce, label + hint wiring; label click focuses it', async () => {
    const user = userEvent.setup();
    render(
      <Host
        initial={'# Note\n```python\ndef f():\n```'}
        loadEditor={realLoader}
      />,
    );
    const view = await editorMounted();
    expect(view.state.doc.toString()).toContain('def f()');
    expect(view.state.facet(EditorView.cspNonce)).toBe(VALID);
    // style-mod mounted its <style> with the nonce (CSP allows it).
    const styles = [...document.head.querySelectorAll('style')];
    expect(
      styles.some(
        (s) => s.nonce === VALID || s.getAttribute('nonce') === VALID,
      ),
    ).toBe(true);

    const content = screen.getByLabelText(/Intuition/);
    expect(content).toBe(view.contentDOM);
    expect(content).toHaveAttribute('role', 'textbox');
    expect(content).toHaveAttribute('aria-multiline', 'true');
    expect(content).toHaveAccessibleDescription(
      'Tab indents. Press Esc then Tab to leave the editor.',
    );
    expect(view.hasFocus).toBe(false);
    await user.click(screen.getByText(/Intuition & approach/));
    expect(view.hasFocus).toBe(true);
  });

  it('lazy swap keeps the value, focus and selection of the textarea', async () => {
    let resolve: (c: ComponentType<NoteEditorProps>) => void = () => {};
    const loader: NoteEditorLoader = () =>
      new Promise((r) => {
        resolve = r;
      });
    render(<Host initial="hello world" loadEditor={loader} />);
    const ta = screen.getByLabelText(/Intuition/) as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(2, 7);
    await act(async () => resolve(NoteEditor));
    const view = await editorMounted();
    expect(view.state.doc.toString()).toBe('hello world');
    expect(view.hasFocus).toBe(true);
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(7);
  });

  it('lazy swap without focus does not steal it', async () => {
    render(<Host initial="x" loadEditor={realLoader} />);
    const view = await editorMounted();
    expect(view.hasFocus).toBe(false);
  });

  it('user edits call onChange; an outside value does not', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Host initial="ab" loadEditor={realLoader} onChange={onChange} />);
    const view = await editorMounted();
    act(() => {
      view.dispatch({ changes: { from: 2, insert: 'c' } });
    });
    expect(onChange).toHaveBeenLastCalledWith('abc');
    expect(screen.getByTestId('value')).toHaveTextContent('abc');

    onChange.mockClear();
    await user.click(screen.getByRole('button', { name: 'set outside' }));
    expect(view.state.doc.toString()).toBe('from outside');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toolbar inserts a Python block around the selection', async () => {
    const user = userEvent.setup();
    render(<Host initial={'Idea\ndef f(): pass'} loadEditor={realLoader} />);
    const view = await editorMounted();
    act(() => {
      view.dispatch({ selection: { anchor: 5, head: 18 } });
    });
    await user.click(
      screen.getByRole('button', { name: 'Insert Python code block' }),
    );
    expect(view.state.doc.toString()).toBe(
      'Idea\n```python\ndef f(): pass\n```',
    );
    expect(screen.getByTestId('value')).toHaveTextContent('```python');
    expect(view.state.selection.main.head).toBe(
      'Idea\n```python\ndef f(): pass'.length,
    );
    expect(view.hasFocus).toBe(true);
  });

  it('toolbar inserts an empty Go block at the cursor', async () => {
    const user = userEvent.setup();
    render(<Host initial="" loadEditor={realLoader} />);
    const view = await editorMounted();
    await user.click(
      screen.getByRole('button', { name: 'Insert Go code block' }),
    );
    expect(view.state.doc.toString()).toBe('```go\n\n```');
    expect(view.state.selection.main.head).toBe('```go\n'.length);
  });
});

describe('Copy note', () => {
  function mockClipboard(writeText: (t: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  it('copies the note and announces "Copied" for 2 s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText);
    render(<Host initial={'my note\n```go\nx\n```'} loadEditor={realLoader} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy note' }));
    });
    expect(writeText).toHaveBeenCalledWith('my note\n```go\nx\n```');
    const live = screen.getByText('Copied');
    expect(live).toHaveAttribute('aria-live', 'polite');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('shows the failure text when the clipboard rejects', async () => {
    mockClipboard(() => Promise.reject(new Error('denied')));
    render(<Host initial="n" loadEditor={realLoader} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy note' }));
    });
    expect(
      screen.getByText('Copy failed — select all and copy.'),
    ).toBeInTheDocument();
  });

  it('shows the failure text without a Clipboard API', async () => {
    render(<Host initial="n" loadEditor={realLoader} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy note' }));
    });
    expect(
      screen.getByText('Copy failed — select all and copy.'),
    ).toBeInTheDocument();
  });
});
