/**
 * @ibai/core — problem-level guidance (Plan job, ADR 0007 amendment w2a).
 *
 * Pure, stateless, synchronous derivation: from the catalog, the user's note
 * statuses and the quiz-derived {@link CompetencySignals}, compute
 *  - `standing` — where the user stands per topic (notes + quiz tallies), and
 *  - `nextUp`   — a short, deterministic list of concrete problems to do next,
 *  - `quiz`     — whether a quiz session is worth suggesting now.
 *
 * No I/O, no LLM, no clock (the caller passes `now`), no cross-call state.
 * Reasons are built MECHANICALLY from counts and dates only — never a hint or
 * a solution (charter §6.2).
 *
 * `core` does not depend on `@ibai/curriculum`; callers map catalog problems
 * to the structural {@link GuidanceProblem} (a catalog `Problem` already
 * satisfies it).
 */

import { deriveTopicStrength } from '@ibai/storage';
import type {
  CompetencySignals,
  IsoTimestamp,
  NoteStatus,
  TopicId,
  TopicStrength,
} from '@ibai/storage';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/** Coarse difficulty, ordered easy < medium < hard. */
export type GuidanceDifficulty = 'easy' | 'medium' | 'hard';

/** The subset of a catalog problem guidance needs (structural, core-owned). */
export interface GuidanceProblem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly difficulty: GuidanceDifficulty;
  readonly topics: readonly TopicId[];
}

/** One saved note's resolved status (see `resolveNoteStatus`). */
export interface GuidanceNote {
  readonly problemId: string;
  readonly status: NoteStatus;
  readonly lastUpdated: IsoTimestamp;
}

/** Everything {@link deriveGuidance} reads. */
export interface GuidanceInput {
  /** The catalog, in catalog order (the final tie-break). */
  readonly problems: readonly GuidanceProblem[];
  /** Resolved note statuses. Ids not in `problems` are ignored. */
  readonly notes: readonly GuidanceNote[];
  /** Quiz-derived tallies (tolerated when malformed: bad numbers count 0). */
  readonly signals: CompetencySignals;
  /** The reference time for "N days ago" and the quiz nudge. */
  readonly now: IsoTimestamp;
  /** Display name for a topic in reasons. Default: the topic id, as the UI shows it. */
  readonly topicLabel?: (topicId: TopicId) => string;
  /** How many next-up items to return. Default {@link NEXT_UP_COUNT}; clamped to 1..{@link MAX_NEXT_UP}. */
  readonly count?: number;
}

/** Where the user stands on one topic. */
export interface TopicStanding {
  readonly topicId: TopicId;
  readonly notes: {
    readonly done: number;
    readonly toRevisit: number;
    readonly didNotUnderstand: number;
    /** Catalog problems tagged with this topic (0 for a non-catalog topic). */
    readonly total: number;
  };
  readonly quiz: { readonly correct: number; readonly incorrect: number };
  /** Latest of note `lastUpdated` and quiz `lastSeen`; null if none parse. */
  readonly lastActivity: IsoTimestamp | null;
  /** `deriveTopicStrength(correct, incorrect)` — same label as Analytics. */
  readonly band: TopicStrength;
  /** Any note in this topic is `to_revisit` or `did_not_understand`. */
  readonly needsReview: boolean;
}

/** Why a problem is in next-up. */
export type NextUpKind = 'revisit' | 'weak_topic' | 'continue' | 'start';

/** One concrete problem to do next. */
export interface NextUpItem {
  readonly kind: NextUpKind;
  readonly problemId: string;
  readonly title: string;
  readonly url: string;
  readonly difficulty: GuidanceDifficulty;
  /** The topic this item was picked for. */
  readonly topicId: TopicId;
  /** Mechanical, count-based reason (never a hint or solution). */
  readonly reason: string;
}

/** Whether to nudge the user towards a quiz session. */
export interface QuizHint {
  /** Catalog problems marked done. */
  readonly doneCount: number;
  /** Latest quiz activity (max topic `lastSeen` in the signals), or null. */
  readonly lastQuizAt: IsoTimestamp | null;
  /** doneCount ≥ 1 and no quiz yet, or the last one is > {@link QUIZ_NUDGE_DAYS} days old. */
  readonly suggested: boolean;
}

/** The result of {@link deriveGuidance}. */
export interface Guidance {
  readonly standing: readonly TopicStanding[];
  readonly nextUp: readonly NextUpItem[];
  readonly quiz: QuizHint;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of next-up items. */
export const NEXT_UP_COUNT = 3;
/** Upper bound on next-up items. */
export const MAX_NEXT_UP = 5;
/** At most this many next-up slots go to revisits. */
export const MAX_REVISIT_SLOTS = 2;
/** Suggest a quiz when the last one is more than this many days old. */
export const QUIZ_NUDGE_DAYS = 7;
/** A topic needs this many done problems before a hard one is suggested. */
export const HARD_GATE_DONE = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

const DIFFICULTY_RANK: Record<GuidanceDifficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};

const BAND_RANK: Record<TopicStrength, number> = {
  weak: 0,
  improving: 1,
  unknown: 2,
  strong: 3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A finite, non-negative integer count, else 0 (signals are untrusted). */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** Parse an ISO timestamp to epoch ms, or null if it does not parse. */
function toMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Whole days between `thenMs` and `nowMs` (never negative). */
function daysBetween(thenMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - thenMs) / DAY_MS));
}

function agoPhrase(days: number): string {
  if (days === 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

interface MutableStanding {
  topicId: TopicId;
  done: number;
  toRevisit: number;
  didNotUnderstand: number;
  total: number;
  correct: number;
  incorrect: number;
  lastActivityMs: number | null;
  hasActivity: boolean;
}

function maxMs(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Derive topic standing, next-up problems and the quiz hint. Deterministic:
 * the same input always yields the same output.
 *
 * Next-up slots are filled in priority order — revisits (oldest first, at most
 * {@link MAX_REVISIT_SLOTS}), then weak/improving topics, then the in-progress
 * topic with the lowest done ratio, then unstarted topics (easiest first). A
 * first pass only takes problems whose topics are not yet represented; a
 * second pass (repeated while it adds something) fills remaining slots without
 * that restriction. No problem appears twice. Only unattempted (`none`) problems are suggested as new work,
 * easy → medium → hard → catalog order; hard only once the topic has
 * {@link HARD_GATE_DONE} done.
 */
export function deriveGuidance(input: GuidanceInput): Guidance {
  const nowMs = toMs(input.now) ?? 0;
  const label = input.topicLabel ?? ((id: TopicId) => id);
  const requested =
    typeof input.count === 'number' && Number.isFinite(input.count)
      ? Math.floor(input.count)
      : NEXT_UP_COUNT;
  const limit = Math.min(MAX_NEXT_UP, Math.max(1, requested));

  // Catalog index: id → problem + catalog position; topic → problems.
  const byId = new Map<string, { problem: GuidanceProblem; index: number }>();
  const problemsByTopic = new Map<TopicId, GuidanceProblem[]>();
  input.problems.forEach((problem, index) => {
    if (byId.has(problem.id)) return;
    byId.set(problem.id, { problem, index });
    for (const topic of new Set(problem.topics)) {
      const list = problemsByTopic.get(topic) ?? [];
      list.push(problem);
      problemsByTopic.set(topic, list);
    }
  });

  // Note status per catalog problem (unknown ids ignored; last note wins).
  const noteById = new Map<string, GuidanceNote>();
  for (const note of input.notes) {
    if (byId.has(note.problemId)) noteById.set(note.problemId, note);
  }
  const statusOf = (id: string): NoteStatus =>
    noteById.get(id)?.status ?? 'none';

  // ---- Standing ----------------------------------------------------------
  const standings = new Map<TopicId, MutableStanding>();
  const standingFor = (topicId: TopicId): MutableStanding => {
    let s = standings.get(topicId);
    if (!s) {
      s = {
        topicId,
        done: 0,
        toRevisit: 0,
        didNotUnderstand: 0,
        total: problemsByTopic.get(topicId)?.length ?? 0,
        correct: 0,
        incorrect: 0,
        lastActivityMs: null,
        hasActivity: false,
      };
      standings.set(topicId, s);
    }
    return s;
  };

  let doneCount = 0;
  for (const note of noteById.values()) {
    if (note.status === 'none') continue;
    if (note.status === 'done') doneCount++;
    const entry = byId.get(note.problemId);
    if (!entry) continue;
    for (const topic of new Set(entry.problem.topics)) {
      const s = standingFor(topic);
      s.hasActivity = true;
      if (note.status === 'done') s.done++;
      else if (note.status === 'to_revisit') s.toRevisit++;
      else s.didNotUnderstand++;
      s.lastActivityMs = maxMs(s.lastActivityMs, toMs(note.lastUpdated));
    }
  }

  let lastQuizMs: number | null = null;
  const signalTopics =
    input.signals && typeof input.signals.topics === 'object'
      ? input.signals.topics ?? {}
      : {};
  for (const key of Object.keys(signalTopics).sort()) {
    const t = signalTopics[key];
    if (!t || typeof t !== 'object') continue;
    const correct = count(t.correct);
    const incorrect = count(t.incorrect);
    const seenMs = toMs(t.lastSeen);
    if (correct + incorrect > 0) lastQuizMs = maxMs(lastQuizMs, seenMs);
    if (correct + incorrect === 0) continue;
    const s = standingFor(key);
    s.hasActivity = true;
    s.correct += correct;
    s.incorrect += incorrect;
    s.lastActivityMs = maxMs(s.lastActivityMs, seenMs);
  }

  const standing: TopicStanding[] = Array.from(standings.values())
    .filter((s) => s.hasActivity)
    .map((s) => ({
      topicId: s.topicId,
      notes: {
        done: s.done,
        toRevisit: s.toRevisit,
        didNotUnderstand: s.didNotUnderstand,
        total: s.total,
      },
      quiz: { correct: s.correct, incorrect: s.incorrect },
      lastActivity:
        s.lastActivityMs === null
          ? null
          : new Date(s.lastActivityMs).toISOString(),
      band: deriveTopicStrength(s.correct, s.incorrect),
      needsReview: s.toRevisit + s.didNotUnderstand > 0,
    }))
    .sort((a, b) => {
      const byBand = BAND_RANK[a.band] - BAND_RANK[b.band];
      if (byBand !== 0) return byBand;
      const missesA =
        a.quiz.incorrect + a.notes.toRevisit + a.notes.didNotUnderstand;
      const missesB =
        b.quiz.incorrect + b.notes.toRevisit + b.notes.didNotUnderstand;
      if (missesA !== missesB) return missesB - missesA;
      return a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : 0;
    });
  const standingById = new Map(standing.map((s) => [s.topicId, s]));

  // ---- Next up -----------------------------------------------------------
  const nextUp: NextUpItem[] = [];
  const usedProblems = new Set<string>();
  const usedTopics = new Set<TopicId>();
  let revisitSlots = 0;

  const add = (
    kind: NextUpKind,
    problem: GuidanceProblem,
    topicId: TopicId,
    reason: string,
  ): void => {
    nextUp.push({
      kind,
      problemId: problem.id,
      title: problem.title,
      url: problem.url,
      difficulty: problem.difficulty,
      topicId,
      reason,
    });
    usedProblems.add(problem.id);
    usedTopics.add(topicId);
    for (const t of problem.topics) usedTopics.add(t);
  };
  const full = (): boolean => nextUp.length >= limit;
  const touchesUsedTopic = (problem: GuidanceProblem): boolean =>
    problem.topics.some((t) => usedTopics.has(t));

  /** First unattempted problem in a topic by difficulty ramp + catalog order. */
  const pick = (
    topicId: TopicId,
    distinct: boolean,
  ): GuidanceProblem | undefined => {
    if (distinct && usedTopics.has(topicId)) return undefined;
    const done = standingById.get(topicId)?.notes.done ?? 0;
    const candidates = (problemsByTopic.get(topicId) ?? []).filter(
      (p) =>
        statusOf(p.id) === 'none' &&
        !usedProblems.has(p.id) &&
        (p.difficulty !== 'hard' || done >= HARD_GATE_DONE) &&
        !(distinct && touchesUsedTopic(p)),
    );
    candidates.sort(
      (a, b) =>
        DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] ||
        (byId.get(a.id)?.index ?? 0) - (byId.get(b.id)?.index ?? 0),
    );
    return candidates[0];
  };

  // Revisit candidates: oldest lastUpdated first (unparseable dates last),
  // then catalog order.
  const revisits = Array.from(noteById.values())
    .filter(
      (n) => n.status === 'to_revisit' || n.status === 'did_not_understand',
    )
    .map((n) => ({
      note: n,
      ms: toMs(n.lastUpdated),
      entry: byId.get(n.problemId),
    }))
    .filter(
      (
        r,
      ): r is typeof r & {
        entry: { problem: GuidanceProblem; index: number };
      } => r.entry !== undefined,
    )
    .sort((a, b) => {
      if (a.ms !== b.ms) {
        if (a.ms === null) return 1;
        if (b.ms === null) return -1;
        return a.ms - b.ms;
      }
      return a.entry.index - b.entry.index;
    });

  const weakTopics = standing
    .filter((s) => s.band === 'weak' || s.band === 'improving')
    .filter((s) => problemsByTopic.has(s.topicId));

  // In-progress: catalog topics with ≥1 done and something left, lowest ratio first.
  const inProgress = standing
    .filter((s) => s.notes.total > 0 && s.notes.done > 0)
    .sort(
      (a, b) =>
        a.notes.done / a.notes.total - b.notes.done / b.notes.total ||
        (a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : 0),
    );

  // Unstarted: catalog topics with no activity, ordered by their easiest
  // problem then that problem's catalog position.
  const unstarted = Array.from(problemsByTopic.keys())
    .filter((t) => !standingById.has(t))
    .map((t) => ({ topicId: t, first: pick(t, false) }))
    .filter(
      (u): u is { topicId: TopicId; first: GuidanceProblem } =>
        u.first !== undefined,
    )
    .sort(
      (a, b) =>
        DIFFICULTY_RANK[a.first.difficulty] -
          DIFFICULTY_RANK[b.first.difficulty] ||
        (byId.get(a.first.id)?.index ?? 0) - (byId.get(b.first.id)?.index ?? 0),
    )
    .map((u) => u.topicId);

  /** One pass over every source in priority order; returns items added. */
  const runPass = (distinct: boolean): number => {
    const before = nextUp.length;
    for (const r of revisits) {
      if (full() || revisitSlots >= MAX_REVISIT_SLOTS) break;
      const problem = r.entry.problem;
      if (usedProblems.has(problem.id)) continue;
      if (distinct && touchesUsedTopic(problem)) continue;
      const what =
        r.note.status === 'to_revisit' ? 'to revisit' : "didn't understand";
      const reason =
        r.ms === null
          ? `Marked ${what}`
          : `Marked ${what} ${agoPhrase(daysBetween(r.ms, nowMs))}`;
      add('revisit', problem, problem.topics[0] ?? '', reason);
      revisitSlots++;
    }
    for (const s of weakTopics) {
      if (full()) break;
      const problem = pick(s.topicId, distinct);
      if (!problem) continue;
      const total = s.quiz.correct + s.quiz.incorrect;
      add(
        'weak_topic',
        problem,
        s.topicId,
        `${label(s.topicId)}: ${s.quiz.correct}/${total} correct in quiz`,
      );
    }
    for (const s of inProgress) {
      if (full()) break;
      const problem = pick(s.topicId, distinct);
      if (!problem) continue;
      add(
        'continue',
        problem,
        s.topicId,
        `${label(s.topicId)}: ${s.notes.done}/${s.notes.total} done`,
      );
    }
    for (const topicId of unstarted) {
      if (full()) break;
      const problem = pick(topicId, distinct);
      if (!problem) continue;
      add('start', problem, topicId, `Start ${label(topicId)}`);
    }
    return nextUp.length - before;
  };

  // Distinct-topic pass first, then relaxed passes until full or exhausted
  // (each relaxed pass adds at most one problem per topic, so a single topic
  // can still fill every slot).
  runPass(true);
  while (!full() && runPass(false) > 0) {
    // keep filling
  }

  // ---- Quiz hint ---------------------------------------------------------
  const lastQuizAt =
    lastQuizMs === null ? null : new Date(lastQuizMs).toISOString();
  const suggested =
    doneCount >= 1 &&
    (lastQuizMs === null || nowMs - lastQuizMs > QUIZ_NUDGE_DAYS * DAY_MS);

  return {
    standing,
    nextUp,
    quiz: { doneCount, lastQuizAt, suggested },
  };
}
