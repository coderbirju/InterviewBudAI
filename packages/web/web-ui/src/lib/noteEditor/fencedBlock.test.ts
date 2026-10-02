import { describe, expect, it } from 'vitest';
import { fencedBlockEdit, minimalChange } from './fencedBlock';

/** ADR 0014 D2: the toolbar insert, shared by the editor and the textarea. */

describe('fencedBlockEdit', () => {
  it('empty doc: an empty block, cursor on its blank line', () => {
    const r = fencedBlockEdit('', 0, 0, 'python');
    expect(r.text).toBe('```python\n\n```');
    expect(r.cursor).toBe('```python\n'.length);
  });

  it('mid-line: the block goes on its own lines', () => {
    const r = fencedBlockEdit('abcdef', 3, 3, 'go');
    expect(r.text).toBe('abc\n```go\n\n```\ndef');
    expect(r.cursor).toBe('abc\n```go\n'.length);
  });

  it('at a line start/end: no extra blank lines', () => {
    const r = fencedBlockEdit('one\ntwo', 4, 4, 'go');
    expect(r.text).toBe('one\n```go\n\n```\ntwo');
    const end = fencedBlockEdit('one\n', 4, 4, 'python');
    expect(end.text).toBe('one\n```python\n\n```');
  });

  it('wraps a selection; cursor at the end of the wrapped text', () => {
    const doc = 'Idea:\ndef f():\n    pass\nDone';
    const from = doc.indexOf('def');
    const to = doc.indexOf('\nDone');
    const r = fencedBlockEdit(doc, from, to, 'python');
    expect(r.text).toBe('Idea:\n```python\ndef f():\n    pass\n```\nDone');
    expect(r.text.slice(0, r.cursor).endsWith('    pass')).toBe(true);
  });

  it('wraps a selection that ends with a newline without doubling it', () => {
    const r = fencedBlockEdit('x := 1\n', 0, 7, 'go');
    expect(r.text).toBe('```go\nx := 1\n```');
    expect(r.cursor).toBe('```go\nx := 1'.length);
  });

  it('accepts a reversed or out-of-range selection', () => {
    expect(fencedBlockEdit('ab', 2, 0, 'go').text).toBe('```go\nab\n```');
    expect(fencedBlockEdit('ab', 9, 9, 'go').text).toBe('ab\n```go\n\n```');
  });
});

describe('minimalChange', () => {
  it('trims the common prefix and suffix', () => {
    expect(minimalChange('hello world', 'hello brave world')).toEqual({
      from: 6,
      to: 6,
      insert: 'brave ',
    });
    expect(minimalChange('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' });
    expect(minimalChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
  });
});
