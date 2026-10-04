/**
 * The sanitized problem-statement tree (ADR 0015 D2).
 *
 * Shared by the server (the sanitizer builds it, the cache reader checks it)
 * and the SPA (which checks it again before rendering it with React). It has
 * ZERO imports, so web-ui can import it by relative path
 * (`../../../src/statement-tree.js`) without pulling any server code into the
 * bundle.
 */

/** The tags that survive sanitizing. No attributes are ever kept. */
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

export type StatementNode =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: StatementTag; c: StatementNode[] };

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

/** Caps (D2). Past one, the sanitizer cuts the tree and sets `truncated`. */
export const STATEMENT_MAX_DEPTH = 32;
export const STATEMENT_MAX_NODES = 5000;
/** Total text, in UTF-8 bytes. */
export const STATEMENT_MAX_TEXT_BYTES = 128 * 1024;

const TAG_SET: ReadonlySet<string> = new Set(STATEMENT_TAGS);

/** C0 controls other than `\t` and `\n` (the sanitizer removes them). */
// eslint-disable-next-line no-control-regex
const BAD_CONTROL = /[\u0000-\u0008\u000b-\u001f]/;

/** UTF-8 byte length without `Buffer` or `TextEncoder` (zero imports). */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
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

function hasOnlyKeys(o: object, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && own.every((k) => keys.includes(k));
}

/**
 * True when `value` is a well-formed statement tree within the caps: an array
 * of nodes with exactly the allowed keys (no attributes), allowed tags only,
 * depth ≤ 32, ≤ 5 000 nodes and ≤ 128 KiB of text. Untrusted input: a cache
 * file on the server, an API reply in the SPA.
 */
export function isStatementTree(value: unknown): value is StatementNode[] {
  if (!Array.isArray(value)) return false;
  let nodes = 0;
  let textBytes = 0;
  // Iterative walk (no recursion limit games): [children, depth].
  const stack: Array<[unknown[], number]> = [[value, 1]];
  while (stack.length > 0) {
    const [list, depth] = stack.pop() as [unknown[], number];
    if (depth > STATEMENT_MAX_DEPTH) return false;
    for (const node of list) {
      nodes++;
      if (nodes > STATEMENT_MAX_NODES) return false;
      if (typeof node !== 'object' || node === null || Array.isArray(node)) {
        return false;
      }
      const n = node as Record<string, unknown>;
      if (n.t === 'text') {
        if (!hasOnlyKeys(n, ['t', 'v']) || typeof n.v !== 'string') {
          return false;
        }
        if (BAD_CONTROL.test(n.v)) return false;
        textBytes += utf8ByteLength(n.v);
        if (textBytes > STATEMENT_MAX_TEXT_BYTES) return false;
      } else if (n.t === 'br') {
        if (!hasOnlyKeys(n, ['t'])) return false;
      } else if (typeof n.t === 'string' && TAG_SET.has(n.t)) {
        if (!hasOnlyKeys(n, ['t', 'c']) || !Array.isArray(n.c)) return false;
        stack.push([n.c, depth + 1]);
      } else {
        return false;
      }
    }
  }
  return true;
}
