import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCatalogSource } from '@ibai/curriculum';
import { LocalFileStorageAdapter } from '@ibai/storage';
import { createCoachHandler } from './handler.js';
import type {
  CoachHandlerDeps,
  HandlerRequest,
  HandlerResponse,
} from './handler.js';
import {
  defaultDataDirFor,
  localConfigPathFor,
  readLocalConfig,
  writeLocalConfig,
} from './config.js';
import type { ApiDataDirResponse } from './api.js';
import { MAX_COOKIE_CANDIDATES, countNotes } from './data-dir-control.js';
import { EXPIRE_LEGACY_DATA_DIR_COOKIE } from './security.js';

/**
 * ADR 0009 D1: the SPA's "Your data" page API. `GET/POST /api/data-dir` and the
 * legacy-cookie recovery routes. Every test injects a temp home dir — the real
 * home (and ~/.interviewbudai) is never touched.
 */

const PORT = 4173;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const CATALOG = createCatalogSource();
const PROBLEM_ID = CATALOG.list()[0]?.id ?? '';
const IDS = CATALOG.list().map((p) => p.id);

let root: string;
let home: string;
let serverDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ibai-datapage-test-'));
  home = path.join(root, 'home');
  serverDir = path.join(root, 'server-data');
  fs.mkdirSync(home);
  fs.mkdirSync(serverDir);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

type Handler = (req: HandlerRequest) => Promise<HandlerResponse>;

function makeHandler(overrides: Partial<CoachHandlerDeps> = {}): Handler {
  const inner = createCoachHandler({
    storage: new LocalFileStorageAdapter(serverDir),
    catalog: CATALOG,
    createStorage: (dir: string) => new LocalFileStorageAdapter(dir),
    homeDir: home,
    env: {},
    argv: [],
    port: PORT,
    warn: () => undefined,
    ...overrides,
  });
  return (req) =>
    inner({ ...req, headers: { host: HOST, origin: ORIGIN, ...req.headers } });
}

async function getDataDir(
  handler: Handler,
  headers: Record<string, string> = {},
): Promise<ApiDataDirResponse> {
  const res = await handler({ method: 'GET', url: '/api/data-dir', headers });
  expect(res.status).toBe(200);
  expect(res.contentType).toContain('application/json');
  return JSON.parse(res.body) as ApiDataDirResponse;
}

function postJson(
  handler: Handler,
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<HandlerResponse> {
  return handler({
    method: 'POST',
    url,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    contentType: 'application/json',
    headers,
  });
}

function postPath(handler: Handler, p: string): Promise<HandlerResponse> {
  return postJson(handler, '/api/data-dir', { path: p });
}

/** Write N note files straight to `<dir>/notes` (as an older version did). */
async function seedNotes(dir: string, ids: readonly string[]): Promise<void> {
  const storage = new LocalFileStorageAdapter(dir);
  for (const id of ids) {
    await storage.writeIntuitionNote({
      problemId: id,
      content: `old note for ${id}`,
      lastUpdated: '2026-09-01T00:00:00.000Z',
      status: 'done',
      completed: true,
    });
  }
}

const legacyCookie = (dir: string) =>
  `ibai_data_dir=${encodeURIComponent(dir)}`;

describe('GET /api/data-dir', () => {
  it('default source: shape, not pinned, exists, zero notes, no candidate', async () => {
    const dir = defaultDataDirFor(home);
    fs.mkdirSync(dir, { recursive: true });
    const body = await getDataDir(makeHandler());
    expect(body).toEqual({
      dataDir: dir,
      source: 'default',
      pinned: false,
      exists: true,
      noteCount: 0,
      formatVersion: 1,
      legacyCandidates: [],
    });
  });

  it('config source: counts the notes in the persisted dir', async () => {
    const chosen = path.join(root, 'chosen');
    fs.mkdirSync(chosen);
    await seedNotes(chosen, IDS.slice(0, 2));
    writeLocalConfig(home, chosen);
    const body = await getDataDir(makeHandler());
    expect(body).toMatchObject({
      dataDir: chosen,
      source: 'config',
      pinned: false,
      exists: true,
      noteCount: 2,
    });
  });

  it.each(['env', 'flag'] as const)(
    '%s source: pinned: true',
    async (source) => {
      const pinned = path.join(root, 'pinned');
      const overrides: Partial<CoachHandlerDeps> =
        source === 'env'
          ? { env: { IBAI_DATA_DIR: pinned } }
          : { argv: [`--data-dir=${pinned}`] };
      const body = await getDataDir(makeHandler(overrides));
      expect(body).toEqual({
        dataDir: pinned,
        source,
        pinned: true,
        exists: false,
        noteCount: 0,
        formatVersion: 1,
        legacyCandidates: [],
      });
    },
  );

  it('injected boot dir (composition root) reports exists + source', async () => {
    const body = await getDataDir(
      makeHandler({ dataDir: serverDir, dataDirSource: 'default' }),
    );
    expect(body).toMatchObject({ dataDir: serverDir, source: 'default' });
  });

  it('wrong method → 405 JSON', async () => {
    const res = await makeHandler()({
      method: 'DELETE',
      url: '/api/data-dir',
      contentType: 'application/json',
    });
    expect(res.status).toBe(405);
  });

  it('countNotes: known notes/<id>.md with frontmatter whose id: is absent or matching (like storage reads them)', () => {
    const notes = path.join(serverDir, 'notes');
    fs.mkdirSync(path.join(notes, 'sub.md'), { recursive: true });
    const known = (id: string) => CATALOG.getById(id) !== undefined;
    const [a, b, c, d, e] = IDS;
    // Counted: matching id; BOM + CRLF + quoted id; no id: line at all; an
    // `id:` only in the body (frontmatter itself has none).
    fs.writeFileSync(path.join(notes, `${a}.md`), `---\nid: ${a}\n---\n`);
    fs.writeFileSync(
      path.join(notes, `${b}.md`),
      `\uFEFF---\r\nlastUpdated: x\r\nid: "${b}"\r\n---\r\n`,
    );
    fs.writeFileSync(
      path.join(notes, `${e}.md`),
      '---\nlastUpdated: 2026-09-01T00:00:00.000Z\nstatus: done\n---\n\nbody\n',
    );
    fs.writeFileSync(path.join(notes, `${d}.md`), `---\nx: 1\n---\nid: ${d}\n`);
    // Not counted: a CONFLICTING id:, no frontmatter, not .md:
    fs.writeFileSync(path.join(notes, `${c}.md`), `---\nid: ${a}\n---\n`);
    fs.writeFileSync(path.join(notes, `${IDS[5]}.md`), '# no frontmatter');
    fs.writeFileSync(path.join(notes, 'b.txt'), `---\nid: b\n---\n`);
    // Not counted with the catalog check: unknown ids, incl. an Obsidian page.
    fs.writeFileSync(
      path.join(notes, 'lc-999999.md'),
      '---\nid: lc-999999\n---\n',
    );
    fs.writeFileSync(
      path.join(notes, 'recipe.md'),
      '---\ntitle: my obsidian page\n---\n',
    );
    expect(countNotes(serverDir, known)).toBe(4);
    // Without a catalog check, lc-999999 and recipe.md also pass.
    expect(countNotes(serverDir)).toBe(6);
    expect(countNotes(path.join(root, 'missing'), known)).toBe(0);
  });

  it('GET noteCount ignores notes whose id is not in the catalog', async () => {
    fs.mkdirSync(path.join(serverDir, 'notes'));
    fs.writeFileSync(
      path.join(serverDir, 'notes', 'lc-999999.md'),
      '---\nid: lc-999999\n---\n',
    );
    const body = await getDataDir(makeHandler({ dataDir: serverDir }));
    expect(body.noteCount).toBe(0);
  });
});

describe('POST /api/data-dir', () => {
  it.each([
    ['relative', 'relative/dir', /absolute/],
    ['root', '/', /root/],
    ['NUL', `${os.tmpdir()}/a\0b`, /NUL/],
    ['empty', '   ', /empty/],
  ])(
    '%s path → 400 with a clear message; nothing changes',
    async (_l, p, msg) => {
      const handler = makeHandler({ dataDir: serverDir });
      const res = await postPath(handler, p);
      expect(res.status).toBe(400);
      expect((JSON.parse(res.body) as { error: string }).error).toMatch(msg);
      expect(fs.existsSync(localConfigPathFor(home))).toBe(false);
      expect((await getDataDir(handler)).dataDir).toBe(serverDir);
    },
  );

  it('an existing file → 400', async () => {
    const file = path.join(root, 'a-file');
    fs.writeFileSync(file, 'x');
    const res = await postPath(makeHandler(), file);
    expect(res.status).toBe(400);
    expect(res.body).toContain('file already exists');
  });

  it.each([
    ['missing body', undefined],
    ['non-object', ['x']],
    ['non-string path', { path: 42 }],
    ['non-boolean dryRun', { path: '/tmp/x', dryRun: 'yes' }],
  ])('%s → 400', async (_l, payload) => {
    const res = await postJson(makeHandler(), '/api/data-dir', payload);
    expect(res.status).toBe(400);
    expect(res.body).toContain('path');
  });

  it('malformed JSON → 400', async () => {
    const res = await makeHandler()({
      method: 'POST',
      url: '/api/data-dir',
      body: '{not json',
      contentType: 'application/json',
    });
    expect(res.status).toBe(400);
  });

  it('good path → created 0700, config.json 0600, live switch, next note lands there', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const target = path.join(root, 'new', 'data');
    const res = await postPath(handler, target);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as ApiDataDirResponse;
    expect(body).toEqual({
      dataDir: target,
      source: 'config',
      pinned: false,
      exists: true,
      noteCount: 0,
      formatVersion: 1,
      legacyCandidates: [],
    });
    expect(fs.statSync(target).mode & 0o777).toBe(0o700);
    expect(fs.statSync(localConfigPathFor(home)).mode & 0o777).toBe(0o600);
    expect(readLocalConfig(home)).toEqual({ status: 'ok', dataDir: target });

    const note = await postJson(handler, `/api/notes/${PROBLEM_ID}`, {
      content: 'in the new dir',
    });
    expect(note.status).toBe(200);
    const saved = await new LocalFileStorageAdapter(target).readIntuitionNote(
      PROBLEM_ID,
    );
    expect(saved?.content).toBe('in the new dir');
    expect(countNotes(serverDir)).toBe(0);
    expect((await getDataDir(handler)).noteCount).toBe(1);
  });

  it('paths are normalized and existing notes are counted', async () => {
    const existing = path.join(root, 'existing');
    await seedNotes(existing, IDS.slice(0, 3));
    const res = await postPath(makeHandler(), `${existing}/../existing/`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      dataDir: existing,
      noteCount: 3,
    });
  });

  it('pinned by env → 400 naming IBAI_DATA_DIR; nothing created or persisted', async () => {
    const pinned = path.join(root, 'pinned');
    const handler = makeHandler({ env: { IBAI_DATA_DIR: pinned } });
    const elsewhere = path.join(root, 'elsewhere');
    const res = await postPath(handler, elsewhere);
    expect(res.status).toBe(400);
    const { error } = JSON.parse(res.body) as { error: string };
    expect(error).toContain('pinned');
    expect(error).toContain('IBAI_DATA_DIR');
    expect(fs.existsSync(elsewhere)).toBe(false);
    expect(fs.existsSync(localConfigPathFor(home))).toBe(false);
    expect((await getDataDir(handler)).dataDir).toBe(pinned);
  });

  it('pinned by flag → 400 naming --data-dir', async () => {
    const pinned = path.join(root, 'pinned');
    const handler = makeHandler({ argv: [`--data-dir=${pinned}`] });
    const res = await postPath(handler, path.join(root, 'elsewhere'));
    expect(res.status).toBe(400);
    expect(res.body).toContain('--data-dir');
  });

  it('cross-site Origin → 403, nothing written', async () => {
    const target = path.join(root, 'evil');
    const res = await postJson(
      makeHandler(),
      '/api/data-dir',
      { path: target },
      { origin: 'http://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(localConfigPathFor(home))).toBe(false);
  });

  it('text/plain → 415, nothing written', async () => {
    const target = path.join(root, 'plain');
    const res = await makeHandler()({
      method: 'POST',
      url: '/api/data-dir',
      body: JSON.stringify({ path: target }),
      contentType: 'text/plain',
    });
    expect(res.status).toBe(415);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('foreign Host → 421', async () => {
    const res = await makeHandler()({
      method: 'GET',
      url: '/api/data-dir',
      headers: { host: 'evil.example:4173' },
    });
    expect(res.status).toBe(421);
  });

  it('/setup and /api/data-dir share state: a /setup choice is reported here', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const form = await handler({ method: 'GET', url: '/setup' });
    expect(form.body).toContain('href="/data"');
    const token = /name="csrfToken" value="([^"]+)"/.exec(form.body)?.[1] ?? '';
    const target = path.join(root, 'via-setup');
    const res = await handler({
      method: 'POST',
      url: '/setup',
      body: new URLSearchParams({
        dataDir: target,
        csrfToken: token,
      }).toString(),
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('href="/data"');
    expect(await getDataDir(handler)).toMatchObject({
      dataDir: target,
      source: 'config',
    });
  });
});

describe('POST /api/data-dir { dryRun: true }', () => {
  function dryRun(handler: Handler, p: string): Promise<HandlerResponse> {
    return postJson(handler, '/api/data-dir', { path: p, dryRun: true });
  }

  it('reports notes + quiz sessions and writes nothing', async () => {
    const existing = path.join(root, 'existing');
    await seedNotes(existing, IDS.slice(0, 3));
    fs.mkdirSync(path.join(existing, 'quiz-sessions'));
    fs.writeFileSync(path.join(existing, 'quiz-sessions', 's1.json'), '{}');
    fs.writeFileSync(path.join(existing, 'quiz-sessions', 'active.json'), '{}');
    const handler = makeHandler({ dataDir: serverDir });
    const res = await dryRun(handler, existing);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      dryRun: true,
      path: existing,
      exists: true,
      noteCount: 3,
      quizSessionCount: 1,
    });
    expect(fs.existsSync(localConfigPathFor(home))).toBe(false);
    expect((await getDataDir(handler)).dataDir).toBe(serverDir);
  });

  it('a missing folder is reported, not created', async () => {
    const missing = path.join(root, 'missing');
    const res = await dryRun(makeHandler(), missing);
    expect(JSON.parse(res.body)).toMatchObject({
      exists: false,
      noteCount: 0,
    });
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('a notes/ folder → hint to use its parent', async () => {
    const existing = path.join(root, 'existing');
    await seedNotes(existing, IDS.slice(0, 1));
    const res = await dryRun(makeHandler(), path.join(existing, 'notes'));
    expect(JSON.parse(res.body)).toMatchObject({
      noteCount: 0,
      hint: { kind: 'use-parent', path: existing },
    });
  });

  it('foreign markdown → not-ibai-format hint', async () => {
    const foreign = path.join(root, 'notion-export');
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'Two Sum.md'), '# Two Sum');
    const res = await dryRun(makeHandler(), foreign);
    expect(JSON.parse(res.body)).toMatchObject({
      noteCount: 0,
      hint: { kind: 'not-ibai-format' },
    });
  });

  it('invalid paths → 400 (validated exactly like a switch)', async () => {
    const res = await dryRun(makeHandler(), 'relative');
    expect(res.status).toBe(400);
    expect(res.body).toContain('absolute');
  });

  it('works while pinned (read-only inspection)', async () => {
    const existing = path.join(root, 'existing');
    await seedNotes(existing, IDS.slice(0, 1));
    const res = await dryRun(
      makeHandler({ env: { IBAI_DATA_DIR: serverDir } }),
      existing,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ noteCount: 1 });
  });
});

describe('legacy recovery candidates', () => {
  let legacy: string;

  beforeEach(async () => {
    legacy = path.join(root, 'old-custom-folder');
    await seedNotes(legacy, IDS.slice(0, 2));
  });

  const cookieCandidate = () => ({
    path: legacy,
    noteCount: 2,
    origin: 'cookie',
  });

  it('cookie + notes present → a cookie candidate (never an automatic switch)', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const res = await handler({
      method: 'GET',
      url: '/api/data-dir',
      headers: { cookie: legacyCookie(legacy) },
    });
    // ADR 0009 D1: the cookie is no longer expired on ordinary responses.
    expect(res.headers?.['Set-Cookie']).toBeUndefined();
    const body = JSON.parse(res.body) as ApiDataDirResponse;
    expect(body.dataDir).toBe(serverDir);
    expect(body.legacyCandidates).toEqual([cookieCandidate()]);
    expect(fs.existsSync(localConfigPathFor(home))).toBe(false);
  });

  it('is captured on first sight and still offered once the browser drops the cookie', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    await handler({
      method: 'GET',
      url: '/',
      headers: { cookie: legacyCookie(legacy) },
    });
    const body = await getDataDir(handler);
    expect(body.legacyCandidates).toEqual([cookieCandidate()]);
  });

  it('~/.ibai/data with notes → a legacy-default candidate (no cookie needed)', async () => {
    const old = path.join(home, '.ibai', 'data');
    await seedNotes(old, IDS.slice(0, 3));
    const body = await getDataDir(makeHandler({ dataDir: serverDir }));
    expect(body.legacyCandidates).toEqual([
      { path: old, noteCount: 3, origin: 'legacy-default' },
    ]);
  });

  it('both candidates are offered; the same path is listed once', async () => {
    const old = path.join(home, '.ibai', 'data');
    await seedNotes(old, IDS.slice(0, 1));
    const handler = makeHandler({ dataDir: serverDir });
    const both = await getDataDir(handler, { cookie: legacyCookie(legacy) });
    expect(both.legacyCandidates.map((c) => c.origin)).toEqual([
      'cookie',
      'legacy-default',
    ]);

    const same = makeHandler({ dataDir: serverDir });
    const once = await getDataDir(same, { cookie: legacyCookie(old) });
    expect(once.legacyCandidates).toEqual([
      { path: old, noteCount: 1, origin: 'cookie' },
    ]);
  });

  it('no parseable notes in the cookie dir → no candidate', async () => {
    const empty = path.join(root, 'empty-old');
    fs.mkdirSync(path.join(empty, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(empty, 'notes', 'readme.txt'), 'x');
    fs.writeFileSync(path.join(empty, 'notes', 'x.md'), 'no frontmatter');
    const body = await getDataDir(makeHandler({ dataDir: serverDir }), {
      cookie: legacyCookie(empty),
    });
    expect(body.legacyCandidates).toEqual([]);
  });

  it('an Obsidian-style notes/recipe.md folder → not a candidate, and the dry run shows the not-ibai-format hint', async () => {
    const vault = path.join(root, 'vault');
    fs.mkdirSync(path.join(vault, 'notes'), { recursive: true });
    fs.writeFileSync(
      path.join(vault, 'notes', 'recipe.md'),
      '---\ntitle: my obsidian page\n---\n\nFlour, eggs.\n',
    );
    const handler = makeHandler({ dataDir: serverDir });
    const body = await getDataDir(handler, { cookie: legacyCookie(vault) });
    expect(body.legacyCandidates).toEqual([]);

    const dry = await postJson(handler, '/api/data-dir', {
      path: vault,
      dryRun: true,
    });
    expect(JSON.parse(dry.body)).toMatchObject({
      noteCount: 0,
      hint: { kind: 'not-ibai-format' },
    });
  });

  it('a later, different valid cookie is offered too (newest first) — a planted value cannot squat', async () => {
    const planted = path.join(root, 'planted');
    await seedNotes(planted, IDS.slice(0, 1));
    const handler = makeHandler({ dataDir: serverDir });
    await getDataDir(handler, { cookie: legacyCookie(planted) });
    const body = await getDataDir(handler, { cookie: legacyCookie(legacy) });
    expect(body.legacyCandidates.map((c) => c.path)).toEqual([legacy, planted]);
    // Seeing an older value again moves it to the front (no duplicates).
    const again = await getDataDir(handler, { cookie: legacyCookie(planted) });
    expect(again.legacyCandidates.map((c) => c.path)).toEqual([
      planted,
      legacy,
    ]);
  });

  it(`remembers at most ${MAX_COOKIE_CANDIDATES} cookie paths`, async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const dirs: string[] = [];
    for (let i = 0; i < MAX_COOKIE_CANDIDATES + 2; i += 1) {
      const dir = path.join(root, `cookie-${i}`);
      await seedNotes(dir, IDS.slice(0, 1));
      dirs.push(dir);
      await getDataDir(handler, { cookie: legacyCookie(dir) });
    }
    const body = await getDataDir(handler);
    expect(body.legacyCandidates.map((c) => c.path)).toEqual(
      dirs.slice(-MAX_COOKIE_CANDIDATES).reverse(),
    );
  });

  it.each([
    ['a missing directory', () => path.join(root, 'nope')],
    ['a relative path', () => 'relative/dir'],
    ['a file', () => path.join(legacy, 'notes', `${IDS[0]}.md`)],
    ['the active dir itself', () => serverDir],
  ])('cookie pointing at %s → no candidate', async (_l, dir) => {
    await seedNotes(serverDir, IDS.slice(2, 3));
    const body = await getDataDir(makeHandler({ dataDir: serverDir }), {
      cookie: legacyCookie(dir()),
    });
    expect(body.legacyCandidates).toEqual([]);
  });

  it('config.json exists → no candidates', async () => {
    await seedNotes(path.join(home, '.ibai', 'data'), IDS.slice(0, 1));
    writeLocalConfig(home, serverDir);
    const body = await getDataDir(makeHandler(), {
      cookie: legacyCookie(legacy),
    });
    expect(body.source).toBe('config');
    expect(body.legacyCandidates).toEqual([]);
  });

  it('pinned → no candidates', async () => {
    await seedNotes(path.join(home, '.ibai', 'data'), IDS.slice(0, 1));
    const body = await getDataDir(
      makeHandler({ env: { IBAI_DATA_DIR: serverDir } }),
      { cookie: legacyCookie(legacy) },
    );
    expect(body.pinned).toBe(true);
    expect(body.legacyCandidates).toEqual([]);
  });

  it('a cookie on a rejected (foreign Host) request is not captured', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    const res = await handler({
      method: 'GET',
      url: '/api/data-dir',
      headers: { host: 'evil.example:4173', cookie: legacyCookie(legacy) },
    });
    expect(res.status).toBe(421);
    expect((await getDataDir(handler)).legacyCandidates).toEqual([]);
  });

  it('accepting = POST /api/data-dir { path }: switches, expires the cookie, notes show in /api/catalog', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    await handler({
      method: 'GET',
      url: '/',
      headers: { cookie: legacyCookie(legacy) },
    });
    const res = await postJson(
      handler,
      '/api/data-dir',
      { path: legacy },
      { cookie: legacyCookie(legacy) },
    );
    expect(res.status).toBe(200);
    expect(res.headers?.['Set-Cookie']).toBe(EXPIRE_LEGACY_DATA_DIR_COOKIE);
    expect(JSON.parse(res.body)).toEqual({
      dataDir: legacy,
      source: 'config',
      pinned: false,
      exists: true,
      noteCount: 2,
      formatVersion: 1,
      legacyCandidates: [],
    });
    expect(readLocalConfig(home)).toEqual({ status: 'ok', dataDir: legacy });

    const catalog = await handler({ method: 'GET', url: '/api/catalog' });
    const statuses = new Map<string, string>();
    for (const topic of (
      JSON.parse(catalog.body) as {
        topics: { problems: { id: string; status: string }[] }[];
      }
    ).topics) {
      for (const p of topic.problems) statuses.set(p.id, p.status);
    }
    expect(statuses.get(IDS[0] ?? '')).toBe('done');
  });

  it('a candidate whose notes vanished is dropped (re-validated on every read)', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    await getDataDir(handler, { cookie: legacyCookie(legacy) });
    fs.rmSync(path.join(legacy, 'notes'), { recursive: true });
    expect((await getDataDir(handler)).legacyCandidates).toEqual([]);
  });

  it('dismiss clears every candidate, expires the cookie, and they are not re-offered', async () => {
    await seedNotes(path.join(home, '.ibai', 'data'), IDS.slice(0, 1));
    const handler = makeHandler({ dataDir: serverDir });
    expect(
      (await getDataDir(handler, { cookie: legacyCookie(legacy) }))
        .legacyCandidates,
    ).toHaveLength(2);
    const res = await postJson(
      handler,
      '/api/data-dir/legacy/dismiss',
      {},
      { cookie: legacyCookie(legacy) },
    );
    expect(res.status).toBe(200);
    expect(res.headers?.['Set-Cookie']).toBe(EXPIRE_LEGACY_DATA_DIR_COOKIE);
    expect(
      (JSON.parse(res.body) as ApiDataDirResponse).legacyCandidates,
    ).toEqual([]);
    const again = await getDataDir(handler, { cookie: legacyCookie(legacy) });
    expect(again.legacyCandidates).toEqual([]);
    expect(again.dataDir).toBe(serverDir);
  });

  it('dismiss: cross-site → 403, text/plain → 415, GET → 405', async () => {
    const handler = makeHandler({ dataDir: serverDir });
    await getDataDir(handler, { cookie: legacyCookie(legacy) });
    const url = '/api/data-dir/legacy/dismiss';
    const cross = await postJson(
      handler,
      url,
      {},
      {
        origin: 'http://evil.example',
      },
    );
    expect(cross.status).toBe(403);
    const plain = await handler({
      method: 'POST',
      url,
      body: '{}',
      contentType: 'text/plain',
    });
    expect(plain.status).toBe(415);
    const get = await handler({ method: 'GET', url });
    expect(get.status).toBe(405);
    // Still offered, never switched.
    const body = await getDataDir(handler);
    expect(body.dataDir).toBe(serverDir);
    expect(body.legacyCandidates).toEqual([cookieCandidate()]);
  });

  it('there is no separate accept endpoint (accept = POST /api/data-dir)', async () => {
    const res = await postJson(
      makeHandler(),
      '/api/data-dir/legacy/accept',
      {},
    );
    expect(res.status).toBe(404);
  });
});
