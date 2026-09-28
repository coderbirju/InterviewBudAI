/**
 * Custom (user-added) problem rules (ADR 0010 D2) — pure, no I/O.
 *
 * One set of field rules shared by the write side (the web layer rejects a
 * request that breaks them) and the read side (`LocalFileStorageAdapter` and
 * the web's known-id check drop or skip a file that breaks them). Files on
 * disk are untrusted (§7.3): a hand-edited file gets exactly the checks a
 * request gets.
 *
 * Topic MEMBERSHIP (the 13 curriculum topics) is not decided here — storage
 * never imports the curriculum. `parseCustomProblem` accepts an optional
 * `topic` mapper; the web passes the curriculum's canonicalise-and-filter so
 * both sides apply the same topic rule. Without one, topics only need to be
 * slug-shaped.
 */

import { randomInt } from 'node:crypto';
import type { CustomProblem, IsoTimestamp, TopicId } from './index.js';

/** Limits from ADR 0010 D5. */
export const CUSTOM_PROBLEM_LIMITS = {
  titleMax: 200,
  statementMax: 2000,
  urlMax: 2048,
  topicsMin: 1,
  topicsMax: 3,
  /** Custom problems per data dir. */
  maxProblems: 1000,
  idMax: 64,
  slugMax: 40,
} as const;

const ID_PATTERN = /^u-[a-z0-9]+(-[a-z0-9]+)*$/;
const TOPIC_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

/** True for a well-formed custom problem id (`u-…`, ≤ 64 chars, path-safe). */
export function isCustomProblemId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length <= CUSTOM_PROBLEM_LIMITS.idMax &&
    ID_PATTERN.test(id)
  );
}

/**
 * Generate a fresh id: `u-<slug>-<rand6>`. The slug is the title's
 * `[a-z0-9]` runs joined by `-` (≤ 40 chars, `problem` if empty); `rand6` is
 * six base36 characters from `crypto.randomInt`.
 */
export function generateCustomProblemId(
  title: string,
  random: (max: number) => number = randomInt,
): string {
  const runs = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let slug = runs.join('-').slice(0, CUSTOM_PROBLEM_LIMITS.slugMax);
  slug = slug.replace(/-+$/, '');
  if (slug === '') slug = 'problem';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += random(36).toString(36);
  return `u-${slug}-${suffix}`;
}

/**
 * Normalise a title: strip every C0 control (incl. newlines) and DEL, trim.
 * Returns `null` if the result is empty or longer than 200 chars.
 */
export function normalizeCustomTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const title = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (title.length === 0 || title.length > CUSTOM_PROBLEM_LIMITS.titleMax) {
    return null;
  }
  return title;
}

/**
 * Normalise a statement: strip C0 controls except tab and newline (and DEL),
 * trim. `''` means "no statement". Returns `null` when not a string or longer
 * than 2000 chars.
 */
export function normalizeCustomStatement(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const statement = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim();
  if (statement.length > CUSTOM_PROBLEM_LIMITS.statementMax) return null;
  return statement;
}

/**
 * Validate a url: parsed by `URL`, `http:` / `https:` only, no control
 * characters, ≤ 2048 chars. Returns the parsed `href`, or `null`.
 */
export function normalizeCustomUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > CUSTOM_PROBLEM_LIMITS.urlMax) {
    return null;
  }
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

/** True for a parseable timestamp string. */
function isTimestamp(value: unknown): value is IsoTimestamp {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Maps a topic id to its canonical id, or `null` to drop it. */
export type CustomTopicMapper = (topic: string) => TopicId | null;

const slugTopic: CustomTopicMapper = (topic) =>
  TOPIC_PATTERN.test(topic) ? topic : null;

/**
 * Map, de-duplicate and bound a topic list. Unknown topics are dropped;
 * returns `null` if none (or more than 3) remain.
 */
export function normalizeCustomTopics(
  raw: unknown,
  topic: CustomTopicMapper = slugTopic,
): TopicId[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TopicId[] = [];
  for (const t of raw) {
    if (typeof t !== 'string' || !TOPIC_PATTERN.test(t)) continue;
    const mapped = topic(t);
    if (mapped !== null && !out.includes(mapped)) out.push(mapped);
  }
  if (
    out.length < CUSTOM_PROBLEM_LIMITS.topicsMin ||
    out.length > CUSTOM_PROBLEM_LIMITS.topicsMax
  ) {
    return null;
  }
  return out;
}

/** Options for {@link parseCustomProblem}. */
export interface ParseCustomProblemOptions {
  /** The id the record must carry (the filename stem). */
  readonly expectedId?: string;
  /** Topic mapper (the web passes the curriculum's rule). */
  readonly topic?: CustomTopicMapper;
}

/**
 * Validate an untrusted record (e.g. a parsed file) against the ADR 0010 D2
 * rules. Invalid REQUIRED fields (id — incl. `expectedId` mismatch — title,
 * difficulty, topics, timestamps) ⇒ `null` (skip the file). An invalid
 * OPTIONAL field (`url` with another scheme such as `javascript:`, an
 * over-long `statement`) is dropped. Unknown fields are dropped. Never throws.
 */
export function parseCustomProblem(
  value: unknown,
  options: ParseCustomProblemOptions = {},
): CustomProblem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;
  if (!isCustomProblemId(v.id)) return null;
  if (options.expectedId !== undefined && v.id !== options.expectedId) {
    return null;
  }
  const title = normalizeCustomTitle(v.title);
  if (title === null) return null;
  if (typeof v.difficulty !== 'string' || !DIFFICULTIES.has(v.difficulty)) {
    return null;
  }
  const topics = normalizeCustomTopics(v.topics, options.topic);
  if (topics === null) return null;
  if (!isTimestamp(v.createdAt) || !isTimestamp(v.updatedAt)) return null;

  const url = v.url === undefined ? null : normalizeCustomUrl(v.url);
  const statement =
    v.statement === undefined ? null : normalizeCustomStatement(v.statement);
  return {
    id: v.id,
    title,
    ...(url !== null && { url }),
    ...(statement !== null && statement !== '' && { statement }),
    difficulty: v.difficulty as CustomProblem['difficulty'],
    topics,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}
