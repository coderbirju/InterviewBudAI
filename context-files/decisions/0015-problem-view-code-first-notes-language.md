# ADR 0015 — In-app problem view, code-first notes, language preference

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Founder, Architect
- **Supersedes:** —
- **Amends:** `team-charter.md` §6.4 and `00-project-context.md` principle 1
  (one optional, user-triggered network call, D1); `01-architecture.md`
  non-negotiables (the same exception); ADR 0014 D4 (resolved here);
  ADR 0006 (dependency table, D2); ADR 0014 D2 (the toolbar gains a language
  picker and "Copy code", D3/D4).

## Context

ADR 0014 D4 left one question open: showing the problem in the app, prefilling
the code signature, and copying code to LeetCode. The catalog ships links and
difficulty only (§6.2). Showing a statement means either shipping LeetCode's
text (rejected: copyright) or fetching it at runtime (new outbound network,
§6.4, and a LeetCode ToS question).

Founder decisions (2026-10-04):

1. When the user opens a catalog problem, the **local server** fetches that
   one problem from LeetCode and caches it in the user's data folder. The
   fetch is optional and can be turned off.
2. An empty note starts as the **starter code** for the user's language, with
   the intuition / approach / complexity prompts as comments inside the
   function. Copying the whole note pastes and runs on LeetCode.
3. An existing non-empty note gets the starter code **appended** when opened,
   unless it already has it.
4. The language is a **preference**: Python or Go, default Python.
5. The Notes page becomes a split view: statement left, editor right.

Verified on 2026-10-04 with two manual requests (no cookies, no auth, plain
`Content-Type: application/json`):

- `POST https://leetcode.com/graphql` with
  `question(titleSlug) { questionFrontendId title titleSlug isPaidOnly
  difficulty exampleTestcases content codeSnippets { langSlug code } }`
  returns 200 for `two-sum`. No `Referer` or CSRF token was needed.
- `content` is HTML. For Two Sum it uses `p code em strong ul li pre sup font`.
- `codeSnippets` has `langSlug` `python3` and `golang` (also `python`, which
  is Python 2, and is not used). Both use 4-space indentation. The Python body
  is one indented blank line; the Go body is `{\n    \n}`.
- A premium problem (`meeting-rooms-ii`) returns `isPaidOnly: true`,
  `content: null`, `codeSnippets: null`.

This can change at any time. Every fallback in D1 exists for that reason.

ARCC was queried through the arcc CLI fallback because `search_arcc` was not
registered in this session. It returned no guidance on sanitizing untrusted
HTML or on outbound HTTP limits, so standard practice is applied (allowlist
sanitizing, defense in depth, timeouts and size caps, least privilege).

## Decisions

### D1 — Problem statement fetch (optional, user-triggered)

**Rule amendment (§6.4).** The charter and principle 1 now read: "no
mandatory network calls except the configured LLM; optional user-triggered
LeetCode fetch per ADR 0015". §6.2 still holds: **the repo ships links and
difficulty only.** No LeetCode text is committed, bundled, or shipped in a
release. The user's own machine fetches one problem, for personal use, when
the user opens it.

**What is fetched.** One GraphQL request per problem to the fixed URL
`https://leetcode.com/graphql`:

```graphql
query ibaiQuestion($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId title titleSlug isPaidOnly difficulty
    exampleTestcases content codeSnippets { langSlug code }
  }
}
```

- `titleSlug` comes from the **catalog entry's `url`** on the server
  (`https://leetcode.com/problems/<slug>/`). The client only sends a catalog
  id. The slug must match `^[a-z0-9-]{1,100}$`.
- Only `python3` and `golang` snippets are kept.
- Custom problems (`u-` ids, ADR 0010) are never fetched. They show their own
  `statement`.

**Transport limits** (`packages/web/src/leetcode.ts`, Node `fetch`, no new
dependency):

| Limit | Value |
|---|---|
| Method / URL | `POST https://leetcode.com/graphql` only (a constant) |
| Timeout | 10 s (`AbortSignal.timeout`) |
| Redirects | `redirect: 'error'` |
| Response size | ≤ 1 MiB, read as a stream and aborted past the cap |
| Response type | must be `application/json`, must parse, must match the expected shape |
| Headers | `Content-Type: application/json`, `Accept: application/json`, `User-Agent: InterviewBudAI/<version> (+https://github.com/coderbirju/InterviewBudAI; personal use, user-triggered)` |
| Credentials | none: no cookies, no auth header, no user data in the request |
| Concurrency | one fetch in flight per process |
| Rate | at most 10 fetches per 10 minutes per process (sliding window) |

Only a cache miss or an explicit refresh calls LeetCode. Opening the same
problem again reads the cache.

**Cache.** `<dataDir>/problem-cache/<id>.json`, one file per catalog id.

- The directory is created 0700, files 0600, written atomically (temp file
  plus rename).
- **Path safety.** `safeJoin` is private to `@ibai/storage`, so PR A adds its
  own helper, `problemCachePath(dataDir, id)` in
  `packages/web/src/problem-cache.ts`. It runs **after** the catalog lookup
  and requires the id to match `^lc-[0-9]+$` (else it throws). It joins
  `<dataDir>/problem-cache/<id>.json` and checks with `path.relative` that the
  result stays inside `problem-cache/`. Custom (`u-`) ids never reach it.
- The app writes `problem-cache/.gitignore` containing `*`, so a user who
  git-tracks the data folder does not commit LeetCode text by accident.
- The cache stores the **sanitized** form (D2), never raw HTML.
- Shape (`schema: 1`):

```json
{
  "schema": 1,
  "id": "lc-1",
  "titleSlug": "two-sum",
  "title": "Two Sum",
  "isPaidOnly": false,
  "fetchedAt": "2026-10-04T12:00:00.000Z",
  "blocks": [],
  "truncated": false,
  "exampleTestcases": "[2,7,11,15]\n9",
  "snippets": { "python": "class Solution: ...", "go": "func twoSum(...) ..." },
  "pastedText": null
}
```

  `blocks` is the D2 tree or `null`. `truncated` is `true` when a D2 cap cut
  the tree. `fetchedAt` is `null` when nothing was fetched (paste only).
  `exampleTestcases` and each snippet are a string or `null`. `pastedText` is
  a string or `null`. There is no stored `source`: the API derives it (see
  "Which text is shown").
- **All caps are UTF-8 bytes** (`Buffer.byteLength`). `exampleTestcases` and
  each snippet: ≤ 16 KiB; a longer value from LeetCode is stored as `null`
  (not cut). `pastedText`: ≤ 64 KiB. D2 text: ≤ 128 KiB. Whole file:
  ≤ 512 KiB.
- **The writer checks** that the serialized JSON is ≤ 512 KiB (the read cap)
  before writing. Over the cap → it does not write, and the reply has
  `cached: false`. So the app never writes a file it would refuse to read.
- A cache file is **untrusted on read**: ≤ 512 KiB, must parse, must match the
  shape (including the per-field caps), and `blocks` must pass
  `isStatementTree()` (D2). Anything else is treated as "not cached" (and is
  overwritten by the next fetch or paste).
- A premium result is cached too (`isPaidOnly: true`, `blocks: null`), so the
  app does not ask again.
- When the data folder is read-only (ADR 0009 D4), a fetch still returns the
  statement but does not cache it (`cached: false`).

**Which text is shown.** When both a fetched statement and pasted text exist,
**the pasted text wins**: the API returns `source: 'pasted'`, `blocks: null`,
`text` = the pasted text, and **keeps the snippets** (and `exampleTestcases`)
from the fetch. Clearing the paste (`PUT` with empty `text`) shows the fetched
statement again. Otherwise: `blocks` present → `source: 'leetcode'`; nothing
present → `source: null` with the right `state`.

**Setting.** "Fetch problem statements from LeetCode" — default **on**.

- Stored as `leetcodeFetch` in `<dataDir>/preferences.json` (D4).
- Env override `IBAI_LEETCODE_FETCH`: `off` / `0` / `false` turns it off, and
  `on` / `1` / `true` turns it on. Either value **pins** the setting: the
  Settings toggle is shown read-only with "Set by IBAI_LEETCODE_FETCH". Any
  other value is ignored with one boot warning. Added to `.env.example` and to
  the Settings env-var list.
- Off means **no request to LeetCode at all**. The cache and pasted text
  still show.

**Fallbacks.** Premium (`content: null`), unknown slug (`question: null`), a
network or shape error, a rate-limit refusal, or the setting turned off. In
each case the left pane shows:

- the title, difficulty and an **"Open on LeetCode"** link (the catalog URL,
  `target="_blank" rel="noopener noreferrer"`);
- a short reason ("Premium problem", "LeetCode could not be reached",
  "Fetching is turned off in Settings");
- a **"Paste the problem"** box. Saving it stores `pastedText` in the same
  cache file. Pasted text is shown as plain text.

**ToS risk, recorded plainly.** LeetCode's terms restrict copying its content
and automated access. This project ships no LeetCode text. The fetch runs on
the user's machine, only when the user opens a problem, one problem at a time,
rate-limited, without login, and the result stays in the user's private data
folder. It can be turned off in Settings or by env. If LeetCode blocks it or
objects, the feature falls back to the link plus paste, and the maintainers
will switch the default to off. This is a recorded risk, not legal advice.
The **README MUST** document the fetch, what is stored where, and how to turn
it off (PR A).

**The fetched statement is not sent to the LLM.** The coach and the quiz
prompts are unchanged (no budget changes). Custom problems keep their ADR 0013
statement grounding. Using the fetched text in prompts needs a new ADR.

### D2 — Sanitize on the server into a node tree; React renders it

LeetCode HTML is untrusted (§7.3).

**Approach.** The server parses the HTML with **`htmlparser2`** (its
streaming `Parser` callbacks only) and builds a small JSON tree from a strict
allowlist. The client renders the tree with React elements. **No HTML string
is ever rendered and there is no `dangerouslySetInnerHTML`** (the ADR 0009 D2
rule holds). Even if the sanitizer had a bug, React would still escape all
text.

Rejected:

- **`sanitize-html`**: it returns an HTML string, so the client would need
  `dangerouslySetInnerHTML`. It also pulls in `postcss`, `deepmerge`, `launder`
  and more at runtime.
- **Client-side DOMPurify**: the raw HTML would reach the browser and the
  cache, and it would add a dependency to the bundle.
- **A hand-written HTML tokenizer**: HTML parsing has many edge cases
  (entities, unclosed tags, comments, CDATA). A widely used parser is safer.

**Dependency** (`packages/web` **`dependencies`**, runtime, server only; exact
pin; from `npm view` on 2026-10-04):

| Package | Version | Why |
|---|---|---|
| `htmlparser2` | 10.1.0 | HTML tokenizer/parser, MIT, ESM. ~120 M weekly downloads (it is used by `cheerio` and `sanitize-html`). |

`12.0.0` and `11.0.0` declare `engines.node >= 20.19.0`, but the project
supports Node ≥ 20.12, so **10.1.0** (2026-01-21, no `engines` field) is
pinned. Its transitive packages (`domhandler` 5, `domutils` 3,
`domelementtype` 2, `entities` and `dom-serializer` 2, same author) are
pinned by the lockfile. Licences: `htmlparser2` and `dom-serializer` are MIT;
`domhandler`, `domutils`, `domelementtype` and `entities` 7.0.1 (under
`htmlparser2`) and 4.5.0 (under `dom-serializer`) are BSD-2-Clause. PR A
adds a row to the ADR 0006 table. A later bump to 12.x waits for the Node
floor to move.

**Module split (decided: one shared file, imported by relative path).**

- `packages/web/src/statement-tree.ts` holds the `StatementNode` type, the
  caps, and `isStatementTree(value): value is StatementNode[]`. It has **zero
  imports**.
- `packages/web/src/statement-sanitize.ts` holds the `htmlparser2` code and
  imports `statement-tree.ts`. **web-ui never imports it**, so `htmlparser2`
  never reaches the SPA bundle.
- web-ui imports the tree module by relative path:
  `import { isStatementTree } from '../../../src/statement-tree.js'` (from
  `web-ui/src/lib/`). Checked on 2026-10-04 with a throwaway probe file:
  `npm run typecheck:ui` (web-ui `tsconfig`, `moduleResolution: bundler`)
  pulls the file in even though `include` is `src` only, `vite build`
  resolves `.js` to the `.ts` file and bundles it, and the server
  `tsc --build` still compiles it to `dist/`. No config change is needed.
  Rejected: a copy at `web-ui/src/lib/statementTree.ts` with a contract test,
  because two copies can drift.

**Tree shape** (`StatementNode`, in `statement-tree.ts`):

```ts
type StatementTag =
  | 'p' | 'pre' | 'code' | 'strong' | 'em'
  | 'ul' | 'ol' | 'li' | 'sup' | 'sub';
type StatementNode =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: StatementTag; c: StatementNode[] };
```

**Rules:**

- Allowed tags: `p pre code strong em ul ol li sup sub br`. `b` → `strong`,
  `i` → `em`.
- **No attributes at all.** No `class`, `style`, `href` or `src` survives.
- Dropped **with** their content: `script style iframe object embed svg math
  template noscript noembed noframes xmp plaintext textarea select option
  button form head title audio video canvas`.
- `img` is dropped. In its place goes the text `[image: <alt>]` (or
  `[image]`), so the user knows to open the problem on LeetCode. The SPA CSP
  (`img-src 'self' data:`) would block remote images anyway, and the CSP is
  not loosened.
- `a` is unwrapped to its text. Links inside a statement are not kept.
- Block tags become paragraphs, so their text does not run together:
  `div`, `h1`–`h6`, `blockquote`, `section`, `article` and `tr` → `p`. Table
  cells (`td`, `th`) are unwrapped, with a `br` after each cell that is not
  the last in its row. A `p` is never nested in a `p` or `li`: an inner block
  there closes into a `br` instead.
- Every other tag (`span`, `font`, `u`, `table`, `tbody`, `thead`, …) is
  unwrapped: its children are kept, the tag is not.
- Entities are decoded by the parser. `&nbsp;` becomes a normal space. C0
  control characters other than `\t` and `\n` are removed.
- Limits: depth ≤ 32, ≤ 5 000 nodes, ≤ 128 KiB of text (UTF-8 bytes). Past
  a limit the tree is cut, and `truncated: true` is stored in the cache and
  returned.
- Empty `p` elements are removed. Whitespace is kept inside `pre`.

**Client rendering.** `StatementView` maps each tag to the same React element,
with Tailwind classes from a fixed `className` map (no inline styles, fits the
CSP). Text goes in as React children. The client checks the tree with the
**same** `isStatementTree()` before rendering, and shows the fallback if it
fails.

**Tests (PR A):** a script tag and its text are gone; `onclick`, `style`,
`class` and `href` are gone; `img` becomes `[image: …]`; `font` and `span` are
unwrapped; `div`, `h3` and table cells keep their text apart; `head`,
`title`, `button` and `video` content is gone; `<sup>` survives (`10<sup>4</sup>`); `&nbsp;` decodes; the depth,
node and size caps; a malformed and an unclosed document; and a recorded Two
Sum fixture (a short **synthetic** stand-in written for the test, not
LeetCode's text, §6.2).

### D3 — Code-first note template

**Templates are built on the client** from the statement reply (pure
function, `web-ui/src/lib/noteTemplate.ts`). Nothing is written on open.

**Empty note.** A note is empty when it has no file or its body is only
whitespace. The editor is filled with the starter code for the preferred
language, with the prompts as comments on the first lines of the function
body. The note text **is the code itself** (no fences), so "Copy code" pastes
straight into LeetCode.

Python (from LeetCode's `python3` snippet):

```python
class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        # Intuition:
        #
        # Approach:
        #
        # Complexity: time O(?), space O(?)
        pass
```

Go (from LeetCode's `golang` snippet):

```go
func twoSum(nums []int, target int) []int {
    // Intuition:
    //
    // Approach:
    //
    // Complexity: time O(?), space O(?)
}
```

**Insertion rule:**

1. Find the **first** signature line that is not a comment. Python:
   `^\s*def \w+\(.*:\s*$`. Go: `^\s*func\b.*\{\s*$`.
2. Indent = that line's indent + 4 spaces.
3. Insert the five comment lines right after it.
4. **Python `pass`:** for **every** `def` in the snippet (not only the first),
   find its body. **A body ends** at the next non-blank line whose indent is
   less than or equal to the `def` line's indent, or at the end of the
   snippet. If a body has only blank lines and comment lines (the inserted
   comments do not count as code), its blank lines are removed and one `pass`
   line is added at the end of the body (after any comments), at the `def`
   indent + 4 spaces. So every method of a design class parses.
   **Go:** leave the bodies as LeetCode gives them (blank lines removed). No
   `return` is invented, because that needs the result type. LeetCode's own
   Go snippet does not compile either until the user writes code.
5. Leading comment blocks in the snippet (for example `# Definition for
   singly-linked list.`) stay above, unchanged.
6. Design problems with several methods get the comments in the **first**
   method only (often `__init__` / `Constructor`).

If no signature line is found, the comments go at the end of the snippet.

**Custom problems and problems without a snippet** (premium, disabled, error,
not fetched yet) use a generic template:

```python
class Solution:
    def solve(self):
        # Intuition:
        #
        # Approach:
        #
        # Complexity: time O(?), space O(?)
        pass
```

```go
func solve() {
    // Intuition:
    //
    // Approach:
    //
    // Complexity: time O(?), space O(?)
}
```

**When the prefill or append runs: once, after the final state is known.**
That is after the `GET /api/problems/:id/statement`, plus, when the GET
returned `not-cached` and fetching is enabled, after the
`POST …/statement/fetch` settles (success or error). Never between the two,
so a note is not filled with the generic template and then changed. If the
user has typed before that point, there is no prefill or append.

**StrictMode.** React StrictMode runs the effect twice in development, so the
second POST can get a 429 from the single-flight guard. The UI retries the
POST **once**, after `retryAfterMs` (capped at 2 s), on a 429. A second 429
shows the fallback.

**Complexity comment vs. the Time/Space fields.** The Notes page keeps its
Time and Space complexity fields (stored as `timeComplexity` /
`spaceComplexity`). The `# Complexity:` comment is only a prompt inside the
code. The app does **not** sync the two, in either direction. The fields stay
the source for the quiz, the coach and Analytics.

**Existing non-empty notes (founder: "append starter code").** On open, if the
note does not already contain the language's **signature key**, the starter
block is appended at the end of the editor text, after one blank line, as a
**fenced** block (` ```python ` / ` ```go `). A fenced block keeps a Markdown
note valid Markdown, and ADR 0014 already highlights those fences.

- Signature key: the first signature line (rule 1 above), trimmed. For the
  generic template it is `def solve(` / `func solve(`. The check is a plain
  substring test on the note text.
- **The prefill and the append are not saved on open.** They show in the
  editor and the note is marked unsaved: the text **"Unsaved changes"**
  appears next to the Save button (muted text, `aria-live="polite"`), and goes
  away after a save. It is written only when the user clicks Save. There is
  **no leave prompt** (no `beforeunload`, no route block). Leaving without
  saving discards it, and the next open applies it again.
- The appended block has the same comments as the empty-note template.

**On disk.** A note stays plain Markdown text in the ADR 0009 note format. A
code-only note is a note whose body happens to be code. No new frontmatter
key, no format change.

**Editor mode** (pure function `noteEditorMode(text, preferred)`):

- the text has a fence line (`^\s*(```|~~~)`) → **Markdown** (ADR 0014,
  highlighted fences);
- the text is empty → the preferred language;
- else a Python signature line → **Python**; a Go `func` line → **Go**;
- else → **Markdown**.

The mode is recomputed when the result changes (a CodeMirror `Compartment`
reconfigure, debounced). The textarea fallback ignores the mode.

**Language switch on an open note.** If the editor text still equals the
untouched template of the old language, it is replaced with the new
language's template. Otherwise the note is not changed now. The new language
applies to the append rule the next time a note is opened.

**Copy.** The toolbar keeps "Copy note" (whole text) and adds **"Copy code"**:
_(Superseded by the ADR 0014 D2 amendment (2026-10-05): "Copy note" is removed.)_

- code-only note (no fence line) → copies the whole note;
- note with fences → copies the content of the **last** fence in the
  preferred language; if none, the last Python or Go fence; if none, the
  whole note.

It uses the same clipboard and `aria-live` messages as "Copy note"
(ADR 0014 D2). The pure helper is `extractCode(text, preferred)`.
_(Superseded by the ADR 0014 D2 amendment (2026-10-05): "Copy code" now has
its own "Code copied" message.)_

**Fence aliases are shared, not repeated.** A fence counts as Python or Go by
ADR 0014's alias set (`python` / `py` / `python3` → Python, `go` / `golang` →
Go). PR B moves that set into the pure `lib/noteEditor/fencedBlock.ts` (for
example `fenceLanguageOf(info): FenceLanguage | null`). `markdown.ts` builds
`CODE_LANGUAGES` from it, and `extractCode` and `noteEditorMode` use it. This
keeps CodeMirror out of the helpers.

**Prompts.** The coach and the quiz read the note text as it is. No prompt
changes. The template comments are short and count against the existing note
cap like any text.

### D4 — Language preference

- Values: `python` | `go`. Default `python`.
- **Stored in `<dataDir>/preferences.json`** (not `~/.interviewbudai/config.json`):
  - In Docker, `~/.interviewbudai` is mounted **read-only** at `/host-config`
    (ADR 0011 D3), so the app cannot write `config.json` there. The data
    folder is writable in both the `npm start` and Docker paths.
  - `config.json` holds only the data-dir choice (ADR 0009 D1). It stays that
    small.
  - The preference travels with the user's data, like the notes. Switching
    the data folder switches the preference. That is accepted.
- The file holds both D4 and the D1 setting:
  `{ "language": "python", "leetcodeFetch": true }`. Both keys are optional.
- It is untrusted on read: ≤ 64 KiB, must be a JSON object. An unknown or bad
  value falls back to its default with one warning. Unknown keys are kept on
  write. Writes are atomic, mode 0600. A read-only data folder (ADR 0009 D4)
  returns 409, like other writes.
- Shared across problems and browsers. Pickers: a segmented **Python | Go**
  control on the Notes toolbar and a **"Code language"** select in Settings,
  next to the fetch toggle.

### D5 — UI: Notes split view

- **Wide screens (`lg` and up):** two columns. Left: the statement pane
  (title, difficulty badge, "Open on LeetCode" link, the rendered statement
  with its examples and constraints, a collapsed "Example test cases" block,
  and the fetched date with a "Refresh" button). Right: today's editor, status
  control and "Check my intuition". Each column scrolls on its own.
- **Narrow screens:** one column. The statement comes first, in a
  `<details>` that is open by default.
- Loading shows a skeleton. Errors show the D1 fallback. Fetch is triggered by
  the UI only when the GET says `not-cached` and fetching is enabled.
- "Check my intuition" (ADR 0013) is unchanged.
- The statement pane is a normal region (`aria-labelledby` the title).

### D6 — Data format: additive, not breaking

- `problem-cache/` and `preferences.json` are **new files** that older builds
  ignore, and newer builds treat as optional. Per ADR 0009 D4 this is an
  **additive** change: **no `formatVersion` bump, no migration, not a
  breaking change.**
- Notes keep the same format. A template or an appended block is plain note
  text.
- ADR 0009 D3 backups copy the cache like any other file. It is small and
  bounded by the catalog size.
- **A `CHANGELOG.md` entry is required** in each PR: `### Added` (statement
  view, fetch with how to turn it off, language preference, code-first
  template) and `### Changed` (the Notes layout; existing notes may show an
  appended, unsaved starter block).

## API (exact shapes, so PR B can build against fixtures)

All routes are under the existing `/api` protections (Host allowlist;
mutations need `Content-Type: application/json` and pass the Origin /
`Sec-Fetch-Site` check; 1 MiB body cap). Unknown body fields → 400. `:id` is
validated against the merged source (catalog plus custom) first; unknown → 404.

**Why the fetch is a POST.** `GET` requests skip the same-origin check, so a
page on another site could trigger them (for example with an `<img>` tag). A
GET that called LeetCode would let any site make the user's machine fetch.
So `GET` reads the cache only, and the network call is a `POST`.
`server.ts` `BODY_METHODS` gains `PUT` for the paste route.

```ts
type StatementState =
  | 'ready'        // blocks or text to show
  | 'not-cached'   // catalog problem, fetch allowed, nothing cached yet
  | 'disabled'     // fetch off and nothing cached
  | 'premium'      // LeetCode says paid-only
  | 'unavailable'; // unknown slug, or a custom problem without a statement

interface ApiProblemStatement {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard'; // curriculum `Difficulty`
  url: string | null;              // catalog link; custom problem url or null
  custom: boolean;
  state: StatementState;
  source: 'leetcode' | 'pasted' | 'custom' | null;
  blocks: StatementNode[] | null;  // source 'leetcode'
  text: string | null;             // source 'pasted' or 'custom' (plain text)
  exampleTestcases: string | null;
  snippets: { python: string | null; go: string | null };
  fetchedAt: string | null;        // ISO timestamp of the LeetCode fetch
  truncated: boolean;              // D2 caps hit
  cached: boolean;                 // false when the folder is read-only
  fetch: { enabled: boolean; pinned: boolean };
}
```

| Method + path | Body | Result |
|---|---|---|
| `GET /api/problems/:id/statement` | — | 200 `ApiProblemStatement`. **Cache only, never calls LeetCode.** Pasted text wins over a fetched statement (D1). Custom: `source: 'custom'`, `state: 'ready'` (or `'unavailable'` when it has no statement). |
| `POST /api/problems/:id/statement/fetch` | `{ refresh?: boolean }` | Catalog ids only (custom → 400). Cache hit and no `refresh` → 200 from cache, no request. Otherwise one LeetCode request → 200 `ApiProblemStatement` (`ready` or `premium`). Errors: 403 `{ error, code: 'fetch_disabled' }`; 404 `{ error, code: 'not_found' }` (LeetCode has no such slug); 429 `{ error, code: 'rate_limited', retryAfterMs }` (also while another fetch is in flight); 502 `{ error, code: 'fetch_failed' }` (network error, non-200, bad shape, too large); 504 `{ error, code: 'fetch_timeout' }`. Error text is fixed; LeetCode's reply is never echoed. |
| `PUT /api/problems/:id/statement` | `{ text: string }` | Catalog ids only (custom → 400 "Edit the custom problem's statement"). `text` ≤ 64 KiB (UTF-8 bytes) after normalising (CRLF → LF, C0 controls except `\t` `\n` removed, trimmed); larger → 413. Saves `pastedText`; the reply follows "Which text is shown" (D1): `source: 'pasted'`, `blocks: null`, `text` = the paste, cached snippets kept. Empty `text` removes the pasted text (back to the fetched or not-cached state). → 200 `ApiProblemStatement`. Read-only folder → 409. |
| `GET /api/preferences` | — | 200 `{ language: 'python' \| 'go', leetcodeFetch: { enabled: boolean, pinned: boolean } }` |
| `PUT /api/preferences` | `{ language?: 'python' \| 'go', leetcodeFetch?: boolean }` | 200, same shape as GET. Bad value → 400. `leetcodeFetch` while pinned by env → 400 "Set by IBAI_LEETCODE_FETCH". Read-only folder → 409. |

`GET /api/settings` gains `IBAI_LEETCODE_FETCH` in its env-var list (set ✓/✗
only, like the others).

PR A ships JSON fixtures under
`packages/web/web-ui/src/test/fixtures/statement/`, so PR B tests do not wait
for the server:

- `GET` statement, one per state: `ready` (a synthetic statement, with
  `truncated: false`), `ready` with `truncated: true`, `not-cached`,
  `disabled`, `premium`, `unavailable`, `pasted` (with fetched snippets
  kept), and `custom`.
- Every `POST …/fetch` error body: `fetch_disabled` (403), `not_found` (404),
  `rate_limited` (429, **with `retryAfterMs`**), `fetch_failed` (502) and
  `fetch_timeout` (504).
- `GET /api/preferences` unpinned (`{ enabled: true, pinned: false }`) and
  pinned by env (`{ enabled: false, pinned: true }`).

A server test checks that each fixture matches what the routes return (so
the fixtures cannot drift from the server).

## Roadmap (two PRs, each with a `code-review` pass)

| PR | Scope | Depends on |
|---|---|---|
| **A — server** | `leetcode.ts` (fetch, limits, rate window, single flight), `statement-tree.ts` (type, caps, `isStatementTree`, zero imports), `statement-sanitize.ts` (`htmlparser2`), `problem-cache.ts` (`problemCachePath`, read/write, `.gitignore`, size checks), `preferences.json` read/write, the five routes above, `BODY_METHODS` + `PUT`, `IBAI_LEETCODE_FETCH` (config, `.env.example`, Settings env list), `htmlparser2` pin + ADR 0006 row, fixtures, tests (no real network: `fetch` injected), README section (what is fetched, where it is stored, how to turn it off), CHANGELOG `### Added`. | — |
| **B — UI** | Split view (D5), `StatementView`, fallback + paste box, `noteTemplate.ts` (template, insertion, `pass` rule, signature key, append), the shared fence aliases in `fencedBlock.ts`, `noteEditorMode`, `extractCode` and "Copy code", "Unsaved changes", the one 429 retry, the Notes language picker, the Settings language select + fetch toggle, `lib/api` clients, tests against the PR A fixtures, CHANGELOG `### Added` / `### Changed`. | Builds in parallel against the fixtures; merge after A. |

## Consequences

- **Positive:** the user reads the problem and writes the code in one place,
  and "Copy code" pastes straight into LeetCode.
- **Positive:** the repo still ships no LeetCode text. Turning the fetch off
  leaves a working app (link plus paste).
- **Tradeoff:** a new optional outbound call to leetcode.com, and a recorded
  ToS risk. Mitigated by user-triggered, one problem at a time, rate-limited,
  no login, default switchable, documented.
- **Tradeoff:** the first runtime server dependency in `packages/web`
  (`htmlparser2`, pinned below the latest major for the Node 20.12 floor).
- **Tradeoff:** LeetCode can change the API or block it at any time. The app
  then falls back to the link and the paste box.
- **Tradeoff:** a note opened in a new language may show an appended block in
  a different style (fenced vs. code-only). The user tidies it.
- **Tradeoff:** the preference lives in the data folder, so two data folders
  have two preferences.

Any change to these decisions requires a new ADR.
