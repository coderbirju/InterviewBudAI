# ADR 0005 — Onboarding: Catalog-First Workflow, Intuition Capture, and AI-Evaluation Interview

- **Status:** Accepted — D6's generic interview UI superseded by ADR 0007 (D8)
- **Date:** 2026-09-13
- **Deciders:** Founder, Architect
- **Supersedes:** ADR 0004 (partially — removes the zero-config demo-provider fallback path; see D6)

## Context

The original assumption was interview-first onboarding: a new user would start
with a self-assessment pass/fail interview using a zero-config demo provider,
then build their progress database from there. This created a cold-start
dead-end ("No Topics Yet") and did not match the founder's prototype origins —
a personal tracking log plus written intuition per problem.

Two data layers remain non-negotiable (ADR 0001 D3):
- **Curriculum** (ships with project): problem catalog as links + difficulty +
  tags only. No answers, no solutions, no intuitions.
- **Progress** (owned by user, private): intuitions, tracking, competency map.
  Never bundled, never uploaded.

This ADR **extends ADR 0003** by defining how the curriculum catalog is
presented to users during onboarding (catalog-first landing) and how progress
data (intuition notes) is stored per problem ID.

Local-first, bring-your-own-LLM principles (charter §6.2/§6.3/§6.4) still hold.
This ADR refines how §6.3 is satisfied now that a provider becomes required
(no zero-config demo fallback).

These are FINAL founder decisions — recorded as Accepted, not relitigated.

## Decisions

### D1 — Catalog-first onboarding (removes cold-start dead-end)

A brand-new user does NOT start with an interview. They land on a **CURRICULUM
CATALOG**: questions grouped by topic, shown in tables. Each row exposes TWO
links:
- A **LeetCode problem link** (external canonical URL)
- A **NOTES link** (write their own intuition)

Interview/coaching comes LATER, only after the user builds a progress database.
This removes the "No Topics Yet" dead-end.

**Rationale:** Matches the founder's prototype origin (log + intuition first).
The growth loop is: browse catalog → capture intuition → build progress → then
interview to validate understanding.

**Rejected alternatives:**

**(a) Interview-first onboarding** — Rejected: creates cold-start with no data;
the user has nothing to be interviewed on.

**(b) Inverting the growth loop (interview → catalog)** — Rejected: inverts the
natural progression; users need content before coaching.

### D2 — 'Create database' + directory persistence (client/server boundary)

The user creates/selects a local data directory (default `~/.ibai/data`, with a
**custom path option**). A browser cannot silently access arbitrary filesystem
paths, so:

- **Server** (local web app): OWNS directory creation/writes; filesystem
  authority.
- **Browser**: UI + cookie of chosen path; the directory PATH is remembered via
  a browser cookie/session so subsequent visits auto-load it (no login).

This explicitly records the client/server boundary: browser = UI + cookie of
chosen path; server = filesystem authority.

Bulk-import of an existing markdown/CSV intuition database is FUTURE scope (not
now).

### D3 — Intuition/notes storage format: structured Markdown, one file per problem ID

Progress-layer notes live as **ONE markdown FILE PER PROBLEM ID** in the user's
data directory, with a small frontmatter header above free-text intuition:

```markdown
---
id: lc-1
lastUpdated: 2026-09-13T10:00:00.000Z
attempts: 3
---

# My Intuition

Use a hash map to find complement in O(1)...
```

**Benefits:**
- Editable by ID (O(1) find/load/save)
- Human-readable
- Diffable
- Portable — matches ownership/local-first principles

**PROGRESS-layer data: NEVER committed to the repo.**

**Rejected alternatives:**

**(a) Single freeform file** — Rejected: no O(1) per-problem access, poor diffs
when file grows large.

**(b) Binary SQLite DB** — Rejected: not diffable, not hand-editable, not as
portable. Note: a DB adapter remains possible LATER via the StorageAdapter
interface.

### D4 — Problem ID scheme (stable, source-namespaced)

Stable IDs enable progress data to reference curriculum entries across releases.
IDs are source-namespaced to avoid coupling and allow non-LeetCode sources.

| Source | ID pattern | Example |
|--------|------------|--------|
| LeetCode | `lc-<number>` | `lc-1` |
| System design | `sysd-<slug>` | `sysd-url-shortener` |

Filenames may be `<id>-<slug>.md` for readability (e.g., `lc-1-two-sum.md`).

IDs are stable across releases so progress can reference curriculum.

### D5 — Storage interface extension (additive, progress layer)

Define a NEW `IntuitionNote` type and TWO additive `StorageAdapter` methods to
read/write a per-problem intuition note by problem ID:

```typescript
export interface IntuitionNote {
  problemId: string;        // curriculum problem id, e.g. 'lc-1'
  content: string;          // markdown body (user's free-text intuition)
  lastUpdated: IsoTimestamp;
  attempts?: number;        // optional metadata
}

// Additive to StorageAdapter (OPTIONAL for now — see approach note):
readIntuitionNote?(problemId: string): Promise<IntuitionNote | null>;
writeIntuitionNote?(note: IntuitionNote): Promise<void>;
```

**ADDITIVE ONLY** — existing StorageAdapter methods/types unchanged.
`LocalFileStorageAdapter` will implement these as per-ID markdown files in a
FOLLOW-UP PR.

**APPROACH NOTE:** The two new methods are declared OPTIONAL
(`readIntuitionNote?`/`writeIntuitionNote?`) in THIS PR. Rationale:
`LocalFileStorageAdapter` uses `implements StorageAdapter`; marking the methods
REQUIRED without implementing them would fail tsc typecheck (breaking
`npm run verify`), and adding throwing "not yet implemented" stubs would FAKE
behavior — which this decision-only PR forbids. Optional-now keeps verify GREEN
honestly. The methods BECOME REQUIRED (optionality removed) in the follow-up PR
that implements them in `LocalFileStorageAdapter`. This mirrors the types-first-
then-impl pattern of ADR 0003.

### D6 — Interview model = AI-evaluation only (supersedes self-assessment + demo fallback)

The interview is a real LLM conversation through the UI: the model asks, the
user answers, the model responds/evaluates/probes and drives the session.

**REMOVE** (in a follow-up PR) the self-assessment (user marks pass/fail) model
AND the zero-config `EchoDemoProvider` fallback path — this **SUPERSEDES ADR
0004's demo-provider decision**.

A provider is now REQUIRED; with no provider configured the app INSTRUCTS the
user to configure one (no fake/demo fallback).

**Coach contract change:** Coach's contract will shift from user-supplied
`TopicOutcome[]` to MODEL-DERIVED evaluation in a follow-up PR. This ADR
AUTHORIZES that specific contract change; the follow-up PR implements it and
will need its own interface consideration.

§6.2 still holds: engine/curriculum ship NO answers; the model evaluates the
USER'S answer, it does not hand over canned solutions.

**NOTE:** This PR does NOT remove `EchoDemoProvider` or the self-assess UI —
that is a later PR.

### D7 — LLM provider: reusable HTTP core + Anthropic (Claude) adapter first

Add an HTTP-based provider design so multiple cloud providers are supported via
config (base URL, model, auth header, request/response mapping) implementing the
EXISTING `LlmProvider` interface (`complete(CompletionRequest): Promise<CompletionResponse>`).

Ship the **ANTHROPIC (Claude) adapter FIRST**:
- Messages API uses `x-api-key` header + `anthropic-version` header
- Request body + response mapping DIFFER from OpenAI:
  - Anthropic: `messages` array + top-level `system`; response under
    `content[].text`
  - OpenAI: `choices[].message.content`
- The HTTP core abstracts this mapping

OpenAI adapter is FUTURE.

API key via ENV `ANTHROPIC_API_KEY`, NEVER committed; provide `.env.example`
guidance (in the impl PR).

Does NOT hardcode a single required vendor (still bring-your-own via config),
satisfying §6.3 intent now that a provider is required.

**DESIGN only in this ADR — no provider code in this PR.**

### D8 — Implementation sequence (roadmap of small serial PRs)

| Step | PR Scope |
|------|----------|
| 1 | THIS ADR (decision + additive types) |
| 2 | Seed curriculum catalog data |
| 3 | Web catalog landing + 'Create database' + cookie dir persistence |
| 4 | Notes/intuition capture (implement LocalFileStorageAdapter per-ID markdown; methods become required) |
| 5 | Anthropic/HTTP provider adapter |
| 6 | Remove demo/self-assess + AI-evaluation interview (coach contract change) |

Each is a small PR the Architect will follow.

## Consequences

- **Positive:** Removes cold-start dead-end; aligns product with founder's
  prototype (log + intuition first); local-first ownership preserved; provider
  extensibility via HTTP core.

- **Tradeoff:** A provider is now REQUIRED (no zero-config demo) — accepted
  deliberately; supersedes ADR 0004.

- **Addition:** Additive `StorageAdapter` methods + `IntuitionNote` type
  (optional now, required after impl PR).

- **Future contract change:** The authorized `coach()` contract change (D6) will
  shift input from `TopicOutcome[]` to model-derived evaluation.

- **Invariant:** Progress data is never committed (D3).

Any change to these decisions requires a new ADR.
