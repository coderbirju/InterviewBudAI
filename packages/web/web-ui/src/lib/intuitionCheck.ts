/**
 * Typed client for `POST /api/notes/:id/check` — the "Check my intuition"
 * coach (ADR 0013 D2). The request carries the editor's CURRENT text (unsaved
 * edits included); the server never reads the saved note to fill gaps.
 *
 * Nothing here is persisted: the reply is returned to the caller and lives
 * only in component state (ADR 0013 D5 — not even localStorage).
 */
import { ApiError } from './api';
import type { MissCode, NoteStatus } from './api';

/** The coach's verdict on the note (ADR 0013 D1). */
export type CoachAssessment = 'on_track' | 'partial' | 'off_track';

const ASSESSMENTS: readonly CoachAssessment[] = [
  'on_track',
  'partial',
  'off_track',
];

/** Request body (ADR 0013 D2). Absent optional fields count as absent. */
export interface IntuitionCheckInput {
  readonly content: string;
  readonly timeComplexity?: string;
  readonly spaceComplexity?: string;
  readonly referenceApproach?: string;
  readonly status?: NoteStatus;
}

/** Which inputs the server cut to fit the prompt budget. */
export interface IntuitionCheckTruncated {
  readonly note: boolean;
  readonly reference: boolean;
  readonly statement: boolean;
}

/** `200` response (ADR 0013 D2). `miss` and `missLabel` are absent together. */
export interface IntuitionCheckResult {
  readonly assessment: CoachAssessment;
  /** 0–3 on `on_track`, else 1–3. */
  readonly questions: readonly string[];
  readonly readyToCode: boolean;
  /** One short sentence; `''` allowed. */
  readonly note: string;
  readonly miss?: MissCode | string;
  readonly missLabel?: string;
  readonly firstCheck: boolean;
  readonly truncated: IntuitionCheckTruncated;
  readonly checkedAt: string;
  readonly recorded: boolean;
}

/** The machine-readable error codes of the check route (ADR 0013 D2). */
export type IntuitionCheckErrorCode =
  | 'empty_note'
  | 'invalid_body'
  | 'no_provider'
  | 'rate_limited'
  | 'model_unavailable';

const ERROR_CODES: readonly IntuitionCheckErrorCode[] = [
  'empty_note',
  'invalid_body',
  'no_provider',
  'rate_limited',
  'model_unavailable',
];

/**
 * A non-2xx reply from the check route. Extends `ApiError` (so `status`,
 * `extra.code/detail/hint` work as elsewhere) and adds the typed `code` and
 * the 429 `retryAfterMs`.
 */
export class IntuitionCheckError extends ApiError {
  constructor(
    message: string,
    status: number,
    readonly code: IntuitionCheckErrorCode | undefined,
    readonly retryAfterMs: number | undefined,
    extra: { readonly detail?: string; readonly hint?: string } = {},
  ) {
    super(message, status, {
      ...(code !== undefined && { code }),
      ...extra,
    });
    this.name = 'IntuitionCheckError';
  }
}

/** A `200` body that does not match the D2 shape (treated like a `502`). */
export const MALFORMED_REPLY_STATUS = 502;

function optionalText(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

/** Build the wire body: only non-blank optional fields are sent. */
export function buildCheckBody(
  input: IntuitionCheckInput,
): Record<string, string> {
  const body: Record<string, string> = { content: input.content };
  const time = optionalText(input.timeComplexity);
  const space = optionalText(input.spaceComplexity);
  const reference = optionalText(input.referenceApproach);
  if (time !== undefined) body.timeComplexity = time;
  if (space !== undefined) body.spaceComplexity = space;
  if (reference !== undefined) body.referenceApproach = reference;
  if (input.status !== undefined) body.status = input.status;
  return body;
}

/**
 * Validate a `200` body defensively (model-derived text is untrusted). Returns
 * null when the shape is unusable.
 */
export function normalizeCheckResult(
  raw: unknown,
): IntuitionCheckResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const assessment = data.assessment;
  if (
    typeof assessment !== 'string' ||
    !ASSESSMENTS.includes(assessment as CoachAssessment)
  ) {
    return null;
  }
  const questions = Array.isArray(data.questions)
    ? data.questions
        .filter((q): q is string => typeof q === 'string' && q.trim() !== '')
        .slice(0, 3)
    : [];
  const truncatedRaw =
    typeof data.truncated === 'object' && data.truncated !== null
      ? (data.truncated as Record<string, unknown>)
      : {};
  const hasMiss =
    typeof data.miss === 'string' && typeof data.missLabel === 'string';
  return {
    assessment: assessment as CoachAssessment,
    questions,
    readyToCode: assessment === 'on_track' && data.readyToCode === true,
    note: typeof data.note === 'string' ? data.note : '',
    ...(hasMiss && {
      miss: data.miss as string,
      missLabel: data.missLabel as string,
    }),
    firstCheck: data.firstCheck === true,
    truncated: {
      note: truncatedRaw.note === true,
      reference: truncatedRaw.reference === true,
      statement: truncatedRaw.statement === true,
    },
    checkedAt: typeof data.checkedAt === 'string' ? data.checkedAt : '',
    recorded: data.recorded === true,
  };
}

/**
 * POST /api/notes/:id/check — coach the current editor text. Throws
 * `IntuitionCheckError` on a non-2xx status or an unusable `200` body; a
 * network failure rejects with the underlying error.
 */
export async function checkIntuition(
  problemId: string,
  input: IntuitionCheckInput,
): Promise<IntuitionCheckResult> {
  const path = `/api/notes/${encodeURIComponent(problemId)}/check`;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(buildCheckBody(input)),
  });
  if (!res.ok) {
    let message = `POST ${path} failed (${res.status})`;
    let code: IntuitionCheckErrorCode | undefined;
    let retryAfterMs: number | undefined;
    const extra: { detail?: string; hint?: string } = {};
    try {
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data.error === 'string' && data.error.trim()) {
        message = data.error;
      }
      if (
        typeof data.code === 'string' &&
        ERROR_CODES.includes(data.code as IntuitionCheckErrorCode)
      ) {
        code = data.code as IntuitionCheckErrorCode;
      }
      if (
        typeof data.retryAfterMs === 'number' &&
        Number.isFinite(data.retryAfterMs) &&
        data.retryAfterMs >= 0
      ) {
        retryAfterMs = data.retryAfterMs;
      }
      for (const key of ['detail', 'hint'] as const) {
        const value = data[key];
        if (typeof value === 'string' && value.trim()) extra[key] = value;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    // Every 429 is a rate limit, even if the body was unreadable.
    if (res.status === 429) {
      code = 'rate_limited';
      retryAfterMs ??= 1000;
    }
    throw new IntuitionCheckError(
      message,
      res.status,
      code,
      retryAfterMs,
      extra,
    );
  }
  const result = normalizeCheckResult(await res.json());
  if (result === null) {
    throw new IntuitionCheckError(
      'The model gave an unusable reply.',
      MALFORMED_REPLY_STATUS,
      undefined,
      undefined,
    );
  }
  return result;
}
