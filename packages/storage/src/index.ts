/**
 * `@ibai/storage` — the progress-layer persistence boundary.
 *
 * This module defines the **pluggable Storage contract** for InterviewBudAI.
 * It is TYPES/CONTRACTS ONLY: no concrete adapter, no backend, no I/O.
 *
 * Design rules (ADR 0001, ADR 0002):
 *  - The engine (`@ibai/core`) is stateless per session; ALL durable user
 *    state lives behind this interface.
 *  - This package NEVER depends on `@ibai/core` (no dependency cycles).
 *  - No specific backend (git files, sqlite, cloud, …) is named here; that is
 *    the concern of a concrete adapter injected by a front-end at startup.
 */

// ---------------------------------------------------------------------------
// Branded Type Aliases
// ---------------------------------------------------------------------------

/** Opaque identifier for a coaching session. */
export type SessionId = string;

/** Opaque identifier for a curriculum topic (e.g. a DSA or system-design area). */
export type TopicId = string;

/** ISO-8601 timestamp string (e.g. `2026-09-05T12:00:00.000Z`). */
export type IsoTimestamp = string;

// ---------------------------------------------------------------------------
// Session Types
// ---------------------------------------------------------------------------

/**
 * A single turn in a session's history, as persisted in the user's progress
 * layer. Role-tagged so the engine can reconstruct prior context on Assess.
 */
export interface SessionHistoryEntry {
  /** Who produced this turn. */
  readonly role: 'user' | 'assistant' | 'system';
  /** The turn's textual content. */
  readonly content: string;
  /** When the turn occurred. */
  readonly timestamp: IsoTimestamp;
}

/**
 * The full history/context the engine loads for a session during Assess.
 */
export interface SessionContext {
  readonly sessionId: SessionId;
  /** Chronologically ordered turns for this session. May be empty. */
  readonly history: readonly SessionHistoryEntry[];
}

/**
 * A structured summary the Coach step writes back at the end of a session.
 * Deliberately structured (not free text) so the Plan step can reason over it.
 */
export interface SessionSummary {
  readonly sessionId: SessionId;
  /** When the session concluded. */
  readonly completedAt: IsoTimestamp;
  /** Topics practised in this session. */
  readonly topics: readonly TopicId[];
  /** Human-readable narrative of what happened / was learned. */
  readonly narrative: string;
  /** Strengths observed this session, as topic references. */
  readonly strengths: readonly TopicId[];
  /** Weaknesses observed this session, as topic references. */
  readonly weaknesses: readonly TopicId[];
}

// ---------------------------------------------------------------------------
// Competency Types
// ---------------------------------------------------------------------------

/** Proficiency the engine tracks for a single topic. */
export interface CompetencyEntry {
  readonly topicId: TopicId;
  /** Normalised proficiency in [0, 1]; higher is stronger. */
  readonly proficiency: number;
  /** When this entry was last updated. */
  readonly lastUpdated: IsoTimestamp;
}

/**
 * The user's competency map: proficiency per topic, keyed by {@link TopicId}.
 * The Plan step reads this to choose where to focus.
 */
export interface CompetencyMap {
  readonly entries: Readonly<Record<TopicId, CompetencyEntry>>;
}

// ---------------------------------------------------------------------------
// Weakness Types
// ---------------------------------------------------------------------------

/** A recurring weakness the engine wants to keep surfacing. */
export interface WeaknessEntry {
  readonly topicId: TopicId;
  /** Short description of the recurring gap. */
  readonly note: string;
  /** How many sessions this weakness has recurred across. */
  readonly occurrences: number;
  readonly lastObserved: IsoTimestamp;
}

/** The register of recurring weaknesses across sessions. */
export interface WeaknessRegister {
  readonly entries: readonly WeaknessEntry[];
}

// ---------------------------------------------------------------------------
// Intuition Note Types (ADR 0005)
// ---------------------------------------------------------------------------

/**
 * A per-note status tag capturing where the user stands on a problem.
 *
 * A small, fixed string union — NOT a configurable/custom tag system (that is
 * explicitly deferred). Values:
 *  - `'none'`             — no explicit status (default).
 *  - `'done'`             — the problem is complete/solved.
 *  - `'to_revisit'`       — the user wants to come back and review it.
 *  - `'did_not_understand'` — the user did not grasp it yet (maybe-later tag,
 *    included as it is trivial; UIs MAY choose not to surface it).
 *
 * `status` is the PRIMARY completion signal going forward; the legacy
 * `completed` boolean on {@link IntuitionNote} is kept for back-compat and is
 * derived from / kept consistent with `status` (`'done'` ⇔ `completed: true`).
 */
export type NoteStatus = 'none' | 'done' | 'to_revisit' | 'did_not_understand';

/**
 * A user's intuition/notes for a single curriculum problem.
 *
 * Part of the PROGRESS layer (user-owned, never committed to the repo).
 * Stored as one markdown file per problem ID in the user's data directory,
 * with frontmatter (id, lastUpdated, optional attempts) above free-text content.
 *
 * @see ADR 0005 D3 (intuition/notes storage format)
 * @see ADR 0005 D4 (problem ID scheme)
 */
export interface IntuitionNote {
  /** Curriculum problem ID, e.g. 'lc-1' or 'sysd-url-shortener'. */
  readonly problemId: string;
  /** Markdown body containing the user's free-text intuition. */
  readonly content: string;
  /** When this note was last updated. */
  readonly lastUpdated: IsoTimestamp;
  /** Optional count of attempts/practice sessions for this problem. */
  readonly attempts?: number;
  /**
   * Whether the problem is marked as complete/solved.
   *
   * @remarks
   * KEPT FOR BACK-COMPAT. `status` (below) is the primary signal going
   * forward. The two are kept CONSISTENT when saving: `status: 'done'` implies
   * `completed: true`, and any other status implies `completed: false`. When
   * reading a legacy note that has `completed: true` but no `status`, the
   * status resolves to `'done'`. Existing completed-based UI (dashboard count,
   * catalog ✓ marker) keeps working unchanged.
   */
  readonly completed?: boolean;
  /**
   * The user's status tag for this problem (Done / To revisit / …).
   *
   * @remarks
   * PRIMARY completion signal (see {@link NoteStatus}). Optional and additive:
   * missing → `undefined`. Kept consistent with {@link IntuitionNote.completed}
   * on save (`'done'` ⇔ `completed: true`).
   */
  readonly status?: NoteStatus;
  /** Time complexity of the solution, e.g. 'O(n)', 'O(n log n)'. */
  readonly timeComplexity?: string;
  /** Space complexity of the solution, e.g. 'O(1)', 'O(n)'. */
  readonly spaceComplexity?: string;
}

/**
 * Resolve the effective {@link NoteStatus} for a note, applying back-compat.
 *
 * Precedence:
 *  1. An explicit `status` (a valid {@link NoteStatus}) wins.
 *  2. Otherwise, a legacy `completed: true` resolves to `'done'`.
 *  3. Otherwise `'none'`.
 *
 * Exported so front-ends (e.g. the notes editor) share one resolution rule.
 */
export function resolveNoteStatus(note: {
  readonly status?: NoteStatus;
  readonly completed?: boolean;
}): NoteStatus {
  if (isNoteStatus(note.status)) {
    return note.status;
  }
  if (note.completed === true) {
    return 'done';
  }
  return 'none';
}

/** Type guard: is `value` a valid {@link NoteStatus}? */
export function isNoteStatus(value: unknown): value is NoteStatus {
  return (
    value === 'none' ||
    value === 'done' ||
    value === 'to_revisit' ||
    value === 'did_not_understand'
  );
}

// ---------------------------------------------------------------------------
// Quiz Session Types (ADR 0007 — Quickfire Quiz Master)
// ---------------------------------------------------------------------------

/** Opaque identifier for a quiz session. */
export type QuizSessionId = string;

/**
 * The lifecycle state of a quiz session.
 *  - `'active'`   — the session is in progress (resumable).
 *  - `'complete'` — the deck is exhausted; a new session must be started.
 */
export type QuizSessionStatus = 'active' | 'complete';

/**
 * The Quiz Master's verdict on the user's answer to a single question.
 *
 * A binary, one-shot outcome per question (ADR 0007): the persona evaluates the
 * DIRECTION of the user's reasoning against the well-known problem and the
 * user's own saved intuition. `'correct'` accepts a semi-optimal-or-better
 * approach; `'incorrect'` records a miss (which also flips the problem's note
 * status to `'to_revisit'` — done by a higher layer, not this storage type).
 */
export type QuizVerdict = 'correct' | 'incorrect';

/**
 * A recorded outcome for one question within a quiz session.
 *
 * One-shot per question per session: exactly one of these is appended when the
 * user answers, and the session advances (no retries within the same session).
 */
export interface QuizAnswerRecord {
  /** Curriculum problem ID the question was drawn from (e.g. 'lc-1'). */
  readonly problemId: string;
  /** The Quiz Master's binary verdict for this question. */
  readonly verdict: QuizVerdict;
  /** When the verdict was recorded. */
  readonly at: IsoTimestamp;
}

/**
 * A single turn in a quiz session's transcript.
 *
 * Role-tagged so the full conversation can be reconstructed on resume. The
 * `assistant` turns are the Quiz Master's wrapped prompts / evaluations
 * (MODEL-generated, never shipped canonical answers — §6.2); `user` turns are
 * the candidate's typed reasoning.
 */
export interface QuizTranscriptEntry {
  /** Who produced this turn. */
  readonly role: 'user' | 'assistant' | 'system';
  /** The turn's textual content. */
  readonly content: string;
  /** When the turn occurred. */
  readonly at: IsoTimestamp;
  /**
   * The miss code the grader tagged on an `on_track` probe turn (ADR 0012 D1,
   * additive). Optional: absent on every other turn and on data written
   * before ADR 0012; an unknown value read from disk is dropped.
   */
  readonly miss?: MissCode;
}

/**
 * A persisted, RESUMABLE Quiz Master session (ADR 0007).
 *
 * The deck is the user's `status: 'done'` set, shuffled once at creation, with
 * NO repeats within a session. `currentIndex` points at the next unanswered
 * problem in `deck`. Leaving and returning continues the SAME session (full
 * transcript + progress preserved) until it is `'complete'`, at which point a
 * new session reshuffles a fresh deck from the current done-set.
 *
 * PROGRESS layer (user-owned): persisted in the user's data directory, NEVER
 * committed to the repo. Stores the user's OWN outcomes/transcript only — no
 * canonical solutions (§6.2).
 */
export interface QuizSession {
  /** Opaque session identifier (also the on-disk filename stem). */
  readonly sessionId: QuizSessionId;
  /** When the session (and its shuffled deck) was created. */
  readonly createdAt: IsoTimestamp;
  /**
   * The shuffled deck of curriculum problem IDs for this session. Fixed at
   * creation; no repeats within a session.
   */
  readonly deck: readonly string[];
  /** Index into {@link QuizSession.deck} of the next unanswered problem. */
  readonly currentIndex: number;
  /** One-shot outcomes recorded so far, in answer order. */
  readonly answered: readonly QuizAnswerRecord[];
  /** The full chronological conversation for resume. */
  readonly transcript: readonly QuizTranscriptEntry[];
  /** Lifecycle state. */
  readonly status: QuizSessionStatus;
}

/**
 * A lightweight, list-oriented summary of a persisted {@link QuizSession}
 * (ADR 0007 — session management, quiz-fix-b).
 *
 * Returned by {@link StorageAdapter.listQuizSessions} so a front-end can render
 * a scannable list of past + active sessions (created time, progress, outcome
 * tallies, status) WITHOUT loading each full session (deck + transcript). Every
 * field is derived from the user's OWN session data — no shipped answers
 * (§6.2).
 */
export interface QuizSessionSummary {
  /** Opaque session identifier (matches the on-disk filename stem). */
  readonly sessionId: QuizSessionId;
  /** When the session (and its shuffled deck) was created. */
  readonly createdAt: IsoTimestamp;
  /** Lifecycle state (`'active'` = resumable-active; `'complete'` = finished). */
  readonly status: QuizSessionStatus;
  /** Total number of questions in this session's deck. */
  readonly deckSize: number;
  /** How many questions have been answered so far (terminal outcomes). */
  readonly answeredCount: number;
  /** How many of the answered questions were verdicted `'correct'`. */
  readonly correctCount: number;
  /**
   * Whether THIS session is currently the active/resumable one (matches the
   * `active.json` pointer). At most one session is active at a time.
   */
  readonly isActive: boolean;
}

// ---------------------------------------------------------------------------
// Competency Signal Types (ADR 0007 — competency intelligence)
// ---------------------------------------------------------------------------

/**
 * A derived qualitative strength band for a topic, computed from the
 * correct/incorrect tallies. A convenience label for Analytics; the raw counts
 * remain the source of truth.
 *  - `'weak'`      — mostly missed.
 *  - `'improving'` — mixed.
 *  - `'strong'`    — mostly correct.
 *  - `'unknown'`   — too little data to judge.
 */
export type TopicStrength = 'unknown' | 'weak' | 'improving' | 'strong';

/**
 * Per-topic competency tally accumulated from quiz-session outcomes.
 *
 * This is the weak/strong-topics dataset that feeds Analytics. It records the
 * user's OWN outcomes (correct/incorrect counts) — not any shipped answer.
 */
export interface TopicCompetency {
  /** Curriculum/competency topic reference (aligns with {@link TopicId}). */
  readonly topicId: TopicId;
  /** Number of correct verdicts observed for this topic. */
  readonly correct: number;
  /** Number of incorrect verdicts observed for this topic. */
  readonly incorrect: number;
  /** When this topic was last seen in a quiz session. */
  readonly lastSeen: IsoTimestamp;
  /** Derived strength band (see {@link TopicStrength}). */
  readonly strength: TopicStrength;
  /**
   * Recorded quiz misses per code for this topic (ADR 0012 D1, additive).
   * Absent on data written before ADR 0012 ("no misses").
   */
  readonly misses?: Readonly<Partial<Record<MissCode, number>>>;
}

/**
 * A recurring MISS pattern detected across sessions (the "where the user goes
 * wrong" signal).
 *
 * Captures a short, human-readable description of a recurring mistake plus the
 * topics it spans and how often it has recurred. Descriptions summarise the
 * USER'S own errors/intuition gaps — they are NOT solutions (§6.2).
 */
export interface PatternSignal {
  /** Stable key for de-duplicating/merging the same recurring pattern. */
  readonly id: string;
  /** Short, human-readable description of the recurring mistake. */
  readonly description: string;
  /** Topics this pattern spans. */
  readonly topics: readonly TopicId[];
  /** How many times this pattern has recurred. */
  readonly occurrences: number;
  /** When this pattern was last observed. */
  readonly lastObserved: IsoTimestamp;
}

/**
 * The competency-intelligence dataset (ADR 0007).
 *
 * Aggregates per-topic tallies + recurring miss patterns derived from quiz
 * outcomes and the user's intuition notes. Persisted as a single
 * human-readable/diffable JSON document in the user's data directory
 * (`competency-signals.json`), PROGRESS layer, NEVER committed.
 *
 * Kept SEPARATE from the engine's existing {@link CompetencyMap} (normalised
 * proficiency in [0,1], written by the Coach job) and {@link WeaknessRegister}
 * (session-summary weaknesses): this dataset is the quiz-derived signal source
 * that FEEDS those and Analytics, tracking raw quiz tallies + patterns rather
 * than replacing the engine's derived proficiency.
 */
export interface CompetencySignals {
  /** Per-topic tallies, keyed by {@link TopicId}. */
  readonly topics: Readonly<Record<TopicId, TopicCompetency>>;
  /** Recurring miss patterns. */
  readonly patterns: readonly PatternSignal[];
  /** When this dataset was last updated. */
  readonly lastUpdated: IsoTimestamp;
  /**
   * Global miss tallies per code (ADR 0012 D1, additive). Absent on data
   * written before ADR 0012 ("no misses"); old builds ignore it.
   */
  readonly misses?: Readonly<Partial<Record<MissCode, MissTally>>>;
}

/**
 * One generic miss code: HOW the user slipped on a quiz question, never WHAT
 * the answer is (ADR 0012 D1, §6.2). Fixed enum; see {@link MISS_CODES}.
 */
export type MissCode =
  | 'edge'
  | 'complexity'
  | 'brute'
  | 'technique'
  | 'vague'
  | 'boundary'
  | 'misread';

/** A global miss tally: how often a code was recorded and when last. */
export interface MissTally {
  readonly count: number;
  readonly lastSeen: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Practice Signal Types (ADR 0013 D3 — "Check my intuition" trends)
// ---------------------------------------------------------------------------

/** The coach's assessment of an intuition note (ADR 0013 D1). */
export type CoachAssessment = 'on_track' | 'partial' | 'off_track';

/**
 * One intuition check's STRUCTURED outcome (ADR 0013 D3). Never holds text:
 * no note, reference, question, feedback or complexity is stored.
 */
export interface PracticeEvent {
  readonly problemId: string;
  /** Canonical topic ids at check time (≤ 5). */
  readonly topics: readonly TopicId[];
  readonly assessment: CoachAssessment;
  readonly readyToCode: boolean;
  /** ADR 0012 D1 code; only on `partial` / `off_track`. */
  readonly miss?: MissCode;
  /** The editor's status at check time. */
  readonly status: NoteStatus;
  /** First check ever for this problem (since the last reset). */
  readonly first: boolean;
  readonly at: IsoTimestamp;
}

/**
 * `practice-signals.json` (ADR 0013 D3): a bounded event log (≤ 500, oldest
 * first) plus the all-time set of checked problems (≤ 5 000). Additive under
 * ADR 0009 D4: a new file older builds ignore. Separate from
 * {@link CompetencySignals}: quiz analytics never read it.
 */
export interface PracticeSignals {
  readonly version: 1;
  readonly updatedAt: IsoTimestamp;
  readonly events: readonly PracticeEvent[];
  readonly seen: readonly string[];
}

/** Event-log cap (ADR 0013 D3): the oldest events are dropped beyond it. */
export const PRACTICE_EVENTS_MAX = 500;

/**
 * `seen` cap (ADR 0013 D3). At the cap the LEAST RECENTLY checked problem is
 * dropped (a re-check moves a problem to the end), so only a problem not
 * checked across 5 000 newer problems can count as "first" again.
 */
export const PRACTICE_SEEN_MAX = 5000;

// ---------------------------------------------------------------------------
// Custom Problem Types (ADR 0010 — user-added problems)
// ---------------------------------------------------------------------------

/**
 * A problem the user added themselves (ADR 0010 D2). PROGRESS layer: stored
 * in the user's data directory, never shipped in the curriculum, never
 * committed. Carries no answer, solution or hint (§6.2) — the user's thinking
 * stays in their intuition note.
 */
export interface CustomProblem {
  /** `u-<slug>-<rand6>`, server-generated, immutable, never reused. */
  readonly id: string;
  /** 1–200 chars, one line (C0 controls stripped). */
  readonly title: string;
  /** `http:` / `https:` only, ≤ 2048 chars. */
  readonly url?: string;
  /** The user's own problem statement: plain text, ≤ 2000 chars. Not an answer. */
  readonly statement?: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  /** 1–3 curriculum topic ids (canonical). */
  readonly topics: readonly TopicId[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

// `deriveTopicStrength` lives in a side-effect-free module so consumers that
// only need the pure rule (e.g. `@ibai/core`) can import
// `@ibai/storage/competency` without loading the concrete adapter.
export {
  deriveTopicStrength,
  MISS_CODES,
  isMissCode,
  sanitizeMisses,
  sanitizeTopicMisses,
} from './competency.js';

// ---------------------------------------------------------------------------
// Storage Adapter Contract
// ---------------------------------------------------------------------------

/**
 * The single contract a storage backend implements.
 *
 * All methods are async and backend-agnostic. Reads that find nothing return
 * an empty structure or `null` rather than throwing. Implementations MUST NOT
 * leak backend concepts (files, tables, connections) through this surface.
 */
export interface StorageAdapter {
  /**
   * Read the full history/context for a session. Used by the engine's Assess
   * step. Returns an empty context (empty history) for an unknown session.
   */
  readSessionContext(sessionId: SessionId): Promise<SessionContext>;

  /**
   * Persist a structured summary produced by the Coach step. Append-only from
   * the engine's perspective.
   */
  writeSessionSummary(summary: SessionSummary): Promise<void>;

  /** Read the user's competency map. Returns an empty map if none exists. */
  readCompetencyMap(): Promise<CompetencyMap>;

  /**
   * Persist an updated competency map. The engine computes the new map; the
   * adapter only stores it.
   */
  updateCompetencyMap(map: CompetencyMap): Promise<void>;

  /** Read the weakness register. Returns an empty register if none exists. */
  readWeaknessRegister(): Promise<WeaknessRegister>;

  /** Persist an updated weakness register. */
  updateWeaknessRegister(register: WeaknessRegister): Promise<void>;

  // ---------------------------------------------------------------------------
  // Intuition Note Methods (ADR 0005)
  // ---------------------------------------------------------------------------

  /**
   * Read a user's intuition note for a specific curriculum problem.
   *
   * Part of the progress-layer per-problem intuition storage (ADR 0005 D3/D4).
   * Returns the note if it exists, or `null` if no note has been saved for
   * the given problem ID.
   *
   * @remarks
   * This method is currently OPTIONAL to maintain backward compatibility with
   * existing StorageAdapter implementations. It becomes REQUIRED in the
   * follow-up implementation PR (ADR 0005 roadmap step 4).
   *
   * @param problemId - Curriculum problem ID (e.g. 'lc-1', 'sysd-url-shortener')
   * @returns The intuition note if found, or `null` if none exists
   */
  readIntuitionNote?(problemId: string): Promise<IntuitionNote | null>;

  /**
   * Persist a user's intuition note for a curriculum problem.
   *
   * Part of the progress-layer per-problem intuition storage (ADR 0005 D3/D4).
   * Creates or overwrites the note for the given problem ID.
   *
   * @remarks
   * This method is currently OPTIONAL to maintain backward compatibility with
   * existing StorageAdapter implementations. It becomes REQUIRED in the
   * follow-up implementation PR (ADR 0005 roadmap step 4).
   *
   * @param note - The intuition note to persist, including problemId and content
   */
  writeIntuitionNote?(note: IntuitionNote): Promise<void>;

  // ---------------------------------------------------------------------------
  // Quiz Session Methods (ADR 0007 — Quickfire Quiz Master)
  // ---------------------------------------------------------------------------

  /**
   * Read the current ACTIVE quiz session, if one exists.
   *
   * Enables RESUMABILITY: leaving and returning continues the same session
   * (full transcript + progress). Returns `null` when there is no active
   * session (none started, or the last one is `'complete'`).
   *
   * @remarks
   * OPTIONAL/additive (like the intuition-note methods) so existing adapters
   * keep compiling. Tolerant: a missing/malformed pointer or session file
   * resolves to `null` and never throws.
   */
  readActiveQuizSession?(): Promise<QuizSession | null>;

  /**
   * Read a specific quiz session by its ID.
   *
   * @param sessionId - The quiz session ID.
   * @returns The session if found and well-formed, or `null`.
   */
  readQuizSession?(sessionId: QuizSessionId): Promise<QuizSession | null>;

  /**
   * Persist a quiz session and update the active-session pointer.
   *
   * Writing an `'active'` session marks it as the current/active one (so
   * {@link StorageAdapter.readActiveQuizSession} returns it). Writing a
   * `'complete'` session clears the active pointer if it referenced this
   * session (a new session must be started next).
   *
   * @param session - The quiz session to persist.
   */
  writeQuizSession?(session: QuizSession): Promise<void>;

  /**
   * List a lightweight summary of every persisted quiz session (ADR 0007 —
   * session management, quiz-fix-b).
   *
   * Scans the quiz-session store, skipping the active-session pointer and any
   * malformed session files, and returns one {@link QuizSessionSummary} per
   * well-formed session, sorted NEWEST-FIRST (by `createdAt` descending). Used
   * to render the sessions list (past + active) in the Quiz section.
   *
   * @remarks
   * OPTIONAL/additive so existing adapters keep compiling. Tolerant: a missing
   * store or malformed files degrade to an empty list / are skipped — never
   * throws.
   */
  listQuizSessions?(): Promise<QuizSessionSummary[]>;

  /**
   * Delete a persisted quiz session by ID (ADR 0007 — session management,
   * quiz-fix-b).
   *
   * Removes the session file. If the deleted session was the active/resumable
   * one, the active pointer is cleared so {@link StorageAdapter.readActiveQuizSession}
   * returns `null` afterwards.
   *
   * @remarks
   * OPTIONAL/additive. Path-safe (reuses the same sanitisation as the other
   * quiz methods) and tolerant: deleting a missing session is a no-op — never
   * throws.
   *
   * @param sessionId - The quiz session ID to delete.
   */
  deleteQuizSession?(sessionId: QuizSessionId): Promise<void>;

  // ---------------------------------------------------------------------------
  // Competency Signal Methods (ADR 0007 — competency intelligence)
  // ---------------------------------------------------------------------------

  /**
   * Read the competency-signals dataset (weak/strong topics + recurring
   * patterns). Returns an empty dataset when none exists.
   *
   * @remarks
   * OPTIONAL/additive. Tolerant: missing/malformed → an empty dataset, never
   * throws.
   */
  readCompetencySignals?(): Promise<CompetencySignals>;

  /**
   * Persist the competency-signals dataset. The caller computes the new
   * dataset (from session outcomes + intuition notes); the adapter only stores
   * it as a human-readable/diffable JSON document.
   *
   * @param signals - The competency-signals dataset to persist.
   */
  writeCompetencySignals?(signals: CompetencySignals): Promise<void>;

  // ---------------------------------------------------------------------------
  // Custom Problem Methods (ADR 0010 D3 — optional, additive)
  // ---------------------------------------------------------------------------

  /**
   * Every valid custom problem, sorted by `createdAt` then `id`. Invalid or
   * unreadable records are skipped (never throws); a missing store is `[]`.
   */
  listCustomProblems?(): Promise<CustomProblem[]>;

  /** One custom problem, or `null` if missing, invalid or not a `u-` id. */
  readCustomProblem?(id: string): Promise<CustomProblem | null>;

  /**
   * Store a NEW custom problem. Exclusive: never overwrites — if the id is
   * taken it throws (code `EEXIST`) and the caller picks a new id. Throws a
   * `RangeError` for a record that fails validation.
   */
  createCustomProblem?(problem: CustomProblem): Promise<void>;

  /**
   * Replace an EXISTING custom problem atomically. Throws (code `ENOENT`) if
   * it does not exist, `RangeError` for an invalid record.
   */
  writeCustomProblem?(problem: CustomProblem): Promise<void>;

  /** Delete a custom problem. Missing (or not a `u-` id) ⇒ no-op. */
  deleteCustomProblem?(id: string): Promise<void>;

  /**
   * True when a note exists for `problemId` — ANY stored entry, even one that
   * `readIntuitionNote` cannot parse — so deleting a problem never orphans a
   * note (ADR 0010 D3 amendment). Never throws.
   */
  hasIntuitionNote?(problemId: string): Promise<boolean>;

  /**
   * Delete the intuition note for `problemId`. Missing ⇒ no-op (ADR 0010 D3
   * amendment). Used when a custom problem is deleted together with its note.
   */
  deleteIntuitionNote?(problemId: string): Promise<void>;

  // ---------------------------------------------------------------------------
  // Practice Signal Methods (ADR 0013 D3 — optional, additive)
  // ---------------------------------------------------------------------------

  /**
   * Read the practice log. `null` when there is none — or when the file is
   * unreadable or has the wrong shape (it is treated as empty and renamed
   * aside on the next append). Malformed events are skipped. Never throws.
   */
  readPracticeSignals?(): Promise<PracticeSignals | null>;

  /**
   * Append one event (read-modify-write, temp file + rename). The adapter
   * decides `first` itself from its `seen` set, inside the write queue, so
   * the stored and returned value is always consistent with the log. The log
   * keeps the newest {@link PRACTICE_EVENTS_MAX} events. A corrupt file is
   * renamed to `practice-signals.json.corrupt-<ts>` (kept) and a fresh log is
   * started. Throws `RangeError` for an invalid event.
   */
  appendPracticeEvent?(event: PracticeEvent): Promise<PracticeSignals>;

  /**
   * Delete the practice log (events AND `seen`). Missing ⇒ no-op. Shares the
   * append's write queue, so a reset and an append never interleave. Touches
   * only `practice-signals.json` (never the `.corrupt-*` files).
   *
   * `beforeDelete` (the caller's ADR 0009 D3 backup) MUST run first, INSIDE
   * the same queue: an append is then either in the backup or lands after
   * the reset, never lost in between. If it throws, nothing is deleted and
   * its error propagates.
   */
  resetPracticeSignals?(beforeDelete?: () => Promise<void>): Promise<void>;
}

export * from './custom-problems.js';
export * from './practice-signals.js';
export * from './local-file-adapter.js';
