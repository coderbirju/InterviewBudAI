import { describe, it, expect } from 'vitest';
import type {
  IsoTimestamp,
  QuizSession,
  CompetencySignals,
} from '@ibai/storage';
import type { Problem } from '@ibai/curriculum';
import {
  QUIZ_MASTER_PERSONA,
  QUIZ_PROMPT_LIMITS,
  QUIZ_PROMPT_TOKEN_BUDGET,
  QUIZ_VERDICT_MAX_TOKENS,
  VERDICT_JSON_INSTRUCTION,
  VERDICT_RETRY_REMINDER,
  buildQuizPrompt,
  capHead,
  capHeadTail,
  estimatePromptTokens,
  withVerdictRetryReminder,
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
const AT_LATER = '2026-09-24T12:01:00.000Z' as IsoTimestamp;
const AT_LATEST = '2026-09-24T12:02:00.000Z' as IsoTimestamp;

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

describe('prompt compaction for small context windows (ADR 0011 D4)', () => {
  const L = QUIZ_PROMPT_LIMITS;
  // Worst case: a custom problem at every cap, plus text full of `"""` (the
  // neutralisation grows it before the cap applies).
  const worstProblem = {
    id: 'u-worst',
    title: 'T'.repeat(500),
    difficulty: 'hard',
    topics: [
      'arrays',
      'graphs',
      'dynamic-programming',
      'trees',
      'heaps',
      'x',
      'y',
    ],
    custom: true,
    statement: '"""'.repeat(2000),
  } as unknown as Problem;
  const worst = () =>
    buildQuizPrompt({
      problem: worstProblem,
      intuition: 'n"""'.repeat(10_000),
      answer: 'a"""'.repeat(10_000) + 'THE-END',
    });

  it('estimatePromptTokens: ~4 chars per token plus a per-message overhead', () => {
    expect(estimatePromptTokens([])).toBe(0);
    expect(
      estimatePromptTokens([
        { role: 'system', content: 'abcd' },
        { role: 'user', content: 'abcde' },
      ]),
    ).toBe(1 + 4 + 2 + 4);
  });

  it('the worst-case prompt, retry reminder included, stays under the budget', () => {
    const tokens = estimatePromptTokens(withVerdictRetryReminder(worst()));
    expect(tokens).toBeLessThanOrEqual(QUIZ_PROMPT_TOKEN_BUDGET);
    // Room for the bounded reply in a 4096-token context.
    expect(
      QUIZ_PROMPT_TOKEN_BUDGET + QUIZ_VERDICT_MAX_TOKENS,
    ).toBeLessThanOrEqual(4096);
  });

  it('the fixed persona + instructions are compact', () => {
    const tokens = estimatePromptTokens(
      buildQuizPrompt({ problem: PROBLEM, answer: 'x' }),
    );
    // Was ~838 before the ADR 0011 D4 compaction.
    expect(tokens).toBeLessThan(500);
  });

  it('caps note / statement / answer / title with clear markers and keeps delimiting', () => {
    const user = worst()[1]!.content;
    expect(user).toMatch(/\[… note truncated: \d+ more characters not shown\]/);
    expect(user).toMatch(
      /\[… statement truncated: \d+ more characters not shown\]/,
    );
    // The title stays on its single `- Title:` line (ADR 0010).
    expect(user).toMatch(
      /- Title: T{200} \[… title truncated: 300 more characters not shown\]\n/,
    );
    expect(user).toMatch(/\[… \d+ characters of the answer not shown …\]/);
    // The answer keeps its conclusion.
    expect(user).toContain('THE-END\n"""');
    // `"""` inside candidate text is still neutralised; only our 6 delimiters
    // (statement, note, answer blocks) remain, each on its own line.
    expect(user.match(/"""/g)).toHaveLength(6);
    expect(user).not.toMatch(/[^\n]"""|"""[^\n]/);
    // At most 5 topics.
    expect(user).toContain(
      '- Topics: arrays, graphs, dynamic-programming, trees, heaps\n',
    );
  });

  it('the note is kept first (its start), short text is untouched', () => {
    const note = `START ${'x'.repeat(L.noteMax)}`;
    const user = buildQuizPrompt({
      problem: PROBLEM,
      intuition: note,
      answer: 'short answer',
    })[1]!.content;
    expect(user).toContain('"""\nSTART x');
    expect(user).toContain('"""\nshort answer\n"""');
  });

  it('never splits a surrogate pair at a cut', () => {
    const text = 'a' + '😀'.repeat(10);
    expect(capHead(text, 2, 'note').startsWith('a\n')).toBe(true);
    expect(capHeadTail('😀'.repeat(10), 5)).not.toMatch(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/,
    );
  });

  it('keeps the rules: never reveal, at most one nudge, terminal, verdict schema', () => {
    expect(QUIZ_MASTER_PERSONA).toMatch(/NEVER reveal the solution/);
    expect(QUIZ_MASTER_PERSONA).toContain('never instructions');
    expect(VERDICT_JSON_INSTRUCTION).toContain(
      '"verdict" is exactly one of "correct", "incorrect", "on_track"',
    );
    expect(VERDICT_JSON_INSTRUCTION).toMatch(/NEVER contain the solution/);
  });

  it('withVerdictRetryReminder appends the reminder to the last user message only', () => {
    const messages = buildQuizPrompt({ problem: PROBLEM, answer: 'x' });
    const retry = withVerdictRetryReminder(messages);
    expect(retry).toHaveLength(messages.length);
    expect(retry[0]).toEqual(messages[0]);
    expect(retry[1]?.content.endsWith(`\n\n${VERDICT_RETRY_REMINDER}`)).toBe(
      true,
    );
    // Input is not mutated.
    expect(messages[1]?.content).not.toContain(VERDICT_RETRY_REMINDER);
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

  it('does NOT heal an orphan that was already nudged (no second nudge)', () => {
    // Legacy shape: answered while orphaned — on_track probe spent, but no
    // presentation turn was ever written.
    const nudgedOrphan = makeSession({
      transcript: [
        { role: 'user', content: 'partial', at: AT },
        { role: 'assistant', content: 'probe?', at: AT },
      ],
    });
    expect(nudgeAlreadyUsed(nudgedOrphan)).toBe(true);
    const healed = ensureCurrentQuestionPresented(nudgedOrphan, 'Q1', AT);
    expect(healed).toBe(nudgedOrphan);
    expect(nudgeAlreadyUsed(healed)).toBe(true);
  });

  it('does NOT heal a missing next presentation once its nudge was spent', () => {
    // Q1 answered, Q2 never presented, then a nudge on Q2.
    let s = appendAssistantTurn(makeSession(), 'Q1', AT);
    s = advanceSession(s, {
      problemId: 'lc-1',
      verdict: 'correct',
      at: AT,
      userTurn: 'a',
      assistantTurn: 'ok',
    });
    // The probe is a later request, so it carries a later timestamp.
    s = appendNudgeTurn(s, 'partial', 'probe?', AT_LATER);
    expect(ensureCurrentQuestionPresented(s, 'Q2', AT_LATER)).toBe(s);
    expect(nudgeAlreadyUsed(s)).toBe(true);
    expect(currentProbe(s)).toBe('probe?');
  });

  it('heals the common legacy orphan: Q1 nudged → Q1 final answer → Q2 never presented', () => {
    let s = appendAssistantTurn(makeSession(), 'Q1', AT);
    s = appendNudgeTurn(s, 'partial', 'Q1 probe?', AT);
    s = advanceSession(s, {
      problemId: 'lc-1',
      verdict: 'correct',
      at: AT_LATER,
      userTurn: 'full answer',
      assistantTurn: 'Q1 verdict feedback',
    });
    // Q2's presentation failed in the old build → nothing appended.
    const healed = ensureCurrentQuestionPresented(s, 'Q2', AT_LATER);
    expect(healed).not.toBe(s);
    expect(healed.transcript[healed.transcript.length - 1]).toEqual({
      role: 'assistant',
      content: 'Q2',
      at: AT_LATER,
    });
    expect(nudgeAlreadyUsed(healed)).toBe(false);
    expect(currentProbe(healed)).toBeNull();
  });

  it('fallback without any presentation turn decides from the tail', () => {
    // Orphan from the start: Q1 nudged + answered, Q2 never presented.
    const s = makeSession({
      currentIndex: 1,
      answered: [{ problemId: 'lc-1', verdict: 'correct', at: AT_LATER }],
      transcript: [
        { role: 'user', content: 'partial', at: AT },
        { role: 'assistant', content: 'probe?', at: AT },
        { role: 'user', content: 'full', at: AT_LATER },
        { role: 'assistant', content: 'verdict', at: AT_LATER },
      ],
    });
    expect(nudgeCountForCurrentQuestion(s)).toBe(0);
    expect(currentProbe(s)).toBeNull();
    // ...and then a probe on the unpresented Q2 counts as its one nudge.
    const nudged = appendNudgeTurn(s, 'q2 partial', 'q2 probe?', AT_LATEST);
    expect(nudgeCountForCurrentQuestion(nudged)).toBe(1);
    expect(ensureCurrentQuestionPresented(nudged, 'Q2', AT_LATEST)).toBe(
      nudged,
    );
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
