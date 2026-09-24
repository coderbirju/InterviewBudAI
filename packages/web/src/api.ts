/**
 * JSON API layer (Milestone M1, ADR 0006 D4).
 *
 * Same-origin, localhost-only JSON endpoints the React SPA consumes. The server
 * remains the storage owner: the browser is UI + cookie, the server is the
 * filesystem authority (ADR 0005 D2). These routes are additive — the existing
 * server-rendered pages and the `/app` bundle keep working unchanged.
 *
 * All routes live under `/api`, always return `application/json`, resolve the
 * data directory per-request with the SAME cookie > env > default precedence
 * used everywhere else (`resolveDataDirWithCookie`), and never emit HTML. There
 * is no auth (local-first).
 *
 * Endpoints:
 *   GET  /api/catalog     — full catalog grouped by topic + per-problem status
 *   GET  /api/notes/:id   — saved note for a problem (404 unknown id)
 *   POST /api/notes/:id   — upsert a note (validated; 404 unknown id)
 *   GET  /api/progress    — overall progress counts for the banner
 *   GET  /api/config      — { dbConfigured, dataDir?, provider }
 *   POST /api/chat        — one interview-coach chat turn (provider REQUIRED;
 *                           the MODEL is the only source of assistant text)
 */

import type {
  StorageAdapter,
  NoteStatus,
  IntuitionNote,
  IsoTimestamp,
} from '@ibai/storage';
import { isNoteStatus, resolveNoteStatus } from '@ibai/storage';
import type { CurriculumSource, Problem } from '@ibai/curriculum';
import type { LlmProvider, PromptMessage } from '@ibai/providers';
import { computeStatusCounts } from './render.js';
import type { StatusCounts } from './render.js';
import { directoryExists, resolveDataDirWithCookie } from './config.js';
import type { HandlerResponse } from './handler.js';

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

/** GET /api/config response shape. */
export interface ApiConfigResponse {
  readonly dbConfigured: boolean;
  readonly dataDir?: string;
  readonly provider: string;
}

/** A single chat turn in a POST /api/chat request (untrusted until validated). */
export interface ApiChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** POST /api/chat response shape: the model's reply text only. */
export interface ApiChatResponse {
  readonly reply: string;
}

/**
 * The interview-coach persona prepended (as the `system` message) to every
 * chat turn. Kept IDENTICAL to the server-rendered `POST /coach` persona so the
 * two surfaces behave the same. Per charter §6.2 the MODEL is the only source
 * of assistant text — this persona shapes the conversation but ships NO canned
 * answers: it elicits the candidate's own reasoning and withholds full
 * solutions until they have worked through the problem themselves.
 */
export const INTERVIEW_COACH_PERSONA =
  'You are an interview coach for software engineering candidates. Hold a ' +
  'natural conversation: ask probing questions, help the candidate reason ' +
  'through problems, and give feedback on THEIR ideas. Elicit their own ' +
  'thinking. Do NOT dump full solutions or code unless they have worked ' +
  'through it themselves.';

/**
 * Check if an error looks like a connection refused error (Ollama not running).
 * Mirrors the classifier used by the server-rendered coach routes so the JSON
 * chat endpoint distinguishes the same failure modes.
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
  readonly defaultDataDir?: string;
  /** LLM provider for POST /api/chat. Absent → chat returns 400 (provider required). */
  readonly provider?: LlmProvider;
  readonly providerLabel?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly argv?: string[];
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
 */
function resolveActiveStorage(
  cookieDataDir: string | undefined,
  deps: ApiDeps,
): { dataDir: string; storage: StorageAdapter | null } {
  const dataDir = resolveDataDirWithCookie(
    cookieDataDir,
    deps.env,
    deps.argv,
    deps.defaultDataDir,
  );
  if (!directoryExists(dataDir)) {
    return { dataDir, storage: null };
  }
  const storage = deps.createStorage
    ? deps.createStorage(dataDir)
    : deps.storage;
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

/**
 * Validate + normalize an untrusted `messages` array into `ApiChatMessage[]`.
 * Returns `null` if the value is not a non-empty array of well-formed turns
 * (each an object with role 'user'|'assistant' and a string `content`). The
 * body is untrusted, so we trim content and reject anything else rather than
 * coercing — the caller turns a `null` into a 400.
 */
function parseChatMessages(value: unknown): ApiChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const out: ApiChatMessage[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const turn = raw as Record<string, unknown>;
    if (turn.role !== 'user' && turn.role !== 'assistant') {
      return null;
    }
    if (typeof turn.content !== 'string') {
      return null;
    }
    const content = turn.content.trim();
    if (content.length === 0) {
      return null;
    }
    out.push({ role: turn.role, content });
  }
  // A meaningful turn must end with the candidate's message.
  if (out[out.length - 1]?.role !== 'user') {
    return null;
  }
  return out;
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
  cookieDataDir: string | undefined,
  body: string | undefined,
): Promise<HandlerResponse> {
  try {
    // ----- /api/catalog (GET) -----
    if (pathname === '/api/catalog') {
      if (method !== 'GET') {
        return json(405, { error: 'method not allowed' });
      }
      const problems = deps.catalog.list();
      const { storage } = resolveActiveStorage(cookieDataDir, deps);
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
      const { storage } = resolveActiveStorage(cookieDataDir, deps);
      const statusById = await resolveStatuses(problems, storage);
      const byStatus = statusCountsFor(problems, statusById);
      const response: ApiProgressResponse = {
        completed: byStatus.done,
        total: problems.length,
        byStatus,
      };
      return json(200, response);
    }

    // ----- /api/config (GET) -----
    if (pathname === '/api/config') {
      if (method !== 'GET') {
        return json(405, { error: 'method not allowed' });
      }
      const dataDir = resolveDataDirWithCookie(
        cookieDataDir,
        deps.env,
        deps.argv,
        deps.defaultDataDir,
      );
      const dbConfigured = directoryExists(dataDir);
      const response: ApiConfigResponse = {
        dbConfigured,
        provider: deps.providerLabel ?? 'No model configured',
        ...(dbConfigured ? { dataDir } : {}),
      };
      return json(200, response);
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

      const { storage } = resolveActiveStorage(cookieDataDir, deps);

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

    // ----- /api/chat (POST) -----
    if (pathname === '/api/chat') {
      if (method !== 'POST') {
        return json(405, { error: 'method not allowed' });
      }

      // Provider REQUIRED (mirrors the coach behavior). No provider → 400 JSON
      // with configuration guidance; we never fabricate assistant text (§6.2).
      if (!deps.provider) {
        return json(400, {
          error: 'no model configured',
          detail:
            'Set ANTHROPIC_API_KEY + IBAI_ANTHROPIC_MODEL, or IBAI_OLLAMA_MODEL, to start the interview chat.',
        });
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

      // Accept the canonical shape { messages: [...] } (prior transcript + the
      // new user turn). Validate every turn; a malformed array → 400.
      const messages = parseChatMessages(
        (parsed as Record<string, unknown>).messages,
      );
      if (!messages) {
        return json(400, {
          error:
            'invalid messages: expected a non-empty array of { role: "user"|"assistant", content } ending with a user turn',
        });
      }

      // Build the prompt: coach persona (system) + the conversation.
      const promptMessages: PromptMessage[] = [
        { role: 'system', content: INTERVIEW_COACH_PERSONA },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      let reply: string;
      try {
        const response = await deps.provider.complete({
          messages: promptMessages,
        });
        reply =
          typeof response.content === 'string' ? response.content.trim() : '';
        if (!reply) {
          throw new Error('Empty response from model');
        }
      } catch (providerError) {
        // Distinguish auth vs connection vs malformed; never crash.
        if (isConnectionError(providerError)) {
          return json(502, {
            error:
              'Could not reach the model provider. If using Ollama, is it running (ollama serve)? If using Anthropic, check your network.',
          });
        }
        if (isAuthError(providerError)) {
          return json(502, {
            error:
              'The model rejected the request - check your ANTHROPIC_API_KEY and IBAI_ANTHROPIC_MODEL (or your Ollama model).',
          });
        }
        return json(502, {
          error: 'The model returned an unusable response. Please try again.',
        });
      }

      const chatResponse: ApiChatResponse = { reply };
      return json(200, chatResponse);
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
