import { fenceLanguageOf } from './noteEditor/fencedBlock';
import type { FenceLanguage } from './noteEditor/fencedBlock';

/**
 * Code-first note templates (ADR 0015 D3). Pure: no DOM, no CodeMirror, no
 * network. Built on the client from the statement reply; nothing is written
 * on open.
 */

/** The user's code language (ADR 0015 D4). */
export type CodeLanguage = FenceLanguage;

/** The editor's language mode. */
export type NoteEditorMode = 'markdown' | 'python' | 'go';

/** Rule 1: a signature line. Comments never match (they start with #, //). */
const PYTHON_SIGNATURE = /^\s*def \w+\(.*:\s*$/;
const GO_SIGNATURE = /^\s*func\b.*\{\s*$/;
const FENCE_LINE = /^\s*(```|~~~)/;

const PROMPTS = [
  'Intuition:',
  '',
  'Approach:',
  '',
  'Complexity: time O(?), space O(?)',
] as const;

/** The generic templates: custom problems and problems without a snippet. */
export const GENERIC_TEMPLATES: Readonly<Record<CodeLanguage, string>> = {
  python: [
    'class Solution:',
    '    def solve(self):',
    '        # Intuition:',
    '        #',
    '        # Approach:',
    '        #',
    '        # Complexity: time O(?), space O(?)',
    '        pass',
  ].join('\n'),
  go: [
    'func solve() {',
    '    // Intuition:',
    '    //',
    '    // Approach:',
    '    //',
    '    // Complexity: time O(?), space O(?)',
    '}',
  ].join('\n'),
};

/** The generic templates' signature keys (D3). */
const GENERIC_KEYS: Readonly<Record<CodeLanguage, string>> = {
  python: 'def solve(',
  go: 'func solve(',
};

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}

/** Indent width, a tab counting as 4 (LeetCode snippets use spaces). */
function widthOf(line: string): number {
  let w = 0;
  for (const ch of indentOf(line)) w += ch === '\t' ? 4 : 1;
  return w;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function promptLines(indent: string, lang: CodeLanguage): string[] {
  const mark = lang === 'python' ? '#' : '//';
  return PROMPTS.map((p) =>
    p === '' ? indent + mark : `${indent}${mark} ${p}`,
  );
}

/**
 * Which lines are inside a Go block comment, so a `func` inside one is not a
 * signature. Python comments are `#` lines, which the regex never matches.
 */
function goCommentMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = [];
  let open = false;
  for (const line of lines) {
    const startsOpen = open;
    let rest = line;
    let touched = startsOpen;
    for (;;) {
      if (open) {
        const end = rest.indexOf('*/');
        if (end < 0) break;
        open = false;
        rest = rest.slice(end + 2);
      } else {
        const start = rest.indexOf('/*');
        if (start < 0) break;
        if (rest.slice(0, start).trim() === '') touched = true;
        open = true;
        rest = rest.slice(start + 2);
      }
    }
    mask.push(touched);
  }
  return mask;
}

/** Index of the first signature line that is not a comment, or -1. */
function findSignature(lines: readonly string[], lang: CodeLanguage): number {
  const re = lang === 'python' ? PYTHON_SIGNATURE : GO_SIGNATURE;
  const mask = lang === 'go' ? goCommentMask(lines) : [];
  return lines.findIndex((line, i) => re.test(line) && !mask[i]);
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Drop whitespace-only lines at the end. */
function trimEnd(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1] ?? '')) end--;
  return lines.slice(0, end);
}

/**
 * Python rule 4: every `def` whose body has only blank and comment lines gets
 * its blank lines removed and one `pass` at its end, at the def indent + 4.
 * A body ends at the next non-blank line indented ≤ the def, or at the end.
 */
function addPythonPass(lines: readonly string[]): string[] {
  const out = [...lines];
  // Walk from the bottom so earlier indices stay valid while bodies change.
  for (let i = out.length - 1; i >= 0; i--) {
    const def = out[i] ?? '';
    if (!PYTHON_SIGNATURE.test(def)) continue;
    const defWidth = widthOf(def);
    let end = i + 1;
    while (end < out.length) {
      const line = out[end] ?? '';
      if (!isBlank(line) && widthOf(line) <= defWidth) break;
      end++;
    }
    const body = out.slice(i + 1, end);
    const hasCode = body.some(
      (l) => !isBlank(l) && !l.trimStart().startsWith('#'),
    );
    if (hasCode) continue;
    const kept = body.filter((l) => !isBlank(l));
    kept.push(`${indentOf(def)}    pass`);
    out.splice(i + 1, end - (i + 1), ...kept);
  }
  return out;
}

/** Go: blank lines inside braces are removed; bodies are otherwise kept. */
function dropGoBlankBodyLines(lines: readonly string[]): string[] {
  const mask = goCommentMask(lines);
  const out: string[] = [];
  let depth = 0;
  lines.forEach((line, i) => {
    if (depth > 0 && isBlank(line)) return;
    out.push(line);
    if (mask[i]) return;
    const code = line.replace(/\/\/.*$/, '');
    for (const ch of code) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  });
  return out;
}

/**
 * The starter code for a note (D3): LeetCode's snippet with the prompts as
 * comments on the first lines of the first function body, or the generic
 * template when there is no snippet.
 */
export function buildTemplate(
  snippet: string | null | undefined,
  lang: CodeLanguage,
): string {
  if (typeof snippet !== 'string' || snippet.trim() === '') {
    return GENERIC_TEMPLATES[lang];
  }
  let lines = trimEnd(splitLines(snippet));
  const sig = findSignature(lines, lang);
  if (sig >= 0) {
    const indent = indentOf(lines[sig] ?? '') + '    ';
    lines.splice(sig + 1, 0, ...promptLines(indent, lang));
  } else {
    // No signature line: the comments go at the end of the snippet.
    lines.push(...promptLines('', lang));
  }
  lines =
    lang === 'python' ? addPythonPass(lines) : dropGoBlankBodyLines(lines);
  return trimEnd(lines).join('\n');
}

/**
 * The signature key (D3): the first signature line, trimmed. The generic
 * template's key is `def solve(` / `func solve(`. Null when the snippet has
 * no signature line.
 */
export function signatureKey(
  snippet: string | null | undefined,
  lang: CodeLanguage,
): string | null {
  if (typeof snippet !== 'string' || snippet.trim() === '') {
    return GENERIC_KEYS[lang];
  }
  const lines = splitLines(snippet);
  const sig = findSignature(lines, lang);
  return sig >= 0 ? (lines[sig] ?? '').trim() : null;
}

/** A note is empty when it has no file or its body is only whitespace. */
export function isEmptyNote(text: string): boolean {
  return text.trim() === '';
}

/** The fenced starter block appended to an existing note. */
export function fencedStarter(template: string, lang: CodeLanguage): string {
  return '```' + lang + '\n' + template + '\n```';
}

/**
 * What the editor shows on open (D3), or null to leave the note as it is:
 *  - an empty note → the template itself (no fences);
 *  - a note without the signature key → the note, one blank line, and the
 *    template as a fenced block;
 *  - a note that already has the key (or no key can be found) → null.
 */
export function starterFor(
  note: string,
  snippet: string | null | undefined,
  lang: CodeLanguage,
): string | null {
  const template = buildTemplate(snippet, lang);
  if (isEmptyNote(note)) return template;
  const key = signatureKey(snippet, lang);
  // No key to check (a snippet without a signature line): appending would
  // repeat on every open, so the note is left alone.
  if (key === null || note.includes(key)) return null;
  const head = note.replace(/(?:\r?\n[ \t]*)+$/, '');
  return `${head}\n\n${fencedStarter(template, lang)}`;
}

/** The editor mode for a note's text (D3). */
export function noteEditorMode(
  text: string,
  preferred: CodeLanguage,
): NoteEditorMode {
  const lines = splitLines(text);
  if (lines.some((l) => FENCE_LINE.test(l))) return 'markdown';
  if (text.trim() === '') return preferred;
  if (lines.some((l) => PYTHON_SIGNATURE.test(l))) return 'python';
  if (lines.some((l) => GO_SIGNATURE.test(l))) return 'go';
  return 'markdown';
}

interface Fence {
  readonly lang: CodeLanguage | null;
  readonly body: string;
}

/** Fenced blocks in order. An unclosed fence runs to the end of the text. */
function fencesOf(lines: readonly string[]): Fence[] {
  const fences: Fence[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i] ?? '');
    if (!open) {
      i++;
      continue;
    }
    const marker = open[1] ?? '```';
    const char = marker[0] ?? '`';
    const info = open[2] ?? '';
    const body: string[] = [];
    i++;
    while (i < lines.length) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[i] ?? '');
      if (
        close &&
        (close[1] ?? '')[0] === char &&
        (close[1] ?? '').length >= marker.length
      ) {
        break;
      }
      body.push(lines[i] ?? '');
      i++;
    }
    i++; // past the closing fence (or the end)
    fences.push({ lang: fenceLanguageOf(info), body: body.join('\n') });
  }
  return fences;
}

/**
 * "Copy code" (D3): a note without fences is copied whole; otherwise the
 * last fence in the preferred language, else the last Python or Go fence,
 * else the whole note.
 */
export function extractCode(text: string, preferred: CodeLanguage): string {
  const lines = splitLines(text);
  if (!lines.some((l) => FENCE_LINE.test(l))) return text;
  const fences = fencesOf(lines);
  const pick =
    [...fences].reverse().find((f) => f.lang === preferred) ??
    [...fences].reverse().find((f) => f.lang !== null);
  return pick ? pick.body : text;
}
