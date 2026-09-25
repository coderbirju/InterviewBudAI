import { describe, it, expect } from 'vitest';
import type {
  IsoTimestamp,
  QuizSession,
  CompetencySignals,
} from '@ibai/storage';
import type { Problem } from '@ibai/curriculum';
import {
  QUIZ_MASTER_PERSONA,
  buildQuizPrompt,
  presentProblem,
  ensureCurrentQuestionPresented,
  currentProbe,
  parseVerdict,
  seededRandom,
  shuffleDeck,
  advanceSession,
  appendAssistantTurn,
  appendNudgeTurn,
  nudgeAlreadyUsed,
  nudgeCountForCurrentQuestion,
  currentProblemId,
  isDeckExhausted,
  quizProgress,
  updateCompetencySignals,
  emptyCompetencySignals,
} from './quiz.js';

const AT = '2026-09-24T12:00:00.000Z' as IsoTimestamp;

const PROBLEM: Problem = {
  id: 'lc-1',
  title: 'Two Sum',
  url: 'https://example.com/two-sum',
  difficulty: 'easy',
  topics: ['arrays', 'hashmap'],
};

function makeSession(overrides: Partial<QuizSession> = {}): QuizSession {
  return {
    sessionId: 'quiz-test',
    createdAt: AT,
    deck: ['lc-1', 'lc-2', 'lc-3'],
    currentIndex: 0,
    answered: [],
    transcript: [],
    status: 'active',
    ...overrides,
  };
}

describe('shuffleDeck (seedable)', () => {
  it('is deterministic for a given seed and does not mutate input', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    const copy = input.slice();
    const out1 = shuffleDeck(input, seededRandom(42));
    const out2 = shuffleDeck(input, seededRandom(42));
    expect(out1).toEqual(out2); // deterministic
    expect(input).toEqual(copy); // no mutation
    expect([...out1].sort()).toEqual([...input].sort()); // permutation
  });

  it('produces different orders for different seeds (typically)', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const out1 = shuffleDeck(input, seededRandom(1));
    const out2 = shuffleDeck(input, seededRandom(999));
    expect(out1).not.toEqual(out2);
  });
});

describe('presentProblem (deterministic, no model — ADR 0007 A8)', () => {
  it('presents the RAW problem: real title + difficulty, nothing else', () => {
    expect(presentProblem(PROBLEM)).toBe('Two Sum (easy)');
  });
});

describe('buildQuizPrompt', () => {
  it('prepends the persona as the system message', () => {
    const messages = buildQuizPrompt({ problem: PROBLEM, answer: 'x' });
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe(QUIZ_MASTER_PERSONA);
    expect(messages[1]?.content).toContain('Two Sum');
  });

  it('persona forbids revealing the solution and caps nudges at one', () => {
    // Persona-level guarantee (§6.2): the Quiz Master must never reveal the
    // answer and must not give more than one on_track nudge per question.
    expect(QUIZ_MASTER_PERSONA).toMatch(/NEVER reveal/i);
    expect(QUIZ_MASTER_PERSONA).toMatch(/AT MOST ONE/i);
    expect(QUIZ_MASTER_PERSONA).toMatch(/TERMINAL/);
  });

  it('injects intuition + answer + strict verdict JSON', () => {
    const messages = buildQuizPrompt({
      problem: PROBLEM,
      intuition: 'I got confused by the two-pointer trick',
      answer: 'Use a hash map for complements',
    });
    const user = messages[1]?.content ?? '';
    expect(user).toContain('I got confused by the two-pointer trick');
    expect(user).toContain('Use a hash map for complements');
    expect(user).toContain('"verdict"');
    expect(user).toContain('correct');
  });

  it('tolerates a missing intuition note', () => {
    const messages = buildQuizPrompt({
      problem: PROBLEM,
      intuition: null,
      answer: 'brute force',
    });
    const user = messages[1]?.content ?? '';
    expect(user).toContain('(no saved note)');
  });
});

describe('parseVerdict (fail-closed)', () => {
  it('parses a fenced correct verdict', () => {
    const out = parseVerdict(
      'Nice reasoning.\n```json\n{"verdict":"correct","feedback":"good direction"}\n```',
    );
    expect(out.verdict).toBe('correct');
    expect(out.feedback).toBe('good direction');
    expect(out.optimalNudge).toBeUndefined();
  });

  it('parses an incorrect verdict with an optional optimalNudge', () => {
    const out = parseVerdict(
      '```json\n{"verdict":"incorrect","feedback":"off track","optimalNudge":"go read about hashing"}\n```',
    );
    expect(out.verdict).toBe('incorrect');
    expect(out.optimalNudge).toBe('go read about hashing');
  });

  it('parses on_track', () => {
    const out = parseVerdict(
      '```json\n{"verdict":"on_track","feedback":"what is the complexity?"}\n```',
    );
    expect(out.verdict).toBe('on_track');
  });

  it('falls back to the last balanced object when unfenced', () => {
    const out = parseVerdict(
      'thinking... {"verdict":"correct","feedback":"ok"}',
    );
    expect(out.verdict).toBe('correct');
  });

  it('throws when no JSON present', () => {
    expect(() => parseVerdict('just prose, no json')).toThrow(/quiz:/);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseVerdict('```json\n{not json}\n```')).toThrow(/quiz:/);
  });

  it('throws on an invalid verdict label', () => {
    expect(() =>
      parseVerdict('```json\n{"verdict":"maybe","feedback":"x"}\n```'),
    ).toThrow(/quiz:/);
  });

  it('throws on a missing feedback field', () => {
    expect(() => parseVerdict('```json\n{"verdict":"correct"}\n```')).toThrow(
      /quiz:/,
    );
  });
});

describe('session helpers', () => {
  it('currentProblemId + isDeckExhausted + quizProgress', () => {
    const s = makeSession({ currentIndex: 1 });
    expect(currentProblemId(s)).toBe('lc-2');
    expect(isDeckExhausted(s)).toBe(false);
    expect(quizProgress(s)).toEqual({ answered: 0, deckSize: 3, index: 1 });

    const done = makeSession({ currentIndex: 3 });
    expect(currentProblemId(done)).toBeNull();
    expect(isDeckExhausted(done)).toBe(true);
  });

  it('advanceSession records outcome, advances index, appends transcript, no-repeat', () => {
    const s = makeSession();
    const next = advanceSession(s, {
      problemId: 'lc-1',
      verdict: 'correct',
      at: AT,
      userTurn: 'hash map',
      assistantTurn: 'correct!',
    });
    expect(next.currentIndex).toBe(1);
    expect(next.answered).toHaveLength(1);
    expect(next.answered[0]).toEqual({
      problemId: 'lc-1',
      verdict: 'correct',
      at: AT,
    });
    expect(next.transcript.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(next.status).toBe('active');
    // Original untouched (pure).
    expect(s.currentIndex).toBe(0);
    expect(s.answered).toHaveLength(0);
  });

  it('advanceSession marks complete when the deck is exhausted', () => {
    const s = makeSession({ currentIndex: 2 });
    const next = advanceSession(s, {
      problemId: 'lc-3',
      verdict: 'incorrect',
      at: AT,
      userTurn: 'x',
      assistantTurn: 'y',
    });
    expect(next.currentIndex).toBe(3);
    expect(next.status).toBe('complete');
  });

  it('appendAssistantTurn adds a turn without advancing', () => {
    const s = makeSession();
    const next = appendAssistantTurn(s, 'wrapped question', AT);
    expect(next.currentIndex).toBe(0);
    expect(next.transcript).toHaveLength(1);
    expect(next.transcript[0]).toEqual({
      role: 'assistant',
      content: 'wrapped question',
      at: AT,
    });
  });

  it('nudge tracking: fresh question has no nudge used', () => {
    const s = appendAssistantTurn(makeSession(), 'presented question', AT);
    expect(nudgeCountForCurrentQuestion(s)).toBe(0);
    expect(nudgeAlreadyUsed(s)).toBe(false);
  });

  it('appendNudgeTurn records the answer + probe and counts as one nudge', () => {
    let s = appendAssistantTurn(makeSession(), 'presented question', AT);
    s = appendNudgeTurn(s, 'my first answer', 'what is the complexity?', AT);
    // Does not advance / record an outcome.
    expect(s.currentIndex).toBe(0);
    expect(s.answered).toHaveLength(0);
    expect(s.transcript.map((t) => t.role)).toEqual([
      'assistant',
      'user',
      'assistant',
    ]);
    // Exactly one nudge is now used for the current question.
    expect(nudgeCountForCurrentQuestion(s)).toBe(1);
    expect(nudgeAlreadyUsed(s)).toBe(true);
  });

  it('nudge tracking resets on the next question after a terminal advance', () => {
    // Q1: one nudge, then a terminal correct advances to Q2.
    let s = appendAssistantTurn(makeSession(), 'Q1 presented', AT);
    s = appendNudgeTurn(s, 'partial', 'probe?', AT);
    expect(nudgeAlreadyUsed(s)).toBe(true);
    s = advanceSession(s, {
      problemId: 'lc-1',
      verdict: 'correct',
      at: AT,
      userTurn: 'full answer',
      assistantTurn: 'correct!',
    });
    // Present Q2; nudge budget is fresh again (user turns == answered).
    s = appendAssistantTurn(s, 'Q2 presented', AT);
    expect(nudgeCountForCurrentQuestion(s)).toBe(0);
    expect(nudgeAlreadyUsed(s)).toBe(false);
  });

  it('ensureCurrentQuestionPresented heals a legacy orphan (empty transcript)', () => {
    const orphan = makeSession();
    const healed = ensureCurrentQuestionPresented(orphan, 'Two Sum (easy)', AT);
    expect(healed.transcript).toEqual([
      { role: 'assistant', content: 'Two Sum (easy)', at: AT },
    ]);
    // Nudge accounting works on the healed session.
    const nudged = appendNudgeTurn(healed, 'partial', 'probe?', AT);
    expect(nudgeAlreadyUsed(nudged)).toBe(true);
  });

  it('ensureCurrentQuestionPresented heals a missing NEXT presentation', () => {
    // Q1 presented + answered terminally, but Q2 was never presented.
    let s = appendAssistantTurn(makeSession(), 'Q1', AT);
    s = advanceSession(s, {
      problemId: 'lc-1',
      verdict: 'correct',
      at: AT,
      userTurn: 'a',
      assistantTurn: 'ok',
    });
    const healed = ensureCurrentQuestionPresented(s, 'Q2', AT);
    expect(healed.transcript).toHaveLength(4);
    expect(healed.transcript[3]?.content).toBe('Q2');
    expect(nudgeAlreadyUsed(healed)).toBe(false);
  });

  it('ensureCurrentQuestionPresented is a no-op for well-formed or exhausted sessions', () => {
    let s = appendAssistantTurn(makeSession(), 'Q1', AT);
    expect(ensureCurrentQuestionPresented(s, 'Q1', AT)).toBe(s);
    s = appendNudgeTurn(s, 'partial', 'probe?', AT);
    expect(ensureCurrentQuestionPresented(s, 'Q1', AT)).toBe(s);
    const done = makeSession({ currentIndex: 3 });
    expect(ensureCurrentQuestionPresented(done, 'x', AT)).toBe(done);
  });

  it('currentProbe returns the spent probe for the current question only', () => {
    let s = appendAssistantTurn(makeSession(), 'Q1', AT);
    expect(currentProbe(s)).toBeNull();
    s = appendNudgeTurn(s, 'partial', 'what about duplicates?', AT);
    expect(currentProbe(s)).toBe('what about duplicates?');
  });
});

describe('updateCompetencySignals', () => {
  const empty: CompetencySignals = emptyCompetencySignals(AT);

  it('bumps correct tallies per topic and derives strength', () => {
    const out = updateCompetencySignals(empty, {
      topics: ['arrays', 'hashmap'],
      verdict: 'correct',
      problemId: 'lc-1',
      problemTitle: 'Two Sum',
      at: AT,
    });
    expect(out.topics['arrays']?.correct).toBe(1);
    expect(out.topics['hashmap']?.correct).toBe(1);
    expect(out.topics['arrays']?.incorrect).toBe(0);
    // < 3 observations → unknown.
    expect(out.topics['arrays']?.strength).toBe('unknown');
    // No miss → no patterns.
    expect(out.patterns).toHaveLength(0);
  });

  it('records a PatternSignal on incorrect, referencing the user intuition', () => {
    const out = updateCompetencySignals(empty, {
      topics: ['arrays'],
      verdict: 'incorrect',
      problemId: 'lc-1',
      problemTitle: 'Two Sum',
      intuition: 'I always forget the complement trick',
      at: AT,
    });
    expect(out.topics['arrays']?.incorrect).toBe(1);
    expect(out.patterns).toHaveLength(1);
    expect(out.patterns[0]?.id).toBe('miss:lc-1');
    expect(out.patterns[0]?.description).toContain('Two Sum');
    expect(out.patterns[0]?.description).toContain('complement');
    expect(out.patterns[0]?.occurrences).toBe(1);
    // NEVER a solution — it summarises the user's own note.
    expect(out.patterns[0]?.topics).toEqual(['arrays']);
  });

  it('merges a repeated miss on the same problem (occurrences++)', () => {
    const once = updateCompetencySignals(empty, {
      topics: ['arrays'],
      verdict: 'incorrect',
      problemId: 'lc-1',
      problemTitle: 'Two Sum',
      at: AT,
    });
    const twice = updateCompetencySignals(once, {
      topics: ['arrays'],
      verdict: 'incorrect',
      problemId: 'lc-1',
      problemTitle: 'Two Sum',
      at: AT,
    });
    expect(twice.patterns).toHaveLength(1);
    expect(twice.patterns[0]?.occurrences).toBe(2);
    expect(twice.topics['arrays']?.incorrect).toBe(2);
  });

  it('derives strength bands after enough observations', () => {
    let signals = emptyCompetencySignals(AT);
    for (let i = 0; i < 4; i++) {
      signals = updateCompetencySignals(signals, {
        topics: ['arrays'],
        verdict: 'correct',
        problemId: `lc-${i}`,
        problemTitle: `P${i}`,
        at: AT,
      });
    }
    expect(signals.topics['arrays']?.correct).toBe(4);
    expect(signals.topics['arrays']?.strength).toBe('strong');
  });
});
