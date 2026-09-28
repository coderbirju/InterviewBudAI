import { useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  CUSTOM_PROBLEM_LIMITS,
  ProblemApiError,
  createProblem,
  updateProblem,
} from '../lib/api';
import type {
  CustomProblem,
  DuplicateProblem,
  WireDifficulty,
} from '../lib/api';
import {
  fieldForServerError,
  normalizeStatementInput,
  normalizeTitleInput,
  validateProblemForm,
} from '../lib/problemForm';
import type { ProblemFormErrors, ProblemFormValues } from '../lib/problemForm';
import { navigate, notesHref } from '../lib/router';
import { Modal, confirmDiscard } from './Modal';

/** A topic choice: id + curriculum label (from `/api/catalog`). */
export interface TopicOption {
  readonly id: string;
  readonly label: string;
}

const INPUT =
  'mt-1 w-full rounded-md border bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

function inputClass(invalid: boolean): string {
  return `${INPUT} ${invalid ? 'border-status-blocked' : 'border-slate-700'}`;
}

/**
 * The add / edit form for a custom problem (ADR 0010 D5) in an accessible
 * modal. Client-side checks mirror the server limits; server errors show
 * inline. A duplicate 409 offers "open it instead" (a link to the existing
 * problem's notes) and, for a title-only match, "Add anyway"
 * (`allowSimilarTitle`). All text renders through React (escaped).
 */
export function ProblemForm({
  mode,
  topics,
  initial,
  problemId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  topics: readonly TopicOption[];
  initial?: Partial<ProblemFormValues>;
  /** Required for `edit`. */
  problemId?: string;
  onClose: () => void;
  onSaved: (problem: CustomProblem) => void;
}): JSX.Element {
  const [start] = useState<ProblemFormValues>(() => ({
    title: initial?.title ?? '',
    url: initial?.url ?? '',
    statement: initial?.statement ?? '',
    difficulty: initial?.difficulty ?? 'medium',
    topics: initial?.topics ?? [],
  }));
  const [values, setValues] = useState<ProblemFormValues>(start);
  const [errors, setErrors] = useState<ProblemFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{
    readonly problem: DuplicateProblem;
    readonly overridable: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const known = new Set(topics.map((t) => t.id));

  function update<K extends keyof ProblemFormValues>(
    key: K,
    value: ProblemFormValues[K],
  ): void {
    setValues((v) => ({ ...v, [key]: value }));
    setDuplicate(null);
    setFormError(null);
    if (key !== 'difficulty') {
      setErrors((e) => ({ ...e, [key]: undefined }));
    }
  }

  function toggleTopic(id: string): void {
    update(
      'topics',
      values.topics.includes(id)
        ? values.topics.filter((t) => t !== id)
        : [...values.topics, id],
    );
  }

  async function submit(allowSimilarTitle: boolean): Promise<void> {
    const checked = validateProblemForm(values, known);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setDuplicate(null);
    setBusy(true);
    try {
      const { input } = checked;
      const saved =
        mode === 'create'
          ? await createProblem(input, { allowSimilarTitle })
          : await updateProblem(
              problemId ?? '',
              {
                title: input.title,
                url: input.url ?? null,
                statement: input.statement ?? null,
                difficulty: input.difficulty,
                topics: input.topics,
              },
              { allowSimilarTitle },
            );
      onSaved(saved);
    } catch (err) {
      if (err instanceof ProblemApiError && err.duplicate) {
        setDuplicate({ problem: err.duplicate, overridable: err.overridable });
      } else if (err instanceof ProblemApiError && err.status === 400) {
        const field = fieldForServerError(err.message);
        if (field) setErrors({ [field]: err.message });
        else setFormError(err.message);
      } else {
        setFormError(
          err instanceof ProblemApiError
            ? err.message
            : 'Could not reach the local API. Please try again.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const titleLength = normalizeTitleInput(values.title).length;
  const statementLength = normalizeStatementInput(values.statement).length;
  const atTopicMax = values.topics.length >= CUSTOM_PROBLEM_LIMITS.topicsMax;
  const dirty =
    values.title !== start.title ||
    values.url !== start.url ||
    values.statement !== start.statement ||
    values.difficulty !== start.difficulty ||
    values.topics.length !== start.topics.length ||
    values.topics.some((t) => !start.topics.includes(t));

  function cancel(): void {
    if (dirty && !confirmDiscard()) return;
    onClose();
  }

  return (
    <Modal
      title={mode === 'create' ? 'Add a problem' : 'Edit problem'}
      onClose={onClose}
      initialFocus={titleRef}
      dirty={dirty}
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <div>
          <label
            htmlFor="problem-title"
            className="block text-sm font-semibold text-slate-300"
          >
            Title
          </label>
          <input
            ref={titleRef}
            id="problem-title"
            type="text"
            value={values.title}
            onChange={(e) => update('title', e.target.value)}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby="problem-title-hint"
            className={inputClass(Boolean(errors.title))}
          />
          <p
            id="problem-title-hint"
            className={`mt-1 text-xs ${errors.title ? 'text-status-blocked' : 'text-slate-500'}`}
          >
            {errors.title ??
              `${titleLength} / ${CUSTOM_PROBLEM_LIMITS.titleMax}`}
          </p>
        </div>

        <div>
          <label
            htmlFor="problem-url"
            className="block text-sm font-semibold text-slate-300"
          >
            Link <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id="problem-url"
            type="url"
            inputMode="url"
            value={values.url}
            placeholder="https://…"
            onChange={(e) => update('url', e.target.value)}
            aria-invalid={errors.url ? true : undefined}
            aria-describedby={errors.url ? 'problem-url-error' : undefined}
            className={inputClass(Boolean(errors.url))}
          />
          {errors.url && (
            <p
              id="problem-url-error"
              className="mt-1 text-xs text-status-blocked"
            >
              {errors.url}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="problem-difficulty"
            className="block text-sm font-semibold text-slate-300"
          >
            Difficulty
          </label>
          <select
            id="problem-difficulty"
            value={values.difficulty}
            onChange={(e) =>
              update('difficulty', e.target.value as WireDifficulty)
            }
            className={inputClass(false)}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        <fieldset aria-describedby="problem-topics-hint">
          <legend className="text-sm font-semibold text-slate-300">
            Topics
          </legend>
          <p
            id="problem-topics-hint"
            className={`text-xs ${errors.topics ? 'text-status-blocked' : 'text-slate-500'}`}
          >
            {errors.topics ??
              `Choose ${CUSTOM_PROBLEM_LIMITS.topicsMin}–${CUSTOM_PROBLEM_LIMITS.topicsMax}.`}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {topics.map((t) => {
              const checked = values.topics.includes(t.id);
              return (
                <label
                  key={t.id}
                  className={`flex items-center gap-2 text-sm ${
                    !checked && atTopicMax ? 'text-slate-500' : 'text-slate-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && atTopicMax}
                    onChange={() => toggleTopic(t.id)}
                    className="accent-emerald-500"
                  />
                  {t.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label
            htmlFor="problem-statement"
            className="block text-sm font-semibold text-slate-300"
          >
            Problem statement{' '}
            <span className="font-normal text-slate-500">
              (optional, plain text — not an answer)
            </span>
          </label>
          <textarea
            id="problem-statement"
            rows={5}
            value={values.statement}
            onChange={(e) => update('statement', e.target.value)}
            aria-invalid={errors.statement ? true : undefined}
            aria-describedby="problem-statement-hint"
            className={`${inputClass(Boolean(errors.statement))} resize-y`}
          />
          <p
            id="problem-statement-hint"
            className={`mt-1 text-xs ${errors.statement ? 'text-status-blocked' : 'text-slate-500'}`}
          >
            {errors.statement ??
              `${statementLength} / ${CUSTOM_PROBLEM_LIMITS.statementMax}`}
          </p>
        </div>

        {duplicate && (
          <div
            role="alert"
            className="rounded-md border border-status-revisit/40 bg-status-revisit/10 px-3 py-2 text-sm text-slate-200"
          >
            <p>
              This looks like{' '}
              <span className="font-semibold">{duplicate.problem.title}</span> —{' '}
              <a
                href={notesHref(duplicate.problem.problemId)}
                onClick={(e) => {
                  e.preventDefault();
                  onClose();
                  navigate(notesHref(duplicate.problem.problemId));
                }}
                className="font-medium text-emerald-400 underline hover:text-emerald-300"
              >
                open it instead
              </a>
              .
            </p>
            {duplicate.overridable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit(true)}
                className="mt-2 rounded-md border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200 transition-all duration-200 hover:bg-slate-800 disabled:opacity-60"
              >
                {mode === 'create' ? 'Add anyway' : 'Save anyway'}
              </button>
            )}
          </div>
        )}

        {formError && (
          <p
            role="alert"
            className="flex items-center gap-1.5 text-sm text-status-blocked"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {formError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={cancel}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-all duration-200 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {mode === 'create' ? 'Add problem' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
