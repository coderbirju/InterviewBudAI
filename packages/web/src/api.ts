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
 */

import type {
  StorageAdapter,
  NoteStatus,
  IntuitionNote,
  IsoTimestamp,
} from '@ibai/storage';
import { isNoteStatus, resolveNoteStatus } from '@ibai/storage';
import type { CurriculumSource, Problem } from '@ibai/curriculum';
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

// ---------------------------------------------------------------------------
// Dependencies (mirrors the subset of CoachHandlerDeps the API needs)
// ---------------------------------------------------------------------------

/** Injected dependencies the API router needs. */
export interface ApiDeps {
  readonly catalog: CurriculumSource;
  readonly createStorage?: (dataDir: string) => StorageAdapter;
  readonly storage: StorageAdapter;
  readonly defaultDataDir?: string;
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
