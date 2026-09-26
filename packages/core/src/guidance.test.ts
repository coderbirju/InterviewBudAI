/**
 * Tests for deriveGuidance (pure; no storage, fixed `now`).
 */

import { describe, it, expect } from 'vitest';
import { deriveTopicStrength } from '@ibai/storage';
import type {
  CompetencySignals,
  IsoTimestamp,
  NoteStatus,
  TopicCompetency,
} from '@ibai/storage';
import {
  deriveGuidance,
  MAX_NEXT_UP,
  NEXT_UP_COUNT,
  QUIZ_NUDGE_DAYS,
} from './guidance.js';
import type {
  GuidanceInput,
  GuidanceNote,
  GuidanceProblem,
} from './guidance.js';

const NOW = '2026-09-26T12:00:00.000Z' as IsoTimestamp;
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): IsoTimestamp {
  return new Date(Date.parse(NOW) - days * DAY).toISOString() as IsoTimestamp;
}

function p(
  id: string,
  difficulty: GuidanceProblem['difficulty'],
  topics: string[],
): GuidanceProblem {
  return {
    id,
    title: `Title ${id}`,
    url: `https://example.test/${id}`,
    difficulty,
    topics,
  };
}

function n(problemId: string, status: NoteStatus, age = 1): GuidanceNote {
  return { problemId, status, lastUpdated: daysAgo(age) };
}

function sig(
  topics: Record<string, [number, number, number?]>,
): CompetencySignals {
  const out: Record<string, TopicCompetency> = {};
  for (const [topicId, [correct, incorrect, age]] of Object.entries(topics)) {
    out[topicId] = {
      topicId,
      correct,
      incorrect,
      lastSeen: daysAgo(age ?? 1),
      strength: deriveTopicStrength(correct, incorrect),
    };
  }
  return { topics: out, patterns: [], lastUpdated: NOW };
}

const NO_SIGNALS: CompetencySignals = {
  topics: {},
  patterns: [],
  lastUpdated: new Date(0).toISOString(),
};

/** A small catalog: 4 topics, mixed difficulty, one multi-topic problem. */
const CATALOG: GuidanceProblem[] = [
  p('a-m1', 'medium', ['arrays']),
  p('a-e1', 'easy', ['arrays']),
  p('a-h1', 'hard', ['arrays']),
  p('a-e2', 'easy', ['arrays']),
  p('g-e1', 'easy', ['graphs']),
  p('g-m1', 'medium', ['graphs']),
  p('g-h1', 'hard', ['graphs']),
  p('t-m1', 'medium', ['trees']),
  p('t-e1', 'easy', ['trees']),
  p('multi', 'easy', ['arrays', 'window']),
  p('w-m1', 'medium', ['window']),
];

function input(over: Partial<GuidanceInput> = {}): GuidanceInput {
  return {
    problems: CATALOG,
    notes: [],
    signals: NO_SIGNALS,
    now: NOW,
    ...over,
  };
}

describe('deriveGuidance — standing', () => {
  it('bands match deriveTopicStrength on quiz tallies (Analytics parity)', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [3, 0],
      [3, 1],
      [2, 1],
      [1, 2],
      [2, 3],
      [4, 6],
    ];
    const signals = sig(
      Object.fromEntries(cases.map(([c, i], k) => [`t${k}`, [c, i]])),
    );
    const g = deriveGuidance(input({ signals }));
    cases.forEach(([c, i], k) => {
      const s = g.standing.find((x) => x.topicId === `t${k}`);
      if (c + i === 0) {
        expect(s).toBeUndefined(); // no activity
      } else {
        expect(s?.band).toBe(deriveTopicStrength(c, i));
      }
    });
  });

  it('counts notes per topic (multi-topic counts for each) and flags needsReview', () => {
    const g = deriveGuidance(
      input({
        notes: [
          n('multi', 'done', 3),
          n('a-e1', 'to_revisit', 2),
          n('a-m1', 'did_not_understand', 5),
          n('g-e1', 'none'),
        ],
      }),
    );
    const arrays = g.standing.find((s) => s.topicId === 'arrays');
    expect(arrays?.notes).toEqual({
      done: 1,
      toRevisit: 1,
      didNotUnderstand: 1,
      total: 5,
    });
    expect(arrays?.needsReview).toBe(true);
    expect(arrays?.lastActivity).toBe(daysAgo(2));
    const window = g.standing.find((s) => s.topicId === 'window');
    expect(window?.notes.done).toBe(1);
    expect(window?.needsReview).toBe(false);
    // A 'none' note is not activity.
    expect(g.standing.find((s) => s.topicId === 'graphs')).toBeUndefined();
  });

  it('lastActivity is the max of note lastUpdated and quiz lastSeen', () => {
    const g = deriveGuidance(
      input({
        notes: [n('t-e1', 'done', 10)],
        signals: sig({ trees: [1, 0, 2] }),
      }),
    );
    expect(g.standing[0]?.lastActivity).toBe(daysAgo(2));
  });

  it('orders weak → improving → unknown → strong, ties by misses desc then id', () => {
    const g = deriveGuidance(
      input({
        signals: sig({
          s1: [4, 0],
          w1: [0, 3],
          w2: [0, 5],
          i1: [2, 2],
          u1: [1, 0],
          u2: [0, 1],
          i2: [2, 2],
        }),
      }),
    );
    expect(g.standing.map((s) => s.topicId)).toEqual([
      'w2',
      'w1',
      'i1',
      'i2',
      'u2',
      'u1',
      's1',
    ]);
  });

  it('counts needs-review notes as misses in the tie-break', () => {
    const g = deriveGuidance(
      input({
        notes: [n('t-e1', 'to_revisit')],
        signals: sig({ arrays: [1, 0], trees: [1, 0] }),
      }),
    );
    expect(g.standing.map((s) => s.topicId)).toEqual(['trees', 'arrays']);
  });

  it('ignores note ids not in the catalog; non-catalog signal topics appear with total 0', () => {
    const g = deriveGuidance(
      input({
        notes: [n('ghost', 'done'), n('ghost2', 'to_revisit')],
        signals: sig({ 'not-in-catalog': [0, 4] }),
      }),
    );
    expect(g.standing).toHaveLength(1);
    expect(g.standing[0]).toMatchObject({
      topicId: 'not-in-catalog',
      band: 'weak',
      notes: { total: 0 },
    });
    expect(g.quiz.doneCount).toBe(0);
    expect(g.nextUp.some((x) => x.topicId === 'not-in-catalog')).toBe(false);
    expect(g.nextUp.some((x) => x.problemId.startsWith('ghost'))).toBe(false);
  });

  it('tolerates malformed signal numbers (counted as 0)', () => {
    const signals = {
      topics: {
        arrays: {
          topicId: 'arrays',
          correct: Number.NaN,
          incorrect: -3,
          lastSeen: 'garbage',
          strength: 'weak',
        },
      },
      patterns: [],
      lastUpdated: NOW,
    } as CompetencySignals;
    const g = deriveGuidance(input({ signals }));
    expect(g.standing).toEqual([]);
    expect(g.quiz.lastQuizAt).toBeNull();
  });
});

describe('deriveGuidance — next up', () => {
  it('empty state: easiest problems from distinct topics, kind start', () => {
    const g = deriveGuidance(input());
    expect(g.standing).toEqual([]);
    expect(g.nextUp).toHaveLength(NEXT_UP_COUNT);
    expect(g.nextUp.every((x) => x.kind === 'start')).toBe(true);
    expect(g.nextUp.every((x) => x.difficulty === 'easy')).toBe(true);
    expect(new Set(g.nextUp.map((x) => x.topicId)).size).toBe(NEXT_UP_COUNT);
    // Easiest first, catalog order for ties.
    expect(g.nextUp.map((x) => x.problemId)).toEqual(['a-e1', 'g-e1', 't-e1']);
    expect(g.nextUp[0]?.reason).toBe('Start arrays');
  });

  it('revisits come first, oldest lastUpdated first, capped at 2', () => {
    const g = deriveGuidance(
      input({
        notes: [
          n('a-e1', 'to_revisit', 3),
          n('g-e1', 'did_not_understand', 9),
          n('t-e1', 'to_revisit', 20),
        ],
      }),
    );
    const revisits = g.nextUp.filter((x) => x.kind === 'revisit');
    expect(revisits.map((x) => x.problemId)).toEqual(['t-e1', 'g-e1']);
    expect(revisits[0]?.reason).toBe('Marked to revisit 20 days ago');
    expect(revisits[1]?.reason).toBe("Marked didn't understand 9 days ago");
    expect(g.nextUp).toHaveLength(3);
    expect(g.nextUp[2]?.kind).not.toBe('revisit');
  });

  it('revisit age phrasing: today / 1 day ago', () => {
    const g = deriveGuidance(
      input({
        notes: [n('a-e1', 'to_revisit', 0), n('g-e1', 'to_revisit', 1)],
      }),
    );
    expect(g.nextUp.map((x) => x.reason).slice(0, 2)).toEqual([
      'Marked to revisit 1 day ago',
      'Marked to revisit today',
    ]);
  });

  it('weak topic: difficulty ramp easy → medium, hard only with ≥2 done', () => {
    const catalog = [
      p('x-h', 'hard', ['x']),
      p('x-m', 'medium', ['x']),
      p('x-e', 'easy', ['x']),
      p('x-e2', 'easy', ['x']),
    ];
    const weak = sig({ x: [0, 3] });
    let g = deriveGuidance(
      input({ problems: catalog, signals: weak, count: 1 }),
    );
    expect(g.nextUp[0]).toMatchObject({
      kind: 'weak_topic',
      problemId: 'x-e',
      reason: 'x: 0/3 correct in quiz',
    });

    // Easy ones done (1 done after x-e2 is marked revisit): medium next.
    g = deriveGuidance(
      input({
        problems: catalog,
        signals: weak,
        notes: [n('x-e', 'done'), n('x-e2', 'to_revisit')],
        count: 5,
      }),
    );
    const newWork = g.nextUp.filter((x) => x.kind !== 'revisit');
    expect(newWork.map((x) => x.problemId)).toEqual(['x-m']); // hard gated

    // Two done: hard unlocks.
    g = deriveGuidance(
      input({
        problems: catalog,
        signals: weak,
        notes: [n('x-e', 'done'), n('x-e2', 'done'), n('x-m', 'done')],
      }),
    );
    expect(g.nextUp.map((x) => x.problemId)).toEqual(['x-h']);
  });

  it('weak topics before improving, both before continue/start', () => {
    const g = deriveGuidance(
      input({
        signals: sig({ graphs: [2, 2], trees: [0, 4] }),
        notes: [n('a-e1', 'done')],
      }),
    );
    expect(g.nextUp.map((x) => [x.kind, x.topicId])).toEqual([
      ['weak_topic', 'trees'],
      ['weak_topic', 'graphs'],
      ['continue', 'arrays'],
    ]);
    expect(g.nextUp[2]?.reason).toBe('arrays: 1/5 done');
  });

  it('continue picks the in-progress topic with the lowest done ratio', () => {
    const g = deriveGuidance(
      input({
        notes: [
          n('t-e1', 'done'), // trees 1/2
          n('g-e1', 'done'), // graphs 1/3
        ],
        count: 1,
      }),
    );
    expect(g.nextUp[0]).toMatchObject({
      kind: 'continue',
      topicId: 'graphs',
      problemId: 'g-m1',
      reason: 'graphs: 1/3 done',
    });
  });

  it('never repeats a problem, even multi-topic ones across topics', () => {
    const catalog = [p('both', 'easy', ['a', 'b'])];
    const g = deriveGuidance(
      input({
        problems: catalog,
        signals: sig({ a: [0, 3], b: [0, 3] }),
        count: 5,
      }),
    );
    expect(g.nextUp.map((x) => x.problemId)).toEqual(['both']);
  });

  it('a multi-topic revisit note is suggested once', () => {
    const g = deriveGuidance(
      input({ notes: [n('multi', 'to_revisit', 4)], count: 5 }),
    );
    const ids = g.nextUp.map((x) => x.problemId);
    expect(ids.filter((id) => id === 'multi')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prefers distinct topics, then fills from the same topic', () => {
    // One weak topic only, 3 slots: first pass takes 1 weak + 2 others
    // from distinct topics.
    let g = deriveGuidance(input({ signals: sig({ graphs: [0, 3] }) }));
    expect(new Set(g.nextUp.map((x) => x.topicId)).size).toBe(3);
    expect(g.nextUp[0]).toMatchObject({
      kind: 'weak_topic',
      topicId: 'graphs',
    });

    // A single-topic catalog: all slots come from that topic, no repeats.
    const catalog = [
      p('x1', 'easy', ['x']),
      p('x2', 'easy', ['x']),
      p('x3', 'medium', ['x']),
    ];
    g = deriveGuidance(
      input({ problems: catalog, signals: sig({ x: [0, 3] }) }),
    );
    expect(g.nextUp.map((x) => x.problemId)).toEqual(['x1', 'x2', 'x3']);
  });

  it('caps the count at MAX_NEXT_UP and at least 1', () => {
    expect(deriveGuidance(input({ count: 99 })).nextUp).toHaveLength(
      MAX_NEXT_UP,
    );
    expect(deriveGuidance(input({ count: 0 })).nextUp).toHaveLength(1);
    expect(deriveGuidance(input({ count: Number.NaN })).nextUp).toHaveLength(
      NEXT_UP_COUNT,
    );
  });

  it('uses the injected topicLabel in reasons', () => {
    const g = deriveGuidance(
      input({ topicLabel: (id) => id.toUpperCase(), count: 1 }),
    );
    expect(g.nextUp[0]?.reason).toBe('Start ARRAYS');
    expect(g.nextUp[0]?.topicId).toBe('arrays');
  });

  it('is deterministic for a fixed input and never mentions solutions', () => {
    const inp = input({
      notes: [n('a-e1', 'done'), n('g-e1', 'to_revisit', 3)],
      signals: sig({ trees: [0, 3], graphs: [3, 1] }),
    });
    const a = deriveGuidance(inp);
    const b = deriveGuidance(inp);
    expect(a).toEqual(b);
    // Input order of notes does not matter.
    const c = deriveGuidance({ ...inp, notes: [...inp.notes].reverse() });
    expect(c).toEqual(a);
    for (const item of a.nextUp) {
      expect(item.reason).toMatch(
        /^(Marked (to revisit|didn't understand)( .*ago| today)?|Start .+|.+: \d+\/\d+ (done|correct in quiz))$/,
      );
    }
  });
});

describe('deriveGuidance — quiz hint', () => {
  const notes = [n('a-e1', 'done')];

  it('not suggested with nothing done', () => {
    const g = deriveGuidance(input());
    expect(g.quiz).toEqual({
      doneCount: 0,
      lastQuizAt: null,
      suggested: false,
    });
  });

  it('suggested when something is done and no quiz ever', () => {
    const g = deriveGuidance(input({ notes }));
    expect(g.quiz).toEqual({ doneCount: 1, lastQuizAt: null, suggested: true });
  });

  it.each([
    [QUIZ_NUDGE_DAYS - 1, false],
    [QUIZ_NUDGE_DAYS, false],
    [QUIZ_NUDGE_DAYS + 1, true],
  ])('last quiz %i days ago → suggested %s', (age, expected) => {
    const g = deriveGuidance(
      input({ notes, signals: sig({ arrays: [1, 0, age] }) }),
    );
    expect(g.quiz.lastQuizAt).toBe(daysAgo(age));
    expect(g.quiz.suggested).toBe(expected);
  });

  it('lastQuizAt is the latest topic lastSeen', () => {
    const g = deriveGuidance(
      input({ notes, signals: sig({ arrays: [1, 0, 12], trees: [0, 1, 3] }) }),
    );
    expect(g.quiz.lastQuizAt).toBe(daysAgo(3));
    expect(g.quiz.suggested).toBe(false);
  });
});
