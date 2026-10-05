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
 *  - caps: depth, node count, text bytes (`statement-tree.ts`), plus the
 *    input size and the number of open tags (here); past a cap the tree is
 *    cut, parsing stops and `truncated` is set. Work is linear in the input.
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

/** Longest HTML input parsed (UTF-8 bytes); longer input is cut first. */
export const STATEMENT_MAX_HTML_BYTES = 256 * 1024;
/** Most tags open at once (every frame kind); past it the tree is cut. */
export const STATEMENT_MAX_OPEN = 1024;

// Mutable twins of the readonly tree types, used only while building.
type MText = { t: 'text'; v: string };
type MBr = { t: 'br' };
type MElem = { t: StatementTag; c: MNode[] };
type MNode = MText | MBr | MElem;

/**
 * One open source tag. Each frame records, when pushed, the list its
 * children go into, that list's element tag and the nearest open row, so
 * every lookup is O(1) (no stack scans per event).
 */
interface Frame {
  readonly name: string;
  /**
   * `drop`: inside a dropped tag; `unwrap`: tag removed, children kept;
   * `break`: a nested block (unwrapped, a break before and after);
   * `elem`: a kept element.
   */
  readonly kind: 'drop' | 'unwrap' | 'break' | 'elem';
  /** The kept element (`elem` only). */
  readonly node?: MElem;
  /** Where this frame's children go (its own node's list for `elem`). */
  readonly list: MNode[];
  /** The element tag owning `list` (null = the top level). */
  readonly tag: StatementTag | null;
  /** The list this frame's own node was added to (`elem` only). */
  readonly parentList: MNode[];
  /** Nearest open `tr` frame (this frame itself for a `tr`). */
  row: Frame | undefined;
  /** Cells seen so far (rows only). */
  cells: number;
}

/** Thrown inside the parser callbacks to stop parsing once the tree is full. */
class StopParsing extends Error {}

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
  let end = 0;
  for (const ch of value) {
    const size = utf8ByteLength(ch);
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += ch.length;
  }
  return value.slice(0, end);
}

/**
 * Sanitize untrusted statement HTML into a tree that always passes
 * `isStatementTree()`. Never throws on malformed or unclosed markup.
 *
 * Linear in the input: input over {@link STATEMENT_MAX_HTML_BYTES} is cut
 * first, every lookup is O(1), at most {@link STATEMENT_MAX_OPEN} tags are
 * open at once, and parsing stops as soon as any cap is hit.
 */
export function sanitizeStatementHtml(input: string): SanitizedStatement {
  const root: MNode[] = [];
  const stack: Frame[] = [];
  let nodes = 0;
  let textBytes = 0;
  let truncated = false;
  /** A cap was hit: nothing more is added and parsing stops. */
  let full = false;
  let dropDepth = 0;
  let elemDepth = 0;
  let preDepth = 0;

  let html = input;
  if (utf8ByteLength(html) > STATEMENT_MAX_HTML_BYTES) {
    html = cutToBytes(html, STATEMENT_MAX_HTML_BYTES);
    truncated = true;
  }

  const top = (): Frame | undefined => stack[stack.length - 1];
  const container = (): MNode[] => top()?.list ?? root;
  const containerTag = (): StatementTag | null => top()?.tag ?? null;

  /** Mark the tree full and stop the parser. */
  const stop = (): never => {
    full = true;
    truncated = true;
    throw new StopParsing();
  };

  /** Reserve one node; stops parsing when the cap is reached. */
  const takeNode = (): void => {
    if (nodes + 1 > STATEMENT_MAX_NODES) stop();
    nodes += 1;
  };

  /** Drop trailing blank text nodes, then add a `br` unless one ends it. */
  const addBreak = (list: MNode[]): void => {
    while (isBlankText(list[list.length - 1])) list.pop();
    const last = list[list.length - 1];
    if (last === undefined || last.t === 'br') return;
    takeNode();
    list.push({ t: 'br' });
  };

  const addText = (raw: string): void => {
    if (dropDepth > 0) return;
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
    if (overCap)
      value = cutToBytes(value, STATEMENT_MAX_TEXT_BYTES - textBytes);
    if (value !== '') {
      if (last !== undefined && last.t === 'text') {
        last.v += value;
      } else {
        takeNode();
        list.push({ t: 'text', v: value });
      }
      textBytes += utf8ByteLength(value);
    }
    // Past the text cap nothing else is added.
    if (overCap) stop();
  };

  /** Push a frame; past the open-tag cap the tree is cut. */
  const push = (name: string, kind: Frame['kind'], node?: MElem): void => {
    if (stack.length >= STATEMENT_MAX_OPEN) stop();
    const parent = top();
    const parentList = parent?.list ?? root;
    const parentTag = parent?.tag ?? null;
    const frame: Frame = {
      name,
      kind,
      ...(node !== undefined && { node }),
      list: node !== undefined ? node.c : parentList,
      tag: node !== undefined ? node.t : parentTag,
      parentList,
      row: undefined,
      cells: 0,
    };
    frame.row = name === 'tr' ? frame : parent?.row;
    stack.push(frame);
    if (kind === 'drop') dropDepth += 1;
    if (kind === 'elem') {
      elemDepth += 1;
      if (node!.t === 'pre') preDepth += 1;
    }
  };

  const openElem = (name: string, tag: StatementTag): void => {
    if (elemDepth + 1 > STATEMENT_MAX_DEPTH) {
      // Past the depth cap: keep the text, cut the nesting.
      truncated = true;
      push(name, 'unwrap');
      return;
    }
    if (stack.length >= STATEMENT_MAX_OPEN) stop();
    takeNode();
    const node: MElem = { t: tag, c: [] };
    container().push(node);
    push(name, 'elem', node);
  };

  const onOpen = (name: string): void => {
    if (dropDepth > 0 || DROP_WITH_CONTENT.has(name)) {
      push(name, 'drop');
      return;
    }
    if (name === 'br') {
      takeNode();
      container().push({ t: 'br' });
      push(name, 'unwrap');
      return;
    }
    if (name === 'td' || name === 'th') {
      const row = top()?.row;
      if (row === undefined || row.cells > 0) addBreak(container());
      if (row !== undefined) row.cells += 1;
      push(name, 'unwrap');
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
        push(name, 'break');
      }
      return;
    }
    if (kept !== undefined) {
      openElem(name, kept);
      return;
    }
    push(name, 'unwrap');
  };

  const closeFrame = (frame: Frame): void => {
    if (frame.kind === 'drop') {
      dropDepth -= 1;
      return;
    }
    if (frame.kind === 'break') {
      if (!full) addBreak(frame.list);
      return;
    }
    if (frame.kind !== 'elem') return;
    elemDepth -= 1;
    const node = frame.node!;
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
      const parent = frame.parentList;
      if (node.t === 'p' && node.c.length === 0) {
        if (parent[parent.length - 1] === node) parent.pop();
      }
    }
  };

  const onClose = (name: string): void => {
    // The parser closes tags in stack order; pop up to the matching frame.
    let index = stack.length - 1;
    while (index >= 0 && stack[index]!.name !== name) index--;
    if (index === -1) return;
    while (stack.length > index) {
      closeFrame(stack.pop()!);
    }
  };

  const parser = new Parser(
    {
      onopentagname: onOpen,
      onopentag(name, attribs) {
        if (name !== 'img' || dropDepth > 0) return;
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
  try {
    parser.write(html);
    parser.end();
  } catch (err) {
    if (!(err instanceof StopParsing)) throw err;
  }
  // Close what is still open (breaks are not added once the tree is full).
  while (stack.length > 0) {
    try {
      closeFrame(stack.pop()!);
    } catch (err) {
      if (!(err instanceof StopParsing)) throw err;
    }
  }
  // Blank text at the top level carries nothing.
  while (isBlankText(root[root.length - 1])) root.pop();

  return { blocks: root as StatementNode[], truncated };
}
