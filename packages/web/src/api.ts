/**
 * JSON API layer (Milestone M1, ADR 0006 D4).
 *
 * Same-origin, localhost-only JSON endpoints the React SPA consumes. The server
 * owns the data directory and is the filesystem authority (ADR 0005 D2 +
 * amendment w2d): the browser is UI only and cannot choose where data goes.
 *
 * All routes live under `/api`, always return `application/json`, use the
 * server's data directory (`ApiDeps.dataDir`, resolved once at boot and
 * changed only by /setup), and never emit HTML. There is no auth (local-first).
 *
 * Endpoints:
 *   GET  /api/catalog     — full catalog grouped by topic + per-problem status
 *   GET  /api/notes/:id   — saved note for a problem (404 unknown id)
 *   POST /api/notes/:id   — upsert a note (validated; 404 unknown id)
 *   GET  /api/progress    — overall progress counts for the banner
 *   GET  /api/competency  — quiz-derived competency signals (weak/strong topics
 *                           + recurring miss patterns); safe empty when no DB
 *   GET  /api/config      — { dbConfigured, dataDir?, provider }
 *   GET  /api/data-dir    — active folder, source, pinned, exists, noteCount,
 *                           formatVersion, legacyCandidates (ADR 0009 D1)
 *   POST /api/data-dir    — { path, dryRun? } → dry run: report what is there;
 *                           else validate, create, persist, switch
 *   POST /api/data-dir/legacy/dismiss — stop offering previous-data folders
 *   POST /api/import/csv/preview — parse + match CSV files, no writes
 *   POST /api/import/csv/commit  — re-check the preview hash, back up the data
 *                                  dir, then write the chosen notes (ADR 0009 D2/D3)
 *   POST /api/quiz/start|new    — start / reshuffle a quiz session
 *   GET  /api/quiz/session      — resume the active session
 *   POST /api/quiz/answer       — submit an answer (verdict + advance)
 *   GET  /api/quiz/sessions     — list past + active sessions (empty-safe)
 *   POST /api/quiz/end          — end the active session (persist complete +
 *                                 clear the active pointer; stays LISTED)
 *   POST /api/quiz/resume       — re-activate a listed session by id
 *   POST /api/quiz/delete       — delete a session by id ({ sessionId })
 *   DELETE /api/quiz/session/:id — delete a session by id (REST form)
 */

import type {
  StorageAdapter,
  NoteStatus,
  IntuitionNote,
  IsoTimestamp,
  QuizSession,
  QuizSessionId,
  QuizSessionSummary,
  CompetencySignals,
  TopicId,
  TopicStrength,
} from '@ibai/storage';
import {
  isNoteStatus,
  resolveNoteStatus,
  LocalFileStorageAdapter,
} from '@ibai/storage';
import type { CurriculumSource, Problem } from '@ibai/curriculum';
import type { LlmProvider } from '@ibai/providers';
import {
  buildQuizPrompt,
  parseVerdict,
  shuffleDeck,
  advanceSession,
  appendAssistantTurn,
  appendNudgeTurn,
  nudgeAlreadyUsed,
  ensureCurrentQuestionPresented,
  currentProbe,
  presentProblem,
  currentProblemId,
  isDeckExhausted,
  quizProgress,
  updateCompetencySignals,
  emptyCompetencySignals,
} from './quiz.js';
import type { RandomSource } from './quiz.js';
import { computeStatusCounts } from './render.js';
import type { StatusCounts } from './render.js';
import { directoryExists } from './config.js';
import { settlesLegacy } from './data-dir-control.js';
import type {
  DataDirControl,
  DataDirInspection,
  DataDirStatus,
} from './data-dir-control.js';
import type { HandlerResponse } from './handler.js';
import { handleImportRoute } from './import/routes.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** Build a JSON HandlerResponse with the given status and payload. */
function json(status: number, payload: unknown): HandlerResponse {
  return {
    status,
    contentType: JSON_CONTENT_TYPE,
    body: JSON.stringify(payload),
  };
}

// ---------------------------------------------------------------------------
// Shapes returned to the SPA (M1 contract)
// ---------------------------------------------------------------------------

/** A catalog problem enriched with its resolved status for the active data dir. */
export interface ApiCatalogProblem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly difficulty: Problem['difficulty'];
  readonly status: NoteStatus;
  readonly completed: boolean;
}

/** A topic group in the catalog response. */
export interface ApiCatalogTopic {
  readonly topic: string;
  readonly problems: readonly ApiCatalogProblem[];
}

/** GET /api/catalog response shape. */
export interface ApiCatalogResponse {
  readonly topics: readonly ApiCatalogTopic[];
  readonly totals: {
    readonly total: number;
    readonly byStatus: StatusCounts;
  };
}

/** GET /api/progress response shape. */
export interface ApiProgressResponse {
  readonly completed: number;
  readonly total: number;
  readonly byStatus: StatusCounts;
}

/**
 * A per-topic competency entry returned by GET /api/competency. Mirrors
 * storage `TopicCompetency` with the derived `strength` band already computed
 * (via `deriveTopicStrength`) so the SPA shares one derivation rule.
 */
export interface ApiCompetencyTopic {
  readonly topicId: TopicId;
  readonly correct: number;
  readonly incorrect: number;
  readonly strength: TopicStrength;
  readonly lastSeen: string | null;
}

/**
 * A recurring miss pattern returned by GET /api/competency. Mirrors storage
 * `PatternSignal` — the `description` summarises the USER's own recurring gap,
 * never a shipped solution (§6.2).
 */
export interface ApiCompetencyPattern {
  readonly id: string;
  readonly description: string;
  readonly topics: readonly TopicId[];
  readonly occurrences: number;
  readonly lastObserved: string | null;
}

/**
 * GET /api/competency response shape. The quiz-derived competency-intelligence
 * signals for the active data dir: per-topic tallies + strength bands and the
 * recurring miss patterns. Safe empty (`{ topics: [], patterns: [] }`) when no
 * DB is configured or no signals exist yet. Read-only.
 */
export interface ApiCompetencyResponse {
  readonly topics: readonly ApiCompetencyTopic[];
  readonly patterns: readonly ApiCompetencyPattern[];
}

/** GET /api/notes/:id response shape (a saved or empty note). */
export interface ApiNoteResponse {
  readonly problemId: string;
  readonly content: string;
  readonly status: NoteStatus;
  readonly completed: boolean;
  readonly timeComplexity: string | null;
  readonly spaceComplexity: string | null;
  readonly lastUpdated: string | null;
}

/**
 * GET /api/data-dir (and every successful switching/dismissing POST) response
 * shape: `{ dataDir, source, pinned, exists, noteCount, formatVersion,
 * legacyCandidates: [{ path, noteCount, origin }] }` (ADR 0009 D1).
 */
export type ApiDataDirResponse = DataDirStatus;

/** `POST /api/data-dir { path, dryRun: true }` response shape (no writes). */
export type ApiDataDirInspection = DataDirInspection;

/** GET /api/config response shape. */
export interface ApiConfigResponse {
  readonly dbConfigured: boolean;
  readonly dataDir?: string;
  readonly provider: string;
}

/**
 * Check if an error looks like a connection refused error (Ollama not running),
 * so the quiz routes can tell the user what to fix.
 */
function isConnectionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('fetch failed') ||
      msg.includes('connection refused') ||
      msg.includes('network error')
    );
  }
  return false;
}

/** Check if an error looks like an authentication/authorization error. */
function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('401') ||
      msg.includes('unauthorized') ||
      msg.includes('api key') ||
      msg.includes('apikey') ||
      msg.includes('authentication') ||
      msg.includes('forbidden') ||
      msg.includes('x-api-key')
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Dependencies (mirrors the subset of CoachHandlerDeps the API needs)
// ---------------------------------------------------------------------------

/** Injected dependencies the API router needs. */
export interface ApiDeps {
  readonly catalog: CurriculumSource;
  readonly createStorage?: (dataDir: string) => StorageAdapter;
  readonly storage: StorageAdapter;
  /**
   * The server's active data directory (server state, never request input).
   * Absent directory on disk → the safe "no DB configured" states.
   */
  readonly dataDir: string;
  /**
   * The server's data-dir controller (the handler's single source of truth).
   * Required for the `/api/data-dir*` routes (absent → they 404).
   */
  readonly dataDirControl?: DataDirControl;
  /** LLM provider for the quiz routes. Absent → 400 (provider required). */
  readonly provider?: LlmProvider;
  readonly providerLabel?: string;
  /**
   * Random source for the quiz deck shuffle. Injectable so tests can pass a
   * seeded, deterministic generator; production defaults to `Math.random`.
   */
  readonly random?: RandomSource;
  /**
   * Clock for timestamps + session ids. Injectable for deterministic tests;
   * defaults to `() => new Date()`.
   */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve status for every catalog problem against a storage adapter (or none).
 * Read-only and safe: a missing adapter or per-problem read error degrades to
 * `'none'`, so this never throws and works when no DB is configured.
 */
async function resolveStatuses(
  problems: readonly Problem[],
  storage: StorageAdapter | null,
): Promise<Map<string, NoteStatus>> {
  const statusById = new Map<string, NoteStatus>();
  if (!storage?.readIntuitionNote) {
    return statusById;
  }
  for (const problem of problems) {
    try {
      const note = await storage.readIntuitionNote(problem.id);
      if (note) {
        statusById.set(problem.id, resolveNoteStatus(note));
      }
    } catch {
      // Ignore per-problem read errors — treated as 'none'.
    }
  }
  return statusById;
}

/**
 * Resolve the active data directory and a storage adapter for it, but only if
 * the directory actually exists. Returns `{ dataDir, storage: null }` when no
 * DB is configured so callers can produce a safe empty/clear state.
 *
 * Storage is ALWAYS built for the current `dataDir` (injected factory, else a
 * `LocalFileStorageAdapter`) — never the boot-time `deps.storage` — so after a
 * /setup switch no write can reach the old directory.
 */
function resolveActiveStorage(deps: ApiDeps): {
  dataDir: string;
  storage: StorageAdapter | null;
} {
  const dataDir = deps.dataDir;
  if (!directoryExists(dataDir)) {
    return { dataDir, storage: null };
  }
  const storage = deps.createStorage
    ? deps.createStorage(dataDir)
    : new LocalFileStorageAdapter(dataDir);
  return { dataDir, storage };
}

/**
 * Group problems by topic (a problem appears under each of its topics), topics
 * sorted alphabetically — matching the server-rendered catalog table so the SPA
 * renders the same structure.
 */
function groupByTopic(
  problems: readonly Problem[],
  statusById: Map<string, NoteStatus>,
): ApiCatalogTopic[] {
  const byTopic = new Map<string, ApiCatalogProblem[]>();
  for (const problem of problems) {
    const status = statusById.get(problem.id) ?? 'none';
    const enriched: ApiCatalogProblem = {
      id: problem.id,
      title: problem.title,
      url: problem.url,
      difficulty: problem.difficulty,
      status,
      completed: status === 'done',
    };
    for (const topic of problem.topics) {
      const list = byTopic.get(topic) ?? [];
      list.push(enriched);
      byTopic.set(topic, list);
    }
  }
  return Array.from(byTopic.keys())
    .sort()
    .map((topic) => ({ topic, problems: byTopic.get(topic) ?? [] }));
}

/** Count how many problems resolve to a given status across the catalog. */
function statusCountsFor(
  problems: readonly Problem[],
  statusById: Map<string, NoteStatus>,
): StatusCounts {
  const statuses: NoteStatus[] = problems.map(
    (p) => statusById.get(p.id) ?? 'none',
  );
  return computeStatusCounts(statuses);
}

// ---------------------------------------------------------------------------
// Quiz Master shapes + helpers (ADR 0007 Q2)
// ---------------------------------------------------------------------------

/**
 * A question presented to the SPA. Built DETERMINISTICALLY from the catalog
 * (ADR 0007 A1/A8) — no model call — so it can always be (re-)presented.
 */
export interface ApiQuizQuestion {
  readonly problemId: string;
  /**
   * Presentation text (`"<title> (<difficulty>)"`). The field name is kept for
   * wire stability (A1); it is NOT a model-authored rephrasing.
   */
  readonly wrapped: string;
  /** The problem's real title (additive, A8). */
  readonly title: string;
  /** The problem's difficulty (additive, A8). */
  readonly difficulty: Problem['difficulty'];
  /** External problem link from the catalog (additive, A8). */
  readonly url: string;
  /**
   * The `on_track` probe already given for this question, if any (additive,
   * A8) — shown separately from the problem so the title never disappears.
   */
  readonly probe?: string;
}

/** Session-state summary returned alongside questions. */
export interface ApiQuizState {
  readonly sessionId: QuizSessionId;
  readonly deckSize: number;
  readonly index: number;
  readonly answered: number;
  readonly status: QuizSession['status'];
}

/**
 * A list-oriented session summary returned by GET /api/quiz/sessions (session
 * management, quiz-fix-b). Mirrors storage `QuizSessionSummary` verbatim so the
 * SPA can render a scannable list (created time, progress, outcome, status,
 * whether it is the active/resumable one) without loading full sessions.
 */
export interface ApiQuizSessionSummary {
  readonly sessionId: QuizSessionId;
  readonly createdAt: string;
  readonly status: QuizSession['status'];
  readonly deckSize: number;
  readonly answeredCount: number;
  readonly correctCount: number;
  readonly isActive: boolean;
}

/** GET /api/quiz/sessions response shape (empty-safe). */
export interface ApiQuizSessionsResponse {
  readonly sessions: readonly ApiQuizSessionSummary[];
}

/** The error message returned when no provider is configured for a quiz route. */
const NO_MODEL_ERROR = 'no model configured';

/** Resolve the injected clock, defaulting to the real one. */
function nowDate(deps: ApiDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

/** Resolve the injected random source, defaulting to Math.random. */
function randomSource(deps: ApiDeps): RandomSource {
  return deps.random ?? Math.random;
}

/**
 * Classify a provider error into a clear JSON HandlerResponse (auth vs
 * connection vs unusable). Shared by all quiz routes that call the model.
 */
function providerErrorResponse(error: unknown): HandlerResponse {
  if (isConnectionError(error)) {
    return json(502, {
      error:
        'Could not reach the model provider. If using Ollama, is it running (ollama serve)? If using Anthropic, check your network.',
    });
  }
  if (isAuthError(error)) {
    return json(502, {
      error:
        'The model rejected the request - check your ANTHROPIC_API_KEY and IBAI_ANTHROPIC_MODEL (or your Ollama model).',
    });
  }
  return json(502, {
    error: 'The model returned an unusable response. Please try again.',
  });
}

/**
 * Read the user's done-set from the catalog + per-problem notes: every problem
 * whose resolved status is `'done'`. Read-only; a missing/failed read degrades
 * to "not done" so this never throws.
 */
async function readDoneProblemIds(
  problems: readonly Problem[],
  storage: StorageAdapter,
): Promise<string[]> {
  const done: string[] = [];
  if (!storage.readIntuitionNote) {
    return done;
  }
  for (const problem of problems) {
    try {
      const note = await storage.readIntuitionNote(problem.id);
      if (note && resolveNoteStatus(note) === 'done') {
        done.push(problem.id);
      }
    } catch {
      // Ignore per-problem read errors — treated as not done.
    }
  }
  return done;
}

/**
 * Build the wire question for a catalog problem — deterministic, no model call
 * (ADR 0007 A8). `probe` is the current question's spent `on_track` nudge, if
 * any.
 */
function toQuizQuestion(
  problem: Problem,
  probe?: string | null,
): ApiQuizQuestion {
  return {
    problemId: problem.id,
    wrapped: presentProblem(problem),
    title: problem.title,
    difficulty: problem.difficulty,
    url: problem.url,
    ...(probe ? { probe } : {}),
  };
}

/**
 * Resolve the CURRENT question of a session for (re-)presentation, healing a
 * missing presentation turn in memory (legacy orphans). Returns `null` when the
 * deck is exhausted or the current id is no longer in the catalog — i.e. the
 * session has nothing to present and must not be reported as an answerable
 * active quiz.
 */
function presentCurrent(
  deps: ApiDeps,
  session: QuizSession,
): {
  session: QuizSession;
  problem: Problem;
  question: ApiQuizQuestion;
} | null {
  const currentId = currentProblemId(session);
  const problem = currentId ? deps.catalog.getById(currentId) : undefined;
  if (!problem) {
    return null;
  }
  const at = nowDate(deps).toISOString() as IsoTimestamp;
  const healed = ensureCurrentQuestionPresented(
    session,
    presentProblem(problem),
    at,
  );
  return {
    session: healed,
    problem,
    question: toQuizQuestion(problem, currentProbe(healed)),
  };
}

/** Build the API state summary from a session. */
function toQuizState(session: QuizSession): ApiQuizState {
  const progress = quizProgress(session);
  return {
    sessionId: session.sessionId,
    deckSize: progress.deckSize,
    index: progress.index,
    answered: progress.answered,
    status: session.status,
  };
}

/** Map a storage {@link QuizSessionSummary} to the API list shape (verbatim). */
function toQuizSessionSummary(
  summary: QuizSessionSummary,
): ApiQuizSessionSummary {
  return {
    sessionId: summary.sessionId,
    createdAt: summary.createdAt,
    status: summary.status,
    deckSize: summary.deckSize,
    answeredCount: summary.answeredCount,
    correctCount: summary.correctCount,
    isActive: summary.isActive,
  };
}

/**
 * Parse a `{ sessionId: string }` body from an untrusted request. Returns the
 * trimmed id, or `null` when the body is not valid JSON, not an object, or the
 * `sessionId` is missing/empty. The caller turns `null` into a 400.
 */
function parseSessionIdBody(body: string | undefined): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? '{}');
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const raw = (parsed as Record<string, unknown>).sessionId;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  return raw.trim();
}

/**
 * Build a fresh shuffled session from the CURRENT done-set and present its
 * first question. Shared by POST /api/quiz/start and POST /api/quiz/new.
 *
 * Returns a `{ empty: true }` state (no session, no writes) when the done-set is
 * empty. The first question is presented DETERMINISTICALLY from the catalog
 * (no model call), and the session is persisted ONCE with that presentation
 * turn already in its transcript — so an active session can never exist
 * without a presentable question (ADR 0007 A8).
 */
async function startFreshSession(
  deps: ApiDeps,
  storage: StorageAdapter,
): Promise<HandlerResponse> {
  const problems = deps.catalog.list();
  const done = await readDoneProblemIds(problems, storage);
  if (done.length === 0) {
    return json(200, {
      empty: true,
      message: 'mark problems complete first',
    });
  }
  if (!storage.writeQuizSession) {
    return json(400, { error: 'no database configured' });
  }

  const deck = shuffleDeck(done, randomSource(deps));
  const at = nowDate(deps).toISOString() as IsoTimestamp;
  const sessionId = `quiz-${nowDate(deps).getTime()}-${Math.floor(
    randomSource(deps)() * 1e9,
  )
    .toString(36)
    .padStart(6, '0')}`;

  // The deck is built from catalog ids, so its first problem always resolves;
  // guard anyway BEFORE writing so we never persist an unpresentable session.
  const problem = deps.catalog.getById(deck[0]!);
  if (!problem) {
    return json(200, { empty: true, message: 'mark problems complete first' });
  }

  const session: QuizSession = appendAssistantTurn(
    {
      sessionId,
      createdAt: at,
      deck,
      currentIndex: 0,
      answered: [],
      transcript: [],
      status: 'active',
    },
    presentProblem(problem),
    at,
  );
  await storage.writeQuizSession(session);

  return json(200, {
    empty: false,
    session: toQuizState(session),
    question: toQuizQuestion(problem),
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** True if this request targets an `/api` route. */
export function isApiRoute(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Handle any `/api` request. Assumes `isApiRoute(pathname)` is already true.
 *
 * Returns JSON for every branch (never HTML): 405 for a wrong method on a known
 * path, 404 for an unknown `/api` path, and the endpoint payload otherwise.
 * Never throws — unexpected failures degrade to a 500 JSON error.
 */
export async function handleApiRoute(
  method: string,
  pathname: string,
  deps: ApiDeps,
  body: string | undefined,
): Promise<HandlerResponse> {
  try {
    // ----- /api/catalog (GET) -----
    if (pathname === '/api/catalog') {
      if (method !== 'GET') {
        return json(405, { error: 'method not allowed' });
      }
      const problems = deps.catalog.list();
      const { storage } = resolveActiveStorage(deps);
      const statusById = await resolveStatuses(problems, storage);
      const response: ApiCatalogResponse = {
        topics: groupByTopic(problems, statusById),
        totals: {
          total: problems.length,
          byStatus: statusCountsFor(problems, statusById),
        },
      };
      return json(200, response);
    }

    // ----- /api/progress (GET) -----
    if (pathname === '/api/progress') {
      if (method !== 'GET') {
        return json(405, { error: 'method not allowed' });
      }
      const problems = deps.catalog.list();
      const { storage } = resolveActiveStorage(deps);
      const statusById = await resolveStatuses(problems, storage);
      const byStatus = statusCountsFor(problems, statusById);
      const response: ApiProgressResponse = {
        completed: byStatus.done,
        total: problems.length,
        byStatus,
      };
      return json(200, response);
    }

    // ----- /api/competency (GET) -----
    if (pathname === '/api/competency') {
      if (method !== 'GET') {
        return json(405, { error: 'method not allowed' });
      }
      const { storage } = resolveActiveStorage(deps);
      // No DB / adapter without the method → safe empty (read-only).
      if (!storage?.readCompetencySignals) {
        const empty: ApiCompetencyResponse = { topics: [], patterns: [] };
        return json(200, empty);
      }
      const signals = await storage.readCompetencySignals();
      return json(200, toCompetencyResponse(signals));
    }

    // ----- /api/config (GET) -----
    if (pathname === '/api/config') {
      if (method !== 'GET') {
        return json(405, { error: 'method not allowed' });
      }
      const dataDir = deps.dataDir;
      const dbConfigured = directoryExists(dataDir);
      const response: ApiConfigResponse = {
        dbConfigured,
        provider: deps.providerLabel ?? 'No model configured',
        ...(dbConfigured ? { dataDir } : {}),
      };
      return json(200, response);
    }

    // ----- /api/data-dir (GET, POST) + legacy accept/dismiss (POST) -----
    if (pathname === '/api/data-dir' || pathname.startsWith('/api/data-dir/')) {
      return handleDataDirRoute(method, pathname, deps.dataDirControl, body);
    }

    // ----- /api/import/csv/preview|commit (POST, ADR 0009 D2) -----
    if (pathname.startsWith('/api/import/')) {
      const imported = await handleImportRoute(
        method,
        pathname,
        {
          catalog: deps.catalog,
          dataDir: deps.dataDir,
          storage: resolveActiveStorage(deps).storage,
          ...(deps.now !== undefined && { now: deps.now }),
        },
        body,
      );
      if (imported !== null) return imported;
    }

    // ----- /api/notes/:id (GET, POST) -----
    if (pathname.startsWith('/api/notes/')) {
      const problemId = decodeURIComponent(
        pathname.slice('/api/notes/'.length),
      );

      if (method !== 'GET' && method !== 'POST') {
        return json(405, { error: 'method not allowed' });
      }

      // Validate the id against the catalog first (independent of DB state).
      const problem = deps.catalog.getById(problemId);
      if (!problem) {
        return json(404, {
          error: 'unknown problem',
          problemId,
        });
      }

      const { storage } = resolveActiveStorage(deps);

      if (method === 'GET') {
        // No DB configured: return a clear state rather than erroring.
        if (!storage?.readIntuitionNote) {
          return json(200, { dbConfigured: false });
        }
        const note = await storage.readIntuitionNote(problemId);
        return json(200, toNoteResponse(problemId, note));
      }

      // POST — upsert. No DB configured: clear JSON error, do not crash.
      if (!storage?.writeIntuitionNote) {
        return json(400, { error: 'no database configured' });
      }

      // Parse untrusted body.
      let parsed: unknown;
      try {
        parsed = JSON.parse(body ?? '{}');
      } catch {
        return json(400, { error: 'invalid JSON body' });
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return json(400, { error: 'invalid JSON body' });
      }
      const input = parsed as Record<string, unknown>;

      // Validate/normalize fields. content optional (defaults to existing or '').
      if (input.content !== undefined && typeof input.content !== 'string') {
        return json(400, { error: 'content must be a string' });
      }
      if (
        input.timeComplexity !== undefined &&
        typeof input.timeComplexity !== 'string'
      ) {
        return json(400, { error: 'timeComplexity must be a string' });
      }
      if (
        input.spaceComplexity !== undefined &&
        typeof input.spaceComplexity !== 'string'
      ) {
        return json(400, { error: 'spaceComplexity must be a string' });
      }
      // Frontmatter values are single-line (storage rejects CR/LF).
      for (const key of ['timeComplexity', 'spaceComplexity'] as const) {
        const v = input[key];
        if (typeof v === 'string' && /[\r\n]/.test(v)) {
          return json(400, { error: `${key} must be a single line` });
        }
      }
      if (input.status !== undefined && !isNoteStatus(input.status)) {
        return json(400, { error: 'invalid status' });
      }

      // Read existing note to preserve unspecified fields (attempts, content).
      const existing = storage.readIntuitionNote
        ? await storage.readIntuitionNote(problemId)
        : null;

      const status: NoteStatus =
        input.status !== undefined && isNoteStatus(input.status)
          ? input.status
          : existing?.status ?? 'none';
      // Keep completed consistent with status 'done' (storage layer rule).
      const completed = status === 'done';
      const content =
        input.content !== undefined
          ? (input.content as string)
          : existing?.content ?? '';
      const timeComplexity =
        input.timeComplexity !== undefined
          ? (input.timeComplexity as string) || undefined
          : existing?.timeComplexity;
      const spaceComplexity =
        input.spaceComplexity !== undefined
          ? (input.spaceComplexity as string) || undefined
          : existing?.spaceComplexity;

      const note: IntuitionNote = {
        problemId,
        content,
        lastUpdated: new Date().toISOString() as IsoTimestamp,
        attempts: existing?.attempts,
        status,
        completed,
        timeComplexity,
        spaceComplexity,
      };

      await storage.writeIntuitionNote(note);
      return json(200, toNoteResponse(problemId, note));
    }

    // ----- /api/quiz/* (Quiz Master engine, ADR 0007 Q2) -----
    if (pathname === '/api/quiz/start' || pathname === '/api/quiz/new') {
      if (method !== 'POST') {
        return json(405, { error: 'method not allowed' });
      }
      if (!deps.provider) {
        return json(400, { error: NO_MODEL_ERROR });
      }
      const { storage } = resolveActiveStorage(deps);
      if (!storage?.writeQuizSession || !storage.readIntuitionNote) {
        return json(400, { error: 'no database configured' });
      }
      // `new` discards any active session implicitly by building a fresh one
      // (writing the new active pointer). `start` reuses the same builder.
      // The provider is still REQUIRED here (answers need a model), even
      // though presenting the question no longer calls it.
      return startFreshSession(deps, storage);
    }

    // ----- /api/quiz/sessions (GET) — list past + active sessions -----
    if (pathname === '/api/quiz/sessions') {
      if (method !== 'GET') {
        return json(405, { error: 'method not allowed' });
      }
      const { storage } = resolveActiveStorage(deps);
      // No DB / adapter without the method → safe empty list (read-only).
      if (!storage?.listQuizSessions) {
        const empty: ApiQuizSessionsResponse = { sessions: [] };
        return json(200, empty);
      }
      const summaries = await storage.listQuizSessions();
      const response: ApiQuizSessionsResponse = {
        sessions: summaries.map(toQuizSessionSummary),
      };
      return json(200, response);
    }

    // ----- /api/quiz/end (POST) — end the active session, keep it listed -----
    if (pathname === '/api/quiz/end') {
      if (method !== 'POST') {
        return json(405, { error: 'method not allowed' });
      }
      const { storage } = resolveActiveStorage(deps);
      if (!storage?.readActiveQuizSession || !storage.writeQuizSession) {
        return json(400, { error: 'no database configured' });
      }
      const active = await storage.readActiveQuizSession();
      if (!active || active.status !== 'active') {
        return json(404, { error: 'no active quiz session' });
      }
      // Persist as complete: writeQuizSession clears the active pointer when it
      // referenced this session, so it stops being resumable-active but REMAINS
      // listed (the session file is preserved — end does NOT delete).
      const ended: QuizSession = { ...active, status: 'complete' };
      await storage.writeQuizSession(ended);
      return json(200, { ok: true, session: toQuizState(ended) });
    }

    // ----- /api/quiz/resume (POST) — re-activate a listed session -----
    if (pathname === '/api/quiz/resume') {
      if (method !== 'POST') {
        return json(405, { error: 'method not allowed' });
      }
      const { storage } = resolveActiveStorage(deps);
      if (!storage?.readQuizSession || !storage.writeQuizSession) {
        return json(400, { error: 'no database configured' });
      }
      const sessionId = parseSessionIdBody(body);
      if (!sessionId) {
        return json(400, { error: 'sessionId must be a non-empty string' });
      }
      const target = await storage.readQuizSession(sessionId);
      if (!target) {
        return json(404, { error: 'unknown quiz session' });
      }
      // Re-present the CURRENT question deterministically from the catalog
      // (healing a legacy missing presentation turn). If there is nothing to
      // present (deck exhausted / problem gone from the catalog) the session
      // is NOT re-activated — an active session must always be answerable —
      // and it is returned as complete, viewable only.
      const presented = presentCurrent(deps, target);
      if (!presented) {
        const finished: QuizSession = { ...target, status: 'complete' };
        if (target.status !== 'complete') {
          await storage.writeQuizSession(finished);
        }
        return json(200, {
          ok: true,
          session: toQuizState(finished),
          question: null,
          transcript: finished.transcript,
        });
      }
      // Re-activate: writeQuizSession points active.json at it.
      const reactivated: QuizSession = {
        ...presented.session,
        status: 'active',
      };
      await storage.writeQuizSession(reactivated);
      return json(200, {
        ok: true,
        session: toQuizState(reactivated),
        question: presented.question,
        transcript: reactivated.transcript,
      });
    }

    // ----- /api/quiz/delete (POST) — delete a session by id -----
    if (pathname === '/api/quiz/delete') {
      if (method !== 'POST') {
        return json(405, { error: 'method not allowed' });
      }
      const { storage } = resolveActiveStorage(deps);
      if (!storage?.deleteQuizSession) {
        return json(400, { error: 'no database configured' });
      }
      const sessionId = parseSessionIdBody(body);
      if (!sessionId) {
        return json(400, { error: 'sessionId must be a non-empty string' });
      }
      await storage.deleteQuizSession(sessionId);
      return json(200, { ok: true });
    }

    // ----- DELETE /api/quiz/session/:id — delete a session by id -----
    if (pathname.startsWith('/api/quiz/session/')) {
      const rawId = decodeURIComponent(
        pathname.slice('/api/quiz/session/'.length),
      );
      if (method !== 'DELETE') {
        return json(405, { error: 'method not allowed' });
      }
      if (rawId.trim().length === 0) {
        return json(400, { error: 'sessionId must be a non-empty string' });
      }
      const { storage } = resolveActiveStorage(deps);
      if (!storage?.deleteQuizSession) {
        return json(400, { error: 'no database configured' });
      }
      await storage.deleteQuizSession(rawId);
      return json(200, { ok: true });
    }

    if (pathname === '/api/quiz/session') {
      if (method !== 'GET') {
        return json(405, { error: 'method not allowed' });
      }
      const { storage } = resolveActiveStorage(deps);
      if (!storage?.readActiveQuizSession) {
        return json(200, { active: false });
      }
      const session = await storage.readActiveQuizSession();
      if (!session || session.status !== 'active') {
        return json(200, { active: false });
      }
      // Re-present the CURRENT question deterministically from the catalog
      // (read-only: any legacy repair is only in memory here; /answer and
      // /resume persist it). Nothing presentable → not an active quiz.
      const presented = presentCurrent(deps, session);
      if (!presented) {
        return json(200, { active: false });
      }
      return json(200, {
        active: true,
        session: toQuizState(presented.session),
        question: presented.question,
        transcript: presented.session.transcript,
      });
    }

    if (pathname === '/api/quiz/answer') {
      if (method !== 'POST') {
        return json(405, { error: 'method not allowed' });
      }
      if (!deps.provider) {
        return json(400, { error: NO_MODEL_ERROR });
      }
      const { storage } = resolveActiveStorage(deps);
      if (
        !storage?.readActiveQuizSession ||
        !storage.writeQuizSession ||
        !storage.readIntuitionNote ||
        !storage.writeIntuitionNote ||
        !storage.readCompetencySignals ||
        !storage.writeCompetencySignals
      ) {
        return json(400, { error: 'no database configured' });
      }

      // Parse + validate the untrusted body.
      let parsed: unknown;
      try {
        parsed = JSON.parse(body ?? '{}');
      } catch {
        return json(400, { error: 'invalid JSON body' });
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return json(400, { error: 'invalid JSON body' });
      }
      const rawAnswer = (parsed as Record<string, unknown>).answer;
      if (typeof rawAnswer !== 'string' || rawAnswer.trim().length === 0) {
        return json(400, { error: 'answer must be a non-empty string' });
      }
      const answer = rawAnswer.trim();

      const stored = await storage.readActiveQuizSession();
      if (!stored || stored.status !== 'active') {
        return json(404, { error: 'no active quiz session' });
      }
      // Resolve (and, for legacy orphans, heal in memory) the current
      // question — the same one GET /api/quiz/session presented. The repair is
      // only persisted together with this turn's write (fail-closed intact).
      const presented = presentCurrent(deps, stored);
      if (!presented) {
        return json(404, { error: 'no current question' });
      }
      const { session, problem } = presented;
      const problemId = problem.id;
      const question = toQuizQuestion(problem);

      // Read the user's OWN intuition note for personalization (never a
      // shipped answer). Missing note is fine.
      let intuition: string | null = null;
      try {
        const note = await storage.readIntuitionNote(problemId);
        intuition = note?.content ?? null;
      } catch {
        intuition = null;
      }

      // Call the model for a structured verdict; parse UNTRUSTED, fail closed.
      let verdict;
      try {
        const messages = buildQuizPrompt({
          problem,
          intuition,
          answer,
        });
        const response = await deps.provider.complete({ messages });
        const content =
          typeof response.content === 'string' ? response.content : '';
        verdict = parseVerdict(content);
      } catch (error) {
        // Malformed model output → fail closed: NO writes, clear JSON error.
        if (error instanceof Error && error.message.startsWith('quiz: ')) {
          return json(502, {
            error: 'The model returned an unusable verdict. Please try again.',
          });
        }
        return providerErrorResponse(error);
      }

      const at = nowDate(deps).toISOString() as IsoTimestamp;

      // AT-MOST-ONE-NUDGE ENGINE ENFORCEMENT (quiz-fix-a):
      // If the model returns 'on_track' but this question has ALREADY consumed
      // its single allowed probe, COERCE it to a terminal 'incorrect' so the
      // at-most-one-nudge guarantee holds even if the model misbehaves.
      const coerceToIncorrect =
        verdict.verdict === 'on_track' && nudgeAlreadyUsed(session);

      // 'on_track' (first, un-coerced) → a single non-terminal probe: stay on
      // the same question, record the answer + probe in the transcript (so the
      // nudge is counted and survives resume), do NOT advance or write outcomes.
      if (verdict.verdict === 'on_track' && !coerceToIncorrect) {
        const updated = appendNudgeTurn(session, answer, verdict.feedback, at);
        await storage.writeQuizSession(updated);
        return json(200, {
          verdict: 'on_track',
          feedback: verdict.feedback,
          ...(verdict.optimalNudge
            ? { optimalNudge: verdict.optimalNudge }
            : {}),
          terminal: false,
          session: toQuizState(updated),
          // The problem stays displayed; the probe travels separately.
          question: { ...question, probe: verdict.feedback },
        });
      }

      // Terminal verdict (correct | incorrect). A coerced second 'on_track'
      // becomes 'incorrect'; the model's feedback (a probe) is still shown, but
      // the turn is terminal and the deck advances.
      const terminalVerdict: 'correct' | 'incorrect' = coerceToIncorrect
        ? 'incorrect'
        : (verdict.verdict as 'correct' | 'incorrect');

      // On INCORRECT: flip the note status to 'to_revisit' (preserve other
      // fields; storage keeps `completed` consistent). Do this BEFORE advancing
      // so a failure here fails the whole turn (no partial state divergence).
      if (terminalVerdict === 'incorrect') {
        let existing: IntuitionNote | null = null;
        try {
          existing = await storage.readIntuitionNote(problemId);
        } catch {
          existing = null;
        }
        const revisit: IntuitionNote = {
          problemId,
          content: existing?.content ?? '',
          lastUpdated: at,
          attempts: existing?.attempts,
          status: 'to_revisit',
          completed: false,
          timeComplexity: existing?.timeComplexity,
          spaceComplexity: existing?.spaceComplexity,
        };
        await storage.writeIntuitionNote(revisit);
      }

      // Update competency signals.
      const currentSignals: CompetencySignals =
        (await storage.readCompetencySignals()) ?? emptyCompetencySignals(at);
      const updatedSignals = updateCompetencySignals(currentSignals, {
        topics: problem.topics,
        verdict: terminalVerdict,
        problemId,
        problemTitle: problem.title,
        intuition,
        at,
      });
      await storage.writeCompetencySignals(updatedSignals);

      // Advance the session (append transcript, bump index, maybe complete).
      const assistantTurn = verdict.optimalNudge
        ? `${verdict.feedback}\n\n${verdict.optimalNudge}`
        : verdict.feedback;
      let advanced = advanceSession(session, {
        problemId,
        verdict: terminalVerdict,
        at,
        userTurn: answer,
        assistantTurn,
      });

      // If the deck is exhausted, persist the complete session and report done.
      if (isDeckExhausted(advanced)) {
        await storage.writeQuizSession(advanced);
        return json(200, {
          verdict: terminalVerdict,
          feedback: verdict.feedback,
          ...(verdict.optimalNudge
            ? { optimalNudge: verdict.optimalNudge }
            : {}),
          terminal: true,
          complete: true,
          session: toQuizState(advanced),
          question: null,
        });
      }

      // Otherwise present the next question.
      const nextId = currentProblemId(advanced);
      const nextProblem = nextId ? deps.catalog.getById(nextId) : undefined;
      if (!nextProblem) {
        // Next id unknown (catalog changed): persist progress + report complete.
        const forced: QuizSession = { ...advanced, status: 'complete' };
        await storage.writeQuizSession(forced);
        return json(200, {
          verdict: terminalVerdict,
          feedback: verdict.feedback,
          terminal: true,
          complete: true,
          session: toQuizState(forced),
          question: null,
        });
      }

      // Present the next question deterministically (no model call) and
      // persist ONCE with its presentation turn, so it is always resumable.
      advanced = appendAssistantTurn(advanced, presentProblem(nextProblem), at);
      await storage.writeQuizSession(advanced);
      return json(200, {
        verdict: terminalVerdict,
        feedback: verdict.feedback,
        ...(verdict.optimalNudge ? { optimalNudge: verdict.optimalNudge } : {}),
        terminal: true,
        complete: false,
        session: toQuizState(advanced),
        question: toQuizQuestion(nextProblem),
      });
    }

    // ----- Unknown /api path -----
    return json(404, { error: 'not found' });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'internal server error';
    return json(500, { error: message });
  }
}

/**
 * Map the stored {@link CompetencySignals} dataset to the flat, sorted
 * GET /api/competency response. Topics are emitted as an array (the on-disk
 * shape keys them by id) sorted weak→strong then by most misses so the SPA can
 * render a scannable list without re-sorting; patterns are ordered by most
 * occurrences then most recently observed. Every value is the user's OWN
 * outcome/pattern — no shipped solutions (§6.2). Read-only, pure mapping.
 */
function toCompetencyResponse(
  signals: CompetencySignals,
): ApiCompetencyResponse {
  // Strength ordering for a weak-first scan (unknown sinks to the bottom).
  const order: Record<TopicStrength, number> = {
    weak: 0,
    improving: 1,
    strong: 2,
    unknown: 3,
  };
  const topics: ApiCompetencyTopic[] = Object.values(signals.topics)
    .map((t) => ({
      topicId: t.topicId,
      correct: t.correct,
      incorrect: t.incorrect,
      strength: t.strength,
      lastSeen: t.lastSeen ?? null,
    }))
    .sort((a, b) => {
      const byStrength = order[a.strength] - order[b.strength];
      if (byStrength !== 0) {
        return byStrength;
      }
      const byMisses = b.incorrect - a.incorrect;
      if (byMisses !== 0) {
        return byMisses;
      }
      return a.topicId.localeCompare(b.topicId);
    });

  const patterns: ApiCompetencyPattern[] = signals.patterns
    .map((p) => ({
      id: p.id,
      description: p.description,
      topics: [...p.topics],
      occurrences: p.occurrences,
      lastObserved: p.lastObserved ?? null,
    }))
    .sort((a, b) => {
      const byOccurrences = b.occurrences - a.occurrences;
      if (byOccurrences !== 0) {
        return byOccurrences;
      }
      return (b.lastObserved ?? '').localeCompare(a.lastObserved ?? '');
    });

  return { topics, patterns };
}

/**
 * Map a stored note (or null) to the API note response. A missing note yields
 * an empty note with status 'none' rather than a 404 (the id is already known
 * to be a valid catalog problem).
 */
function toNoteResponse(
  problemId: string,
  note: IntuitionNote | null,
): ApiNoteResponse {
  if (!note) {
    return {
      problemId,
      content: '',
      status: 'none',
      completed: false,
      timeComplexity: null,
      spaceComplexity: null,
      lastUpdated: null,
    };
  }
  const status = resolveNoteStatus(note);
  return {
    problemId,
    content: note.content,
    status,
    completed: status === 'done',
    timeComplexity: note.timeComplexity ?? null,
    spaceComplexity: note.spaceComplexity ?? null,
    lastUpdated: note.lastUpdated ?? null,
  };
}

/**
 * Parse `{ path: string, dryRun?: boolean }` from an untrusted JSON body
 * (`null` if invalid).
 */
function parseDataDirBody(
  body: string | undefined,
): { readonly path: string; readonly dryRun: boolean } | null {
  if (body === undefined || body.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const { path: value, dryRun } = parsed as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  if (dryRun !== undefined && typeof dryRun !== 'boolean') return null;
  return { path: value, dryRun: dryRun === true };
}

/**
 * The data-folder routes (ADR 0009 D1). Every change goes through
 * `DataDirControl.choose` — the same validate → create 0700 → persist
 * config.json → switch path `POST /setup` uses. The Host / Origin / JSON
 * content-type prechecks and the body cap already ran in the handler.
 */
function handleDataDirRoute(
  method: string,
  pathname: string,
  control: DataDirControl | undefined,
  body: string | undefined,
): HandlerResponse {
  if (control === undefined) {
    return json(404, { error: 'not found' });
  }
  const statusResponse = (): HandlerResponse => {
    const response: ApiDataDirResponse = control.status();
    return json(200, response);
  };

  if (pathname === '/api/data-dir') {
    if (method === 'GET') {
      return statusResponse();
    }
    if (method !== 'POST') {
      return json(405, { error: 'method not allowed' });
    }
    const requested = parseDataDirBody(body);
    if (requested === null) {
      return json(400, {
        error: 'expected a JSON body { "path": string, "dryRun"?: boolean }',
      });
    }
    if (requested.dryRun) {
      // Validate + report what is there; no writes, no switch.
      const inspected = control.inspect(requested.path);
      if (!inspected.ok) {
        return json(400, { error: inspected.error });
      }
      const response: ApiDataDirInspection = inspected.inspection;
      return json(200, response);
    }
    const chosen = control.choose(requested.path);
    if (!chosen.ok) {
      return json(400, { error: chosen.error });
    }
    // A switch settles legacy recovery: the handler expires the cookie.
    return settlesLegacy(statusResponse());
  }

  if (pathname === '/api/data-dir/legacy/dismiss') {
    if (method !== 'POST') {
      return json(405, { error: 'method not allowed' });
    }
    control.dismissLegacy();
    return settlesLegacy(statusResponse());
  }

  return json(404, { error: 'not found' });
}
