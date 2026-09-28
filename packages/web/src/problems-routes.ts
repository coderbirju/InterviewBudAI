/**
 * Custom problem routes (ADR 0010 D5):
 *
 *   POST   /api/problems      { title, url?, statement?, difficulty, topics,
 *                              allowSimilarTitle? } → 201 { problem }
 *   PATCH  /api/problems/:id  any of title, url, statement (null clears),
 *                             difficulty, topics (+ allowSimilarTitle?)
 *                             → 200 { problem }
 *   DELETE /api/problems/:id  { deleteNote? } → 200 { deleted, noteDeleted, backup? }
 *
 * The Host / Origin / JSON content-type prechecks and the 1 MiB body cap
 * already ran in the handler / server. Every input is untrusted (§7.3):
 * unknown fields ⇒ 400, ids are server-generated, only `u-` ids are
 * editable (catalog ids ⇒ 403). Duplicates are found with the CSV matcher
 * (#65) over the catalog AND existing custom problems.
 */

import type { CurriculumSource } from '@ibai/curriculum';
import type {
  CustomProblem,
  IsoTimestamp,
  StorageAdapter,
} from '@ibai/storage';
import {
  CUSTOM_PROBLEM_LIMITS,
  generateCustomProblemId,
  isCustomProblemId,
  normalizeCustomStatement,
  normalizeCustomTitle,
  normalizeCustomTopics,
  normalizeCustomUrl,
} from '@ibai/storage';
import type { HandlerResponse } from './handler.js';
import { createBackup } from './import/backup.js';
import { createCatalogMatcher } from './import/match.js';
import {
  curriculumTopic,
  customProblemView,
  mergeProblemSource,
} from './problems.js';

export const PROBLEMS_PATH = '/api/problems';

/** What the routes need from the API layer. */
export interface ProblemRouteDeps {
  readonly catalog: CurriculumSource;
  /** Active data dir (server state). */
  readonly dataDir: string;
  /** Storage for `dataDir`, or null when the folder does not exist. */
  readonly storage: StorageAdapter | null;
  readonly now?: () => Date;
  /** Snapshot hook (defaults to {@link createBackup}); injectable for tests. */
  readonly backup?: (dataDir: string, now: Date) => Promise<string>;
  /** Randomness for ids (defaults to `crypto.randomInt`). */
  readonly randomInt?: (max: number) => number;
}

/** The `{ problem }` wire shape: the stored record plus `custom: true`. */
export type ApiCustomProblem = CustomProblem & { readonly custom: true };

function json(status: number, payload: unknown): HandlerResponse {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  };
}

const NO_DB = json(400, { error: 'no database configured' });
const CREATE_FIELDS = new Set([
  'title',
  'url',
  'statement',
  'difficulty',
  'topics',
  'allowSimilarTitle',
]);
const DELETE_FIELDS = new Set(['deleteNote']);

type Fail = { readonly ok: false; readonly response: HandlerResponse };
const fail = (status: number, payload: unknown): Fail => ({
  ok: false,
  response: json(status, payload),
});

/** Parse a JSON object body; `allowEmpty` treats a missing body as `{}`. */
function parseBody(
  raw: string | undefined,
  allowed: ReadonlySet<string>,
  allowEmpty: boolean,
): { ok: true; input: Record<string, unknown> } | Fail {
  if (allowEmpty && (raw === undefined || raw.trim() === '')) {
    return { ok: true, input: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '');
  } catch {
    return fail(400, { error: 'invalid JSON body' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(400, { error: 'invalid JSON body' });
  }
  const input = parsed as Record<string, unknown>;
  const unknown = Object.keys(input).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return fail(400, { error: `unknown field: ${unknown[0]}` });
  }
  return { ok: true, input };
}

/** The editable fields after validation (`null` = clear an optional one). */
interface Fields {
  title?: string;
  url?: string | null;
  statement?: string | null;
  difficulty?: CustomProblem['difficulty'];
  topics?: string[];
  allowSimilarTitle: boolean;
}

/**
 * Validate the editable fields with the same rules storage applies on read.
 * `create`: title, difficulty and topics are required; `null` never allowed.
 */
function validateFields(
  input: Record<string, unknown>,
  mode: 'create' | 'patch',
): { ok: true; fields: Fields } | Fail {
  const fields: Fields = { allowSimilarTitle: false };
  const { title, url, statement, difficulty, topics, allowSimilarTitle } =
    input;

  if (allowSimilarTitle !== undefined) {
    if (typeof allowSimilarTitle !== 'boolean') {
      return fail(400, { error: 'allowSimilarTitle must be a boolean' });
    }
    fields.allowSimilarTitle = allowSimilarTitle;
  }
  if (title !== undefined || mode === 'create') {
    const t = normalizeCustomTitle(title);
    if (t === null) {
      return fail(400, {
        error: `title must be 1–${CUSTOM_PROBLEM_LIMITS.titleMax} characters`,
      });
    }
    fields.title = t;
  }
  if (url === null || url === '') {
    if (mode === 'patch') fields.url = null;
  } else if (url !== undefined) {
    const u = normalizeCustomUrl(url);
    if (u === null) {
      return fail(400, {
        error: `url must be an http(s) link of at most ${CUSTOM_PROBLEM_LIMITS.urlMax} characters`,
      });
    }
    fields.url = u;
  }
  if (statement === null) {
    if (mode === 'patch') fields.statement = null;
  } else if (statement !== undefined) {
    const s = normalizeCustomStatement(statement);
    if (s === null) {
      return fail(400, {
        error: `statement must be text of at most ${CUSTOM_PROBLEM_LIMITS.statementMax} characters`,
      });
    }
    if (s !== '' || mode === 'patch') fields.statement = s === '' ? null : s;
  }
  if (difficulty !== undefined || mode === 'create') {
    if (
      difficulty !== 'easy' &&
      difficulty !== 'medium' &&
      difficulty !== 'hard'
    ) {
      return fail(400, { error: 'difficulty must be easy, medium or hard' });
    }
    fields.difficulty = difficulty;
  }
  if (topics !== undefined || mode === 'create') {
    if (!Array.isArray(topics)) {
      return fail(400, { error: 'topics must be an array of topic ids' });
    }
    const unknownTopic = topics.find(
      (t) => typeof t !== 'string' || curriculumTopic(t) === null,
    );
    if (unknownTopic !== undefined) {
      return fail(400, { error: `unknown topic: ${String(unknownTopic)}` });
    }
    const normalized = normalizeCustomTopics(topics, curriculumTopic);
    if (normalized === null) {
      return fail(400, {
        error: `choose ${CUSTOM_PROBLEM_LIMITS.topicsMin}–${CUSTOM_PROBLEM_LIMITS.topicsMax} topics`,
      });
    }
    fields.topics = normalized;
  }
  return { ok: true, fields };
}

/**
 * Duplicate check (ADR 0010 D2): a LeetCode url-slug or `NNN.` number match
 * is the same problem (409, no override); a title-only match is overridable
 * with `allowSimilarTitle: true`.
 */
function duplicateResponse(
  catalog: CurriculumSource,
  custom: readonly CustomProblem[],
  title: string,
  url: string | undefined,
  allowSimilarTitle: boolean,
  selfId?: string,
): HandlerResponse | null {
  const others = mergeProblemSource(
    catalog,
    custom.filter((p) => p.id !== selfId),
  );
  const match = createCatalogMatcher(others.list()).match(title, url ?? '');
  if (match === null) return null;
  if (match.by === 'title' && allowSimilarTitle) return null;
  return json(409, {
    error:
      match.by === 'title'
        ? 'a problem with a similar title already exists'
        : 'this problem already exists',
    duplicate: {
      problemId: match.problemId,
      title: match.title,
      custom: others.getById(match.problemId)?.custom === true,
    },
    ...(match.by === 'title' && { overridable: true }),
  });
}

/** The storage methods a create needs. */
export type CustomProblemWriter = Required<
  Pick<StorageAdapter, 'createCustomProblem' | 'listCustomProblems'>
>;

/** Already-validated fields of a new custom problem. */
export interface NewCustomProblem {
  readonly title: string;
  readonly url?: string;
  readonly statement?: string;
  readonly difficulty: CustomProblem['difficulty'];
  readonly topics: readonly string[];
}

/**
 * Create one custom problem from validated fields: the 1,000 cap, the
 * duplicate check (catalog + existing custom problems) and an exclusive
 * create with a server-generated id. Shared by `POST /api/problems` and the
 * CSV import's "Add as custom problem" (ADR 0010 D4); callers hold
 * {@link serializedProblemWrite}.
 */
export async function createCustomProblemRecord(
  deps: {
    readonly catalog: CurriculumSource;
    readonly storage: CustomProblemWriter;
    readonly now: () => Date;
    readonly randomInt?: (max: number) => number;
  },
  fields: NewCustomProblem,
  allowSimilarTitle: boolean,
): Promise<
  | { readonly ok: true; readonly problem: CustomProblem }
  | { readonly ok: false; readonly response: HandlerResponse }
> {
  const { storage } = deps;
  const existing = await storage.listCustomProblems();
  if (existing.length >= CUSTOM_PROBLEM_LIMITS.maxProblems) {
    return fail(400, {
      error: `at most ${CUSTOM_PROBLEM_LIMITS.maxProblems} custom problems per data folder`,
    });
  }
  const dup = duplicateResponse(
    deps.catalog,
    existing,
    fields.title,
    fields.url,
    allowSimilarTitle,
  );
  if (dup !== null) return { ok: false, response: dup };

  const at = deps.now().toISOString() as IsoTimestamp;
  // Exclusive create; a (vanishingly rare) id collision retries with a new
  // random suffix — an existing problem is never overwritten.
  for (let attempt = 0; attempt < 5; attempt++) {
    const problem: CustomProblem = {
      id: generateCustomProblemId(fields.title, deps.randomInt),
      title: fields.title,
      ...(fields.url !== undefined && { url: fields.url }),
      ...(fields.statement !== undefined && { statement: fields.statement }),
      difficulty: fields.difficulty,
      topics: [...fields.topics],
      createdAt: at,
      updatedAt: at,
    };
    try {
      await storage.createCustomProblem(problem);
      return { ok: true, problem };
    } catch (err) {
      if (!isErrno(err, 'EEXIST')) throw err;
    }
  }
  return fail(500, { error: 'could not allocate a problem id; try again' });
}

function toApiProblem(problem: CustomProblem): ApiCustomProblem {
  return { ...problem, custom: true };
}

function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === code
  );
}

/** Resolve `:id`: catalog ⇒ 403, not a `u-` id ⇒ 404. */
function checkEditableId(id: string, catalog: CurriculumSource): Fail | null {
  if (catalog.getById(id) !== undefined) {
    return fail(403, { error: 'catalog problems are read-only' });
  }
  if (!isCustomProblemId(id)) {
    return fail(404, { error: 'unknown problem', problemId: id });
  }
  return null;
}

/**
 * In-process mutex for custom-problem writes: each create/edit/delete runs
 * alone, so the 1,000 cap and the duplicate checks (read, then write) cannot
 * race another request. The `wx` create still guarantees no overwrite.
 */
let problemWrites: Promise<unknown> = Promise.resolve();

export function serializedProblemWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = problemWrites.then(task, task);
  problemWrites = run.catch(() => undefined);
  return run;
}

/** Handle an `/api/problems*` request (null → not a problems route). */
export async function handleProblemsRoute(
  method: string,
  pathname: string,
  deps: ProblemRouteDeps,
  rawBody: string | undefined,
): Promise<HandlerResponse | null> {
  if (
    (pathname === PROBLEMS_PATH || pathname.startsWith(`${PROBLEMS_PATH}/`)) &&
    (method === 'POST' || method === 'PATCH' || method === 'DELETE')
  ) {
    return serializedProblemWrite(() =>
      handleProblemsRouteUnlocked(method, pathname, deps, rawBody),
    );
  }
  return handleProblemsRouteUnlocked(method, pathname, deps, rawBody);
}

async function handleProblemsRouteUnlocked(
  method: string,
  pathname: string,
  deps: ProblemRouteDeps,
  rawBody: string | undefined,
): Promise<HandlerResponse | null> {
  const now = (): Date => (deps.now ?? (() => new Date()))();
  const storage = deps.storage;

  if (pathname === PROBLEMS_PATH) {
    if (method !== 'POST') return json(405, { error: 'method not allowed' });
    if (!storage?.createCustomProblem || !storage.listCustomProblems) {
      return NO_DB;
    }
    const body = parseBody(rawBody, CREATE_FIELDS, false);
    if (!body.ok) return body.response;
    const valid = validateFields(body.input, 'create');
    if (!valid.ok) return valid.response;
    const f = valid.fields;

    const created = await createCustomProblemRecord(
      {
        catalog: deps.catalog,
        storage: {
          createCustomProblem: storage.createCustomProblem.bind(storage),
          listCustomProblems: storage.listCustomProblems.bind(storage),
        },
        now,
        ...(deps.randomInt !== undefined && { randomInt: deps.randomInt }),
      },
      {
        title: f.title!,
        ...(typeof f.url === 'string' && { url: f.url }),
        ...(typeof f.statement === 'string' && { statement: f.statement }),
        difficulty: f.difficulty!,
        topics: f.topics!,
      },
      f.allowSimilarTitle,
    );
    if (!created.ok) return created.response;
    return json(201, { problem: toApiProblem(created.problem) });
  }

  if (!pathname.startsWith(`${PROBLEMS_PATH}/`)) return null;

  let id: string;
  try {
    id = decodeURIComponent(pathname.slice(PROBLEMS_PATH.length + 1));
  } catch {
    return json(404, { error: 'unknown problem' });
  }
  if (method !== 'PATCH' && method !== 'DELETE') {
    return json(405, { error: 'method not allowed' });
  }
  const badId = checkEditableId(id, deps.catalog);
  if (badId !== null) return badId.response;
  if (
    !storage?.readCustomProblem ||
    !storage.writeCustomProblem ||
    !storage.deleteCustomProblem
  ) {
    return NO_DB;
  }
  const stored = await storage.readCustomProblem(id);
  const view = stored === null ? null : customProblemView(stored);
  if (stored === null || view === null) {
    return json(404, { error: 'unknown problem', problemId: id });
  }

  if (method === 'PATCH') {
    const body = parseBody(rawBody, CREATE_FIELDS, false);
    if (!body.ok) return body.response;
    const valid = validateFields(body.input, 'patch');
    if (!valid.ok) return valid.response;
    const f = valid.fields;
    const { allowSimilarTitle, ...changes } = f;
    if (Object.keys(changes).length === 0) {
      return json(400, { error: 'nothing to update' });
    }
    const title = f.title ?? view.title;
    const url = f.url === undefined ? view.url : f.url ?? undefined;
    const statement =
      f.statement === undefined ? view.statement : f.statement ?? undefined;
    if (f.title !== undefined || typeof f.url === 'string') {
      const all = storage.listCustomProblems
        ? await storage.listCustomProblems()
        : [];
      const dup = duplicateResponse(
        deps.catalog,
        all,
        title,
        url,
        allowSimilarTitle,
        id,
      );
      if (dup !== null) return dup;
    }
    const updated: CustomProblem = {
      id,
      title,
      ...(url !== undefined && { url }),
      ...(statement !== undefined && { statement }),
      difficulty: f.difficulty ?? view.difficulty,
      topics: f.topics ?? [...view.topics],
      createdAt: stored.createdAt,
      updatedAt: now().toISOString() as IsoTimestamp,
    };
    try {
      await storage.writeCustomProblem(updated);
    } catch (err) {
      if (isErrno(err, 'ENOENT')) {
        return json(404, { error: 'unknown problem', problemId: id });
      }
      throw err;
    }
    return json(200, { problem: toApiProblem(updated) });
  }

  // ----- DELETE -----
  const body = parseBody(rawBody, DELETE_FIELDS, true);
  if (!body.ok) return body.response;
  const { deleteNote } = body.input;
  if (deleteNote !== undefined && typeof deleteNote !== 'boolean') {
    return json(400, { error: 'deleteNote must be a boolean' });
  }
  // The adapter owns the note layout (ADR 0010 D3 amendment). Without a way
  // to delete notes, refuse outright rather than risk orphaning one.
  if (!storage.deleteIntuitionNote) {
    return json(501, {
      error: 'this storage cannot delete notes, so the problem was not deleted',
    });
  }
  const hasNote = storage.hasIntuitionNote
    ? await storage.hasIntuitionNote(id)
    : ((await storage.readIntuitionNote?.(id)) ?? null) !== null;
  if (!hasNote) {
    await storage.deleteCustomProblem(id);
    return json(200, { deleted: true, noteDeleted: false });
  }
  if (deleteNote !== true) {
    return json(409, {
      error:
        'this problem has a note: resend with deleteNote: true to delete both',
      hasNote: true,
    });
  }
  // ADR 0009 D3: snapshot before deleting the user's note; failure ⇒ nothing
  // is deleted.
  let backup: string;
  try {
    backup = await (deps.backup ?? createBackup)(deps.dataDir, now());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return json(500, {
      error: `could not back up the data folder, so nothing was deleted: ${reason}`,
    });
  }
  await storage.deleteIntuitionNote(id);
  await storage.deleteCustomProblem(id);
  return json(200, { deleted: true, noteDeleted: true, backup });
}
