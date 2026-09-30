/**
 * The server's data-directory state and the ONE code path that changes it
 * (ADR 0005 amendment w2d; ADR 0009 D1).
 *
 * Both the no-JS `POST /setup` form and the SPA's `POST /api/data-dir` call
 * {@link DataDirControl.choose}: validate the untrusted path (absolute or `~/`,
 * normalized, no NUL, not a root, not a file), refuse to change a pinned dir,
 * create it 0700, persist `~/.interviewbudai/config.json` atomically, then
 * switch the live server. Nothing else mutates the active dir.
 *
 * Legacy recovery (ADR 0009 D1): before w2d the dir came from the
 * `ibai_data_dir` cookie, so users who chose a custom folder that way now see
 * an empty default. Two kinds of "previous data" candidates are offered:
 *
 *   - `cookie` — the legacy cookie's path(s). Each distinct valid value seen on
 *     a request that passed the Host check is remembered in memory (per
 *     process, newest first, at most {@link MAX_COOKIE_CANDIDATES}), so it can
 *     still be offered if the browser later drops or overwrites the cookie.
 *   - `legacy-default` — `~/.ibai/data` (ADR 0005 D2's default, still used by
 *     the frozen CLI).
 *
 * A candidate is offered only while recovery makes sense (not pinned, no
 * config.json yet) and only if it passes `validateSetupPath`, is an existing
 * directory other than the active one, and holds ≥ 1 recognised note
 * (`notes/<id>.md` with a matching frontmatter id in the catalog). It is
 * only ever a SUGGESTION: the server never reads or writes through it.
 * Accepting is a normal `POST /api/data-dir { path }`, re-validated from
 * scratch. Cookies are not port-isolated, so the cookie stays untrusted.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createDataDir,
  directoryExists,
  isPinnedSource,
  localConfigPathFor,
  parseCookies,
  readLocalConfig,
  validateSetupPath,
  writeLocalConfig,
} from './config.js';
import type { DataDirSource } from './config.js';
import { LEGACY_DATA_DIR_COOKIE, hasLegacyDataDirCookie } from './security.js';
import type { HandlerResponse } from './handler.js';
import type { DockerDataInfo } from './container.js';

/**
 * The on-disk format version reported by `GET /api/data-dir`. Every folder is
 * format v1 today (an absent `manifest.json` means v1 — ADR 0009 D4); reading
 * and migrating manifests lands with the versioning PR.
 */
export const CURRENT_FORMAT_VERSION = 1;

/** Where a legacy candidate came from. */
export type LegacyOrigin = 'cookie' | 'legacy-default';

/** A previous data folder the user may restore. */
export interface LegacyCandidate {
  readonly path: string;
  readonly noteCount: number;
  readonly origin: LegacyOrigin;
}

/** `GET /api/data-dir` shape (ADR 0009 D1). */
export interface DataDirStatus {
  readonly dataDir: string;
  readonly source: DataDirSource;
  readonly pinned: boolean;
  readonly exists: boolean;
  readonly noteCount: number;
  readonly formatVersion: number;
  readonly legacyCandidates: readonly LegacyCandidate[];
  /**
   * Present only inside the Docker image (ADR 0011 D3): the display-only host
   * folder, the boot writability check and the mismatch hint.
   */
  readonly docker?: DockerDataInfo;
}

/** A hint shown next to a dry-run result. */
export type InspectionHint =
  /** The path is a `notes/` folder; its parent is the data dir. */
  | { readonly kind: 'use-parent'; readonly path: string }
  /** Markdown files, but no InterviewBudAI `notes/<id>.md` (→ CSV import). */
  | { readonly kind: 'not-ibai-format' };

/** `POST /api/data-dir { dryRun: true }` shape: what is there, no writes. */
export interface DataDirInspection {
  readonly dryRun: true;
  readonly path: string;
  readonly exists: boolean;
  readonly noteCount: number;
  readonly quizSessionCount: number;
  readonly hint?: InspectionHint;
}

/** Result of {@link DataDirControl.choose}. */
export type ChooseResult =
  | {
      readonly ok: true;
      readonly path: string;
      /** Set when the dir is pinned (it was only created/verified). */
      readonly pinnedBy?: string;
    }
  | {
      readonly ok: false;
      readonly kind: 'invalid' | 'pinned' | 'create' | 'persist';
      readonly error: string;
    };

/** Human-readable name of what pins the data dir. */
export function pinnedBy(source: DataDirSource): string {
  return source === 'flag'
    ? 'the --data-dir flag'
    : 'the IBAI_DATA_DIR environment variable';
}

/** "Pinned by Docker (IBAI_HOST_DATA_DIR=<host path>)" (ADR 0011 D3). */
export function dockerPinnedText(docker: DockerDataInfo): string {
  return docker.hostDataDir !== null
    ? `Pinned by Docker (IBAI_HOST_DATA_DIR=${docker.hostDataDir})`
    : 'Pinned by Docker (the folder mounted at /data)';
}

/** `<home>/.ibai/data` — the pre-w2d default (ADR 0005 D2; frozen CLI). */
export function legacyDefaultDataDirFor(homeDir: string): string {
  return path.join(homeDir, '.ibai', 'data');
}

/** How much of a note file is read to find its frontmatter `id:`. */
const NOTE_HEAD_BYTES = 4096;

/**
 * Read a note's leading frontmatter block (`---` ... `---`, optional BOM) from
 * the first {@link NOTE_HEAD_BYTES}. `undefined` when the file has no
 * frontmatter; otherwise `{ id }` with the `id:` value, or `id: undefined`
 * when the block has no `id:` line. Never throws.
 */
function readFrontmatterId(file: string): { id?: string } | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(NOTE_HEAD_BYTES);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    const lines = head
      .subarray(0, read)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return undefined;
    for (const line of lines.slice(1)) {
      if (line.trim() === '---') return {};
      const match = /^id:\s*(.*?)\s*$/.exec(line);
      if (match) return { id: match[1]?.replace(/^(['"])(.*)\1$/, '$2') };
    }
    // No closing fence within the head: treat as frontmatter without an id.
    return {};
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Decides whether a problem id is one the app knows IN `dir` (the folder being
 * inspected): a shipped catalog id, or a custom problem whose
 * `<dir>/problems/<id>.json` exists and validates (ADR 0010 D4). Drives
 * noteCount, legacy-candidate eligibility and dry-run hints.
 */
export type ProblemIdCheck = (id: string, dir: string) => boolean;

/** Regular-file entries of a directory (empty on any error). */
function filesIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Count the recognised InterviewBudAI notes (format v1, ADR 0009 D1), matching
 * how storage reads them (by filename id): regular files `<dir>/notes/<id>.md`
 * where `<id>` is known (`isKnownId`, when given), the file opens with
 * frontmatter, and its `id:` is either absent or equal to `<id>` — only a
 * CONFLICTING `id:` is rejected. An Obsidian/Jekyll page like
 * `notes/recipe.md` does not count (`recipe` is not a known id). This one rule
 * drives `noteCount`, candidate eligibility and the dry-run hints. Never
 * throws: a missing or unreadable directory counts as 0.
 */
export function countNotes(dir: string, isKnownId?: ProblemIdCheck): number {
  const notesDir = path.join(dir, 'notes');
  return filesIn(notesDir).filter((name) => {
    if (!name.endsWith('.md')) return false;
    const id = name.slice(0, -'.md'.length);
    if (id === '' || (isKnownId !== undefined && !isKnownId(id, dir))) {
      return false;
    }
    const frontmatter = readFrontmatterId(path.join(notesDir, name));
    if (frontmatter === undefined) return false;
    return frontmatter.id === undefined || frontmatter.id === id;
  }).length;
}

/** Count saved quiz sessions (`quiz-sessions/*.json`, minus the pointer). */
export function countQuizSessions(dir: string): number {
  return filesIn(path.join(dir, 'quiz-sessions')).filter(
    (name) => name.endsWith('.json') && name !== 'active.json',
  ).length;
}

/** Any `.md` file directly in `dir` or in `dir/notes`. */
function hasAnyMarkdown(dir: string): boolean {
  return [dir, path.join(dir, 'notes')].some((d) =>
    filesIn(d).some((name) => name.toLowerCase().endsWith('.md')),
  );
}

/**
 * Responses that settle legacy recovery (a successful switch or a dismiss).
 * The handler expires the legacy cookie on exactly these (ADR 0009 D1).
 */
const settling = new WeakSet<HandlerResponse>();

/** Mark a response as settling legacy recovery; returns it. */
export function settlesLegacy<T extends HandlerResponse>(res: T): T {
  settling.add(res);
  return res;
}

/** True when {@link settlesLegacy} marked this response. */
export function isSettlingResponse(res: HandlerResponse): boolean {
  return settling.has(res);
}

export interface DataDirControlInit {
  readonly dataDir: string;
  readonly source: DataDirSource;
  /** Home directory holding `.interviewbudai/config.json` and `.ibai/data`. */
  readonly homeDir: string;
  /** Known-id check for note counting (see {@link countNotes}). */
  readonly isKnownProblemId?: ProblemIdCheck;
  /** Docker info (ADR 0011 D3); only set inside the container. */
  readonly docker?: DockerDataInfo;
}

/**
 * How many distinct legacy-cookie paths are remembered (newest first).
 *
 * A small set, not "first wins" or "latest wins": the browser holds ONE
 * `ibai_data_dir` value and any page on another localhost port can overwrite
 * it, so a planted value must neither lock out the real one (first-wins) nor
 * silently replace it (latest-wins). Keeping the few distinct valid values
 * seen lets the user pick the folder they recognise; the bound keeps a flood
 * from growing the list, and each entry must still be an existing folder with
 * real InterviewBudAI notes that the user explicitly accepts.
 */
export const MAX_COOKIE_CANDIDATES = 3;

/** Owns the active data dir + the legacy-recovery state (per process). */
export class DataDirControl {
  private current: string;
  private currentSource: DataDirSource;
  private readonly homeDir: string;
  private readonly isKnownId: ProblemIdCheck | undefined;
  private readonly docker: DockerDataInfo | undefined;
  /** Captured cookie paths, newest first (≤ {@link MAX_COOKIE_CANDIDATES}). */
  private cookiePaths: string[] = [];
  /** The last raw cookie value seen (skip re-checking an unchanged cookie). */
  private lastCookieValue: string | undefined;
  private readonly dismissed = new Set<string>();

  constructor(init: DataDirControlInit) {
    this.current = init.dataDir;
    this.currentSource = init.source;
    this.homeDir = init.homeDir;
    this.isKnownId = init.isKnownProblemId;
    this.docker = init.docker;
  }

  /** {@link countNotes} with this server's known-id check. */
  private notesIn(dir: string): number {
    return countNotes(dir, this.isKnownId);
  }

  get dataDir(): string {
    return this.current;
  }

  get source(): DataDirSource {
    return this.currentSource;
  }

  /** Docker info (ADR 0011 D3), undefined outside the container. */
  get dockerInfo(): DockerDataInfo | undefined {
    return this.docker;
  }

  get pinned(): boolean {
    return isPinnedSource(this.currentSource);
  }

  /**
   * Validate, create, persist and switch to `raw` (untrusted). A pinned dir
   * may be created here, never changed.
   */
  choose(raw: string): ChooseResult {
    const checked = validateSetupPath(raw);
    if (!checked.ok) {
      return { ok: false, kind: 'invalid', error: checked.error };
    }
    const pinned = this.pinned;
    if (pinned && checked.path !== this.current) {
      return {
        ok: false,
        kind: 'pinned',
        error:
          this.docker !== undefined
            ? `${dockerPinnedText(this.docker)}, so it cannot be changed here. To use another folder, set IBAI_HOST_DATA_DIR=<path> in .env and restart (docker compose up).`
            : `The data directory is pinned to ${this.current} by ${pinnedBy(this.currentSource)}, so it cannot be changed here. Restart the server without it to choose ${checked.path}.`,
      };
    }

    try {
      // mkdir -p with owner-only permissions (an existing dir is left as-is).
      createDataDir(checked.path);
    } catch (err) {
      return {
        ok: false,
        kind: 'create',
        error:
          err instanceof Error
            ? err.message
            : 'Unknown error creating directory',
      };
    }

    if (pinned) {
      return {
        ok: true,
        path: checked.path,
        pinnedBy:
          this.docker !== undefined ? 'Docker' : pinnedBy(this.currentSource),
      };
    }

    // Persist (atomic, 0600) BEFORE switching, so the server never uses a dir
    // it would forget on restart.
    try {
      writeLocalConfig(this.homeDir, checked.path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        kind: 'persist',
        error: `Could not save your choice to ${localConfigPathFor(this.homeDir)}: ${message}`,
      };
    }
    this.current = checked.path;
    this.currentSource = 'config';
    this.cookiePaths = [];
    return { ok: true, path: checked.path };
  }

  /**
   * Dry run: validate `raw` exactly like {@link choose} and report what is
   * there. Never writes or creates anything.
   */
  inspect(
    raw: string,
  ):
    | { readonly ok: true; readonly inspection: DataDirInspection }
    | { readonly ok: false; readonly error: string } {
    const checked = validateSetupPath(raw);
    if (!checked.ok) {
      return { ok: false, error: checked.error };
    }
    const dir = checked.path;
    const exists = directoryExists(dir);
    const noteCount = exists ? this.notesIn(dir) : 0;
    let hint: InspectionHint | undefined;
    if (exists && noteCount === 0) {
      const parent = path.dirname(dir);
      if (path.basename(dir) === 'notes' && this.notesIn(parent) > 0) {
        hint = { kind: 'use-parent', path: parent };
      } else if (hasAnyMarkdown(dir)) {
        hint = { kind: 'not-ibai-format' };
      }
    }
    return {
      ok: true,
      inspection: {
        dryRun: true,
        path: dir,
        exists,
        noteCount,
        quizSessionCount: exists ? countQuizSessions(dir) : 0,
        ...(hint !== undefined ? { hint } : {}),
      },
    };
  }

  /**
   * Inspect a request's Cookie header and remember a valid legacy cookie path
   * (newest first, see {@link MAX_COOKIE_CANDIDATES}). Never switches anything.
   */
  observeLegacyCookie(cookieHeader: string | undefined): void {
    if (!cookieHeader || !hasLegacyDataDirCookie(cookieHeader)) return;
    const raw = parseCookies(cookieHeader)[LEGACY_DATA_DIR_COOKIE];
    // Cheap per-request path: an unchanged cookie is not re-checked here
    // (validity is re-checked whenever candidates are read).
    if (raw === undefined || raw === '' || raw === this.lastCookieValue) return;
    if (!this.recoveryAllowed()) return;
    const candidate = this.check(raw, 'cookie');
    if (candidate === undefined) return;
    this.lastCookieValue = raw;
    this.cookiePaths = [
      candidate.path,
      ...this.cookiePaths.filter((p) => p !== candidate.path),
    ].slice(0, MAX_COOKIE_CANDIDATES);
  }

  /** The current candidates, each re-validated now. */
  legacyCandidates(): LegacyCandidate[] {
    if (!this.recoveryAllowed()) return [];
    const found: LegacyCandidate[] = [];
    const stillValid: string[] = [];
    for (const cookiePath of this.cookiePaths) {
      const fromCookie = this.check(cookiePath, 'cookie');
      if (fromCookie !== undefined) {
        stillValid.push(cookiePath);
        found.push(fromCookie);
      }
    }
    this.cookiePaths = stillValid;
    const fromDefault = this.check(
      legacyDefaultDataDirFor(this.homeDir),
      'legacy-default',
    );
    if (
      fromDefault !== undefined &&
      !found.some((c) => c.path === fromDefault.path)
    ) {
      found.push(fromDefault);
    }
    return found;
  }

  /** Stop offering the current candidates (for the life of this process). */
  dismissLegacy(): void {
    for (const candidate of this.legacyCandidates()) {
      this.dismissed.add(candidate.path);
    }
    this.cookiePaths = [];
  }

  /** The `GET /api/data-dir` view of the current state. */
  status(): DataDirStatus {
    return {
      dataDir: this.current,
      source: this.currentSource,
      pinned: this.pinned,
      exists: directoryExists(this.current),
      noteCount: this.notesIn(this.current),
      formatVersion: CURRENT_FORMAT_VERSION,
      legacyCandidates: this.legacyCandidates(),
      ...(this.docker !== undefined && { docker: this.docker }),
    };
  }

  /** Recovery is only offered before any choice is pinned or persisted. */
  private recoveryAllowed(): boolean {
    return !this.pinned && readLocalConfig(this.homeDir).status === 'absent';
  }

  private check(
    raw: string,
    origin: LegacyOrigin,
  ): LegacyCandidate | undefined {
    const checked = validateSetupPath(raw);
    if (!checked.ok) return undefined;
    const dir = checked.path;
    if (dir === this.current || this.dismissed.has(dir)) return undefined;
    if (!directoryExists(dir)) return undefined;
    const noteCount = this.notesIn(dir);
    if (noteCount < 1) return undefined;
    return { path: dir, noteCount, origin };
  }
}
