import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { normalizeDifficulty } from '../lib/api';
import type { QuizBreakdownGroup, QuizBreakdownQuestion } from '../lib/api';
import type { QuizBreakdownFlow } from '../lib/useQuizBreakdown';
import { DifficultyBadge } from './DifficultyBadge';
import { Disclosure } from './Disclosure';
import { ProblemTitleLink } from './ProblemTitleLink';

const MAX_GROUPS = 3;

/** Per-question results of one quiz session: misses first, unanswered collapsed. */
export function QuizBreakdown({
  breakdown,
  failed,
}: QuizBreakdownFlow): JSX.Element {
  if (failed) {
    return (
      <p role="status" className="text-sm text-slate-400">
        Could not load the question breakdown.
      </p>
    );
  }
  if (!breakdown) {
    return (
      <div
        className="flex items-center gap-2 text-sm text-slate-400"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading question breakdown…
      </div>
    );
  }

  const { questions, summary } = breakdown;
  const answered = questions.filter((q) => q.verdict !== 'unanswered');
  const unanswered = questions.filter((q) => q.verdict === 'unanswered');
  return (
    <section aria-label="Question breakdown" className="space-y-3 text-left">
      <SummaryLine
        label="Most misses"
        groups={summary.topics}
        questions={questions}
      />
      <SummaryLine label="Slips" groups={summary.slips} questions={questions} />
      {answered.length > 0 && (
        <ul className="space-y-2">
          {answered.map((q) => (
            <AnsweredRow key={q.number} question={q} />
          ))}
        </ul>
      )}
      {unanswered.length > 0 && (
        <Disclosure
          testId="breakdown-unanswered"
          summary={`Not answered (${unanswered.length})`}
        >
          <ul className="space-y-2">
            {unanswered.map((q) => (
              <li key={q.number}>
                <QuestionHeading question={q} />
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

function AnsweredRow({
  question,
}: {
  readonly question: QuizBreakdownQuestion;
}): JSX.Element {
  const correct = question.verdict === 'correct';
  const Icon = correct ? CheckCircle2 : AlertTriangle;
  return (
    <li
      className={`rounded-lg border p-3 ${
        correct
          ? 'border-status-done/40 bg-status-done/10'
          : 'border-status-revisit/40 bg-status-revisit/10'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <QuestionHeading question={question} />
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
            correct ? 'text-status-done' : 'text-status-revisit'
          }`}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {correct ? 'Correct' : 'Missed'}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
        {question.feedback ?? 'No feedback saved.'}
      </p>
      {question.missLabel && (
        <p className="mt-1 text-xs text-slate-400">{question.missLabel}</p>
      )}
    </li>
  );
}

function QuestionHeading({
  question,
}: {
  readonly question: QuizBreakdownQuestion;
}): JSX.Element {
  const difficulty = normalizeDifficulty(question.difficulty);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-slate-400">Q{question.number}</span>
      {question.title !== undefined ? (
        <ProblemTitleLink
          problemId={question.problemId}
          title={question.title}
          url={question.url}
        />
      ) : (
        <span className="text-slate-400">{question.problemId}</span>
      )}
      {difficulty && <DifficultyBadge difficulty={difficulty} />}
    </div>
  );
}

function SummaryLine({
  label,
  groups,
  questions,
}: {
  readonly label: string;
  readonly groups: readonly QuizBreakdownGroup[];
  readonly questions: readonly QuizBreakdownQuestion[];
}): JSX.Element | null {
  if (groups.length === 0) return null;
  const text = groups
    .slice(0, MAX_GROUPS)
    .map((g) => {
      const names = g.problemIds.map((id) => shortName(id, questions));
      return `${g.label} (${names.join(', ')})`;
    })
    .join(', ');
  return (
    <p className="text-sm text-slate-300">
      <span className="font-semibold text-status-revisit">{label}:</span> {text}
    </p>
  );
}

/** Catalog ids read as their LeetCode number; custom ids are opaque, so use the title. */
function shortName(
  problemId: string,
  questions: readonly QuizBreakdownQuestion[],
): string {
  if (problemId.startsWith('lc-')) return problemId.slice('lc-'.length);
  return questions.find((q) => q.problemId === problemId)?.title ?? problemId;
}
