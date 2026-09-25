/**
 * Quiz Master engine (ADR 0007 — Q2).
 *
 * PURE, testable core of the Quickfire Quiz Master: prompt construction
 * (persona + wrapped-question + evaluation instructions + injected user
 * intuition), UNTRUSTED model-output parsing (fail-closed, mirroring
 * `coach()`), a seedable deck shuffle, session advance / no-repeat logic, and
 * competency-signal update derivation.
 *
 * Design rules (charter §6.2, ADR 0007):
 *  - The MODEL is the sole source of question wording AND verdicts. This module
 *    NEVER authors canonical answers/solutions/hints — it only shapes prompts
 *    and parses/validates the model's structured output.
 *  - Model output is UNTRUSTED: parsing fails closed (throws) on malformed
 *    output so the caller performs NO storage writes and NO fabricated verdict.
 *  - Everything here is pure (no I/O): the HTTP layer (`api.ts`) owns the
 *    provider call and all storage reads/writes, so this stays unit-testable.
 */

import type {
  IsoTimestamp,
  QuizSession,
  QuizAnswerRecord,
  QuizTranscriptEntry,
  CompetencySignals,
  TopicCompetency,
  PatternSignal,
  TopicId,
} from '@ibai/storage';
import { deriveTopicStrength } from '@ibai/storage';
import type { Problem } from '@ibai/curriculum';
import type { PromptMessage } from '@ibai/providers';

// ---------------------------------------------------------------------------
// Persona + instruction constants (§6.2: shape the prompt, ship NO answers)
// ---------------------------------------------------------------------------

/**
 * The Quiz Master persona (ADR 0007 D1/D2). Prepended as the `system` message.
 * It quizzes the user on problems they marked done, presents each WRAPPED (a
 * short story/rephrase, no hints, not the raw title), and evaluates the
 * DIRECTION of their reasoning against the model's OWN knowledge of the
 * well-known problem, cross-referenced with the user's OWN saved intuition. It
 * NEVER reveals a solution: a semi-optimal-or-better approach is accepted; if a
 * materially more optimal approach exists it NUDGES the user to go look, but
 * does not hand it over.
 */
export const QUIZ_MASTER_PERSONA =
  'You are the Quickfire Quiz Master for software-engineering interview prep. ' +
  'You quiz the candidate on problems they have already marked as done. For ' +
  'each problem you present a WRAPPED version: a short 1-2 line story or ' +
  'rephrasing that tests whether they recognise the underlying pattern — NOT ' +
  'the raw problem title, and with NO hints. The candidate types their ' +
  'approach/reasoning (not necessarily code). You EVALUATE the DIRECTION of ' +
  'that reasoning using YOUR OWN general knowledge of the well-known problem, ' +
  "cross-referenced with the candidate's OWN saved intuition note (provided " +
  'as personalization). CRITICAL RULES: NEVER reveal, describe, or hand over ' +
  'the solution, optimal algorithm, or code. A semi-optimal-or-better ' +
  'approach is CORRECT. If a materially more optimal approach exists, mark it ' +
  'correct but add a nudge telling the candidate to go read/figure out the ' +
  'more optimal approach themselves — WITHOUT revealing it. Judge only the ' +
  "candidate's own reasoning; do not fill in gaps for them.";

/**
 * Instruction to generate a WRAPPED presentation of the current problem. Used
 * when we ask the model to present the next question. The model authors the
 * wording (§6.2), we only constrain the shape.
 */
export const WRAP_INSTRUCTION =
  'Present the CURRENT problem as a WRAPPED question: a short (1-2 line) story ' +
  'or rephrasing that hints at the underlying pattern WITHOUT naming the ' +
  'problem, revealing the algorithm, or giving any solving hint. Output ONLY ' +
  'the wrapped question text — no preamble, no title, no answer.';

/**
 * Instruction for the structured, machine-parseable verdict block. Mirrors the
 * fail-closed JSON contract used by `coach()`.
 */
export const VERDICT_JSON_INSTRUCTION = `
After evaluating the candidate's answer, you MUST end your reply with a single fenced code block labelled json containing EXACTLY this shape and NOTHING else inside the fence:

\`\`\`json
{
  "verdict": "correct",
  "feedback": "<assessment of the candidate's OWN reasoning; never a solution>",
  "optimalNudge": "<OPTIONAL: if a materially more optimal approach exists, tell them to go read/figure it out — do NOT reveal it>"
}
\`\`\`

Requirements:
- "verdict" MUST be exactly one of: "correct", "incorrect", "on_track".
- Use "correct" when a semi-optimal-or-better direction is demonstrated (terminal).
- Use "incorrect" when the direction is wrong or absent (terminal).
- Use "on_track" ONLY to ask ONE clarifying probe when the direction is promising but incomplete; keep the same question.
- "feedback" assesses the candidate's OWN answer — NEVER a canned solution, algorithm, or code.
- "optimalNudge" is OPTIONAL and MUST NOT reveal the solution.
- Emit the JSON block LAST; do not wrap it in extra prose after the fence.`;

// ---------------------------------------------------------------------------
// Parsed verdict (UNTRUSTED until validated)
// ---------------------------------------------------------------------------

/** The three model-facing verdict labels (a superset of the persisted binary). */
export type ParsedVerdictLabel = 'correct' | 'incorrect' | 'on_track';

/** The validated, parsed verdict from the model's JSON block. */
export interface ParsedVerdict {
  readonly verdict: ParsedVerdictLabel;
  readonly feedback: string;
  readonly optimalNudge?: string;
}

// ---------------------------------------------------------------------------
// Deck shuffle (SEEDABLE for deterministic tests)
// ---------------------------------------------------------------------------

/**
 * A pure random source in [0, 1). Injectable so tests can pass a deterministic
 * generator; production passes `Math.random`.
 */
export type RandomSource = () => number;

/**
 * A small, deterministic PRNG (mulberry32). Exported so tests can build a
 * reproducible {@link RandomSource} from a numeric seed without pulling a dep.
 */
export function seededRandom(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle producing a NEW array (does not mutate the input). Pure
 * given a deterministic {@link RandomSource}.
 */
export function shuffleDeck<T>(items: readonly T[], random: RandomSource): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt construction (PURE)
// ---------------------------------------------------------------------------

/** The kind of turn we ask the model to perform. */
export type QuizPromptMode = 'wrap' | 'evaluate';

/** Inputs shared by both prompt modes. */
export interface QuizPromptContext {
  /** The current problem being quizzed (from the catalog). */
  readonly problem: Problem;
  /**
   * The user's saved intuition note content for this problem, if any. Injected
   * as PERSONALIZATION only — it is the user's OWN text, never a shipped answer.
   */
  readonly intuition?: string | null;
  /** The user's typed answer/reasoning — required for the `evaluate` mode. */
  readonly answer?: string;
}

/**
 * Build the prompt messages for either presenting a WRAPPED question (`wrap`)
 * or EVALUATING the user's answer (`evaluate`).
 *
 * Both modes prepend the {@link QUIZ_MASTER_PERSONA}. The `problem` metadata
 * (title/topics/difficulty) is given to the model as context so it can draw on
 * ITS OWN knowledge of the well-known problem; we ship no solution. For
 * `evaluate`, the user's intuition note is injected as personalization and the
 * strict verdict-JSON instruction is appended.
 */
export function buildQuizPrompt(
  mode: QuizPromptMode,
  ctx: QuizPromptContext,
): PromptMessage[] {
  const messages: PromptMessage[] = [
    { role: 'system', content: QUIZ_MASTER_PERSONA },
  ];

  const topics =
    ctx.problem.topics.length > 0 ? ctx.problem.topics.join(', ') : 'unknown';
  let user =
    `CURRENT PROBLEM (for your reference — use your OWN knowledge of it):\n` +
    `- Title: ${ctx.problem.title}\n` +
    `- Topics: ${topics}\n` +
    `- Difficulty: ${ctx.problem.difficulty}\n`;

  if (mode === 'wrap') {
    user += `\n${WRAP_INSTRUCTION}`;
    messages.push({ role: 'user', content: user });
    return messages;
  }

  // evaluate
  const intuition = (ctx.intuition ?? '').trim();
  user +=
    `\nThe candidate's OWN saved intuition note for this problem ` +
    `(personalization signal — may be empty):\n` +
    (intuition.length > 0 ? `"""\n${intuition}\n"""\n` : '(no saved note)\n');
  user += `\nThe candidate's typed answer/reasoning:\n"""\n${(ctx.answer ?? '').trim()}\n"""\n`;
  user += `\n${VERDICT_JSON_INSTRUCTION}`;
  messages.push({ role: 'user', content: user });
  return messages;
}

// ---------------------------------------------------------------------------
// Verdict parsing (UNTRUSTED — fail closed, mirrors coach())
// ---------------------------------------------------------------------------

/**
 * Extract JSON from model output. Prefers the LAST fenced ```json block; falls
 * back to the last balanced `{ ... }` object. Mirrors the coach extractor.
 */
function extractJson(text: string): string | null {
  const fencePattern = /```json\s*([\s\S]*?)```/g;
  let lastMatch: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(text)) !== null) {
    lastMatch = match[1]?.trim() ?? null;
  }
  if (lastMatch) {
    return lastMatch;
  }

  let depth = 0;
  let start = -1;
  let lastValidStart = -1;
  let lastValidEnd = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        lastValidStart = start;
        lastValidEnd = i + 1;
      }
    }
  }
  if (lastValidStart !== -1 && lastValidEnd !== -1) {
    return text.slice(lastValidStart, lastValidEnd);
  }
  return null;
}

/**
 * Parse + strictly validate the model's verdict from UNTRUSTED output.
 *
 * FAIL CLOSED: throws on missing JSON, invalid JSON, a non-object, an invalid
 * `verdict` label, or a non-string `feedback`. The caller MUST NOT write to
 * storage or fabricate a verdict when this throws.
 */
export function parseVerdict(content: string): ParsedVerdict {
  const jsonStr = extractJson(content);
  if (!jsonStr) {
    throw new Error('quiz: model returned malformed verdict — no JSON found');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('quiz: model returned malformed verdict — invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('quiz: model returned non-object verdict JSON');
  }
  const obj = parsed as Record<string, unknown>;
  if (
    obj.verdict !== 'correct' &&
    obj.verdict !== 'incorrect' &&
    obj.verdict !== 'on_track'
  ) {
    throw new Error('quiz: verdict missing or invalid "verdict" field');
  }
  if (typeof obj.feedback !== 'string') {
    throw new Error('quiz: verdict missing or invalid "feedback" field');
  }
  if (obj.optimalNudge !== undefined && typeof obj.optimalNudge !== 'string') {
    throw new Error('quiz: verdict has invalid "optimalNudge" field');
  }
  const feedback = obj.feedback.trim();
  const nudge =
    typeof obj.optimalNudge === 'string' ? obj.optimalNudge.trim() : '';
  return {
    verdict: obj.verdict,
    feedback,
    ...(nudge.length > 0 ? { optimalNudge: nudge } : {}),
  };
}

// ---------------------------------------------------------------------------
// Session helpers (PURE)
// ---------------------------------------------------------------------------

/**
 * The problem id at the session's current index, or `null` if the deck is
 * exhausted (session complete).
 */
export function currentProblemId(session: QuizSession): string | null {
  if (session.currentIndex < 0 || session.currentIndex >= session.deck.length) {
    return null;
  }
  return session.deck[session.currentIndex] ?? null;
}

/** True when the deck has been fully answered. */
export function isDeckExhausted(session: QuizSession): boolean {
  return session.currentIndex >= session.deck.length;
}

/** Progress counters for the SPA/resume banner. */
export interface QuizProgress {
  readonly answered: number;
  readonly deckSize: number;
  readonly index: number;
}

/** Derive progress counters from a session. */
export function quizProgress(session: QuizSession): QuizProgress {
  return {
    answered: session.answered.length,
    deckSize: session.deck.length,
    index: session.currentIndex,
  };
}

/**
 * Advance a session after a TERMINAL verdict for the current problem.
 *
 * Appends the answer record, advances `currentIndex` by one (no-repeat: the
 * deck is fixed and each problem is visited once), appends transcript turns,
 * and marks the session `'complete'` when the deck is exhausted. Pure: returns
 * a NEW session object; the caller persists it.
 */
export function advanceSession(
  session: QuizSession,
  outcome: {
    readonly problemId: string;
    readonly verdict: 'correct' | 'incorrect';
    readonly at: IsoTimestamp;
    readonly userTurn: string;
    readonly assistantTurn: string;
  },
): QuizSession {
  const answerRecord: QuizAnswerRecord = {
    problemId: outcome.problemId,
    verdict: outcome.verdict,
    at: outcome.at,
  };
  const userEntry: QuizTranscriptEntry = {
    role: 'user',
    content: outcome.userTurn,
    at: outcome.at,
  };
  const assistantEntry: QuizTranscriptEntry = {
    role: 'assistant',
    content: outcome.assistantTurn,
    at: outcome.at,
  };
  const nextIndex = session.currentIndex + 1;
  const status = nextIndex >= session.deck.length ? 'complete' : 'active';
  return {
    ...session,
    currentIndex: nextIndex,
    answered: [...session.answered, answerRecord],
    transcript: [...session.transcript, userEntry, assistantEntry],
    status,
  };
}

/**
 * Append a WRAPPED-question turn (assistant) to the transcript without
 * advancing. Used when presenting the next question. Pure.
 */
export function appendAssistantTurn(
  session: QuizSession,
  content: string,
  at: IsoTimestamp,
): QuizSession {
  return {
    ...session,
    transcript: [...session.transcript, { role: 'assistant', content, at }],
  };
}

// ---------------------------------------------------------------------------
// Competency-signal update (PURE)
// ---------------------------------------------------------------------------

/**
 * Derive an updated {@link CompetencySignals} dataset after one terminal
 * verdict on a problem.
 *
 * For each topic the problem spans, bumps the correct/incorrect tally and
 * recomputes the derived strength band via {@link deriveTopicStrength}. On an
 * INCORRECT verdict, also records/merges a {@link PatternSignal} capturing the
 * miss — its `description` summarises the USER's own gap (optionally
 * referencing their own intuition), NEVER a solution (§6.2).
 *
 * Pure: returns a NEW dataset; the caller persists it.
 */
export function updateCompetencySignals(
  current: CompetencySignals,
  input: {
    readonly topics: readonly TopicId[];
    readonly verdict: 'correct' | 'incorrect';
    readonly problemId: string;
    readonly problemTitle: string;
    readonly intuition?: string | null;
    readonly at: IsoTimestamp;
  },
): CompetencySignals {
  const topics: Record<TopicId, TopicCompetency> = { ...current.topics };

  for (const topicId of input.topics) {
    const existing = topics[topicId];
    const correct =
      (existing?.correct ?? 0) + (input.verdict === 'correct' ? 1 : 0);
    const incorrect =
      (existing?.incorrect ?? 0) + (input.verdict === 'incorrect' ? 1 : 0);
    topics[topicId] = {
      topicId,
      correct,
      incorrect,
      lastSeen: input.at,
      strength: deriveTopicStrength(correct, incorrect),
    };
  }

  let patterns: PatternSignal[] = current.patterns.slice();
  if (input.verdict === 'incorrect') {
    // Stable per-problem key so repeated misses on the same problem merge.
    const patternId = `miss:${input.problemId}`;
    const intuition = (input.intuition ?? '').trim();
    const description =
      intuition.length > 0
        ? `Missed "${input.problemTitle}"; you noted: ${truncate(intuition, 160)}`
        : `Missed "${input.problemTitle}" — reasoning direction was off.`;
    const idx = patterns.findIndex((p) => p.id === patternId);
    if (idx >= 0) {
      const prev = patterns[idx]!;
      patterns[idx] = {
        ...prev,
        description,
        topics: mergeTopics(prev.topics, input.topics),
        occurrences: prev.occurrences + 1,
        lastObserved: input.at,
      };
    } else {
      patterns = [
        ...patterns,
        {
          id: patternId,
          description,
          topics: [...input.topics],
          occurrences: 1,
          lastObserved: input.at,
        },
      ];
    }
  }

  return {
    topics,
    patterns,
    lastUpdated: input.at,
  };
}

/** Union of two topic lists, order-preserving and de-duplicated. */
function mergeTopics(
  a: readonly TopicId[],
  b: readonly TopicId[],
): readonly TopicId[] {
  const seen = new Set<TopicId>();
  const out: TopicId[] = [];
  for (const t of [...a, ...b]) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Truncate a string to `max` chars with an ellipsis (pure helper). */
function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

/** An empty competency-signals dataset (used when none exists yet). */
export function emptyCompetencySignals(at: IsoTimestamp): CompetencySignals {
  return { topics: {}, patterns: [], lastUpdated: at };
}
