/**
 * Routes for the "Check my intuition" coach and practice trends (ADR 0013
 * D2/D3):
 *
 *   POST /api/notes/:id/check  — coach the editor's CURRENT text (one shot)
 *   GET  /api/practice         — practice trends from the practice log only
 *   POST /api/practice/reset   — backup first, then delete the practice log
 *
 * Nothing in a check's feedback is persisted: not the note sent, not the
 * reply text. Only the structured outcome goes to `practice-signals.json`.
 * Quiz files and `/api/insights` are never read or written here.
 */

import type {
  IsoTimestamp,
  NoteStatus,
  PracticeEvent,
  PracticeSignals,
  StorageAdapter,
} from '@ibai/storage';
import {
  containsReferenceMarker,
  isNoteStatus,
  splitReferenceSection,
} from '@ibai/storage';
import { canonicalTopicId } from '@ibai/curriculum';
import type { CurriculumSource } from '@ibai/curriculum';
import type { LlmProvider, PromptMessage } from '@ibai/providers';
import type { HandlerResponse } from './handler.js';
import { createBackup } from './import/backup.js';
import { loadProblemSource } from './problems.js';
import { MISS_LABELS } from './miss-labels.js';
import {
  COACH_MAX_TOKENS,
  COACH_MIN_INTERVAL_MS,
  CoachReplyError,
  buildCheckPrompt,
  parseCoachReply,
  withCoachRetryReminder,
} from './coach-check.js';
import type {
  CoachGuardContext,
  CoachReply,
  CoachTruncated,
} from './coach-check.js';
import { buildPractice } from './practice.js';

// ---------------------------------------------------------------------------
// Rate limit (per process, the `testProvider` pattern)
// ---------------------------------------------------------------------------

/** Outcome of {@link CoachLimiter.tryStart}. */
export type CoachStart =
  | { readonly ok: true; readonly done: () => void }
  | { readonly ok: false; readonly retryAfterMs: number };

/** One check in flight, ≥ `minIntervalMs` between the starts of two checks. */
export interface CoachLimiter {
  tryStart(): CoachStart;
}

/**
 * Build the per-process limiter (ADR 0013 D2). Refusal: while a check is in
 * flight, `retryAfterMs` is the remaining minimum interval, or 1000 once it
 * has passed; otherwise the remaining interval.
 */
export function createCoachLimiter(
  opts: { readonly clock?: () => number; readonly minIntervalMs?: number } = {},
): CoachLimiter {
  const clock = opts.clock ?? Date.now;
  const minIntervalMs = opts.minIntervalMs ?? COACH_MIN_INTERVAL_MS;
  let lastStartedAt: number | undefined;
  let inFlight = false;
  return {
    tryStart(): CoachStart {
      const now = clock();
      const remaining =
        lastStartedAt === undefined
          ? 0
          : Math.max(0, minIntervalMs - (now - lastStartedAt));
      if (inFlight) {
        return { ok: false, retryAfterMs: remaining > 0 ? remaining : 1000 };
      }
      if (remaining > 0) return { ok: false, retryAfterMs: remaining };
      lastStartedAt = now;
      inFlight = true;
      let released = false;
      return {
        ok: true,
        done: () => {
          if (!released) {
            released = true;
            inFlight = false;
          }
        },
      };
    },
  };
}

/** Fallback for callers that inject none (the handler always does). */
const DEFAULT_LIMITER = createCoachLimiter();

// ---------------------------------------------------------------------------
// Deps + helpers
// ---------------------------------------------------------------------------

/** What these routes need from the API layer. */
export interface CoachRouteDeps {
  readonly catalog: CurriculumSource;
  readonly dataDir: string;
  /** Storage for `dataDir`, or null when the folder does not exist. */
  readonly storage: StorageAdapter | null;
  readonly provider?: LlmProvider;
  readonly now?: () => Date;
  readonly limiter?: CoachLimiter;
  /** Maps a provider error to the shared 503/502 body (quiz classifier). */
  readonly providerError: (error: unknown) => HandlerResponse;
  readonly backup?: (dataDir: string, now: Date) => Promise<string>;
  /**
   * ADR 0009 D4 read-only state of the data folder: its format version when
   * it must not be written, else null. Absent ⇒ writable.
   */
  readonly readOnlyFormat?: () => number | null;
}

function json(status: number, payload: unknown): HandlerResponse {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  };
}

const METHOD_NOT_ALLOWED = (): HandlerResponse =>
  json(405, { error: 'method not allowed' });

/** Longest accepted text field in the check body (ADR 0013 D2). */
export const CHECK_FIELD_MAX = 50_000;

/** Confirm token for `POST /api/practice/reset` (ADR 0013 D3). */
export const PRACTICE_RESET_CONFIRM = 'reset-practice';

const CHECK_PATH = /^\/api\/notes\/([^/]+)\/check$/;

/** Is this a path these routes own? */
export function isCoachRoute(pathname: string): boolean {
  return (
    CHECK_PATH.test(pathname) ||
    pathname === '/api/practice' ||
    pathname === '/api/practice/reset'
  );
}

/** Parse a JSON object body, or null. */
function parseObject(body: string | undefined): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? '');
  } catch {
    return null;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/**
 * Remove every reference-marker section from the request's content with the
 * ONE shared split (ADR 0013 D2/D4). Prompt-side only: nothing is written.
 */
export function stripMarkerSections(content: string): string {
  let out = content;
  while (containsReferenceMarker(out)) {
    out = splitReferenceSection(out).content;
  }
  return out;
}

interface CheckInput {
  readonly content: string;
  readonly timeComplexity?: string;
  readonly spaceComplexity?: string;
  readonly referenceApproach?: string;
  readonly status: NoteStatus;
}

/** Validate the untrusted check body; a 400 response on failure. */
function parseCheckBody(
  body: string | undefined,
): { ok: true; input: CheckInput } | { ok: false; res: HandlerResponse } {
  const input = parseObject(body);
  const invalid = (error: string) =>
    ({ ok: false, res: json(400, { error, code: 'invalid_body' }) }) as const;
  if (input === null) return invalid('invalid JSON body');
  for (const key of [
    'content',
    'timeComplexity',
    'spaceComplexity',
    'referenceApproach',
  ] as const) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof v !== 'string') return invalid(`${key} must be a string`);
    if (v.length > CHECK_FIELD_MAX) {
      return invalid(`${key} must be at most ${CHECK_FIELD_MAX} characters`);
    }
  }
  if (input.status !== undefined && !isNoteStatus(input.status)) {
    return invalid('invalid status');
  }
  const content =
    typeof input.content === 'string' ? stripMarkerSections(input.content) : '';
  if (content.trim().length === 0) {
    return {
      ok: false,
      res: json(400, {
        error: 'Write your intuition first.',
        code: 'empty_note',
      }),
    };
  }
  const opt = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v : undefined;
  const time = opt(input.timeComplexity);
  const space = opt(input.spaceComplexity);
  const reference = opt(input.referenceApproach);
  return {
    ok: true,
    input: {
      content,
      ...(time !== undefined && { timeComplexity: time }),
      ...(space !== undefined && { spaceComplexity: space }),
      ...(reference !== undefined && { referenceApproach: reference }),
      status: isNoteStatus(input.status) ? input.status : 'none',
    },
  };
}

/** Empty completions count as unreadable (the quiz rule). */
function rejectionOf(error: unknown): CoachReplyError | null {
  if (error instanceof CoachReplyError) return error;
  if (
    error instanceof Error &&
    error.message.includes('returned an empty response')
  ) {
    return new CoachReplyError('malformed', 'empty reply');
  }
  return null;
}

/**
 * Ask the model (JSON mode, bounded reply). A malformed or leaking reply
 * gets ONE retry with the matching reminder; a second failure throws the
 * {@link CoachReplyError}. Transport errors propagate at once. ≤ 2 calls.
 */
async function askCoach(
  provider: LlmProvider,
  messages: readonly PromptMessage[],
  guard: CoachGuardContext,
): Promise<CoachReply> {
  const options = {
    responseFormat: 'json',
    maxTokens: COACH_MAX_TOKENS,
  } as const;
  const ask = async (prompt: readonly PromptMessage[]): Promise<CoachReply> => {
    const res = await provider.complete({ messages: prompt, options });
    return parseCoachReply(
      typeof res.content === 'string' ? res.content : '',
      guard,
    );
  };
  try {
    return await ask(messages);
  } catch (error) {
    const rejected = rejectionOf(error);
    if (rejected === null) throw error;
    try {
      return await ask(withCoachRetryReminder(messages, rejected.kind));
    } catch (second) {
      throw rejectionOf(second) ?? second;
    }
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Handle a coach/practice route, or return null when the path is not ours. */
export async function handleCoachRoute(
  method: string,
  pathname: string,
  deps: CoachRouteDeps,
  body: string | undefined,
): Promise<HandlerResponse | null> {
  const check = CHECK_PATH.exec(pathname);
  if (check !== null) {
    if (method !== 'POST') return METHOD_NOT_ALLOWED();
    return handleCheck(decodeURIComponent(check[1]!), deps, body);
  }
  if (pathname === '/api/practice') {
    if (method !== 'GET') return METHOD_NOT_ALLOWED();
    return json(200, await readPractice(deps));
  }
  if (pathname === '/api/practice/reset') {
    if (method !== 'POST') return METHOD_NOT_ALLOWED();
    return resetPractice(deps, body);
  }
  return null;
}

/** `POST /api/notes/:id/check` (ADR 0013 D2). */
async function handleCheck(
  problemId: string,
  deps: CoachRouteDeps,
  body: string | undefined,
): Promise<HandlerResponse> {
  const { storage } = deps;
  const problem = (await loadProblemSource(deps.catalog, storage)).getById(
    problemId,
  );
  if (!problem) {
    return json(404, { error: 'unknown problem', problemId });
  }
  if (!deps.provider) {
    return json(400, { error: 'no model configured', code: 'no_provider' });
  }
  const parsed = parseCheckBody(body);
  if (!parsed.ok) return parsed.res;
  const ctx = parsed.input;

  const start = (deps.limiter ?? DEFAULT_LIMITER).tryStart();
  if (!start.ok) {
    return json(429, {
      error: 'One check at a time — try again in a moment.',
      code: 'rate_limited',
      retryAfterMs: start.retryAfterMs,
    });
  }
  let reply: CoachReply;
  let truncated: CoachTruncated;
  try {
    const prompt = buildCheckPrompt({
      problem,
      note: ctx.content,
      ...pick(ctx),
    });
    truncated = prompt.truncated;
    reply = await askCoach(deps.provider, prompt.messages, {
      note: ctx.content,
      title: problem.title,
      topics: problem.topics,
      ...(ctx.referenceApproach !== undefined && {
        referenceApproach: ctx.referenceApproach,
      }),
    });
  } catch (error) {
    if (error instanceof CoachReplyError) {
      return json(502, {
        error: 'The model gave an unusable reply. Try again.',
      });
    }
    return deps.providerError(error);
  } finally {
    start.done();
  }

  const checkedAt = (
    deps.now ?? (() => new Date())
  )().toISOString() as IsoTimestamp;
  // Record the STRUCTURED outcome only. A missing or read-only folder never
  // blocks the check: the reply then says `recorded: false`.
  let recorded = false;
  let firstCheck = false;
  if (storage?.appendPracticeEvent && deps.readOnlyFormat?.() == null) {
    const topics: string[] = [];
    for (const t of problem.topics) {
      const id = canonicalTopicId(t);
      if (id !== null && !topics.includes(id)) topics.push(id);
    }
    const event: PracticeEvent = {
      problemId,
      topics: topics.slice(0, 5),
      assessment: reply.assessment,
      readyToCode: reply.readyToCode,
      ...(reply.miss !== undefined && { miss: reply.miss }),
      status: ctx.status,
      first: false, // decided by the adapter from its `seen` set
      at: checkedAt,
    };
    try {
      const after = await storage.appendPracticeEvent(event);
      recorded = true;
      firstCheck = after.events[after.events.length - 1]?.first === true;
    } catch {
      recorded = false;
    }
  }
  return json(200, {
    assessment: reply.assessment,
    questions: reply.questions,
    readyToCode: reply.readyToCode,
    note: reply.note,
    ...(reply.miss !== undefined && {
      miss: reply.miss,
      missLabel: MISS_LABELS[reply.miss],
    }),
    firstCheck,
    truncated,
    checkedAt,
    recorded,
  });
}

function pick(ctx: CheckInput): {
  timeComplexity?: string;
  spaceComplexity?: string;
  referenceApproach?: string;
} {
  return {
    ...(ctx.timeComplexity !== undefined && {
      timeComplexity: ctx.timeComplexity,
    }),
    ...(ctx.spaceComplexity !== undefined && {
      spaceComplexity: ctx.spaceComplexity,
    }),
    ...(ctx.referenceApproach !== undefined && {
      referenceApproach: ctx.referenceApproach,
    }),
  };
}

/** `GET /api/practice` (ADR 0013 D3). Read-only; never throws. */
async function readPractice(deps: CoachRouteDeps) {
  const now = (deps.now ?? (() => new Date()))().toISOString() as IsoTimestamp;
  if (deps.storage === null) return buildPractice(undefined, now);
  let signals: PracticeSignals | null = null;
  if (deps.storage.readPracticeSignals) {
    try {
      signals = await deps.storage.readPracticeSignals();
    } catch {
      signals = null;
    }
  }
  return buildPractice(signals, now);
}

/** `POST /api/practice/reset` (ADR 0013 D3). */
async function resetPractice(
  deps: CoachRouteDeps,
  body: string | undefined,
): Promise<HandlerResponse> {
  const { storage } = deps;
  if (storage === null) {
    return json(400, { error: 'no database configured' });
  }
  const input = parseObject(body);
  if (input === null || input.confirm !== PRACTICE_RESET_CONFIRM) {
    return json(400, {
      error: `confirm must be "${PRACTICE_RESET_CONFIRM}"`,
      code: 'invalid_body',
    });
  }
  const format = deps.readOnlyFormat?.() ?? null;
  if (format !== null) {
    return json(409, {
      error: `This folder is read-only (format v${format}).`,
      code: 'read_only',
    });
  }
  if (!storage.resetPracticeSignals) {
    return json(501, { error: 'this storage cannot reset practice history' });
  }
  // ADR 0009 D3: snapshot FIRST, inside the practice write queue (so a
  // concurrent append is either in the backup or after the reset); a failed
  // backup deletes nothing.
  let backup: string | undefined;
  try {
    await storage.resetPracticeSignals(async () => {
      backup = await (deps.backup ?? createBackup)(
        deps.dataDir,
        (deps.now ?? (() => new Date()))(),
      );
    });
  } catch {
    if (backup === undefined) {
      return json(500, {
        error: 'Could not save a backup; practice history was not reset.',
        code: 'backup_failed',
      });
    }
    return json(500, {
      error: 'Could not reset practice history.',
      code: 'reset_failed',
      backup,
    });
  }
  if (backup === undefined) {
    // An adapter that ignored `beforeDelete` must not pass as backed up.
    return json(500, {
      error: 'Could not reset practice history.',
      code: 'reset_failed',
    });
  }
  return json(200, { reset: true, backup });
}
