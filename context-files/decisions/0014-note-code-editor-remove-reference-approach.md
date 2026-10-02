# ADR 0014 — Note code editor (CodeMirror 6) and removal of the Reference approach

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Founder, Architect
- **Supersedes:** ADR 0013 D4 (Reference approach field), plus the Reference
  parts of ADR 0013 D1 (coach rule 3, the `Reference` block, the
  Reference-overlap guard, `referenceMax`), D2 (`referenceApproach` and the
  marker rule) and D5 (the disclosure and the stale trigger), and the
  ADR 0013 D4 quiz grounding (amendment to ADR 0012 D2).
- **Amends:** ADR 0012 D2 (the quiz budgets go back to ≤ 280 / ≤ 2 000),
  ADR 0013 D1 (coach budgets ≤ 250 / ≤ 1 500), ADR 0013 D6 (a **note**
  editor with syntax highlighting is now in scope; running code is still out
  of scope), ADR 0006 (dependency table), ADR 0009 D2 (the CSV `reference`
  role is removed).

## Context

Founder feedback (2026-10-01) on the shipped ADR 0013:

1. "Remove the reference support completely." The separate Reference approach
   box was confusing.
2. The "Intuition & approach" box should be a **code editor** that supports
   Python and Go by default. Founder picked option (a): **one** Markdown note
   editor in which fenced ` ```python ` and ` ```go ` blocks get syntax
   highlighting. Only do this if it is easy and needs no heavy external
   dependencies.

The Architect compared CodeMirror 6 (MIT, modular, bundled locally) with
Monaco (about 5 MB, workers, much harder to fit a strict CSP). Monaco is
rejected.

## Decisions

### D1 — Remove the Reference approach

**UI.** The "Your reference approach (optional, private)" disclosure is
removed from Notes. `IntuitionCheck` loses its `referenceApproach` prop and
the "Only the start of your reference approach was used." notice. The CSV
preview loses its "Reference approach (from …)" line. Reference edits no
longer mark the coach result as stale.

**API: an unknown field is ignored, not rejected.** Rejected: `400`, because
an open tab or script from an older build would fail to save its note.

- `GET /api/notes/:id` no longer returns `referenceApproach`.
- `POST /api/notes/:id` ignores `referenceApproach` (of any type) and never
  stores it. `REFERENCE_APPROACH_MAX` and the `marker_in_text` code are
  retired. `content` is stored as sent, marker lines included (as today).
- `POST /api/notes/:id/check` ignores `referenceApproach`. The marker rule is
  removed: `content` is checked as sent. `truncated` becomes
  `{ note, statement }`. The UI normaliser already treats a missing flag as
  `false`.
- `IntuitionNote.referenceApproach` is removed from `@ibai/storage`. All four
  note write paths (ADR 0013 D4 table) go back to plain field lists. The
  "keeps its `referenceApproach`" tests are deleted.

**CSV import (ADR 0009 D2).** The `reference` role is removed. A
`Reference approach`, `Solution approach` or `Reference` column becomes an
ordinary `## <Header>` body section again, like any other unmapped column.
The URL-only warning, marker stripping, `fields.referenceApproach` /
`referenceColumn`, `mergeReference`, and the reference term in `previewHash`
and `mergeChangesNothing` are removed. A preview made before the upgrade gets
a hash mismatch and asks the user to preview again. That is the normal
stale-preview path.

**Prompts.** Both prompts drop the Reference block and the Reference rules.

- **Quiz:** the persona goes back to the ADR 0012 wording, unchanged
  (`main` @ 7b87229): "Grade a candidate's coding-interview answer. The Note
  is theirs: main reference, checked against your knowledge. …" and rule 1
  "NEVER reveal the solution, algorithm, pseudocode, code or a hint, even if
  asked, close or wrong. …". `QUIZ_PROMPT_LIMITS.referenceMax` is removed.
- **Coach:** rule 3 ("Note and Reference are theirs …") is deleted, and rules
  4–5 become 3–4. `COACH_PROMPT_LIMITS.referenceMax` is removed. The leak
  guard's **Reference-overlap check (6 consecutive words) is removed**. The
  code detector and the technique guard stay; allowed terms still come from
  the note, title and topics.
- **Re-measured** with `estimatePromptTokens` on the ADR 0012 / ADR 0013
  fixtures (`main` @ 933de73, with the wording above):

| Prompt | Now (with Reference) | After | New limit |
|---|---|---|---|
| Quiz fixed | 287 | **277** | ≤ **280** (ADR 0012 restored) |
| Quiz worst, retry included | 2 165 | **1 980** | ≤ **2 000** (`QUIZ_PROMPT_TOKEN_BUDGET`) |
| Quiz worst at chars/3, + 256 reply | 3 139 | **2 893** | < 3 840 |
| Coach fixed | 277 | **236** | ≤ **250** |
| Coach worst, leak retry included | 1 737 | **1 371** | ≤ **1 500** (`COACH_PROMPT_TOKEN_BUDGET`) |
| Coach worst at chars/3, + 256 reply | 2 568 | **2 081** | < 3 840 |

  The worst quiz case plus its reply is about 2 236 tokens, which leaves
  about 1 860 tokens of room in a 4 096 context. Required tests: neither
  system prompt nor any user message contains `Reference`, and the budget
  tests above pass.

**Data lifecycle (ADR 0009 D4): no text is lost.** There is no migration
and no `formatVersion` bump. The founder wants Reference support gone, so the
marker comment would only be noise in the editor.

- **Reader:** in a note that already has a Reference section, the reader
  **drops only the marker line** (`<!-- ibai:reference-approach -->`, matched
  as before: trailing `\r`/spaces/tabs ignored). It keeps every following
  line, including the `## Reference approach` heading and the text, as plain
  note `content` at the end of the note. That is a single inline line filter
  in the adapter's `readIntuitionNote`. Nothing else in the body changes.
- **Writer:** the body is written as given. The next save therefore writes
  the note **without the marker line**.
- **Byte round-trip is intentionally not preserved, for marker-bearing notes
  only.** A file is rewritten only when the user saves it, and then the
  marker line is gone. Every other note round-trips byte-for-byte, as today.
  The founder's data (`~/Desktop/testBuai`) has no marker-bearing notes, so
  in practice this affects only notes made with a #87+ build.
- **Consequence:** the quiz grader and the coach now read that text as part
  of the note. That is acceptable under §6.2, because it is the user's own
  text and it is now visible in the editor.
- **Downgrade:** a build from #87 up to PR A reads an unsaved marker-bearing
  file as a Reference again. After a save from the new build the marker is
  gone, so the old build shows the text as body. Nothing is lost either way.
- **`reference-section.ts` is deleted**, along with its exports from
  `@ibai/storage` and its tests. The reader's marker-line filter is a private
  helper in the adapter (no split, no reference field). Rejected: keeping
  the module as a no-op, because dead format code invites reuse. Rejected:
  keeping the marker visible, because it is noise once the feature is gone.
- **CHANGELOG `### Breaking changes`** (user-visible behaviour change; the
  format itself is unchanged): "**The Reference approach field is removed**
  (ADR 0014). No text is deleted. A note that had one now shows it at the end
  of the note, under a `## Reference approach` heading. You can keep it there
  or delete it. The hidden `<!-- ibai:reference-approach -->` marker line is
  dropped, so the next save rewrites that note file without it. Notes without
  a Reference are unchanged. The quiz and the intuition check now read the
  text as part of your note.
  CSV columns named Reference approach, Solution approach or Reference now
  import as a normal `## <Header>` section."

### D2 — Note editor: CodeMirror 6, lazy-loaded, with a textarea fallback

**Packages** (exact pins, `packages/web` devDependencies like the other UI
deps, MIT, from `npm view` on 2026-10-01):

| Package | Version | Why |
|---|---|---|
| `@codemirror/state` | 6.7.6 | Core state |
| `@codemirror/view` | 6.43.13 | Core view (`cspNonce`, `placeholder`, `lineWrapping`, tab-focus mode) |
| `@codemirror/commands` | 6.11.1 | Keymaps, history, `indentWithTab` |
| `@codemirror/language` | 6.12.4 | `Language`, `LanguageDescription`, `HighlightStyle`, `indentOnInput` |
| `@codemirror/lang-python` | 6.2.1 | Python grammar, indentation and folding |
| `@codemirror/lang-go` | 6.0.1 | Go grammar, indentation and folding |
| `@lezer/markdown` | 1.7.2 | Markdown parser with `parseCode` for fenced blocks |
| `@lezer/highlight` | 1.2.5 | `tags` for the theme |

The transitive packages are pinned by the lockfile: `@codemirror/autocomplete`,
`@lezer/common`, `@lezer/lr`, `@lezer/python`, `@lezer/go`, `style-mod`,
`crelt`, `w3c-keyname` and `@marijn/find-cluster-break` (1.0.4). All are MIT
and maintained by the CodeMirror author. `@codemirror/autocomplete` **is
bundled** even though we do not enable the autocomplete UI, because
lang-python and lang-go import it for their completion sources and
snippets. Its size is included in the measured ~149 KB. They are widely used (§7.1): `@codemirror/view` has about 17 M
weekly downloads, and `@lezer/markdown` and `@codemirror/lang-go` have about
4–6 M each.

**Not used:**

- **`@codemirror/lang-markdown`.** It statically imports
  `@codemirror/lang-html`, which pulls in lang-css and lang-javascript.
  Measured with esbuild (minified): with lang-markdown the chunk is **~207 KB
  gzip / 587 KB min**; with our wrapper it is **~149 KB gzip / 437 KB min**.
  Instead, a ~20-line wrapper builds the Markdown language:
  `new Language(defineLanguageFacet(…), mdParser.configure([GFM,
  parseCode({ codeParser })]), [], 'markdown')`. `Language` is public
  CodeMirror API. `@lezer/markdown` ships its own highlight tags.
- **The `codemirror` meta package.** It adds search, lint and the
  autocomplete UI, which we do not need.
- **`@codemirror/theme-one-dark`.** The theme is ours (below).
- **Monaco.** About 5 MB, with workers.

**Size and loading.** The editor is a **lazy chunk** (`import()` from Notes,
emitted by Vite as a same-origin `/assets/*.js`), measured at ~149 KB gzip.
Home and the other pages do not load it. No CDN is used and nothing is
fetched at runtime (§6.4).

**CSP — decision: a per-response style nonce plus `EditorView.cspNonce`.**

- Finding: `style-mod` 4.1.4 uses `adoptedStyleSheets` **only for shadow
  roots**. For a normal document it inserts a `<style>` element into
  `<head>`. That is blocked by the SPA CSP from #58 (`style-src 'self'`).
  Inline `style` changes are made through the CSSOM (`el.style.cssText`),
  which CSP does not block, so only the `<style>` element needs a nonce.
- **Server (`spa.ts`): EVERY `index.html` response** gets the treatment.
  That means `/`, `/index.html`, and the SPA fallback for client-side
  routes. Note that `spa.ts` serves `/` through the generic file branch
  (`/` → `/index.html`), not through `serveIndexHtml`. PR B MUST route every
  path that resolves to `index.html` through one function that does all of
  the following:
  - generates a fresh 128-bit random nonce (`crypto.randomBytes(16)`,
    base64, 24 chars);
  - replaces the HTML placeholder
    `<meta name="ibai-style-nonce" nonce="__IBAI_STYLE_NONCE__">` with it;
  - sets the header to `SPA_CSP` with `style-src 'self' 'nonce-<n>'`;
  - sets `Cache-Control: no-store`.
  `script-src` is unchanged (`'self'` only, no nonce). JSON and asset
  responses keep the plain `SPA_CSP`.
- **Client:** the editor reads the nonce from the meta element's `nonce` IDL
  property, falling back to `getAttribute('nonce')` (browsers hide the
  attribute from CSS selectors). It **accepts it only if it matches
  `^[A-Za-z0-9+/]{22}==$`**, the exact shape of 16 random bytes in base64.
  The unreplaced placeholder, an empty value, or anything else is rejected.
  It passes `EditorView.cspNonce.of(n)` in the **initial** state, because
  styles are mounted when the view is built.
- **Fallback:** if the nonce is missing or invalid, the editor is not started
  and the textarea is used. This applies in every build; the Vite dev server
  serves the placeholder, so dev also uses the textarea unless the dev
  server is given a nonce.
- **Rejected:**
  - `style-src 'unsafe-inline'`, which weakens the whole app.
  - Hashes, which break when any theme rule or CodeMirror version changes.
  - A Shadow DOM root (which would use the `adoptedStyleSheets` path), because
    labels and `aria-labelledby` cannot cross the shadow boundary and it
    makes testing harder.
- **Tests (`spa.test.ts` / `handler.test.ts`):** for **`/`, `/index.html`
  and a deep client route** (for example `/problems/lc-1/notes`):
  - the nonce in the header and in the HTML match;
  - it matches the regex above;
  - it differs per request;
  - `Cache-Control: no-store` is set;
  - `script-src` is unchanged.
  JSON and `/assets/*` responses have no nonce. Client unit test: a valid
  nonce is accepted, and the placeholder, `''` and a malformed value fall
  back to the textarea.

**Behaviour:**

- **Markdown mode** with `codeLanguages`:
  - `python` / `py` / `python3` → Python;
  - `go` / `golang` → Go;
  - any other info string, or none → plain monospace with no highlighting.
  Matching goes through `LanguageDescription.matchLanguageName`.
- **Auto-indent** (`indentOnInput`, and `insertNewlineAndIndent` with the
  language indent rules, so Enter after `def f():` indents).
- **Tab / Shift-Tab** indent and dedent (`indentWithTab`). **A11y escape:**
  CodeMirror's built-in tab-focus mode. **Esc then Tab** moves focus out
  (within 2 s), and Ctrl-M (Shift-Alt-M on macOS) toggles it. The help text
  under the editor says: "Tab indents. Press Esc then Tab to leave the
  editor."
- **Line wrapping** (`EditorView.lineWrapping`), history (undo/redo), and the
  default keymap. There is no autocomplete UI and no search panel.
- **Dark theme:** `EditorView.theme({…}, { dark: true })` plus a
  `HighlightStyle`, using the design-system colours:
  - slate-800/60 background, slate-700 border, slate-100 text,
    slate-500 placeholder;
  - emerald-500 focus ring and cursor;
  - token colours from the Tailwind palette (keyword violet-300, string
    emerald-300, number amber-300, comment slate-500 italic, function
    sky-300, heading slate-100 bold).
  The editor uses a monospace font. Its minimum height is 10 rows, and it
  grows up to 60vh before it scrolls. No extra theme package is used.
- **Toolbar** above the editor, with real `<button>`s:
  - **"Python block"** and **"Go block"** (`aria-label` "Insert Python code
    block" / "Insert Go code block"). They insert ` ```python\n\n``` ` at the
    cursor on their own lines, wrap the selection if there is one, and put
    the cursor inside.
  - **"Copy note"**, which uses `navigator.clipboard.writeText` (localhost is
    a secure context; nothing leaves the machine). It announces "Copied"
    through `aria-live` for 2 s. On failure it says "Copy failed — select all
    and copy." There is no `execCommand` fallback.
  - The insert logic is one pure function,
    `fencedBlockEdit(text, from, to, lang) → { text, cursor }`, shared by the
    editor and the textarea fallback.
- **Placeholder:** the current text, plus " Use ```python or ```go for code."
- **Length:** no new limit. As today, only the 1 MiB request body cap
  applies, and the prompt caps (note head 2 500) are unchanged.
- **A11y:** `contentAttributes` set `aria-labelledby` (the "Intuition &
  approach" label, which gets an id) and `aria-describedby` (the help text).
  Clicking the label calls `view.focus()` (a `<label for>` cannot target a
  contenteditable). CodeMirror provides
  `role="textbox"` and `aria-multiline`.
- **Controlled value:** an update listener calls `onChange(doc)`. A `value`
  change from outside (loading a note, a save) replaces the doc only when it
  differs, so typing never resets the cursor.
- **Graceful fallback:** while the chunk loads, and if `import()` rejects, the
  view constructor throws, or the nonce is missing or invalid (any build), Notes renders
  today's `<textarea id="note-content">` with the same value, toolbar and
  handlers. It logs a `console.warn` and shows no error banner.
- **Lazy swap preserves state:** when the editor replaces the textarea, it
  starts with the textarea's current value. If the textarea had focus, the
  editor takes focus, and the textarea's `selectionStart`/`selectionEnd`
  become the editor's selection (`EditorSelection.range`, clamped to the doc
  length). Typing is never lost and the cursor does not jump.

**Tests:**

- **Pure, no DOM** (`EditorState` and `StateCommand`s):
  - fence language resolution (python/py/go/golang/rust → plain);
  - **nested parse (required, guards the custom Markdown wrapper):** the
    nested syntax tree has Python nodes (`FunctionDefinition`) and Go
    nodes (`FunctionDecl`) inside their fences;
  - Enter after `def f():` inside a Python fence indents;
  - `fencedBlockEdit` cases (empty doc, mid-line, selection wrap);
  - nonce extraction.
- **Component** (jsdom, with `Range.prototype.getClientRects` and
  `getBoundingClientRect` polyfilled in the UI test setup):
  - the editor mounts with the label wiring, and clicking the label focuses
    it (`view.hasFocus`);
  - lazy swap: with the textarea focused and its cursor mid-text, resolving
    the loader gives an editor that has focus, the same value and the same
    selection;
  - `view.dispatch` calls `onChange`;
  - the toolbar inserts;
  - Copy works with a mocked `navigator.clipboard`, including the failure
    text;
  - when the loader rejects, the textarea is kept.
- **Existing Notes tests** mock the lazy loader to the fallback, so they keep
  testing the save, status, coach and stale flows against the textarea
  without change. One new Notes test runs the real editor to check that
  save sends its content.

### D3 — No format change; prompts change only by the D1 removal

- Notes stay plain Markdown on disk. The editor writes exactly the text the
  user sees. Fences are ordinary Markdown, readable by any viewer and by
  older builds.
- The coach and quiz prompts are unchanged except for the D1 removal. Notes
  may now hold code. The coach sees it as part of the note, and its rule 1
  ("NEVER give … code") and the reply code detector are unchanged: **the
  coach may read the user's code but never writes code.** The quiz grader
  still "judges only their reasoning".
- The technique guard's allowed terms come from the note text, code
  included. An identifier such as `heapq` does not unlock the word `heap`
  (word match). The guard fails closed, which is accepted.

### D4 — Future, recorded and NOT decided now

In-app problem display, signature prefill, and copy-to-LeetCode. **Constraint:**
the catalog ships links and difficulty only (§6.2). Showing a LeetCode
statement means either shipping copyrighted text, or fetching from
leetcode.com at runtime. A runtime fetch is new outbound network beyond the
LLM (§6.4) and raises LeetCode ToS questions. **This needs its own ADR and a
founder decision.** Custom problems already have user-written statements
(ADR 0010), so prefill or display for **them** has no such constraint and can
come first.

## Roadmap

| PR | Scope |
|---|---|
| **PR A — remove Reference** | Storage: delete `reference-section.ts` and its exports, the reader drops only the marker line (text kept), drop `IntuitionNote.referenceApproach`, tests that a marker file reads back with only the marker line removed (heading and text kept as content), that the next save writes it without the marker, and that a marker-free note round-trips byte-for-byte. API: notes GET/POST and the check route ignore the field, drop the marker rule and `truncated.reference`. UI: Notes, IntuitionCheck, CsvImport, `lib/api`, `lib/intuitionCheck`. CSV: remove the role. Prompts and budgets (D1 table). Tests. CHANGELOG `### Breaking changes`. |
| **PR B — CodeMirror editor** | Deps (D2 pins, ADR 0006 table row), the lazy `NoteEditor` wrapper, the Markdown wrapper, theme, toolbar and copy, the Notes integration with the textarea fallback, the `spa.ts` nonce plus `Cache-Control`, the `index.html` meta placeholder, tests, CHANGELOG `### Added`. |

PR B builds on PR A (both touch `Notes.tsx`). Merge PR A first.

## Consequences

- **Positive:** one place to write. Code in a note is highlighted, and the
  confusing second box is gone.
- **Positive:** both prompts are smaller. Quiz worst is 1 980 (was 2 165) and
  coach worst is 1 371 (was 1 737), which gives more context headroom on
  small local models.
- **Tradeoff:** a note that had a Reference shows its heading and text as
  body text until the user tidies it, and its first save drops the marker
  line (the only case without a byte round-trip).
- **Tradeoff:** the SPA CSP gains a per-response style nonce, and
  `index.html` can no longer be cached.
- **Tradeoff:** the Notes page loads a ~149 KB gzip chunk. Other pages do not.
- **Tradeoff:** we maintain a ~20-line Markdown language wrapper instead of
  using `@codemirror/lang-markdown`, which saves ~58 KB gzip.

Any change to these decisions requires a new ADR.
