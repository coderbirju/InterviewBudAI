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

/** Derived qualitative strength band for a topic (mirrors storage `TopicStrength`). */
export type TopicStrength = 'unknown' | 'weak' | 'improving' | 'strong';

/**
 * A per-topic competency entry (mirrors the server `ApiCompetencyTopic`). The
 * `strength` band is already derived server-side; `correct`/`incorrect` are the
 * user's OWN quiz outcomes.
 */
export interface CompetencyTopic {
  readonly topicId: string;
  readonly correct: number;
  readonly incorrect: number;
  readonly strength: TopicStrength;
  readonly lastSeen: string | null;
}

/**
 * A recurring miss pattern (mirrors the server `ApiCompetencyPattern`). The
 * `description` summarises the user's OWN recurring gap — never a solution.
 * Rendered verbatim via JSX (auto-escaped).
 */
export interface CompetencyPattern {
  readonly id: string;
  readonly description: string;
  readonly topics: readonly string[];
  readonly occurrences: number;
  readonly lastObserved: string | null;
}

/**
 * GET /api/competency response shape (mirrors the server
 * `ApiCompetencyResponse`). Safe empty (`{ topics: [], patterns: [] }`) when no
 * DB is configured or no quiz signals exist yet.
 */
export interface CompetencyResponse {
  readonly topics: readonly CompetencyTopic[];
  readonly patterns: readonly CompetencyPattern[];
}

/** GET /api/config response shape. */
export interface ConfigResponse {
  readonly dbConfigured: boolean;
  readonly dataDir?: string;
  readonly provider: string;
}

/** A single interview chat turn (mirrors the server `ApiChatMessage`). */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** POST /api/chat response shape: the model's reply text (mirrors `ApiChatResponse`). */
export interface ChatResponse {
  readonly reply: string;
}

/** POST /api/notes/:id response shape (subset the SPA needs). */
export interface NoteResponse {
  readonly problemId: string;
  readonly status: NoteStatus;
  readonly completed: boolean;
}

/**
 * A fully-resolved saved note (GET /api/notes/:id when a DB is configured, and
 * the POST /api/notes/:id response). Mirrors the server `ApiNoteResponse`:
 * `content` is always a string; the two complexity fields and `lastUpdated` are
 * `null` when unset. A never-saved problem yields an empty note (status 'none').
 */
export interface FullNote {
  readonly problemId: string;
  readonly content: string;
  readonly status: NoteStatus;
  readonly completed: boolean;
  readonly timeComplexity: string | null;
  readonly spaceComplexity: string | null;
  readonly lastUpdated: string | null;
}

/**
 * GET /api/notes/:id result, discriminated on DB state:
 *  - `{ dbConfigured: false }` when no database is configured (server returns
 *    this instead of a note), so the page can show the create-DB call-to-action;
 *  - a `FullNote` (implicitly `dbConfigured: true`) otherwise.
 * An unknown problem id is a 404 and surfaces as an `ApiError` (status 404).
 */
export type NoteFetchResult =
  | { readonly dbConfigured: false }
  | ({ readonly dbConfigured?: true } & FullNote);

/** Fields the notes editor may persist via POST /api/notes/:id. */
export interface NoteSaveInput {
  readonly content?: string;
  readonly status?: NoteStatus;
  readonly timeComplexity?: string;
  readonly spaceComplexity?: string;
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
 * GET /api/competency — the quiz-derived competency signals (weak/strong topics
 * + recurring miss patterns). Resolves to `{ topics: [], patterns: [] }` when
 * no DB is configured or no signals exist yet. Read-only.
 */
export function fetchCompetency(): Promise<CompetencyResponse> {
  return getJson<CompetencyResponse>('/api/competency');
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

/**
 * GET /api/notes/:id — the saved note for a problem. Returns either a
 * `{ dbConfigured: false }` marker (no DB configured) or a `FullNote`. Throws
 * `ApiError(404)` for an unknown problem id so the page can show a friendly
 * "problem not found" message, and `ApiError` for other non-2xx responses.
 */
export async function fetchNote(problemId: string): Promise<NoteFetchResult> {
  const path = `/api/notes/${encodeURIComponent(problemId)}`;
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new ApiError(`GET ${path} failed (${res.status})`, res.status);
  }
  return (await res.json()) as NoteFetchResult;
}

/**
 * POST /api/notes/:id — persist the editor fields. Only the provided fields are
 * sent; the server preserves the rest and keeps `completed` consistent with
 * `status === 'done'`. Returns the persisted note. Throws `ApiError` on non-2xx
 * (e.g. 400 when no DB is configured, 404 for an unknown id).
 */
export async function saveNote(
  problemId: string,
  input: NoteSaveInput,
): Promise<FullNote> {
  const path = `/api/notes/${encodeURIComponent(problemId)}`;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new ApiError(`POST ${path} failed (${res.status})`, res.status);
  }
  return (await res.json()) as FullNote;
}

/**
 * POST /api/chat — send the running transcript (prior turns + the new user
 * turn) and resolve with the model's reply. The MODEL is the only source of
 * assistant text (charter §6.2); this client never fabricates a reply.
 *
 * On a non-2xx response it throws an `ApiError` carrying the server's JSON
 * `error` message (so the UI can show a friendly inline banner) and the HTTP
 * status (so the page can special-case the provider-required `400`). The
 * transcript is preserved by the caller — this function never mutates it.
 */
export async function postChat(
  messages: readonly ChatMessage[],
): Promise<ChatResponse> {
  const path = '/api/chat';
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    // Prefer the server's JSON { error } message; fall back to a generic one.
    let message = `Chat request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string' && data.error.trim()) {
        message = data.error;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as ChatResponse;
}

// ---------------------------------------------------------------------------
// Quiz Master (ADR 0007 Q3) — typed client for the /api/quiz/* endpoints.
//
// These mirror the server `ApiQuizQuestion` / `ApiQuizState` and the quiz
// route payloads in `packages/web/src/api.ts` EXACTLY. The SPA consumes the Q2
// contract unchanged — no server-contract changes in Q3.
// ---------------------------------------------------------------------------

/** The Quiz Master verdict for a submitted answer (mirrors the server). */
export type QuizVerdict = 'correct' | 'incorrect' | 'on_track';

/**
 * A wrapped question presented to the SPA. `wrapped` is the MODEL-authored
 * short rephrasing (no title, no hints, no answer) and is rendered verbatim via
 * JSX (auto-escaped) — never as HTML (charter §6.2 / §7.3).
 */
export interface QuizQuestion {
  readonly problemId: string;
  readonly wrapped: string;
}

/** Session-state summary returned alongside questions (mirrors `ApiQuizState`). */
export interface QuizState {
  readonly sessionId: string;
  readonly deckSize: number;
  readonly index: number;
  readonly answered: number;
  readonly status: 'active' | 'complete';
}

/** A persisted transcript entry (mirrors storage `QuizTranscriptEntry`). */
export interface QuizTranscriptEntry {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly at: string;
}

/**
 * GET /api/quiz/session result. Either no active session, or an active session
 * with its current wrapped question (may be `null` if it could not be
 * re-presented), progress, and full transcript for resume.
 */
export type QuizSessionResult =
  | { readonly active: false }
  | {
      readonly active: true;
      readonly session: QuizState;
      readonly question: QuizQuestion | null;
      readonly transcript: readonly QuizTranscriptEntry[];
    };

/**
 * POST /api/quiz/start and POST /api/quiz/new result. Either an empty-deck
 * marker (no problems marked done) or a fresh session presenting its first
 * wrapped question.
 */
export type QuizStartResult =
  | { readonly empty: true; readonly message: string }
  | {
      readonly empty: false;
      readonly session: QuizState;
      readonly question: QuizQuestion;
    };

/**
 * POST /api/quiz/answer result. `on_track` is non-terminal (stay on the same
 * question, `question.wrapped` carries the probe). A terminal verdict
 * (`correct` | `incorrect`) either advances to the next question or, when
 * `complete` is true, ends the session (`question` is `null`).
 */
export type QuizAnswerResult =
  | {
      readonly verdict: 'on_track';
      readonly feedback: string;
      readonly optimalNudge?: string;
      readonly terminal: false;
      readonly session: QuizState;
      readonly question: QuizQuestion;
    }
  | {
      readonly verdict: 'correct' | 'incorrect';
      readonly feedback: string;
      readonly optimalNudge?: string;
      readonly terminal: true;
      readonly complete: boolean;
      readonly session: QuizState;
      readonly question: QuizQuestion | null;
    };

/**
 * Shared POST helper for the quiz routes. Sends the (optional) JSON body and,
 * on a non-2xx response, throws an `ApiError` carrying the server's JSON
 * `error` message and HTTP status so the UI can show a friendly inline banner
 * and special-case the provider-required `400` (no model configured).
 */
async function postQuiz<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let message = `POST ${path} failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string' && data.error.trim()) {
        message = data.error;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

/**
 * GET /api/quiz/session — resume the single active session if one exists. A
 * missing/inactive session resolves to `{ active: false }` (200), so the page
 * can offer to start a new quiz. Throws `ApiError` only on a genuine non-2xx.
 */
export function getQuizSession(): Promise<QuizSessionResult> {
  return getJson<QuizSessionResult>('/api/quiz/session');
}

/**
 * POST /api/quiz/start — build a fresh shuffled deck from the current done-set
 * and present its first wrapped question. Resolves to `{ empty: true }` when no
 * problems are marked done. Throws `ApiError(400)` when no model is configured
 * (message `no model configured`) or `ApiError(502)` on a provider failure.
 */
export function startQuiz(): Promise<QuizStartResult> {
  return postQuiz<QuizStartResult>('/api/quiz/start');
}

/**
 * POST /api/quiz/new — reshuffle a brand-new deck from the CURRENT done-set and
 * restart the flow (discarding any active session). Same result shape and error
 * modes as `startQuiz`.
 */
export function newQuiz(): Promise<QuizStartResult> {
  return postQuiz<QuizStartResult>('/api/quiz/new');
}

/**
 * POST /api/quiz/answer — submit the user's typed approach for the current
 * question. Resolves with the verdict, model feedback, optional optimal nudge,
 * and either the next wrapped question or a completion marker. Throws
 * `ApiError` on a non-2xx (400 no model / no DB, 404 no active session, 502
 * provider/verdict failure) — the caller preserves the transcript.
 */
export function answerQuiz(answer: string): Promise<QuizAnswerResult> {
  return postQuiz<QuizAnswerResult>('/api/quiz/answer', { answer });
}
