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
}

export * from './local-file-adapter.js';
