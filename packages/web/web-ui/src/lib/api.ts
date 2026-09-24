/**
 * Typed client for the M1 JSON API (ADR 0006 D4 / M1).
 *
 * The React SPA is a thin view: it never touches storage directly, it only
 * fetches these same-origin, localhost-only endpoints (the server remains the
 * storage owner). Response shapes mirror `packages/web/src/api.ts` exactly — we
 * consume the M1 contract unchanged (no server-contract changes in M2).
 *
 * All requests are relative (same origin) so nothing external/CDN is contacted.
 */

/** The four-state per-problem note status (mirrors storage `NoteStatus`). */
export type NoteStatus = 'none' | 'done' | 'to_revisit' | 'did_not_understand';

/** Problem difficulty (mirrors curriculum `Problem['difficulty']`). */
export type Difficulty = 'Easy' | 'Medium' | 'Hard';

/** Per-status counts across a set of problems (mirrors `StatusCounts`). */
export interface StatusCounts {
  readonly none: number;
  readonly done: number;
  readonly to_revisit: number;
  readonly did_not_understand: number;
}

/** A catalog problem enriched with its resolved status. */
export interface CatalogProblem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly difficulty: Difficulty;
  readonly status: NoteStatus;
  readonly completed: boolean;
}

/** A topic group in the catalog response. */
export interface CatalogTopic {
  readonly topic: string;
  readonly problems: readonly CatalogProblem[];
}

/** GET /api/catalog response shape. */
export interface CatalogResponse {
  readonly topics: readonly CatalogTopic[];
  readonly totals: {
    readonly total: number;
    readonly byStatus: StatusCounts;
  };
}

/** GET /api/progress response shape. */
export interface ProgressResponse {
  readonly completed: number;
  readonly total: number;
  readonly byStatus: StatusCounts;
}

/** GET /api/config response shape. */
export interface ConfigResponse {
  readonly dbConfigured: boolean;
  readonly dataDir?: string;
  readonly provider: string;
}

/** POST /api/notes/:id response shape (subset the SPA needs). */
export interface NoteResponse {
  readonly problemId: string;
  readonly status: NoteStatus;
  readonly completed: boolean;
}

/** Thrown when an API call returns a non-2xx status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new ApiError(`GET ${path} failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

/** GET /api/config — used to decide the no-DB call-to-action state. */
export function fetchConfig(): Promise<ConfigResponse> {
  return getJson<ConfigResponse>('/api/config');
}

/** GET /api/catalog — the categorized problem list. */
export function fetchCatalog(): Promise<CatalogResponse> {
  return getJson<CatalogResponse>('/api/catalog');
}

/** GET /api/progress — the global progress banner data. */
export function fetchProgress(): Promise<ProgressResponse> {
  return getJson<ProgressResponse>('/api/progress');
}

/**
 * POST /api/notes/:id — set a problem's status. The server keeps `completed`
 * consistent with `status === 'done'` and preserves other note fields. Returns
 * the persisted note so callers can reconcile optimistic state.
 */
export async function postNoteStatus(
  problemId: string,
  status: NoteStatus,
): Promise<NoteResponse> {
  const res = await fetch(`/api/notes/${encodeURIComponent(problemId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new ApiError(
      `POST /api/notes/${problemId} failed (${res.status})`,
      res.status,
    );
  }
  return (await res.json()) as NoteResponse;
}
