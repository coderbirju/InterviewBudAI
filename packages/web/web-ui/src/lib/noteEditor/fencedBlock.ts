/**
 * Fence helpers shared by the CodeMirror editor and the pure note helpers
 * (ADR 0014 D2, ADR 0015 D3). Pure: no DOM, no CodeMirror.
 */

export type FenceLanguage = 'python' | 'go';

/**
 * Fence info words per language (ADR 0014 D2, shared per ADR 0015 D3). The
 * first entry is the canonical name. `markdown.ts` builds the CodeMirror
 * `CODE_LANGUAGES` from this, and `noteTemplate.ts` uses it for "Copy code"
 * and the editor mode, so the alias set lives in one place.
 */
export const FENCE_ALIASES: Readonly<Record<FenceLanguage, readonly string[]>> =
  {
    python: ['python', 'py', 'python3'],
    go: ['go', 'golang'],
  };

/**
 * The language of a fence info string (```` ```python title ```` → `python`),
 * by its first word, case-insensitively and exactly (`pythonic` → null).
 */
export function fenceLanguageOf(info: string): FenceLanguage | null {
  const word = (info.trim().split(/\s+/)[0] ?? '').toLowerCase();
  if (word === '') return null;
  for (const lang of ['python', 'go'] as const) {
    if (FENCE_ALIASES[lang].includes(word)) return lang;
  }
  return null;
}

/**
 * The smallest single replacement turning `prev` into `next` (common prefix
 * and suffix trimmed), so the editor can dispatch a minimal change.
 */
export function minimalChange(
  prev: string,
  next: string,
): { from: number; to: number; insert: string } {
  let p = 0;
  const max = Math.min(prev.length, next.length);
  while (p < max && prev.charCodeAt(p) === next.charCodeAt(p)) p++;
  let s = 0;
  while (
    s < max - p &&
    prev.charCodeAt(prev.length - 1 - s) ===
      next.charCodeAt(next.length - 1 - s)
  ) {
    s++;
  }
  return {
    from: p,
    to: prev.length - s,
    insert: next.slice(p, next.length - s),
  };
}
