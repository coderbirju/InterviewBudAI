/**
 * The sanitized problem-statement tree (ADR 0015 D2): its type, its caps and
 * the one validator both sides use.
 *
 * The server builds this tree from LeetCode HTML (`statement-sanitize.ts`)
 * and checks every cache file with {@link isStatementTree} on read. The SPA
 * imports THIS file by relative path and checks the tree again before it
 * renders it with React elements (no HTML string is ever rendered).
 *
 * This module MUST have zero imports: it is compiled by the server `tsc`
 * build and bundled by Vite, and must never pull `htmlparser2` (or anything
 * else) into the SPA bundle.
 */

/** The only element tags a statement tree may contain (`br` is its own node). */
export type StatementTag =
  | 'p'
  | 'pre'
  | 'code'
  | 'strong'
  | 'em'
  | 'ul'
  | 'ol'
  | 'li'
  | 'sup'
  | 'sub';

/** One node: plain text, a line break, or an allowed element (no attributes). */
export type StatementNode =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'br' }
  | { readonly t: StatementTag; readonly c: StatementNode[] };

/** Every tag a `{ t, c }` element node may carry. */
export const STATEMENT_TAGS: readonly StatementTag[] = [
  'p',
  'pre',
  'code',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'sup',
  'sub',
];

/** Deepest element nesting (a root element is depth 1). */
export const STATEMENT_MAX_DEPTH = 32;
/** Most nodes in one tree (text, `br` and elements all count). */
export const STATEMENT_MAX_NODES = 5000;
/** Most text in one tree, in UTF-8 bytes (all text nodes together). */
export const STATEMENT_MAX_TEXT_BYTES = 128 * 1024;

/** UTF-8 byte length of a string, without `Buffer` (works in the browser). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

/** C0 control characters other than `\t` and `\n` (never in a tree). */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000b-\u001f]/;

const TAG_SET: ReadonlySet<string> = new Set(STATEMENT_TAGS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

/**
 * Is `value` a valid statement tree? Checks the exact node shapes (no extra
 * keys, so no attributes can ride along), the tag allowlist, text without
 * C0 controls, and the depth, node and text caps. Iterative, so a hostile
 * deeply nested value cannot overflow the stack.
 */
export function isStatementTree(value: unknown): value is StatementNode[] {
  if (!Array.isArray(value)) return false;
  let nodes = 0;
  let textBytes = 0;
  // Each entry: a list of sibling nodes and the depth of their parent.
  const pending: { readonly list: unknown[]; readonly depth: number }[] = [
    { list: value, depth: 0 },
  ];
  while (pending.length > 0) {
    const { list, depth } = pending.pop()!;
    for (const node of list) {
      nodes += 1;
      if (nodes > STATEMENT_MAX_NODES) return false;
      if (!isPlainObject(node)) return false;
      const t = node.t;
      if (t === 'text') {
        if (!hasExactKeys(node, ['t', 'v'])) return false;
        const v = node.v;
        if (typeof v !== 'string' || FORBIDDEN_CONTROL.test(v)) return false;
        textBytes += utf8ByteLength(v);
        if (textBytes > STATEMENT_MAX_TEXT_BYTES) return false;
      } else if (t === 'br') {
        if (!hasExactKeys(node, ['t'])) return false;
      } else if (typeof t === 'string' && TAG_SET.has(t)) {
        if (!hasExactKeys(node, ['t', 'c'])) return false;
        if (!Array.isArray(node.c)) return false;
        if (depth + 1 > STATEMENT_MAX_DEPTH) return false;
        pending.push({ list: node.c, depth: depth + 1 });
      } else {
        return false;
      }
    }
  }
  return true;
}
