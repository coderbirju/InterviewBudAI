import {
  Language,
  LanguageDescription,
  defineLanguageFacet,
  languageDataProp,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { GFM, parseCode, parser as mdParser } from '@lezer/markdown';
import { FENCE_ALIASES, fenceLanguageOf } from './fencedBlock';

/**
 * The note editor's Markdown language (ADR 0014 D2). EDITOR CHUNK ONLY.
 *
 * A small wrapper instead of `@codemirror/lang-markdown`, which pulls in
 * lang-html/css/javascript (~58 KB gzip). Fenced blocks tagged
 * python/py/python3 or go/golang are parsed with the real grammar (nested
 * parse), so they get highlighting and language indentation. Any other info
 * string, or none, stays plain monospace text.
 *
 * `@lezer/markdown` ships its own highlight tags. The nested-parse test in
 * `markdown.test.ts` guards this wrapper against a dependency bump.
 */

/**
 * Fence languages, loaded eagerly: both grammars live in this chunk. The
 * aliases come from the shared `FENCE_ALIASES` (ADR 0015 D3).
 */
const PYTHON = LanguageDescription.of({
  name: 'Python',
  alias: FENCE_ALIASES.python,
  support: python(),
});
const GO = LanguageDescription.of({
  name: 'Go',
  alias: FENCE_ALIASES.go,
  support: go(),
});
export const CODE_LANGUAGES: readonly LanguageDescription[] = [PYTHON, GO];

/**
 * Resolve a fence info string (```` ```python title ```` → `python`) to a
 * supported language, by its first word. Unknown or empty → null (plain).
 */
export function resolveFenceLanguage(info: string): LanguageDescription | null {
  const lang = fenceLanguageOf(info);
  return lang === 'python' ? PYTHON : lang === 'go' ? GO : null;
}

const markdownData = defineLanguageFacet({
  commentTokens: { block: { open: '<!--', close: '-->' } },
});

export const markdownLanguage = new Language(
  markdownData,
  mdParser.configure([
    GFM,
    parseCode({
      codeParser: (info) =>
        resolveFenceLanguage(info)?.support?.language.parser ?? null,
    }),
    { props: [languageDataProp.add({ Document: markdownData })] },
  ]),
  [],
  'markdown',
);
