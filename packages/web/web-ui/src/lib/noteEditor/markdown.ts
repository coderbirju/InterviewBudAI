import {
  Language,
  LanguageDescription,
  defineLanguageFacet,
  languageDataProp,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { GFM, parseCode, parser as mdParser } from '@lezer/markdown';

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

/** Fence languages, loaded eagerly: both grammars live in this chunk. */
export const CODE_LANGUAGES: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'Python',
    alias: ['py', 'python3'],
    support: python(),
  }),
  LanguageDescription.of({ name: 'Go', alias: ['golang'], support: go() }),
];

/**
 * Resolve a fence info string (```` ```python title ```` → `python`) to a
 * supported language, by its first word. Unknown or empty → null (plain).
 */
export function resolveFenceLanguage(info: string): LanguageDescription | null {
  const word = info.trim().split(/\s+/)[0] ?? '';
  if (word === '') return null;
  return LanguageDescription.matchLanguageName(CODE_LANGUAGES, word, false);
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
