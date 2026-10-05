import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
 * toolbar (only the language picker and "Copy code", ADR 0015 D3/D4), copy,
 * label focus and the lazy swap. Uses the REAL editor (jsdom
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

let warn: MockInstance<Parameters<typeof console.warn>, void>;

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
});

describe('Copy code', () => {
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

  it('copies the code and announces "Code copied" for 2 s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText);
    render(<Host initial={'my note\n```go\nx\n```'} loadEditor={realLoader} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(writeText).toHaveBeenCalledWith('x');
    const live = screen.getByText('Code copied');
    expect(live).toHaveAttribute('aria-live', 'polite');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Code copied')).toBeNull();
  });

  it('shows the failure text when the clipboard rejects', async () => {
    mockClipboard(() => Promise.reject(new Error('denied')));
    render(<Host initial="n" loadEditor={realLoader} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(
      screen.getByText('Copy failed — select all and copy.'),
    ).toBeInTheDocument();
  });

  it('shows the failure text without a Clipboard API', async () => {
    render(<Host initial="n" loadEditor={realLoader} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(
      screen.getByText('Copy failed — select all and copy.'),
    ).toBeInTheDocument();
  });
});

/**
 * ADR 0014 D2 amendment (2026-10-05): the toolbar is exactly the Python | Go
 * picker and "Copy code", for the editor and the textarea fallback alike.
 */
describe('toolbar contents', () => {
  function toolbarButtons(): (string | undefined)[] {
    const toolbar = screen.getByRole('toolbar', { name: 'Note tools' });
    return within(toolbar)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
  }

  function renderWithPicker(loadEditor: NoteEditorLoader): void {
    render(
      <NoteContentField
        value="x"
        onChange={() => {}}
        loadEditor={loadEditor}
        language="go"
        onLanguageChange={() => {}}
      />,
    );
  }

  it('textarea fallback: exactly the language picker and Copy code', async () => {
    renderWithPicker(realLoader); // no nonce: the textarea stays
    await act(async () => {});
    expect(screen.getByLabelText(/Intuition/).tagName).toBe('TEXTAREA');
    expect(toolbarButtons()).toEqual(['Python', 'Go', 'Copy code']);
    const picker = screen.getByRole('group', { name: 'Code language' });
    expect(within(picker).getByRole('button', { name: 'Go' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('CodeMirror editor: exactly the language picker and Copy code', async () => {
    setNonce(VALID);
    renderWithPicker(realLoader);
    await editorMounted();
    expect(toolbarButtons()).toEqual(['Python', 'Go', 'Copy code']);
    expect(
      screen.getByRole('group', { name: 'Code language' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /block|Copy note/ }),
    ).toBeNull();
  });
});
