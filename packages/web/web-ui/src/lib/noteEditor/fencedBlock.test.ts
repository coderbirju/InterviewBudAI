import { describe, expect, it } from 'vitest';
import { fenceLanguageOf, minimalChange } from './fencedBlock';

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

/** ADR 0015 D3: the alias set is shared by the editor and the pure helpers. */
describe('fenceLanguageOf', () => {
  it.each([
    ['python', 'python'],
    ['py', 'python'],
    ['Python3 title="x"', 'python'],
    ['go', 'go'],
    ['golang', 'go'],
    ['rust', null],
    ['', null],
    ['pythonic', null],
    ['gopher', null],
  ] as const)('%j → %s', (info, lang) => {
    expect(fenceLanguageOf(info)).toBe(lang);
  });
});
