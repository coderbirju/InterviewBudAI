/**
 * LeetCode statement HTML → the allowlisted {@link StatementNode} tree
 * (ADR 0015 D2). Server only: the SPA never imports this file, so
 * `htmlparser2` never reaches the bundle.
 *
 * The HTML is untrusted (charter §7.3). Only the streaming `Parser`
 * callbacks are used; nothing here produces an HTML string. Rules:
 *
 *  - kept: `p pre code strong em ul ol li sup sub br`; `b` → `strong`,
 *    `i` → `em`; no attributes at all;
 *  - dropped WITH their content: {@link DROP_WITH_CONTENT};
 *  - `img` → the text `[image: <alt>]` (or `[image]`); `a` → its text;
 *  - `div h1–h6 blockquote section article tr` → `p` at the top level; a
 *    block inside another element (a `p` in a `p` or `li`) becomes a `br`
 *    break instead; table cells are unwrapped with a `br` between cells;
 *  - every other tag is unwrapped (children kept, tag dropped);
 *  - entities decoded by the parser, `&nbsp;` → space, C0 controls other
 *    than `\t` `\n` removed, whitespace collapsed outside `pre`;
 *  - caps: depth, node count, text bytes (`statement-tree.ts`); past a cap
 *    the tree is cut and `truncated` is set.
 */

import { Parser } from 'htmlparser2';
import {
  STATEMENT_MAX_DEPTH,
  STATEMENT_MAX_NODES,
  STATEMENT_MAX_TEXT_BYTES,
  utf8ByteLength,
} from './statement-tree.js';
import type { StatementNode, StatementTag } from './statement-tree.js';

/** Tags whose whole subtree (text included) is removed. */
export const DROP_WITH_CONTENT: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'noscript',
  'noembed',
  'noframes',
  'xmp',
  'plaintext',
  'textarea',
  'select',
  'option',
  'button',
  'form',
  'head',
  'title',
  'audio',
  'video',
  'canvas',
]);

/** Source tag → kept tag. */
const KEPT: ReadonlyMap<string, StatementTag> = new Map<string, StatementTag>([
  ['p', 'p'],
  ['pre', 'pre'],
  ['code', 'code'],
  ['strong', 'strong'],
  ['b', 'strong'],
  ['em', 'em'],
  ['i', 'em'],
  ['ul', 'ul'],
  ['ol', 'ol'],
  ['li', 'li'],
  ['sup', 'sup'],
  ['sub', 'sub'],
]);

/** Block tags that become a paragraph (or a break when nested). */
const BLOCKS: ReadonlySet<string> = new Set([
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'section',
  'article',
  'tr',
]);

/** Longest `alt` text kept in an `[image: …]` placeholder (characters). */
const MAX_ALT_CHARS = 200;

/** The sanitizer's result: the tree, and whether a cap cut it. */
export interface SanitizedStatement {
  readonly blocks: StatementNode[];
  readonly truncated: boolean;
}

// Mutable twins of the readonly tree types, used only while building.
type MText = { t: 'text'; v: string };
type MBr = { t: 'br' };
type MElem = { t: StatementTag; c: MNode[] };
type MNode = MText | MBr | MElem;

type Frame =
  /** Inside a dropped tag: nothing below it is emitted. */
  | { readonly name: string; readonly kind: 'drop' }
  /** Tag removed, children kept (or a frame inside a dropped tag). */
  | { readonly name: string; readonly kind: 'unwrap'; cells: number }
  /** A nested block: unwrapped, with a break before and after. */
  | { readonly name: string; readonly kind: 'break'; cells: number }
  /** A kept element. */
  | {
      readonly name: string;
      readonly kind: 'elem';
      readonly node: MElem;
      cells: number;
    };

// eslint-disable-next-line no-control-regex
const C0_CONTROLS = /[\u0000-\u0008\u000b-\u001f]/g;

/** Remove C0 controls (except `\t` `\n`; `\r` goes) and turn NBSP into a space. */
function cleanText(raw: string): string {
  return raw.replace(C0_CONTROLS, '').replace(/\u00a0/g, ' ');
}

function isBlankText(node: MNode | undefined): boolean {
  return node !== undefined && node.t === 'text' && node.v.trim() === '';
}

/** Cut `value` to at most `maxBytes` UTF-8 bytes, on a code point boundary. */
function cutToBytes(value: string, maxBytes: number): string {
  let bytes = 0;
  let out = '';
  for (const ch of value) {
    const size = utf8ByteLength(ch);
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += ch;
  }
  return out;
}

/**
 * Sanitize untrusted statement HTML into a tree that always passes
 * `isStatementTree()`. Never throws on malformed or unclosed markup.
 */
export function sanitizeStatementHtml(html: string): SanitizedStatement {
  const root: MNode[] = [];
  const stack: Frame[] = [];
  let nodes = 0;
  let textBytes = 0;
  let truncated = false;
  /** A node or text cap was hit: ignore everything after. */
  let full = false;
  let dropDepth = 0;
  let elemDepth = 0;
  let preDepth = 0;

  const container = (): MNode[] => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const frame = stack[i]!;
      if (frame.kind === 'elem') return frame.node.c;
    }
    return root;
  };
  const containerTag = (): StatementTag | null => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const frame = stack[i]!;
      if (frame.kind === 'elem') return frame.node.t;
    }
    return null;
  };

  /** Reserve one node; false (and the tree is cut) when the cap is reached. */
  const takeNode = (): boolean => {
    if (full) return false;
    if (nodes + 1 > STATEMENT_MAX_NODES) {
      full = true;
      truncated = true;
      return false;
    }
    nodes += 1;
    return true;
  };

  /** Drop trailing blank text nodes, then add a `br` unless one ends it. */
  const addBreak = (list: MNode[]): void => {
    while (isBlankText(list[list.length - 1])) list.pop();
    const last = list[list.length - 1];
    if (last === undefined || last.t === 'br') return;
    if (takeNode()) list.push({ t: 'br' });
  };

  const addText = (raw: string): void => {
    if (full || dropDepth > 0) return;
    let value = cleanText(raw);
    if (preDepth === 0) value = value.replace(/[\t\n ]+/g, ' ');
    if (value === '') return;
    const list = container();
    const last = list[list.length - 1];
    if (value.trim() === '' && preDepth === 0) {
      const tag = containerTag();
      if (
        tag === null ||
        tag === 'ul' ||
        tag === 'ol' ||
        last === undefined ||
        last.t === 'br' ||
        isBlankText(last)
      ) {
        return;
      }
    }
    const size = utf8ByteLength(value);
    const overCap = textBytes + size > STATEMENT_MAX_TEXT_BYTES;
    if (overCap) {
      value = cutToBytes(value, STATEMENT_MAX_TEXT_BYTES - textBytes);
      truncated = true;
    }
    if (value !== '') {
      if (last !== undefined && last.t === 'text') {
        last.v += value;
        textBytes += utf8ByteLength(value);
      } else if (takeNode()) {
        list.push({ t: 'text', v: value });
        textBytes += utf8ByteLength(value);
      }
    }
    // Past the text cap nothing else is added.
    if (overCap) full = true;
  };

  /** Nearest open table row, for the between-cells break. */
  const nearestRow = (): Frame | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.name === 'tr') return stack[i];
    }
    return undefined;
  };

  const openElem = (name: string, tag: StatementTag): void => {
    if (elemDepth + 1 > STATEMENT_MAX_DEPTH) {
      // Past the depth cap: keep the text, cut the nesting.
      truncated = true;
      stack.push({ name, kind: 'unwrap', cells: 0 });
      return;
    }
    if (!takeNode()) {
      stack.push({ name, kind: 'unwrap', cells: 0 });
      return;
    }
    const node: MElem = { t: tag, c: [] };
    container().push(node);
    stack.push({ name, kind: 'elem', node, cells: 0 });
    elemDepth += 1;
    if (tag === 'pre') preDepth += 1;
  };

  const onOpen = (name: string): void => {
    if (dropDepth > 0 || DROP_WITH_CONTENT.has(name)) {
      dropDepth += 1;
      stack.push({ name, kind: 'drop' });
      return;
    }
    if (full) {
      stack.push({ name, kind: 'unwrap', cells: 0 });
      return;
    }
    if (name === 'br') {
      const list = container();
      if (takeNode()) list.push({ t: 'br' });
      stack.push({ name, kind: 'unwrap', cells: 0 });
      return;
    }
    if (name === 'td' || name === 'th') {
      const row = nearestRow();
      if (row === undefined || row.kind === 'drop' || row.cells > 0) {
        addBreak(container());
      }
      if (row !== undefined && row.kind !== 'drop') row.cells += 1;
      stack.push({ name, kind: 'unwrap', cells: 0 });
      return;
    }
    const kept = KEPT.get(name);
    const isBlock = kept === 'p' || BLOCKS.has(name);
    if (isBlock) {
      if (elemDepth === 0) {
        openElem(name, 'p');
      } else {
        // A paragraph is never nested: the inner block becomes breaks.
        addBreak(container());
        stack.push({ name, kind: 'break', cells: 0 });
      }
      return;
    }
    if (kept !== undefined) {
      openElem(name, kept);
      return;
    }
    stack.push({ name, kind: 'unwrap', cells: 0 });
  };

  const closeFrame = (frame: Frame): void => {
    if (frame.kind === 'drop') {
      dropDepth -= 1;
      return;
    }
    if (frame.kind === 'break') {
      if (!full) addBreak(container());
      return;
    }
    if (frame.kind !== 'elem') return;
    elemDepth -= 1;
    const { node } = frame;
    if (node.t === 'pre') preDepth -= 1;
    if (node.t === 'p' || node.t === 'li') {
      // No trailing breaks or blank text; an empty paragraph is removed.
      for (;;) {
        const last = node.c[node.c.length - 1];
        if (last === undefined || !(last.t === 'br' || isBlankText(last))) {
          break;
        }
        node.c.pop();
      }
      if (node.t === 'p' && node.c.length === 0) {
        const parent = container();
        if (parent[parent.length - 1] === node) parent.pop();
      }
    }
  };

  const onClose = (name: string): void => {
    // The parser closes tags in stack order; pop up to the matching frame.
    const index = stack.map((f) => f.name).lastIndexOf(name);
    if (index === -1) return;
    while (stack.length > index) {
      closeFrame(stack.pop()!);
    }
  };

  const parser = new Parser(
    {
      onopentagname: onOpen,
      onopentag(name, attribs) {
        if (name !== 'img' || dropDepth > 0 || full) return;
        const alt = cleanText(attribs.alt ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, MAX_ALT_CHARS);
        addText(alt === '' ? '[image]' : `[image: ${alt}]`);
      },
      ontext: addText,
      onclosetag: onClose,
    },
    { decodeEntities: true, lowerCaseTags: true, xmlMode: false },
  );
  parser.write(html);
  parser.end();
  while (stack.length > 0) closeFrame(stack.pop()!);
  // Blank text at the top level carries nothing.
  while (isBlankText(root[root.length - 1])) root.pop();

  return { blocks: root as StatementNode[], truncated };
}
