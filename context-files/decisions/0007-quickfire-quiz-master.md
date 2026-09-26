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

## Amendment (quiz-fix-a, 2026-09-24) — founder feedback on the live quiz

After the first hands-on use of the Quiz Master surface (Q1–Q4 merged), the
founder reported three problems. This amendment records the corrected policy.
It supersedes the affected parts of **D1** (presentation) and **D2** (nudge
behavior); the data shapes (D5–D7), session lifecycle (D3), and competency
signals (D4) are UNCHANGED.

### A1 — Present the RAW problem directly (supersedes D1 "wrapped")

The "wrapped story/rephrasing" presentation of D1 confused users and risked
drifting from the actual problem. The Quiz Master now presents each problem
**directly**: it states the **real problem title** and MAY add one neutral line
restating the standard problem it knows. It authors **no invented story**, **no
disguised scenario**, and **no hints**. Still ships **no answer/solution**
(§6.2 intact — the model uses only its own general knowledge + the user's own
intuition note). The `wrap` prompt mode and the `question.wrapped` field names
are retained for wire/type stability, but their CONTENT is now the direct
presentation.

### A2 — Never-reveal + at-most-one-nudge (refines D2)

The persona is hardened to be **model-agnostic** so a weaker model still
complies:

- **NEVER REVEAL:** the Quiz Master MUST NEVER reveal, state, describe, hint at,
  or write out the solution / answer / optimal approach / pseudocode / code —
  not when the candidate is close, not when wrong, **not even on direct
  request**. If asked for the answer it refuses and tells them to work it out.
- **Verdict policy** (evaluated against the model's own knowledge + the user's
  saved intuition):
  - Clearly reaches at least a **semi-optimal** correct approach → `correct`
    (if a materially more optimal approach exists, set `optimalNudge` pointing
    them to go read/figure it out, WITHOUT revealing it).
  - **Near / on the right track** but incomplete → `on_track` with **exactly
    one** probing question (never the answer). **At most one nudge per
    question.**
  - Clearly wrong → `incorrect` immediately (no nudge owed).
  - After a single `on_track` nudge, the candidate's **next answer is
    TERMINAL** (`correct` | `incorrect`) — never a second `on_track`.

### A3 — Engine enforcement of the one-nudge cap (do not trust the model alone)

`POST /api/quiz/answer` enforces the cap independently of the model:

- Whether a nudge was already spent on the current question is derived from
  existing `QuizSession` state — **no new storage field**. Each terminal answer
  appends exactly one `user` transcript turn (via `advanceSession`, counted in
  `answered`); each `on_track` probe appends exactly one `user` turn WITHOUT
  incrementing `answered`. Therefore `#user-turns − answered.length` is the
  number of nudges spent on the current question (`nudgeCountForCurrentQuestion`
  / `nudgeAlreadyUsed`, pure helpers). This survives resume (reads only the
  persisted transcript).
- If the model returns `on_track` **and** a nudge was already given for this
  question, the engine **COERCES** the verdict to a terminal `incorrect` (note
  → `to_revisit`, advance) so the at-most-one-nudge guarantee holds even if the
  model misbehaves. `correct` → correct + advance; `incorrect` → `to_revisit` +
  advance; the first `on_track` → stay, record the probe. Fail-closed parsing is
  unchanged.

**Storage impact:** none. No `StorageAdapter` or `QuizSession` type change; the
nudge count is derived from the existing transcript + `answered`.

### A4 — Verdict-card render fix (UI, no contract change)

The SPA (`Interview.tsx`) cleared the per-answer verdict card too late, so the
previous answer's `correct`/`incorrect` card lingered over the freshly rendered
next question. Fixed: on a terminal advance the prior `verdictCard` is cleared
before the next question renders, and it is cleared on session completion; an
`on_track` verdict keeps the same question and shows its probe card. No API or
type change.

## Amendment (quiz-fix-b, 2026-09-24) — session management (end / list / resume / delete)

Founder feedback items 4 & 5: users need to **end** a session on demand, **see
their past sessions**, **resume** any of them, and **delete** ones they no
longer want. This amendment records the additive storage + API + UI surface. It
is fully additive — the data shapes (D5–D7), lifecycle (D3), and the resume
model (D7 `active.json` pointer) are UNCHANGED; only new OPTIONAL storage
methods, new endpoints, and UI are added.

### A5 — Additive session-management storage methods

Two more OPTIONAL `StorageAdapter` methods are added (same optionality pattern
as D7, so existing adapters/tests keep compiling), implemented concretely in
`LocalFileStorageAdapter`:

- `listQuizSessions(): Promise<QuizSessionSummary[]>` — scans
  `<dataDir>/quiz-sessions/`, skips the `active.json` pointer and any
  malformed/non-`.json` files, and returns a lightweight
  **`QuizSessionSummary`** per well-formed session (`sessionId`, `createdAt`,
  `status`, `deckSize`, `answeredCount`, `correctCount`, `isActive`), sorted
  **newest-first**. Tolerant: a missing store → empty list; never throws.
- `deleteQuizSession(sessionId): Promise<void>` — deletes the session file
  (path-safe via the existing `sanitizeSessionId`/`safeJoin`); if it was the
  active session, clears the `active.json` pointer. Tolerant: deleting a missing
  session is a no-op; never throws.

A new **`QuizSessionSummary`** type is exported. Storage stays a leaf (no new
deps, no dependency on other packages).

### A6 — Session-management endpoints (packages/web)

New JSON routes on the same-origin API (data-dir cookie>env>default; bodies
untrusted; `400/404/405` coherent; never HTML):

- **`POST /api/quiz/end`** — ends the ACTIVE session: persists it `status:
  'complete'` (via `writeQuizSession`, which clears the active pointer), so it
  stops being resumable-active but **REMAINS listed**. Ending never deletes.
  `404` when there is no active session. Returns `{ ok, session }`.
- **`GET /api/quiz/sessions`** — returns `{ sessions: QuizSessionSummary[] }`
  from `listQuizSessions()`; empty-safe (`{ sessions: [] }`) when no DB / none.
- **`POST /api/quiz/resume { sessionId }`** — re-activates a listed session
  (sets `status: 'active'`, pointing `active.json` at it) and returns it with
  its re-presented current question + transcript. A `complete` session can be
  resumed: if its deck is exhausted it is simply viewable/complete; otherwise it
  continues from `currentIndex`. `404` unknown id, `400` bad/missing id.
- **`POST /api/quiz/delete { sessionId }`** and **`DELETE
  /api/quiz/session/:id`** — delete a session via `deleteQuizSession`;
  idempotent (`ok: true` even if missing). `400` bad/missing id.

Coherent with the existing single-active-session model: at most one session is
active; resuming makes the chosen one active; ending/deleting the active one
clears the pointer.

### A7 — Session-management UI (Interview.tsx)

The Quiz Master page gains: an **End session** button during an active quiz
(→ `POST /api/quiz/end`, then the idle/list view); a **Your sessions** list in
the idle + complete views (`GET /api/quiz/sessions`) rendering each session as a
card (created time, `answered / deckSize`, correct tally, Active/Complete badge)
with a **Resume** button (re-activates + continues) and a **Delete** button
(small `window.confirm`, optimistic row removal). Empty/loading/error states are
handled; nothing crashes with no DB / no sessions. Design system unchanged (dark
slate/emerald, Lucide icons, `transition-all duration-200`); all values render
via JSX (auto-escaped); no `dangerouslySetInnerHTML`; no user data committed.

**Storage impact:** two additive OPTIONAL methods + one new exported type; no
change to `QuizSession`/`CompetencySignals` or any existing method.

## Amendment (w1-quiz-reliability, 2026-09-25) — deterministic presentation

### A8 — Questions are presented from the catalog, not the model (refines A1)

A1's "raw problem" presentation is now built **deterministically by the app**
from the catalog (real title + difficulty + external link); the model is no
longer called to present a question, and the `wrap` prompt mode is removed. The
model is used only for **verdicts**. Consequences:

- `start`/`new` persist the session **once, together with** its first
  question's presentation turn, so a provider failure can never leave an
  active session without a presentable question (the "orphan" bug). A
  provider is still **required** for `start`/`new` (`400 no model
  configured`) because answers need one.
- `GET /api/quiz/session`, `POST /api/quiz/resume` and `/answer` re-present the
  current question from the catalog (legacy orphans missing a presentation
  turn are healed in memory and persisted with the next write). A session with
  nothing to present (deck exhausted / problem gone) is reported
  `{ active:false }` and is not re-activated by resume.
- Wire shape is **additive only**: `question` gains `title`, `difficulty`,
  `url`, and an optional `probe` (the current `on_track` nudge); `wrapped` is
  kept and holds `"<title> (<difficulty>)"`. On `on_track` the problem stays in
  `question` and the probe is shown separately.

**Storage impact:** none (no `StorageAdapter` or `QuizSession` change).

## Amendment (w2a growth loop, 2026-09-26) — read-time guidance

ADR 0008 Wave 2(a) asks for the growth loop in the web: use quiz results to
bring back "Where you stand / Next up". D4/D9 Q4 planned to do that by
**wiring quiz signals into `CompetencyMap`/`WeaknessRegister`**. This amendment
**replaces** that plan.

### A9 — Guidance is derived at read time, not written back

- A new pure, synchronous core function **`deriveGuidance(input)`** computes
  guidance from the catalog, the resolved note statuses (`status` +
  `lastUpdated`) and `CompetencySignals`, with the clock passed in. No I/O, no
  LLM, deterministic.
- **`CompetencyMap`/`WeaknessRegister` stay Coach/CLI-owned.** The web never
  writes them; quiz signals are not copied into them. There is nothing to keep
  in sync and no new persisted data.
- Output:
  - `standing` — per topic with activity: note counts (`done`, `toRevisit`,
    `didNotUnderstand`, `total` = catalog problems in the topic), quiz
    `correct`/`incorrect`, `lastActivity`, `band` = `deriveTopicStrength` on
    the quiz tallies (same label as Analytics), `needsReview`. Ordered weak →
    improving → unknown → strong, then most misses, then topic id.
    Multi-topic problems count for each topic.
  - `nextUp` — 3 problems (`NEXT_UP_COUNT`, max 5), no problem twice, distinct
    topics preferred: up to 2 oldest to-revisit / didn't-understand notes;
    then an unattempted problem (easy → medium → hard → catalog order; hard
    only after 2 done in the topic) from each weak, then improving, topic; then
    the in-progress topic with the lowest done ratio; then an unstarted topic.
    Revisits claim their slots first (so a second same-topic revisit is
    never dropped for a lower kind); the final list is ordered revisit →
    weak_topic → continue → start, stable within a kind. A revisit whose
    problem lists no topics has `topicId: null`.
    No activity at all → the 3 easiest problems from 3 topics. Signal topics
    outside the catalog show in `standing` but never produce `nextUp`.
  - `quiz` — `{ doneCount, lastQuizAt, suggested }`; `lastQuizAt` is the
    latest topic `lastSeen` in the signals (written on every terminal answer;
    no session scan); `suggested` when `doneCount ≥ 1` and no quiz in the last
    7 days (`QUIZ_NUDGE_DAYS`).
  - Every `reason` is built from counts and dates only — never a hint or a
    solution (§6.2).
- `core` does not import `@ibai/curriculum`; it takes a structural
  `GuidanceProblem` (`{ id, title, url, difficulty, topics }`).
- New core exports: `deriveGuidance`, `Guidance`, `GuidanceInput`,
  `GuidanceProblem`, `GuidanceNote`, `GuidanceDifficulty`, `TopicStanding`,
  `NextUpItem`, `NextUpKind`, `QuizHint`, and the constants `NEXT_UP_COUNT`,
  `MAX_NEXT_UP`, `MAX_REVISIT_SLOTS`, `QUIZ_NUDGE_DAYS`, `HARD_GATE_DONE`.
- New endpoint **`GET /api/guidance`** →
  `{ state: 'no_db' | 'empty' | 'ready', generatedAt, standing, nextUp, quiz }`.
  Strictly read-only; `405` for other methods; malformed signals degrade to
  notes-only.

This does **not** settle ADR 0008 D5 #4 (quiz-only vs free-form coach/plan in
the web): guidance is deterministic and uses no model.

**Storage impact:** none. No `StorageAdapter` change, no on-disk change
(ADR 0009 D4: CHANGELOG `### Added` only).
