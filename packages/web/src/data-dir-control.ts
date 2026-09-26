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
 * Legacy cookie recovery: before w2d the dir came from the `ibai_data_dir`
 * cookie, so users who chose a custom folder that way now see an empty default.
 * When a request carries that cookie, the server is not pinned, no
 * config.json exists yet, and the cookie path is a real directory holding at
 * least one `notes/*.md`, the path is CAPTURED in memory (per process) as a
 * "legacy candidate" the SPA can offer. The server never switches to it on its
 * own: the user must accept it (`POST /api/data-dir/legacy/accept`), which
 * re-validates everything and then goes through `choose`. Capturing matters
 * because the handler expires the cookie on the very first response.
 *
 * The cookie is still untrusted (cookies are not port-isolated), which is why
 * it is only ever a suggestion shown to the user, never a switch.
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

/** A previous (cookie-chosen) data folder the user may restore. */
export interface LegacyCandidate {
  readonly path: string;
  readonly noteCount: number;
}

/** `GET /api/data-dir` shape. */
export interface DataDirStatus {
  readonly dataDir: string;
  readonly source: DataDirSource;
  readonly pinned: boolean;
  readonly exists: boolean;
  readonly noteCount: number;
  readonly legacyCandidate?: LegacyCandidate;
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

/**
 * Count the saved notes (`<dir>/notes/*.md` regular files). Never throws: a
 * missing or unreadable directory counts as 0.
 */
export function countNotes(dir: string): number {
  try {
    return fs
      .readdirSync(path.join(dir, 'notes'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

export interface DataDirControlInit {
  readonly dataDir: string;
  readonly source: DataDirSource;
  /** Home directory holding `.interviewbudai/config.json`. */
  readonly homeDir: string;
}

/** Owns the active data dir + the captured legacy candidate (per process). */
export class DataDirControl {
  private current: string;
  private currentSource: DataDirSource;
  private readonly homeDir: string;
  private captured: string | undefined;
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
   * may be created here, never changed. On success any legacy candidate is
   * dropped (the user has made a choice).
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
    this.captured = undefined;
    return { ok: true, path: checked.path };
  }

  /**
   * Inspect a request's Cookie header and capture a valid legacy candidate
   * (first valid one wins while it stays valid). Never switches anything.
   */
  observeLegacyCookie(cookieHeader: string | undefined): void {
    if (!cookieHeader || this.legacyCandidate() !== undefined) return;
    if (!this.recoveryAllowed()) return;
    const raw = parseCookies(cookieHeader)[LEGACY_DATA_DIR_COOKIE];
    if (raw === undefined || raw === '') return;
    const candidate = this.checkCandidate(raw);
    if (candidate !== undefined) {
      this.captured = candidate.path;
    }
  }

  /** The captured candidate, re-validated now (dropped when no longer valid). */
  legacyCandidate(): LegacyCandidate | undefined {
    if (this.captured === undefined) return undefined;
    const candidate = this.recoveryAllowed()
      ? this.checkCandidate(this.captured)
      : undefined;
    if (candidate === undefined) {
      this.captured = undefined;
    }
    return candidate;
  }

  /**
   * Switch to the captured candidate after re-validating it. `undefined` when
   * there is nothing (valid) to restore.
   */
  acceptLegacy(): ChooseResult | undefined {
    const candidate = this.legacyCandidate();
    if (candidate === undefined) return undefined;
    return this.choose(candidate.path);
  }

  /** Forget the captured candidate; the same path is not offered again. */
  dismissLegacy(): void {
    if (this.captured !== undefined) {
      this.dismissed.add(this.captured);
    }
    this.captured = undefined;
  }

  /** The `GET /api/data-dir` view of the current state. */
  status(): DataDirStatus {
    const candidate = this.legacyCandidate();
    return {
      dataDir: this.current,
      source: this.currentSource,
      pinned: this.pinned,
      exists: directoryExists(this.current),
      noteCount: countNotes(this.current),
      ...(candidate !== undefined ? { legacyCandidate: candidate } : {}),
    };
  }

  /** Recovery is only offered before any choice is pinned or persisted. */
  private recoveryAllowed(): boolean {
    return !this.pinned && readLocalConfig(this.homeDir).status === 'absent';
  }

  private checkCandidate(raw: string): LegacyCandidate | undefined {
    const checked = validateSetupPath(raw);
    if (!checked.ok) return undefined;
    const dir = checked.path;
    if (dir === this.current || this.dismissed.has(dir)) return undefined;
    if (!directoryExists(dir)) return undefined;
    const noteCount = countNotes(dir);
    if (noteCount < 1) return undefined;
    return { path: dir, noteCount };
  }
}
