# ADR 0007 — Quickfire Quiz Master + AI Competency Intelligence

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Founder, Architect
- **Supersedes:** — (relates to / partially supersedes ADR 0005 D6's generic
  interview model in the UI — see D8)

## Context

InterviewBudAI's growth loop (ADR 0005) is: browse the catalog → capture an
intuition note per problem → build a progress database → then get coached to
validate understanding. Until now the "coach" surface was a **generic AI chat
interview** (ADR 0005 D6): the model asks open questions and evaluates typed
answers with no structured deck, no per-problem targeting, and no persistent
notion of what the user has actually marked as "done".

The founder wants the **core** of the product to be a **Quickfire Quiz Master**:
a persona that quizzes the user specifically on the problems they have marked
`status: 'done'`, presents each one **wrapped** (a short rephrasing/story — not
the raw title, no hints), reads the user's typed approach, and **evaluates the
direction** of their reasoning without ever handing over the answer. Every
session outcome and the user's own intuition notes feed a **competency
intelligence** layer that detects **where the user recurringly goes wrong** and
maintains a **weak-topics / strong-topics** dataset for Analytics — i.e.
AI-assisted competency evaluation with spaced repetition.

This is an architecturally significant addition (new persisted data shapes on
the `StorageAdapter` public interface, a new product surface, and a
superseding relationship with ADR 0005's UI interview model), so per charter
§5.2 it is recorded as an ADR before implementation.

Hard product rules that constrain the design (charter §6):

- **§6.1 / §6.4** — user progress data (sessions, outcomes, competency signals,
  intuition) is PROGRESS-layer: stored locally in the user's data directory,
  **NEVER committed** to the repo; local-first, no mandatory network beyond the
  user-configured LLM.
- **§6.2** — the project ships **NO answers/solutions/intuitions**. The Quiz
  Master judges using the **model's own general knowledge** of these well-known
  problems, cross-referenced with the **user's own saved intuition** note. It
  stores the user's OWN outcomes/patterns/intuition references — never any
  canonical solution authored or bundled by us.

This PR is **ADR + STORAGE FOUNDATION ONLY**: the decision record plus the
additive types and `LocalFileStorageAdapter` persistence. The API/engine and UI
land in later PRs (see D9 roadmap).

## Decisions

### D1 — Persona: a "Quiz Master" over the user's done-set

The core coaching surface becomes a **Quiz Master** persona (replacing the
generic chat interview in the UI, D8). Its behaviour:

- It quizzes the user **only** on problems the user marked `status: 'done'`
  (resolved via `resolveNoteStatus`), never the whole catalog. This done-set is
  the **session deck**.
- Each question is presented **WRAPPED**: a short (1–2 line) story/rephrasing of
  the problem, **no hints**, and not necessarily the raw title verbatim. The
  intent is to test whether the user recognises the underlying pattern rather
  than recites a memorised title.
- The user types their **approach / reasoning** (not code necessarily).
- The persona **evaluates the DIRECTION** of that reasoning and **never hands
  over the answer**.

**Rationale:** Matches the founder's product vision — the value is validating
that the user can re-derive the approach for problems they claimed to have
learned, not re-reading solutions. The wrap prevents title-pattern-matching.

**Rejected alternative:** Quiz over the entire catalog — rejected: a user should
be quizzed on what they claim to know (done-set), which is also the spaced-
repetition signal.

### D2 — Judging: model knowledge × the user's saved intuition; semi-optimal bar

The verdict for each answer is computed by the **model** using:

1. its **own general knowledge** of the well-known problem, AND
2. the **user's saved `IntuitionNote`** for that problem (ADR 0005) — this is
   the **personalization** input.

No shipped/committed answers are used or stored anywhere (§6.2 preserved —
nothing is authored or persisted as a canonical solution). The dataset the Quiz
Master maintains holds the **user's own outcomes/patterns/intuition
references**, not solutions.

**Correctness bar:** a **semi-optimal** (or better) approach is **accepted**. If
a materially **more optimal** solution exists, the persona **prompts the user to
go read/figure it out** — it does **not** reveal it. This keeps §6.2 intact
while still nudging improvement.

**Future (recorded, NOT implemented now):** a per-session **difficulty** knob —
`easy` accepts brute force, `hard` accepts optimal-only. Out of scope for this
milestone; noted so a later ADR/PR can add it without surprise.

**Rejected alternative:** an optimal-only bar always — rejected: too punishing
for a confidence-building quiz; semi-optimal-accepted with a "go look deeper"
nudge better fits the growth loop.

### D3 — Session: a shuffled, no-repeat, one-shot, resumable deck

A **quiz session** is:

- **Deck** = the user's current done-set, **RANDOMIZED** once at creation, with
  **NO repeats within a session**.
- **RESUMABLE** — the session is persisted (full transcript + progress) so
  leaving and returning **continues the same session**. There is at most one
  **active** session at a time.
- **ONE-SHOT per question per session**: the user gets a single attempt per
  question. On **correct** → advance to the next question. On **wrong** → the
  problem's note `status` is flipped to `'to_revisit'` (done by the
  engine/API layer, not by storage), the miss is recorded in the session, and
  the deck advances anyway. No retries within the session.
- **New session** = reshuffle a **fresh deck** from the **current** done-set
  (which may have changed as the user marks more problems done or as misses flip
  problems to `to_revisit`).

**Rationale:** randomization + no-repeat + one-shot mirrors a real quickfire
drill; resumability respects local-first, interrupt-friendly usage; deriving the
deck fresh each session keeps it aligned with the evolving done-set and the
spaced-repetition intent.

**Rejected alternatives:** (a) infinite retries per question — rejected: dilutes
the signal and the spaced-repetition value; (b) a fixed deck reused across
sessions — rejected: stale relative to the user's changing done-set.

### D4 — Competency intelligence: quiz-derived signals feed Analytics

From **session outcomes** (correct/incorrect per problem → per topic) plus the
user's **intuition notes**, the system **detects recurring patterns of where the
user goes wrong** and maintains a **weak-topics / strong-topics** dataset that
feeds Analytics. This is AI-assisted competency evaluation + spaced repetition.

**How it is stored (this PR defines the shapes):** a new
**`CompetencySignals`** dataset, persisted as a single human-readable/diffable
JSON document in the user's data directory
(`<dataDir>/competency-signals.json`). It holds:

- `topics: Record<TopicId, TopicCompetency>` — per-topic `correct`/`incorrect`
  tallies, `lastSeen`, and a **derived** `strength` band
  (`unknown|weak|improving|strong` via the exported `deriveTopicStrength`).
- `patterns: PatternSignal[]` — recurring **miss** patterns: a short
  human-readable `description`, the `topics` spanned, an `occurrences` count,
  and `lastObserved`.
- `lastUpdated`.

**Why a NEW structure rather than folding into the existing
`CompetencyMap`/`WeaknessRegister`:** those already have distinct, established
roles written by the **Coach** engine job — `CompetencyMap` holds normalised
proficiency in `[0,1]`; `WeaknessRegister` holds session-summary weaknesses.
`CompetencySignals` is the **quiz-derived raw signal source** (tallies +
patterns) that **feeds** those and Analytics; conflating raw quiz tallies into
the normalised proficiency map would overload one shape and risk breaking the
Coach contract. Keeping them separate is additive and non-breaking. The two
existing structures are **reused as-is** downstream (a later PR wires quiz
signals → competency/weakness updates); this PR only adds the new source shape.

**§6.2 note:** every field records the user's OWN outcomes, patterns, and
intuition references — descriptions summarise the user's mistakes, never a
solution.

### D5 — QuizSession shape (additive types)

```typescript
type QuizSessionStatus = 'active' | 'complete';
type QuizVerdict = 'correct' | 'incorrect';

interface QuizAnswerRecord {
  problemId: string;         // curriculum problem id, e.g. 'lc-1'
  verdict: QuizVerdict;
  at: IsoTimestamp;
}
interface QuizTranscriptEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  at: IsoTimestamp;
}
interface QuizSession {
  sessionId: QuizSessionId;
  createdAt: IsoTimestamp;
  deck: readonly string[];   // shuffled problemIds, no repeats
  currentIndex: number;      // next unanswered problem in deck
  answered: readonly QuizAnswerRecord[];
  transcript: readonly QuizTranscriptEntry[];
  status: QuizSessionStatus;
}
```

### D6 — CompetencySignals shape (additive types)

```typescript
type TopicStrength = 'unknown' | 'weak' | 'improving' | 'strong';

interface TopicCompetency {
  topicId: TopicId;
  correct: number;
  incorrect: number;
  lastSeen: IsoTimestamp;
  strength: TopicStrength;   // derived via deriveTopicStrength(correct, incorrect)
}
interface PatternSignal {
  id: string;                // stable key for merging the same recurring pattern
  description: string;       // human-readable recurring mistake (NOT a solution)
  topics: readonly TopicId[];
  occurrences: number;
  lastObserved: IsoTimestamp;
}
interface CompetencySignals {
  topics: Readonly<Record<TopicId, TopicCompetency>>;
  patterns: readonly PatternSignal[];
  lastUpdated: IsoTimestamp;
}
```

`deriveTopicStrength(correct, incorrect)` is exported so front-ends/Analytics
share one derivation rule: `< 3` observations → `unknown`; correct ratio `≥ 0.75`
→ `strong`; `≤ 0.40` → `weak`; else `improving`.

### D7 — Additive, OPTIONAL StorageAdapter methods + on-disk layout

New methods are declared **OPTIONAL** on `StorageAdapter` (mirroring the
`readIntuitionNote?`/`writeIntuitionNote?` pattern of ADR 0005 D5), so existing
adapters/tests keep compiling with no breaking change:

```typescript
readActiveQuizSession?(): Promise<QuizSession | null>;
readQuizSession?(sessionId: QuizSessionId): Promise<QuizSession | null>;
writeQuizSession?(session: QuizSession): Promise<void>;
readCompetencySignals?(): Promise<CompetencySignals>;
writeCompetencySignals?(signals: CompetencySignals): Promise<void>;
```

`LocalFileStorageAdapter` implements them **concretely** in this PR, reusing the
same **path-traversal safety** (`sanitizeSessionId`/`safeJoin`) and **tolerant
parsing** (missing/malformed → `null` or empty, never throw) used for notes.

On-disk layout (PROGRESS layer, never committed):

```
<dataDir>/quiz-sessions/<sessionId>.json   -> QuizSession
<dataDir>/quiz-sessions/active.json        -> { sessionId } active-session pointer
<dataDir>/competency-signals.json          -> CompetencySignals
```

**Resumability** is implemented via the `active.json` pointer: writing an
`active` session updates the pointer; writing a `complete` session clears the
pointer if it referenced that session (so `readActiveQuizSession` returns `null`
and a fresh deck is started next). Completed sessions remain readable by id
(transcript preserved).

### D8 — Relationship to ADR 0005's interview model

This ADR **relates to and (in the UI) supersedes** ADR 0005 D6's generic
AI-evaluation **chat interview**: the Quiz Master becomes the coaching surface
in the UI in a later PR, replacing the free-form chat interview. ADR 0005's core
principles are **preserved and reused**: a provider is REQUIRED (no demo
fallback), the model evaluates the user's answer, and §6.2 (no canned solutions)
holds. The existing `POST /api/chat` and the generic interview page are **NOT**
changed in this PR; their replacement is scoped to Q3 (D9).

### D9 — Implementation sequence (small serial PRs)

| Step | PR Scope |
|------|----------|
| **Q1** | **THIS PR** — ADR 0007 + storage foundation (additive types + `LocalFileStorageAdapter` methods + tests). No API/UI. |
| Q2 | Engine/API: session lifecycle (build deck from done-set, shuffle, one-shot advance, wrong→`to_revisit`), model-judging prompt (persona + wrapped problem + user intuition), competency-signal updates. JSON endpoints. |
| Q3 | UI: Quiz Master surface in the SPA (wrapped prompt, answer box, verdict, resume), replacing the generic interview page. |
| Q4 | Analytics: consume `CompetencySignals` (weak/strong topics + recurring patterns); wire quiz signals → `CompetencyMap`/`WeaknessRegister`. Future: per-session difficulty (D2). |

## Consequences

- **Positive:** Defines the product's core coaching loop with a concrete,
  resumable, spaced-repetition-friendly data model; adds a competency-signal
  source that feeds Analytics; all additive and non-breaking.
- **Positive:** §6.1/§6.2/§6.4 preserved — progress-layer, local-first,
  human-readable/diffable, never committed, and NO canonical answers stored.
- **Tradeoff:** introduces a new persisted structure (`CompetencySignals`)
  alongside the existing `CompetencyMap`/`WeaknessRegister`; a later PR reconciles
  the quiz signals into those. Accepted to avoid overloading the Coach's shapes.
- **Superseding:** the generic UI interview (ADR 0005 D6) will be replaced by the
  Quiz Master surface in Q3; the interfaces/endpoints are untouched until then.
- **Optionality:** the five new `StorageAdapter` methods are OPTIONAL now (kept
  honest with a concrete `LocalFileStorageAdapter` implementation in the same
  PR); they MAY become required once all adapters implement them.

Any change to these decisions requires a new ADR.
