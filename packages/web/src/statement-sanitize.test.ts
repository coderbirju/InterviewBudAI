/**
 * The statement sanitizer + tree validator (ADR 0015 D2), with hostile HTML.
 */

import { describe, it, expect } from 'vitest';
import {
  STATEMENT_MAX_HTML_BYTES,
  STATEMENT_MAX_OPEN,
  sanitizeStatementHtml,
} from './statement-sanitize.js';
import {
  STATEMENT_MAX_DEPTH,
  STATEMENT_MAX_NODES,
  STATEMENT_MAX_TEXT_BYTES,
  isStatementTree,
  utf8ByteLength,
} from './statement-tree.js';
import type { StatementNode } from './statement-tree.js';

const text = (v: string): StatementNode => ({ t: 'text', v });
const br: StatementNode = { t: 'br' };

/** Sanitize, assert the result passes the shared validator, return it. */
function clean(html: string) {
  const out = sanitizeStatementHtml(html);
  expect(isStatementTree(out.blocks)).toBe(true);
  return out;
}

/** All text in a tree, in order. */
function allText(nodes: readonly StatementNode[]): string {
  return nodes
    .map((n) =>
      n.t === 'text' ? n.v : n.t === 'br' ? '\n' : 'c' in n ? allText(n.c) : '',
    )
    .join('');
}

describe('sanitizeStatementHtml (ADR 0015 D2)', () => {
  it('keeps the allowlisted tags, maps b/i, drops every attribute', () => {
    const { blocks, truncated } = clean(
      '<p class="x" style="color:red" onclick="alert(1)">A <b>bold</b> <i id="i">it</i> <code>c</code> <em>e</em> <strong>s</strong></p>',
    );
    expect(truncated).toBe(false);
    expect(blocks).toEqual([
      {
        t: 'p',
        c: [
          text('A '),
          { t: 'strong', c: [text('bold')] },
          text(' '),
          { t: 'em', c: [text('it')] },
          text(' '),
          { t: 'code', c: [text('c')] },
          text(' '),
          { t: 'em', c: [text('e')] },
          text(' '),
          { t: 'strong', c: [text('s')] },
        ],
      },
    ]);
    const serialized = JSON.stringify(blocks);
    for (const banned of ['class', 'style', 'onclick', 'alert', 'href']) {
      expect(serialized).not.toContain(banned);
    }
  });

  it('removes a script tag and its text, and style / iframe / svg / template content', () => {
    const { blocks } = clean(
      '<p>keep</p><script>alert("x")</script><style>p{}</style><iframe src="https://evil">frame</iframe><svg><text>svgtext</text><script>s()</script></svg><template><p>tpl</p></template><noscript>ns</noscript><math><mi>m</mi></math><object>obj</object><embed><textarea>ta</textarea><select><option>opt</option></select><form>f<input></form>',
    );
    expect(blocks).toEqual([{ t: 'p', c: [text('keep')] }]);
  });

  it('removes head, title, button and video content', () => {
    const { blocks } = clean(
      '<html><head><title>T</title><meta charset="utf-8"></head><body><p>body</p><button>Click</button><video>vid<source src="x"></video><audio>aud</audio><canvas>cv</canvas></body></html>',
    );
    expect(blocks).toEqual([{ t: 'p', c: [text('body')] }]);
  });

  it('hostile edge cases: uppercase tags, an unclosed script, split tags, event handlers in text-like spots', () => {
    expect(
      clean('<P>x</P><SCRIPT>bad()</SCRIPT><Style>s</Style>').blocks,
    ).toEqual([{ t: 'p', c: [text('x')] }]);
    // An unclosed <script> swallows the rest of the document.
    expect(clean('<p>before</p><script>alert(1)<p>after</p>').blocks).toEqual([
      { t: 'p', c: [text('before')] },
    ]);
    // A split tag is an unknown tag (unwrapped): what is left is inert text.
    expect(clean('<scr<script>ipt>alert(1)</script>').blocks).toEqual([
      text('ipt>alert(1)'),
    ]);
    // Allowed tags inside a dropped one stay dropped.
    expect(
      clean(
        '<button><strong>no</strong></button><svg><p>no</p><foreignObject><p>no</p></foreignObject></svg>',
      ).blocks,
    ).toEqual([]);
    // Markup inside text is only text (React escapes it again).
    expect(clean('<p>&lt;img src=x onerror=alert(1)&gt;</p>').blocks).toEqual([
      { t: 'p', c: [text('<img src=x onerror=alert(1)>')] },
    ]);
  });

  it('drops href (a is unwrapped to its text)', () => {
    const { blocks } = clean(
      '<p>see <a href="javascript:alert(1)" target="_blank">the link</a>.</p>',
    );
    expect(blocks).toEqual([{ t: 'p', c: [text('see the link.')] }]);
  });

  it('replaces img with [image: alt] or [image]', () => {
    const { blocks } = clean(
      '<p><img src="https://x/a.png" alt="A  tree" onerror="x()">and<img src="b.png"></p>',
    );
    expect(blocks).toEqual([
      { t: 'p', c: [text('[image: A tree]and[image]')] },
    ]);
  });

  it('unwraps font and span (children kept)', () => {
    const { blocks } = clean(
      '<p><font face="monospace">mono</font> <span style="x">span</span> <u>u</u></p>',
    );
    expect(blocks).toEqual([{ t: 'p', c: [text('mono span u')] }]);
  });

  it('keeps div, h3 and table cells apart', () => {
    const { blocks } = clean(
      '<h3>Title</h3><div>one</div><div>two</div><table><tr><td>a</td><td>b</td></tr><tr><th>c</th><th>d</th></tr></table>',
    );
    expect(blocks).toEqual([
      { t: 'p', c: [text('Title')] },
      { t: 'p', c: [text('one')] },
      { t: 'p', c: [text('two')] },
      { t: 'p', c: [text('a'), br, text('b')] },
      { t: 'p', c: [text('c'), br, text('d')] },
    ]);
  });

  it('never nests a p in a p or li: inner blocks become breaks', () => {
    const { blocks } = clean(
      '<div class="example"><p><strong>Input:</strong> x</p>\n  <p><strong>Output:</strong> y</p></div><ul><li><p>item</p><div>more</div></li></ul>',
    );
    expect(blocks).toEqual([
      {
        t: 'p',
        c: [
          { t: 'strong', c: [text('Input:')] },
          text(' x'),
          br,
          { t: 'strong', c: [text('Output:')] },
          text(' y'),
        ],
      },
      { t: 'ul', c: [{ t: 'li', c: [text('item'), br, text('more')] }] },
    ]);
  });

  it('keeps <sup> (10<sup>4</sup>) and lists', () => {
    const { blocks } = clean(
      '<ul>\n  <li><code>1 &lt;= n &lt;= 10<sup>4</sup></code></li>\n  <li>H<sub>2</sub>O</li>\n</ul><ol><li>first</li></ol>',
    );
    expect(blocks).toEqual([
      {
        t: 'ul',
        c: [
          {
            t: 'li',
            c: [
              {
                t: 'code',
                c: [text('1 <= n <= 10'), { t: 'sup', c: [text('4')] }],
              },
            ],
          },
          { t: 'li', c: [text('H'), { t: 'sub', c: [text('2')] }, text('O')] },
        ],
      },
      { t: 'ol', c: [{ t: 'li', c: [text('first')] }] },
    ]);
  });

  it('decodes entities; &nbsp; becomes a normal space; C0 controls go', () => {
    const { blocks } = clean(
      '<p>a&nbsp;b &amp; &lt;c&gt; &#x41;\u0000\u0007\u001b!</p>',
    );
    expect(blocks).toEqual([{ t: 'p', c: [text('a b & <c> A!')] }]);
  });

  it('keeps whitespace inside pre, collapses it elsewhere, removes empty p', () => {
    const { blocks } = clean(
      '<p>  a \n\n b  </p><p>   </p><p><br></p><pre>x = 1\r\n    y = 2\n</pre>',
    );
    expect(blocks).toEqual([
      { t: 'p', c: [text(' a b ')] },
      { t: 'pre', c: [text('x = 1\n    y = 2\n')] },
    ]);
  });

  it('handles a malformed and an unclosed document', () => {
    const malformed = clean('<p>a<b>b</p>c</b><<>>&bogus;<p>d</i></p></div>');
    expect(allText(malformed.blocks)).toContain('a');
    expect(allText(malformed.blocks)).toContain('d');
    const unclosed = clean('<p>start <strong>bold <em>deep');
    expect(unclosed.blocks).toEqual([
      {
        t: 'p',
        c: [
          text('start '),
          { t: 'strong', c: [text('bold '), { t: 'em', c: [text('deep')] }] },
        ],
      },
    ]);
    const midTag = clean('<p>x</p><img alt="half');
    expect(midTag.blocks).toEqual([{ t: 'p', c: [text('x')] }]);
    expect(clean('').blocks).toEqual([]);
    expect(clean('<!-- c --><![CDATA[x]]>').blocks).toEqual([]);
  });

  it('cuts at the depth cap (text kept, nesting cut) and sets truncated', () => {
    const depth = STATEMENT_MAX_DEPTH + 8;
    const html = '<p>' + '<em>'.repeat(depth) + 'deep' + '</em>'.repeat(depth);
    const { blocks, truncated } = clean(html);
    expect(truncated).toBe(true);
    expect(allText(blocks)).toBe('deep');
    let levels = 0;
    let node: StatementNode | undefined = blocks[0];
    while (node !== undefined && 'c' in node) {
      levels += 1;
      node = node.c[0];
    }
    expect(levels).toBe(STATEMENT_MAX_DEPTH);
  });

  it('cuts at the node cap and sets truncated', () => {
    const html = '<p>' + 'x<br>'.repeat(STATEMENT_MAX_NODES) + '</p>';
    const { blocks, truncated } = clean(html);
    expect(truncated).toBe(true);
    const count = (nodes: readonly StatementNode[]): number =>
      nodes.reduce((n, x) => n + 1 + ('c' in x ? count(x.c) : 0), 0);
    expect(count(blocks)).toBeLessThanOrEqual(STATEMENT_MAX_NODES);
  });

  it('cuts at the text cap (UTF-8 bytes) and sets truncated', () => {
    const html = '<pre>' + 'é'.repeat(STATEMENT_MAX_TEXT_BYTES) + '</pre>';
    const { blocks, truncated } = clean(html);
    expect(truncated).toBe(true);
    const bytes = utf8ByteLength(allText(blocks));
    expect(bytes).toBeLessThanOrEqual(STATEMENT_MAX_TEXT_BYTES);
    expect(bytes).toBeGreaterThan(STATEMENT_MAX_TEXT_BYTES - 2);
  });

  it('~1 MiB of nested <div> sanitizes in < 2 s, truncated', () => {
    const html = '<div>'.repeat(Math.floor((1024 * 1024) / 5));
    const started = Date.now();
    const { truncated } = clean(html);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(truncated).toBe(true);
  });

  it('~1 MiB of nested <span>…</span> sanitizes in < 2 s, truncated', () => {
    const n = 75_000;
    const html = '<span>'.repeat(n) + 'x' + '</span>'.repeat(n);
    expect(html.length).toBeGreaterThan(900_000);
    const started = Date.now();
    const { blocks, truncated } = clean(html);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(truncated).toBe(true);
    expect(blocks).toEqual([]);
  });

  it('open-tag cap: past STATEMENT_MAX_OPEN the tree is cut, text before it kept', () => {
    const html =
      '<p>kept</p>' +
      '<canvas>'.repeat(STATEMENT_MAX_OPEN + 5) +
      'hidden' +
      '</canvas>'.repeat(STATEMENT_MAX_OPEN + 5) +
      '<p>after</p>';
    const { blocks, truncated } = clean(html);
    expect(truncated).toBe(true);
    expect(blocks).toEqual([{ t: 'p', c: [text('kept')] }]);
    // Below the cap, deep unwrapped nesting is fine and complete.
    const ok = clean('<span>'.repeat(500) + 'x' + '</span>'.repeat(500));
    expect(ok).toEqual({ blocks: [text('x')], truncated: false });
  });

  it('input over 256 KiB is cut before parsing (truncated)', () => {
    const para = '<p>' + 'a'.repeat(1000) + '</p>';
    const html = para.repeat(
      Math.ceil((STATEMENT_MAX_HTML_BYTES * 2) / para.length),
    );
    const { blocks, truncated } = clean(html);
    expect(truncated).toBe(true);
    expect(utf8ByteLength(allText(blocks))).toBeLessThanOrEqual(
      STATEMENT_MAX_HTML_BYTES,
    );
    expect(blocks.length).toBeLessThan(270);
  });

  it('sanitizes a recorded Two Sum fixture (synthetic stand-in, not LeetCode text)', () => {
    // Written for this test (§6.2): the same tag mix as the real page.
    const html =
      '<p>You get a list <code>nums</code> and a number <code>goal</code>. Pick two places whose values add up to <code>goal</code>.</p>\n\n<p>&nbsp;</p>\n<p><strong class="example">Example 1:</strong></p>\n\n<pre>\n<strong>Input:</strong> nums = [1,4,6], goal = 10\n<strong>Output:</strong> [1,2]\n</pre>\n\n<p><strong>Constraints:</strong></p>\n<ul>\n\t<li><code>2 &lt;= nums.length &lt;= 10<sup>4</sup></code></li>\n\t<li><font face="monospace">One answer exists.</font></li>\n</ul>';
    const { blocks, truncated } = clean(html);
    expect(truncated).toBe(false);
    expect(blocks).toEqual([
      {
        t: 'p',
        c: [
          text('You get a list '),
          { t: 'code', c: [text('nums')] },
          text(' and a number '),
          { t: 'code', c: [text('goal')] },
          text('. Pick two places whose values add up to '),
          { t: 'code', c: [text('goal')] },
          text('.'),
        ],
      },
      { t: 'p', c: [{ t: 'strong', c: [text('Example 1:')] }] },
      {
        t: 'pre',
        c: [
          text('\n'),
          { t: 'strong', c: [text('Input:')] },
          text(' nums = [1,4,6], goal = 10\n'),
          { t: 'strong', c: [text('Output:')] },
          text(' [1,2]\n'),
        ],
      },
      { t: 'p', c: [{ t: 'strong', c: [text('Constraints:')] }] },
      {
        t: 'ul',
        c: [
          {
            t: 'li',
            c: [
              {
                t: 'code',
                c: [
                  text('2 <= nums.length <= 10'),
                  { t: 'sup', c: [text('4')] },
                ],
              },
            ],
          },
          { t: 'li', c: [text('One answer exists.')] },
        ],
      },
    ]);
  });
});

describe('isStatementTree (ADR 0015 D2)', () => {
  it('accepts a valid tree', () => {
    expect(
      isStatementTree([
        { t: 'p', c: [{ t: 'text', v: 'a\tb\n' }, { t: 'br' }] },
        { t: 'ul', c: [{ t: 'li', c: [] }] },
      ]),
    ).toBe(true);
    expect(isStatementTree([])).toBe(true);
  });

  it('rejects unknown tags, attributes, extra keys and bad text', () => {
    const bad: unknown[] = [
      null,
      {},
      'p',
      [{ t: 'a', c: [] }],
      [{ t: 'script', c: [] }],
      [{ t: 'p', c: [], href: 'x' }],
      [{ t: 'p', c: [], attrs: { onclick: 'x' } }],
      [{ t: 'text', v: 'x', html: '<b>' }],
      [{ t: 'text', v: 1 }],
      [{ t: 'text', v: 'bell\u0007' }],
      [{ t: 'br', c: [] }],
      [{ t: 'p', c: 'x' }],
      [{ t: 'p' }],
      [[]],
    ];
    for (const value of bad) expect(isStatementTree(value)).toBe(false);
  });

  it('rejects trees over the depth, node and text caps', () => {
    let deep: StatementNode = { t: 'text', v: 'x' };
    for (let i = 0; i < STATEMENT_MAX_DEPTH + 1; i++) {
      deep = { t: 'em', c: [deep] };
    }
    expect(isStatementTree([deep])).toBe(false);
    const many = Array.from({ length: STATEMENT_MAX_NODES + 1 }, () => br);
    expect(isStatementTree(many)).toBe(false);
    expect(
      isStatementTree([
        { t: 'text', v: 'a'.repeat(STATEMENT_MAX_TEXT_BYTES + 1) },
      ]),
    ).toBe(false);
  });

  it('counts UTF-8 bytes like Buffer.byteLength', () => {
    for (const s of ['', 'abc', 'é', '€', '😀', 'a\ud800b', 'x😀é€']) {
      expect(utf8ByteLength(s)).toBe(Buffer.byteLength(s, 'utf8'));
    }
  });
});
