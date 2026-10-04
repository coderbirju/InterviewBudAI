import { describe, expect, it } from 'vitest';
import {
  STATEMENT_MAX_DEPTH,
  STATEMENT_MAX_NODES,
  STATEMENT_MAX_TEXT_BYTES,
  isStatementTree,
  utf8ByteLength,
} from '../../../src/statement-tree.js';
import ready from '../test/fixtures/statement/get-ready.json';

/* ADR 0015 D2 — the shared tree check, imported by relative path exactly as
 * the SPA uses it. A hostile or invalid tree is rejected. */

function nested(depth: number): unknown[] {
  let node: unknown = { t: 'text', v: 'deep' };
  for (let i = 1; i < depth; i++) node = { t: 'em', c: [node] };
  return [node];
}

describe('isStatementTree', () => {
  it('accepts the ready fixture and an empty tree', () => {
    expect(isStatementTree(ready.blocks)).toBe(true);
    expect(isStatementTree([])).toBe(true);
    expect(isStatementTree([{ t: 'br' }, { t: 'text', v: 'a\tb\n' }])).toBe(
      true,
    );
  });

  it.each([
    ['not an array', { t: 'p', c: [] }],
    ['null', null],
    ['a string', '<p>hi</p>'],
    ['an HTML string node', ['<script>alert(1)</script>']],
    ['a script tag', [{ t: 'script', c: [{ t: 'text', v: 'alert(1)' }] }]],
    ['an a tag', [{ t: 'a', c: [] }]],
    ['an img tag', [{ t: 'img', c: [] }]],
    ['an attribute', [{ t: 'p', c: [], onclick: 'alert(1)' }]],
    ['an href', [{ t: 'code', c: [], href: 'javascript:alert(1)' }]],
    ['a style key', [{ t: 'p', c: [], style: 'x' }]],
    ['children on br', [{ t: 'br', c: [] }]],
    ['children on text', [{ t: 'text', v: 'a', c: [] }]],
    ['a non-string text', [{ t: 'text', v: 1 }]],
    ['non-array children', [{ t: 'p', c: 'x' }]],
    ['a missing tag', [{ c: [] }]],
    ['an array node', [[{ t: 'br' }]]],
    ['a C0 control', [{ t: 'text', v: 'a\u0000b' }]],
    ['a text node with an extra key', [{ t: 'text', v: 'a', class: 'x' }]],
  ])('rejects %s', (_label, value) => {
    expect(isStatementTree(value)).toBe(false);
  });

  it('enforces the depth cap', () => {
    expect(isStatementTree(nested(STATEMENT_MAX_DEPTH))).toBe(true);
    expect(isStatementTree(nested(STATEMENT_MAX_DEPTH + 1))).toBe(false);
  });

  it('enforces the node cap', () => {
    const ok = Array.from({ length: STATEMENT_MAX_NODES }, () => ({ t: 'br' }));
    expect(isStatementTree(ok)).toBe(true);
    expect(isStatementTree([...ok, { t: 'br' }])).toBe(false);
  });

  it('enforces the text cap in UTF-8 bytes', () => {
    const half = 'é'.repeat(STATEMENT_MAX_TEXT_BYTES / 4); // 2 bytes each
    expect(utf8ByteLength(half)).toBe(STATEMENT_MAX_TEXT_BYTES / 2);
    expect(
      isStatementTree([
        { t: 'text', v: half },
        { t: 'text', v: half },
      ]),
    ).toBe(true);
    expect(
      isStatementTree([
        { t: 'text', v: half },
        { t: 'text', v: half + 'x' },
      ]),
    ).toBe(false);
  });

  it('counts UTF-8 bytes like Buffer.byteLength', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});
