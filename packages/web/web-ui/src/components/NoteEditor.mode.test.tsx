import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { language } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { NoteContentField } from './NoteContentField';
import NoteEditor from './NoteEditor';
import { GENERIC_TEMPLATES } from '../lib/noteTemplate';

/* ADR 0015 D3: the editor's language follows `noteEditorMode` (Compartment
 * reconfigure, debounced) — Python / Go for code-only notes, Markdown when
 * the note has a fence. Runs the REAL editor. */

const VALID = 'AAECAwQFBgcICQoLDA0ODw==';

function Host({ initial }: { initial: string }): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NoteContentField
        value={value}
        onChange={setValue}
        language="go"
        loadEditor={() => Promise.resolve(NoteEditor)}
      />
      <button type="button" onClick={() => setValue('notes\n```go\nx\n```')}>
        to markdown
      </button>
    </>
  );
}

function languageName(): string | undefined {
  const content = document.querySelector('.cm-content') as HTMLElement | null;
  const view = content ? EditorView.findFromDOM(content) : null;
  return view?.state.facet(language)?.name;
}

let meta: HTMLMetaElement;
beforeEach(() => {
  meta = document.createElement('meta');
  meta.setAttribute('name', 'ibai-style-nonce');
  meta.setAttribute('nonce', VALID);
  document.head.appendChild(meta);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  meta.remove();
  vi.restoreAllMocks();
});

describe('editor mode', () => {
  it('a code-only Python note is Python; adding a fence switches to Markdown', async () => {
    render(<Host initial={GENERIC_TEMPLATES.python} />);
    await screen.findByTestId('note-editor');
    await waitFor(() => expect(languageName()).toBe('python'));
    act(() => screen.getByRole('button', { name: 'to markdown' }).click());
    await waitFor(() => expect(languageName()).toBe('markdown'));
  });

  it('an empty note uses the preferred language (Go)', async () => {
    render(<Host initial="" />);
    await screen.findByTestId('note-editor');
    await waitFor(() => expect(languageName()).toBe('go'));
  });
});
