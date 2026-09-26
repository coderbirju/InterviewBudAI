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
 *   - `cookie` — the legacy cookie's path. It is CAPTURED in memory (per
 *     process) the first time a request that passed the Host/Origin checks
 *     carries it, so it can still be offered if the browser later drops it.
 *   - `legacy-default` — `~/.ibai/data` (ADR 0005 D2's default, still used by
 *     the frozen CLI).
 *
 * A candidate is offered only while recovery makes sense (not pinned, no
 * config.json yet) and only if it passes `validateSetupPath`, is an existing
 * directory other than the active one, and holds ≥ 1 parseable note. It is
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
import { LEGACY_DATA_DIR_COOKIE } from './security.js';
import type { HandlerResponse } from './handler.js';

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

/** `<home>/.ibai/data` — the pre-w2d default (ADR 0005 D2; frozen CLI). */
export function legacyDefaultDataDirFor(homeDir: string): string {
  return path.join(homeDir, '.ibai', 'data');
}

/** True when a file starts with a `---` frontmatter fence (optional BOM). */
function hasFrontmatter(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(8);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    return head
      .subarray(0, read)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .startsWith('---');
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

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
 * Count the parseable notes: regular `<dir>/notes/*.md` files that open with a
 * frontmatter fence (the format-v1 note shape). Never throws: a missing or
 * unreadable directory counts as 0.
 */
export function countNotes(dir: string): number {
  const notesDir = path.join(dir, 'notes');
  return filesIn(notesDir).filter(
    (name) => name.endsWith('.md') && hasFrontmatter(path.join(notesDir, name)),
  ).length;
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
}

/** Owns the active data dir + the legacy-recovery state (per process). */
export class DataDirControl {
  private current: string;
  private currentSource: DataDirSource;
  private readonly homeDir: string;
  private capturedCookiePath: string | undefined;
  private readonly dismissed = new Set<string>();

  constructor(init: DataDirControlInit) {
    this.current = init.dataDir;
    this.currentSource = init.source;
    this.homeDir = init.homeDir;
  }

  get dataDir(): string {
    return this.current;
  }

  get source(): DataDirSource {
    return this.currentSource;
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
        error: `The data directory is pinned to ${this.current} by ${pinnedBy(this.currentSource)}, so it cannot be changed here. Restart the server without it to choose ${checked.path}.`,
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
        pinnedBy: pinnedBy(this.currentSource),
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
    this.capturedCookiePath = undefined;
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
    const noteCount = exists ? countNotes(dir) : 0;
    let hint: InspectionHint | undefined;
    if (exists && noteCount === 0) {
      const parent = path.dirname(dir);
      if (path.basename(dir) === 'notes' && countNotes(parent) > 0) {
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
   * Inspect a request's Cookie header and capture a valid legacy cookie path
   * (first valid one wins while it stays valid). Never switches anything.
   */
  observeLegacyCookie(cookieHeader: string | undefined): void {
    if (!cookieHeader) return;
    if (this.capturedCookiePath !== undefined) {
      if (this.check(this.capturedCookiePath, 'cookie') !== undefined) return;
      this.capturedCookiePath = undefined;
    }
    if (!this.recoveryAllowed()) return;
    const raw = parseCookies(cookieHeader)[LEGACY_DATA_DIR_COOKIE];
    if (raw === undefined || raw === '') return;
    const candidate = this.check(raw, 'cookie');
    if (candidate !== undefined) {
      this.capturedCookiePath = candidate.path;
    }
  }

  /** The current candidates, each re-validated now. */
  legacyCandidates(): LegacyCandidate[] {
    if (!this.recoveryAllowed()) return [];
    const found: LegacyCandidate[] = [];
    if (this.capturedCookiePath !== undefined) {
      const fromCookie = this.check(this.capturedCookiePath, 'cookie');
      if (fromCookie === undefined) {
        this.capturedCookiePath = undefined;
      } else {
        found.push(fromCookie);
      }
    }
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
    this.capturedCookiePath = undefined;
  }

  /** The `GET /api/data-dir` view of the current state. */
  status(): DataDirStatus {
    return {
      dataDir: this.current,
      source: this.currentSource,
      pinned: this.pinned,
      exists: directoryExists(this.current),
      noteCount: countNotes(this.current),
      formatVersion: CURRENT_FORMAT_VERSION,
      legacyCandidates: this.legacyCandidates(),
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
    const noteCount = countNotes(dir);
    if (noteCount < 1) return undefined;
    return { path: dir, noteCount, origin };
  }
}
