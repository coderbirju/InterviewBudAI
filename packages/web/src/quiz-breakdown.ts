// Pure builder behind the read-only `GET /api/quiz/session/:id` (no I/O, no model call).

import type {
  MissCode,
  QuizSession,
  QuizVerdict,
  TopicId,
} from '@ibai/storage';
import { MISS_CODES } from '@ibai/storage';
import { compareTopics, topicLabel } from '@ibai/curriculum';
import type { ProblemView } from './problems.js';
import { MISS_LABELS } from './miss-labels.js';
import { questionMiss } from './quiz.js';

export type BreakdownVerdict = QuizVerdict | 'unanswered';

export interface ApiQuizBreakdownQuestion {
  /** 1-based deck position. */
  readonly number: number;
  readonly problemId: string;
  readonly title?: string;
  readonly difficulty?: ProblemView['difficulty'];
  readonly url?: string;
  readonly verdict: BreakdownVerdict;
  readonly feedback: string | null;
  readonly miss?: MissCode;
  readonly missLabel?: string;
}

export interface ApiQuizBreakdownGroup<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly problemIds: readonly string[];
}

export interface QuizBreakdown {
  readonly correct: number;
  readonly incorrect: number;
  readonly questions: readonly ApiQuizBreakdownQuestion[];
  readonly summary: {
    readonly topics: readonly ApiQuizBreakdownGroup<TopicId>[];
    readonly slips: readonly ApiQuizBreakdownGroup<MissCode>[];
  };
}

interface GradedAnswer {
  readonly verdict: QuizVerdict;
  readonly feedback: string | null;
  readonly miss: MissCode | undefined;
}

const VERDICT_RANK: Readonly<Record<BreakdownVerdict, number>> = {
  incorrect: 0,
  correct: 1,
  unanswered: 2,
};

/** Pair each answer record, in order, with its terminal user + assistant turns. */
function gradedAnswers(session: QuizSession): Map<string, GradedAnswer[]> {
  const t = session.transcript;
  const byProblem = new Map<string, GradedAnswer[]>();
  let cursor = 0;
  for (const { problemId, verdict, at, miss } of session.answered) {
    const isPair = (i: number): boolean =>
      t[i]?.role === 'user' &&
      t[i]?.at === at &&
      t[i + 1]?.role === 'assistant' &&
      t[i + 1]?.at === at;
    let i = cursor;
    while (i < t.length && !isPair(i)) i++;
    const found = i < t.length;
    if (found) {
      // A probe pair can share the terminal pair's `at`; the last one is terminal.
      while (isPair(i + 2)) i += 2;
      cursor = i + 2;
    }
    const answer: GradedAnswer = {
      verdict,
      feedback: found ? t[i + 1]!.content : null,
      // Files written before `answered[].miss` carry a code on the probe only.
      miss: questionMiss(miss, found ? t[i - 1]?.miss : undefined),
    };
    byProblem.set(problemId, [...(byProblem.get(problemId) ?? []), answer]);
  }
  return byProblem;
}

function addTo<Id extends string>(
  groups: Map<Id, string[]>,
  id: Id,
  problemId: string,
): void {
  const ids = groups.get(id) ?? [];
  if (!ids.includes(problemId)) groups.set(id, [...ids, problemId]);
}

function rankGroups<Id extends string>(
  groups: ReadonlyMap<Id, readonly string[]>,
  label: (id: Id) => string,
  tieBreak: (a: Id, b: Id) => number,
): ApiQuizBreakdownGroup<Id>[] {
  return [...groups]
    .map(([id, problemIds]) => ({ id, label: label(id), problemIds }))
    .sort(
      (a, b) =>
        b.problemIds.length - a.problemIds.length || tieBreak(a.id, b.id),
    );
}

/** Per-question breakdown of a session: misses first, then correct, then unanswered. */
export function sessionBreakdown(
  session: QuizSession,
  getById: (problemId: string) => ProblemView | undefined,
): QuizBreakdown {
  const answers = gradedAnswers(session);
  const topics = new Map<TopicId, string[]>();
  const slips = new Map<MissCode, string[]>();
  const tally = { correct: 0, incorrect: 0, unanswered: 0 };

  const questions = session.deck.map(
    (problemId, index): ApiQuizBreakdownQuestion => {
      const problem = getById(problemId);
      const answer = answers.get(problemId)?.shift();
      const verdict = answer?.verdict ?? 'unanswered';
      const miss = answer?.miss;
      tally[verdict]++;
      if (verdict === 'incorrect') {
        for (const id of problem?.topics ?? []) addTo(topics, id, problemId);
        if (miss) addTo(slips, miss, problemId);
      }
      return {
        number: index + 1,
        problemId,
        ...(problem && {
          title: problem.title,
          difficulty: problem.difficulty,
        }),
        ...(problem?.url !== undefined && { url: problem.url }),
        verdict,
        feedback: answer?.feedback ?? null,
        ...(miss && { miss, missLabel: MISS_LABELS[miss] }),
      };
    },
  );
  questions.sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]);

  return {
    correct: tally.correct,
    incorrect: tally.incorrect,
    questions,
    summary: {
      topics: rankGroups(topics, topicLabel, compareTopics),
      slips: rankGroups(
        slips,
        (code) => MISS_LABELS[code],
        (a, b) => MISS_CODES.indexOf(a) - MISS_CODES.indexOf(b),
      ),
    },
  };
}
