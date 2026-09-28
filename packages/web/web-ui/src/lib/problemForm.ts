/**
 * Client-side validation for the custom-problem form (ADR 0010 D5). Pure; it
 * mirrors the server's normalisation and limits so most mistakes are caught
 * before a request — the server stays authoritative (its 400/409 messages are
 * shown inline too).
 */

import { CUSTOM_PROBLEM_LIMITS } from './api';
import type { ProblemInput, WireDifficulty } from './api';

/** What the form holds (raw strings as typed). */
export interface ProblemFormValues {
  readonly title: string;
  readonly url: string;
  readonly statement: string;
  readonly difficulty: WireDifficulty;
  readonly topics: readonly string[];
}

export type ProblemFormField = 'title' | 'url' | 'statement' | 'topics';
export type ProblemFormErrors = Partial<Record<ProblemFormField, string>>;

/** The server's title rule: one line, controls stripped, whitespace collapsed. */
export function normalizeTitleInput(raw: string): string {
  return (
    raw
      .replace(/[\t\r\n]/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** The server's statement rule: controls except tab/newline stripped, trimmed. */
export function normalizeStatementInput(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
}

/** A valid http(s) url (normalised `href`), `''` for none, or `null` if invalid. */
export function normalizeUrlInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed.length > CUSTOM_PROBLEM_LIMITS.urlMax) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.href.length > CUSTOM_PROBLEM_LIMITS.urlMax) return null;
  return url.href;
}

/**
 * Validate the form. `knownTopics` is the 13 topic ids from `/api/catalog`.
 * Returns field errors, or the normalised create input when there are none.
 */
export function validateProblemForm(
  values: ProblemFormValues,
  knownTopics: ReadonlySet<string>,
):
  | { readonly ok: true; readonly input: ProblemInput }
  | { readonly ok: false; readonly errors: ProblemFormErrors } {
  const errors: ProblemFormErrors = {};
  const title = normalizeTitleInput(values.title);
  if (title === '') {
    errors.title = 'Enter a title.';
  } else if (title.length > CUSTOM_PROBLEM_LIMITS.titleMax) {
    errors.title = `Keep the title to ${CUSTOM_PROBLEM_LIMITS.titleMax} characters or fewer.`;
  }
  const url = normalizeUrlInput(values.url);
  if (url === null) {
    errors.url = `Use a full http:// or https:// link (at most ${CUSTOM_PROBLEM_LIMITS.urlMax} characters), or leave it empty.`;
  }
  const statement = normalizeStatementInput(values.statement);
  if (statement.length > CUSTOM_PROBLEM_LIMITS.statementMax) {
    errors.statement = `Keep the statement to ${CUSTOM_PROBLEM_LIMITS.statementMax} characters or fewer.`;
  }
  const topics = [...new Set(values.topics)].filter((t) => knownTopics.has(t));
  if (
    topics.length < CUSTOM_PROBLEM_LIMITS.topicsMin ||
    topics.length > CUSTOM_PROBLEM_LIMITS.topicsMax
  ) {
    errors.topics = `Choose ${CUSTOM_PROBLEM_LIMITS.topicsMin}–${CUSTOM_PROBLEM_LIMITS.topicsMax} topics.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      title,
      ...(url ? { url } : {}),
      ...(statement !== '' && { statement }),
      difficulty: values.difficulty,
      topics,
    },
  };
}

/** Map a server 400 message to the field it is about (else a form error). */
export function fieldForServerError(message: string): ProblemFormField | null {
  const m = message.toLowerCase();
  if (m.startsWith('title')) return 'title';
  if (m.startsWith('url')) return 'url';
  if (m.startsWith('statement')) return 'statement';
  if (m.includes('topic')) return 'topics';
  return null;
}
