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

/**
 * Problem difficulty as the SPA uses it (display casing). NOTE: the server
 * sends the curriculum's lowercase `'easy'|'medium'|'hard'`; the client
 * boundary normalizes it via {@link normalizeDifficulty} (the single source of
 * truth) so badges and filters always see this casing.
 */
export type Difficulty = 'Easy' | 'Medium' | 'Hard';

/**
 * Normalize a wire difficulty (any casing, e.g. the catalog's `'easy'`) to the
 * SPA's {@link Difficulty}; `null` when absent/unknown.
 */
export function normalizeDifficulty(raw: unknown): Difficulty | null {
  switch (typeof raw === 'string' ? raw.toLowerCase() : '') {
    case 'easy':
      return 'Easy';
    case 'medium':
      return 'Medium';
    case 'hard':
      return 'Hard';
    default:
      return null;
  }
}

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
  /** Absent for a custom problem without a link (ADR 0010): show plain text. */
  readonly url?: string;
  readonly difficulty: Difficulty;
  readonly status: NoteStatus;
  readonly completed: boolean;
  /** A user-added problem (ADR 0010): "Custom" badge, editable on Notes. */
  readonly custom?: true;
  /** A custom problem's own plain-text statement (render escaped). */
  readonly statement?: string;
}

/** A topic group in the catalog response. */
export interface CatalogTopic {
  readonly topic: string;
  /** Curriculum display label (server `TOPIC_LABELS`); absent → show `topic`. */
  readonly label?: string;
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
  /** Curriculum display label (server `TOPIC_LABELS`); absent → show `topicId`. */
  readonly label?: string;
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
  /** Curriculum display labels for `topics`, index-aligned; absent → show `topics`. */
  readonly topicLabels?: readonly string[];
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
    /**
     * Optional machine-readable extras from the JSON error body, e.g. the
     * quiz's 503 `{ code: 'model_unavailable', detail, hint }` (ADR 0011 D4).
     */
    readonly extra: {
      readonly code?: string;
      readonly detail?: string;
      readonly hint?: string;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** True for the quiz's "model is starting or unavailable" error (ADR 0011 D4). */
export function isModelUnavailable(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 503 &&
    err.extra.code === 'model_unavailable'
  );
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
export async function fetchCatalog(): Promise<CatalogResponse> {
  return normalizeCatalog(await getJson<CatalogResponse>('/api/catalog'));
}

/**
 * Normalize a raw /api/catalog payload at the client boundary: the wire
 * difficulty is lowercase, the SPA's {@link Difficulty} is display-cased.
 * Unknown values pass through unchanged (neutral badge, match no chip).
 */
export function normalizeCatalog(raw: CatalogResponse): CatalogResponse {
  return {
    ...raw,
    topics: raw.topics.map((topic) => ({
      ...topic,
      problems: topic.problems.map((p) => ({
        ...p,
        difficulty: normalizeDifficulty(p.difficulty) ?? p.difficulty,
      })),
    })),
  };
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

// ---------------------------------------------------------------------------
// Guidance (ADR 0007 amendment w2a) — GET /api/guidance. Mirrors the server
// `ApiGuidanceResponse` and core `TopicStanding` / `NextUpItem` / `QuizHint`.
// ---------------------------------------------------------------------------

/** Whether a data folder exists (`no_db`), has no activity (`empty`), or has some. */
export type GuidanceState = 'no_db' | 'empty' | 'ready';

/** Where the user stands on one topic (mirrors core `TopicStanding`). */
export interface GuidanceStanding {
  readonly topicId: string;
  /** Curriculum display label (server `topicLabel`); absent → show `topicId`. */
  readonly label?: string;
  readonly notes: {
    readonly done: number;
    readonly toRevisit: number;
    readonly didNotUnderstand: number;
    /** Catalog problems tagged with this topic. */
    readonly total: number;
  };
  readonly quiz: { readonly correct: number; readonly incorrect: number };
  readonly lastActivity: string | null;
  /** Same band (and so the same color/label) Analytics shows. */
  readonly band: TopicStrength;
  readonly needsReview: boolean;
}

/** Why a problem is in next-up (mirrors core `NextUpKind`). */
export type NextUpKind = 'revisit' | 'weak_topic' | 'continue' | 'start';

/** One concrete problem to do next (mirrors core `NextUpItem`). */
export interface GuidanceNextUp {
  readonly kind: NextUpKind;
  readonly problemId: string;
  readonly title: string;
  /** Absent for a custom problem without a link (ADR 0010): show plain text. */
  readonly url?: string;
  /** Display-cased at the client boundary (see {@link normalizeDifficulty}). */
  readonly difficulty: Difficulty;
  /** Topic the item came from; `null` when unknown (e.g. a revisit off-catalog). */
  readonly topicId: string | null;
  /** Display label of `topicId` (`null` when `topicId` is); absent → show `topicId`. */
  readonly label?: string | null;
  /** Count-based reason (never a hint); rendered as JSX text. */
  readonly reason: string;
}

/** The quiz nudge (mirrors core `QuizHint`). */
export interface GuidanceQuiz {
  readonly doneCount: number;
  readonly lastQuizAt: string | null;
  readonly suggested: boolean;
}

/** GET /api/guidance response shape. */
export interface GuidanceResponse {
  readonly state: GuidanceState;
  readonly generatedAt: string;
  readonly standing: readonly GuidanceStanding[];
  readonly nextUp: readonly GuidanceNextUp[];
  readonly quiz: GuidanceQuiz;
}

/**
 * Normalize a raw /api/guidance payload: next-up difficulties are lowercase on
 * the wire; unknown values pass through unchanged (neutral badge).
 */
export function normalizeGuidance(raw: GuidanceResponse): GuidanceResponse {
  return {
    ...raw,
    nextUp: raw.nextUp.map((item) => ({
      ...item,
      difficulty: normalizeDifficulty(item.difficulty) ?? item.difficulty,
    })),
  };
}

/** GET /api/guidance — where you stand + next-up problems + quiz nudge. Read-only. */
export async function fetchGuidance(): Promise<GuidanceResponse> {
  return normalizeGuidance(await getJson<GuidanceResponse>('/api/guidance'));
}

// ---------------------------------------------------------------------------
// Insights (ADR 0012 D3) — GET /api/insights. Mirrors the ADR's exact shape.
// ---------------------------------------------------------------------------

/** `no_db` (no data folder), `locked` (< 2 counted quiz sessions), `unlocked`. */
export type InsightsState = 'no_db' | 'locked' | 'unlocked';

/** Generic quiz miss code (ADR 0012 D1). The wire may carry codes we don't know yet. */
export type MissCode =
  | 'edge'
  | 'complexity'
  | 'brute'
  | 'technique'
  | 'vague'
  | 'boundary'
  | 'misread';

export interface InsightsSessions {
  /** Quiz sessions with at least one terminal answer. */
  readonly counted: number;
  /** Sessions needed to unlock insights (`INSIGHTS_UNLOCK_SESSIONS`, 2). */
  readonly required: number;
}

export interface InsightsStatus {
  readonly done: number;
  readonly toRevisit: number;
  readonly didNotUnderstand: number;
  readonly notStarted: number;
  readonly total: number;
}

/** One of the 13 topics, in `TOPIC_ORDER` (never re-sorted client-side). */
export interface InsightsTopic {
  readonly topicId: string;
  readonly label: string;
  readonly done: number;
  readonly total: number;
}

export interface InsightsFocus {
  readonly topicId: string;
  readonly label: string;
  readonly band: TopicStrength;
  /** Count-based reason (never a hint); rendered as JSX text. */
  readonly reason: string;
}

export interface InsightsSlipTopic {
  readonly topicId: string;
  readonly label: string;
  readonly count: number;
}

export interface InsightsSlip {
  /** Usually a {@link MissCode}; a string so unknown codes degrade gracefully. */
  readonly code: string;
  readonly label: string;
  readonly count: number;
  readonly lastSeen: string;
  readonly topics: readonly InsightsSlipTopic[];
}

export interface InsightsStrength {
  readonly topicId: string;
  readonly label: string;
  readonly correct: number;
  readonly incorrect: number;
}

/** GET /api/insights response shape (ADR 0012 D3). */
export interface InsightsResponse {
  readonly state: InsightsState;
  readonly generatedAt: string;
  readonly sessions: InsightsSessions;
  readonly status: InsightsStatus;
  readonly topics: readonly InsightsTopic[];
  readonly focus: readonly InsightsFocus[];
  readonly slips: readonly InsightsSlip[];
  readonly strengths: readonly InsightsStrength[];
}

/** A well-formed topic tile entry: non-empty string id, finite numeric counts. */
function isInsightsTopic(t: unknown): t is InsightsTopic {
  if (typeof t !== 'object' || t === null) {
    return false;
  }
  const o = t as Record<string, unknown>;
  return (
    typeof o.topicId === 'string' &&
    o.topicId !== '' &&
    typeof o.done === 'number' &&
    Number.isFinite(o.done) &&
    typeof o.total === 'number' &&
    Number.isFinite(o.total)
  );
}

/**
 * Normalize a raw /api/insights payload at the client boundary: malformed
 * `topics[]` entries are dropped (order kept); an unknown
 * `state` reads as `locked`, missing lists read as `[]`, and missing
 * sessions/status read as zeros, so a partial payload renders the calm locked
 * view instead of crashing. Lists stay empty unless `state` is `unlocked`.
 */
export function normalizeInsights(raw: InsightsResponse): InsightsResponse {
  const state: InsightsState =
    raw.state === 'no_db' || raw.state === 'unlocked' ? raw.state : 'locked';
  const list = <T>(xs: readonly T[] | undefined): readonly T[] =>
    state === 'unlocked' && Array.isArray(xs) ? xs : [];
  const s = raw.status ?? ({} as Partial<InsightsStatus>);
  return {
    state,
    generatedAt: raw.generatedAt,
    sessions: {
      counted: raw.sessions?.counted ?? 0,
      required: raw.sessions?.required ?? 2,
    },
    status: {
      done: s.done ?? 0,
      toRevisit: s.toRevisit ?? 0,
      didNotUnderstand: s.didNotUnderstand ?? 0,
      notStarted: s.notStarted ?? 0,
      total: s.total ?? 0,
    },
    topics: Array.isArray(raw.topics) ? raw.topics.filter(isInsightsTopic) : [],
    focus: list(raw.focus),
    slips: list(raw.slips),
    strengths: list(raw.strengths),
  };
}

/** GET /api/insights — Analytics v2: status, topic tiles, focus/slips/strengths. Read-only. */
export async function fetchInsights(): Promise<InsightsResponse> {
  return normalizeInsights(await getJson<InsightsResponse>('/api/insights'));
}

// ---------------------------------------------------------------------------
// Practice trends (ADR 0013 D3) — separate from quiz analytics
// ---------------------------------------------------------------------------

/** `no_db` (no data folder), `empty` (no practice checks), `ready`. */
export type PracticeState = 'no_db' | 'empty' | 'ready';

/** The coach's assessment of an intuition check (ADR 0013 D1). */
export type CoachAssessment = 'on_track' | 'partial' | 'off_track';

export interface PracticeTotals {
  /** Events in the window (same as `windowEvents`). */
  readonly checks: number;
  /** All-time distinct problems checked (the `seen` set). */
  readonly problems: number;
  readonly windowEvents: number;
  readonly windowCap: number;
}

/** First-check outcome counts in the window. */
export type PracticeFirstCheck = Readonly<Record<CoachAssessment, number>>;

export interface PracticeSlipTopic {
  readonly topicId: string;
  readonly label: string;
  readonly count: number;
}

export interface PracticeSlip {
  /** Usually a {@link MissCode}; a string so unknown codes degrade gracefully. */
  readonly code: string;
  readonly label: string;
  readonly count: number;
  readonly topics: readonly PracticeSlipTopic[];
}

export interface PracticeRatio {
  readonly count: number;
  readonly of: number;
}

/** GET /api/practice response shape (ADR 0013 D3). */
export interface PracticeResponse {
  readonly state: PracticeState;
  readonly generatedAt: string;
  readonly totals: PracticeTotals;
  readonly firstCheck: PracticeFirstCheck;
  readonly slips: readonly PracticeSlip[];
  readonly fixedAfterRecheck: PracticeRatio;
  readonly readyToCodeFirstTry: PracticeRatio;
  /** The oldest event's `at`, or `null`. */
  readonly since: string | null;
}

/** A non-negative finite count; anything else reads as 0. */
function countOf(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function ratioOf(raw: unknown): PracticeRatio {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return { count: countOf(o.count), of: countOf(o.of) };
}

function isPracticeSlip(s: unknown): s is PracticeSlip {
  if (typeof s !== 'object' || s === null) {
    return false;
  }
  const o = s as Record<string, unknown>;
  return typeof o.code === 'string' && o.code !== '';
}

function isSlipTopic(t: unknown): t is PracticeSlipTopic {
  return (
    typeof t === 'object' &&
    t !== null &&
    typeof (t as Record<string, unknown>).topicId === 'string' &&
    (t as Record<string, unknown>).topicId !== ''
  );
}

/**
 * Normalize a raw /api/practice payload at the client boundary. Only a
 * literal `state: 'ready'` reads as ready (anything else — including a
 * payload from an older server — reads as `empty`, which the UI hides).
 * Counts are clamped to non-negative numbers; malformed slips/topics are
 * dropped; `since` is a string or `null`.
 */
export function normalizePractice(raw: unknown): PracticeResponse {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const state: PracticeState =
    o.state === 'ready' || o.state === 'no_db' ? o.state : 'empty';
  const ready = state === 'ready';
  const t = (typeof o.totals === 'object' && o.totals !== null
    ? o.totals
    : {}) as Record<string, unknown>;
  const fc = (typeof o.firstCheck === 'object' && o.firstCheck !== null
    ? o.firstCheck
    : {}) as Record<string, unknown>;
  const slips =
    ready && Array.isArray(o.slips)
      ? o.slips.filter(isPracticeSlip).map((s) => ({
          code: s.code,
          label: typeof s.label === 'string' ? s.label : '',
          count: countOf(s.count),
          topics: Array.isArray(s.topics)
            ? s.topics.filter(isSlipTopic).map((tp) => ({
                topicId: tp.topicId,
                label: typeof tp.label === 'string' ? tp.label : '',
                count: countOf(tp.count),
              }))
            : [],
        }))
      : [];
  return {
    state,
    generatedAt: typeof o.generatedAt === 'string' ? o.generatedAt : '',
    totals: {
      checks: countOf(t.checks),
      problems: countOf(t.problems),
      windowEvents: countOf(t.windowEvents),
      windowCap: countOf(t.windowCap),
    },
    firstCheck: {
      on_track: countOf(fc.on_track),
      partial: countOf(fc.partial),
      off_track: countOf(fc.off_track),
    },
    slips,
    fixedAfterRecheck: ratioOf(o.fixedAfterRecheck),
    readyToCodeFirstTry: ratioOf(o.readyToCodeFirstTry),
    since: typeof o.since === 'string' && o.since !== '' ? o.since : null,
  };
}

/**
 * GET /api/practice — practice trends from intuition checks (ADR 0013 D3).
 * Read-only. Throws `ApiError` on a non-2xx (e.g. `404` on a server without
 * the route); the UI just hides the Practice section then.
 */
export async function fetchPractice(): Promise<PracticeResponse> {
  return normalizePractice(await getJson<unknown>('/api/practice'));
}

/** Confirm token the server requires for a practice reset (ADR 0013 D3). */
export const PRACTICE_RESET_CONFIRM = 'reset-practice';

/**
 * Result of `POST /api/practice/reset`. HTTP errors resolve (not throw) so
 * the UI can show the server's message and, for `reset_failed`, the backup
 * path the server already made. Only a network failure throws.
 */
export type PracticeResetResult =
  | { readonly ok: true; readonly backup: string }
  | {
      readonly ok: false;
      readonly status: number;
      /** Server `error` text (rendered as JSX text), or a generic fallback. */
      readonly error: string;
      /** `read_only` | `backup_failed` | `reset_failed` | `invalid_body` | … */
      readonly code?: string;
      /** Present on `reset_failed`: the backup was made before the failure. */
      readonly backup?: string;
    };

/**
 * POST /api/practice/reset with `{ confirm: 'reset-practice' }`. The server
 * backs up the data folder first, then deletes the practice history only —
 * quiz analytics are never touched.
 */
export async function resetPractice(): Promise<PracticeResetResult> {
  const path = '/api/practice/reset';
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ confirm: PRACTICE_RESET_CONFIRM }),
  });
  let data: Record<string, unknown> = {};
  try {
    const parsed = (await res.json()) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON body — fall through to the generic handling.
  }
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v : undefined;
  if (res.ok) {
    return { ok: true, backup: str(data.backup) ?? '' };
  }
  const code = str(data.code);
  const backup = str(data.backup);
  return {
    ok: false,
    status: res.status,
    error: str(data.error) ?? `POST ${path} failed (${res.status})`,
    ...(code !== undefined ? { code } : {}),
    ...(backup !== undefined ? { backup } : {}),
  };
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
 * A question presented to the SPA, built deterministically from the catalog
 * (ADR 0007 A1/A8 — the real problem, no model call). `wrapped` is the
 * presentation text (field name kept for wire stability); `title`,
 * `difficulty`, `url` and the optional current `probe` are additive. All values
 * render via JSX (auto-escaped) — never as HTML (charter §6.2 / §7.3).
 */
export interface QuizQuestion {
  readonly problemId: string;
  readonly wrapped: string;
  readonly title?: string;
  /** Catalog difficulty as sent by the server (e.g. `'easy'`). */
  readonly difficulty?: string;
  readonly url?: string;
  readonly probe?: string;
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
 * with its current question (catalog-built; `null` only when there is
 * nothing to present), progress, and full transcript for resume.
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
 * question, the problem stays in `question`, the probe is in `feedback` and `question.probe`). A terminal verdict
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
 * Shared POST helper (quiz + data-dir routes). Sends the (optional) JSON body and,
 * on a non-2xx response, throws an `ApiError` carrying the server's JSON
 * `error` message and HTTP status so the UI can show a friendly inline banner
 * and special-case the provider-required `400` (no model configured).
 */
async function postJson<T>(path: string, body?: unknown): Promise<T> {
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
    const extra: { code?: string; detail?: string; hint?: string } = {};
    try {
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data.error === 'string' && data.error.trim()) {
        message = data.error;
      }
      for (const key of ['code', 'detail', 'hint'] as const) {
        const value = data[key];
        if (typeof value === 'string' && value.trim()) extra[key] = value;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiError(message, res.status, extra);
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
 * and present its first question. Resolves to `{ empty: true }` when no
 * problems are marked done. Throws `ApiError(400)` when no model is configured
 * (message `no model configured`), `ApiError(503)` (code `model_unavailable`)
 * when the model is starting or unreachable, or `ApiError(502)` on another
 * provider failure.
 */
export function startQuiz(): Promise<QuizStartResult> {
  return postJson<QuizStartResult>('/api/quiz/start');
}

/**
 * POST /api/quiz/new — reshuffle a brand-new deck from the CURRENT done-set and
 * restart the flow (discarding any active session). Same result shape and error
 * modes as `startQuiz`.
 */
export function newQuiz(): Promise<QuizStartResult> {
  return postJson<QuizStartResult>('/api/quiz/new');
}

/**
 * POST /api/quiz/answer — submit the user's typed approach for the current
 * question. Resolves with the verdict, model feedback, optional optimal nudge,
 * and either the next question or a completion marker. Throws
 * `ApiError` on a non-2xx (400 no model / no DB, 404 no active session, 409
 * the shown card changed — e.g. it was deleted — so the answer was not graded,
 * 503 model unavailable (code `model_unavailable`: starting or unreachable,
 * nothing written), 502 provider/verdict failure) — the caller preserves the
 * transcript.
 * `problemId` names the card the user was shown.
 */
export function answerQuiz(
  answer: string,
  problemId?: string,
): Promise<QuizAnswerResult> {
  return postJson<QuizAnswerResult>('/api/quiz/answer', {
    answer,
    ...(problemId !== undefined && { problemId }),
  });
}

// ---------------------------------------------------------------------------
// Quiz session management (quiz-fix-b) — end / list / resume / delete.
// ---------------------------------------------------------------------------

/**
 * A list-oriented session summary (mirrors the server `ApiQuizSessionSummary`).
 * Powers the sessions list in the Quiz section: created time, progress, outcome
 * tally, status, and whether it is the active/resumable one.
 */
export interface QuizSessionSummary {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly status: 'active' | 'complete';
  readonly deckSize: number;
  readonly answeredCount: number;
  readonly correctCount: number;
  readonly isActive: boolean;
}

/** GET /api/quiz/sessions result (empty-safe). */
export interface QuizSessionsResult {
  readonly sessions: readonly QuizSessionSummary[];
}

/**
 * POST /api/quiz/resume result — the re-activated session with its current
 * wrapped question (may be `null` if it could not be re-presented) and the full
 * transcript for resume.
 */
export interface QuizResumeResult {
  readonly ok: true;
  readonly session: QuizState;
  readonly question: QuizQuestion | null;
  readonly transcript: readonly QuizTranscriptEntry[];
}

/**
 * GET /api/quiz/sessions — the list of past + active sessions for the Quiz
 * section. Resolves to `{ sessions: [] }` when no DB is configured or none
 * exist yet. Read-only.
 */
export function listQuizSessions(): Promise<QuizSessionsResult> {
  return getJson<QuizSessionsResult>('/api/quiz/sessions');
}

/**
 * POST /api/quiz/end — end the active session: it is persisted `complete` and
 * the active pointer cleared, so it stops being resumable-active but REMAINS in
 * the list (with Resume). Throws `ApiError(404)` when there is no active
 * session, `ApiError(400)` when no DB is configured.
 */
export function endQuiz(): Promise<{
  readonly ok: true;
  readonly session: QuizState;
}> {
  return postJson<{ readonly ok: true; readonly session: QuizState }>(
    '/api/quiz/end',
  );
}

/**
 * POST /api/quiz/resume — re-activate a listed session by id so it becomes the
 * resumable-active one, and continue from its current position. Throws
 * `ApiError(404)` for an unknown id, `ApiError(400)` when no DB / bad id.
 */
export function resumeQuiz(sessionId: string): Promise<QuizResumeResult> {
  return postJson<QuizResumeResult>('/api/quiz/resume', { sessionId });
}

/**
 * POST /api/quiz/delete — delete a session by id. Idempotent: deleting a
 * missing session still resolves `{ ok: true }`. Throws `ApiError(400)` when no
 * DB is configured or the id is missing.
 */
export function deleteQuizSession(
  sessionId: string,
): Promise<{ readonly ok: true }> {
  return postJson<{ readonly ok: true }>('/api/quiz/delete', { sessionId });
}

// ---------------------------------------------------------------------------
// Your data (ADR 0009 D1) — typed client for /api/data-dir*. Mirrors the
// server `DataDirStatus` / `DataDirInspection` in
// `packages/web/src/data-dir-control.ts`.
// ---------------------------------------------------------------------------

/** Where the active data folder came from (highest precedence first). */
export type DataDirSource = 'flag' | 'env' | 'config' | 'default';

/** A previous data folder the server found (a suggestion, never auto-used). */
export interface LegacyCandidate {
  readonly path: string;
  readonly noteCount: number;
  readonly origin: 'cookie' | 'legacy-default';
}

/** GET /api/data-dir response shape. */
export interface DataDirStatus {
  readonly dataDir: string;
  readonly source: DataDirSource;
  readonly pinned: boolean;
  readonly exists: boolean;
  readonly noteCount: number;
  readonly formatVersion: number;
  readonly readOnly?: boolean;
  readonly legacyCandidates: readonly LegacyCandidate[];
  /** Present only when the server runs in the Docker image (ADR 0011 D3). */
  readonly docker?: DockerDataInfo;
}

/** The server's Docker info for the data folder (ADR 0011 D3). */
export interface DockerDataInfo {
  /** Display-only host folder mounted at /data (`IBAI_HOST_DATA_DIR`). */
  readonly hostDataDir: string | null;
  /** `/data` passed the boot writability check. */
  readonly writable: boolean;
  /** Fixed help text when not writable. */
  readonly writableHelp?: string;
  /** The /setup choice from the host config.json, when it differs (mismatch banner). */
  readonly hostConfigDataDir?: string;
}

/** "Pinned by Docker (IBAI_HOST_DATA_DIR=<host path>)". */
export function dockerPinnedText(docker: DockerDataInfo): string {
  return docker.hostDataDir !== null
    ? `Pinned by Docker (IBAI_HOST_DATA_DIR=${docker.hostDataDir})`
    : 'Pinned by Docker (the folder mounted at /data)';
}

/** A dry-run hint (see the server `InspectionHint`). */
export type DataDirHint =
  | { readonly kind: 'use-parent'; readonly path: string }
  | { readonly kind: 'not-ibai-format' };

/** POST /api/data-dir { dryRun: true } response shape (no writes). */
export interface DataDirInspection {
  readonly dryRun: true;
  readonly path: string;
  readonly exists: boolean;
  readonly noteCount: number;
  readonly quizSessionCount: number;
  readonly hint?: DataDirHint;
}

/** GET /api/data-dir — the active folder + any previous-data candidates. */
export function fetchDataDir(): Promise<DataDirStatus> {
  return getJson<DataDirStatus>('/api/data-dir');
}

/**
 * POST /api/data-dir { path, dryRun: true } — validate a path and report what
 * is there, without switching. Throws `ApiError(400)` with the server's
 * message for an invalid path.
 */
export function checkDataDir(path: string): Promise<DataDirInspection> {
  return postJson<DataDirInspection>('/api/data-dir', { path, dryRun: true });
}

/**
 * POST /api/data-dir { path } — switch the server to `path` (created 0700 if
 * missing, persisted to config.json). Throws `ApiError(400)` with the server's
 * message (invalid path, pinned dir, …).
 */
export function switchDataDir(path: string): Promise<DataDirStatus> {
  return postJson<DataDirStatus>('/api/data-dir', { path });
}

/** POST /api/data-dir/legacy/dismiss — stop offering previous-data folders. */
export function dismissLegacyData(): Promise<DataDirStatus> {
  return postJson<DataDirStatus>('/api/data-dir/legacy/dismiss', {});
}

// ---------------------------------------------------------------------------
// Settings / provider status (ADR 0008 Wave 2c). Keys stay env-only: these
// shapes carry presence booleans, never a secret value.
// ---------------------------------------------------------------------------

export type ProviderKind = 'anthropic' | 'openai' | 'ollama' | 'none';

export interface SettingsProvider {
  readonly kind: ProviderKind;
  readonly model: string | null;
  /** Ollama / OpenAI-compatible origin (scheme://host:port) only; null otherwise. */
  readonly endpoint: string | null;
  /** The active provider's key is present (OpenAI-compatible: optional key). */
  readonly keyConfigured: boolean;
  /** `openai` only: "Docker Model Runner (local)" or "OpenAI-compatible". */
  readonly label?: string;
  readonly hint?: string;
}

export interface SettingsEnvVar {
  readonly var: string;
  readonly purpose: string;
  readonly set: boolean;
}

/** GET /api/settings response shape. */
export interface SettingsResponse {
  readonly provider: SettingsProvider;
  readonly dataDir: {
    readonly path: string;
    readonly source: DataDirSource;
    readonly pinned: boolean;
  };
  readonly app: { readonly version: string; readonly node: string };
  readonly envHelp: readonly SettingsEnvVar[];
}

/** POST /api/settings/test-provider response shape. */
export interface ProviderTestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly detail: string;
}

/** GET /api/settings — active provider (no secrets), data dir, versions. */
export function fetchSettings(): Promise<SettingsResponse> {
  return getJson<SettingsResponse>('/api/settings');
}

/**
 * POST /api/settings/test-provider — one health check against the configured
 * provider. Throws `ApiError` (400 no model, 429 too soon) with the server's
 * message.
 */
export function testProviderConnection(): Promise<ProviderTestResult> {
  return postJson<ProviderTestResult>('/api/settings/test-provider', {});
}

// ---------------------------------------------------------------------------
// CSV import (ADR 0009 D2)
// ---------------------------------------------------------------------------

/** A CSV file read client-side. `name` is display-only on the server. */
export interface ImportFileInput {
  readonly name: string;
  readonly text: string;
}

/** How the server matched a row to the catalog. */
export interface ImportMatch {
  readonly problemId: string;
  readonly title: string;
  readonly by: 'url' | 'number' | 'title';
}

/** One preview row. */
export interface ImportPreviewRow {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly title: string;
  readonly match: ImportMatch | null;
  readonly existing: 'none' | 'note';
  /** The row imported for its problem by default (one per problem). */
  readonly chosen: boolean;
  readonly fields: {
    readonly status: NoteStatus;
    readonly lastUpdated: string | null;
    readonly timeComplexity?: string;
    readonly spaceComplexity?: string;
    readonly bodyPreview: string;
  };
  readonly warnings: readonly string[];
}

/** A row that matched no catalog problem (never written). */
export interface ImportUnmatchedRow {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly title: string;
  readonly url: string;
}

/** POST /api/import/csv/preview response. */
export interface ImportPreview {
  readonly previewHash: string;
  readonly defaultStatus: NoteStatus;
  readonly rows: readonly ImportPreviewRow[];
  readonly unmatched: readonly ImportUnmatchedRow[];
  readonly duplicatesCollapsed: number;
  readonly blankRows: number;
  readonly errors: readonly { readonly file: string; readonly error: string }[];
}

export type ImportAction = 'create' | 'skip' | 'overwrite' | 'merge';

/** Per-problem choice sent on commit (keyed by problem id). */
export interface ImportDecision {
  readonly action: ImportAction;
  readonly status?: NoteStatus;
  readonly rowKey?: string;
}

/**
 * "Add as custom problem" for an unmatched row (ADR 0010 D4), keyed by the
 * row's `key` in the same `decisions` object: the new problem gets the row's
 * title (+ its url if http(s)) and this difficulty and 1–3 topics.
 */
export interface ImportCustomDecision {
  readonly action: 'add-custom';
  readonly difficulty: WireDifficulty;
  readonly topics: readonly string[];
  readonly status?: NoteStatus;
}

/** POST /api/import/csv/commit response. */
export interface ImportCommitResult {
  readonly created: number;
  readonly overwritten: number;
  readonly merged: number;
  readonly skipped: number;
  readonly unmatched: number;
  /** Custom problems created from unmatched rows (absent from older servers). */
  readonly customCreated?: readonly {
    readonly rowKey: string;
    readonly problemId: string;
    readonly title: string;
  }[];
  /** `rowKey` is set for an add-custom row (`problemId` may then be ''). */
  readonly failed: readonly {
    readonly problemId: string;
    readonly rowKey?: string;
    readonly error: string;
  }[];
  readonly backup: string;
}

/** POST /api/import/csv/preview — parse + match, no writes. */
export function previewCsvImport(
  files: readonly ImportFileInput[],
  defaultStatus: NoteStatus,
): Promise<ImportPreview> {
  return postJson<ImportPreview>('/api/import/csv/preview', {
    files,
    defaultStatus,
  });
}

/**
 * POST /api/import/csv/commit — the server re-parses the same files, checks
 * `previewHash` (409 "re-run preview" on any change), backs up the data folder
 * and writes the chosen notes.
 */
export function commitCsvImport(
  files: readonly ImportFileInput[],
  previewHash: string,
  defaultStatus: NoteStatus,
  decisions: Readonly<Record<string, ImportDecision | ImportCustomDecision>>,
): Promise<ImportCommitResult> {
  return postJson<ImportCommitResult>('/api/import/csv/commit', {
    files,
    previewHash,
    defaultStatus,
    decisions,
  });
}

// ---------------------------------------------------------------------------
// Custom problems (ADR 0010 D5)
// ---------------------------------------------------------------------------

/** The wire (lowercase) difficulty the problems API takes and returns. */
export type WireDifficulty = 'easy' | 'medium' | 'hard';

/** Server limits (ADR 0010 D5), mirrored for client-side validation. */
export const CUSTOM_PROBLEM_LIMITS = {
  titleMax: 200,
  urlMax: 2048,
  statementMax: 2000,
  topicsMin: 1,
  topicsMax: 3,
} as const;

/** A stored custom problem (`{ problem }` of POST / PATCH). */
export interface CustomProblem {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  readonly statement?: string;
  readonly difficulty: WireDifficulty;
  readonly topics: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly custom: true;
}

/** Fields of a create. */
export interface ProblemInput {
  readonly title: string;
  readonly url?: string;
  readonly statement?: string;
  readonly difficulty: WireDifficulty;
  readonly topics: readonly string[];
}

/** Fields of an edit (`null` clears the optional url / statement). */
export interface ProblemPatch {
  readonly title?: string;
  readonly url?: string | null;
  readonly statement?: string | null;
  readonly difficulty?: WireDifficulty;
  readonly topics?: readonly string[];
}

/** The existing problem a duplicate 409 points at. */
export interface DuplicateProblem {
  readonly problemId: string;
  readonly title: string;
  readonly custom: boolean;
}

/**
 * A non-2xx from `/api/problems*`: the server message plus the 409 details —
 * `duplicate` (+ `overridable` for a title-only match, which may be resent
 * with `allowSimilarTitle`) or `hasNote` (resend the delete with
 * `deleteNote: true`).
 */
export class ProblemApiError extends ApiError {
  constructor(
    message: string,
    status: number,
    readonly duplicate?: DuplicateProblem,
    readonly overridable = false,
    readonly hasNote = false,
  ) {
    super(message, status);
    this.name = 'ProblemApiError';
  }
}

async function sendProblemRequest<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let data: Record<string, unknown> = {};
    try {
      const parsed = (await res.json()) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON error body — generic message below.
    }
    const dup = data.duplicate as Record<string, unknown> | undefined;
    const duplicate =
      dup && typeof dup.problemId === 'string' && typeof dup.title === 'string'
        ? {
            problemId: dup.problemId,
            title: dup.title,
            custom: dup.custom === true,
          }
        : undefined;
    throw new ProblemApiError(
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : `${method} ${path} failed (${res.status})`,
      res.status,
      duplicate,
      data.overridable === true,
      data.hasNote === true,
    );
  }
  return (await res.json()) as T;
}

/** POST /api/problems — 201 `{ problem }`; 409 duplicate ⇒ `ProblemApiError`. */
export async function createProblem(
  input: ProblemInput,
  options: { readonly allowSimilarTitle?: boolean } = {},
): Promise<CustomProblem> {
  const { problem } = await sendProblemRequest<{ problem: CustomProblem }>(
    'POST',
    '/api/problems',
    { ...input, ...(options.allowSimilarTitle && { allowSimilarTitle: true }) },
  );
  return problem;
}

/** PATCH /api/problems/:id — 200 `{ problem }`; 409 duplicate as for create. */
export async function updateProblem(
  id: string,
  patch: ProblemPatch,
  options: { readonly allowSimilarTitle?: boolean } = {},
): Promise<CustomProblem> {
  const { problem } = await sendProblemRequest<{ problem: CustomProblem }>(
    'PATCH',
    `/api/problems/${encodeURIComponent(id)}`,
    { ...patch, ...(options.allowSimilarTitle && { allowSimilarTitle: true }) },
  );
  return problem;
}

/** DELETE /api/problems/:id result (`backup` only when a note was deleted). */
export interface DeleteProblemResult {
  readonly deleted: boolean;
  readonly noteDeleted: boolean;
  readonly backup?: string;
}

/**
 * DELETE /api/problems/:id. Without `deleteNote`, a problem that has a note
 * answers 409 `{ hasNote: true }` (`ProblemApiError.hasNote`) — confirm, then
 * resend with `deleteNote: true` (the server backs the folder up first).
 */
export function deleteProblem(
  id: string,
  options: { readonly deleteNote?: boolean } = {},
): Promise<DeleteProblemResult> {
  return sendProblemRequest<DeleteProblemResult>(
    'DELETE',
    `/api/problems/${encodeURIComponent(id)}`,
    options.deleteNote ? { deleteNote: true } : {},
  );
}
