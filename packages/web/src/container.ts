/**
 * Running inside the Docker image (ADR 0011 D2/D3, `IBAI_CONTAINER=1`).
 *
 *  - The data dir is pinned to `/data` (the image sets `IBAI_DATA_DIR`), a
 *    bind mount of the host folder `IBAI_HOST_DATA_DIR`. That variable is
 *    DISPLAY-ONLY here: it is shown in the UI and compared with the host's
 *    config.json, never used as a path inside the container.
 *  - Boot checks that `/data` is writable (best-effort `chmod 0700` first) so
 *    a root-owned bind source is a clear error, not silent failures.
 *  - Compose mounts the host's `~/.interviewbudai` read-only at
 *    `/host-config`. Only the FIXED file `/host-config/config.json` is read
 *    (no symlink, ≤ 64 KiB, same validation as config.json), to tell the user
 *    when their non-Docker setup uses another folder. No data path is ever
 *    resolved under `/host-config`.
 *
 * Node built-ins only. Nothing here throws.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MAX_LOCAL_CONFIG_BYTES,
  isContainer,
  parseLocalConfigText,
} from './config.js';
import type { LocalConfigRead } from './config.js';

/** The fixed, read-only path of the host's config.json inside the container. */
export const HOST_CONFIG_PATH = '/host-config/config.json';

/** `/data` writability, checked once at boot. */
export type WritableCheck =
  | { readonly writable: true; readonly chmodWarning?: string }
  | { readonly writable: false; readonly error: string };

function errorText(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string') return code;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Best-effort `chmod 0700` of `dir` (a folder Docker creates is typically
 * 0755), then create + remove a temp file. Never throws; never creates `dir`.
 */
export function checkDataDirWritable(dir: string): WritableCheck {
  let chmodWarning: string | undefined;
  try {
    fs.chmodSync(dir, 0o700);
  } catch (err) {
    chmodWarning = `could not chmod 0700 ${dir} (${errorText(err)})`;
  }
  const probe = path.join(
    dir,
    `.ibai-write-check.${process.pid}.${randomBytes(6).toString('hex')}`,
  );
  try {
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
  } catch (err) {
    return { writable: false, error: errorText(err) };
  }
  try {
    fs.rmSync(probe, { force: true });
  } catch {
    // The probe is empty and uniquely named; a leftover is harmless.
  }
  return chmodWarning === undefined
    ? { writable: true }
    : { writable: true, chmodWarning };
}

/** The fix shown when `/data` is not writable (ADR 0011 D3). */
export function notWritableHelp(hostDataDir: string | undefined): string {
  const where = hostDataDir ?? 'the folder mounted at /data';
  return `The data folder is not writable by the app (host folder: ${where}). On Linux, create it as your user before starting (mkdir -p -m 700 ${hostDataDir ?? '~/.interviewbudai/data'}), make sure you own it, and set IBAI_UID=$(id -u) IBAI_GID=$(id -g); then restart with docker compose up.`;
}

/** Reading `/host-config/config.json`: same result shape as config.json. */
export type HostConfigRead = LocalConfigRead;

/** POSIX or Windows path flavour for a HOST path read inside the container. */
function flavourOf(p: string): path.PlatformPath {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
    ? path.win32
    : path.posix;
}

/**
 * Read `file` (default {@link HOST_CONFIG_PATH}) — untrusted, like
 * config.json. Refuses a symlink (`O_NOFOLLOW` + `lstat`), a non-regular file
 * and anything over 64 KiB; `dataDir` may be a POSIX or Windows absolute path
 * (it is a HOST path). Missing file → `absent`. Never throws.
 */
export function readHostConfig(
  file: string = HOST_CONFIG_PATH,
): HostConfigRead {
  let fd: number | undefined;
  let text: string;
  try {
    const link = fs.lstatSync(file);
    if (link.isSymbolicLink()) {
      return { status: 'invalid', error: 'is a symbolic link' };
    }
    if (!link.isFile()) {
      return { status: 'invalid', error: 'not a regular file' };
    }
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const nonBlock = fs.constants.O_NONBLOCK ?? 0;
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | nonBlock);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      return { status: 'invalid', error: 'not a regular file' };
    }
    if (stat.size > MAX_LOCAL_CONFIG_BYTES) {
      return { status: 'invalid', error: 'file is too large' };
    }
    const buf = Buffer.alloc(MAX_LOCAL_CONFIG_BYTES + 1);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    if (read > MAX_LOCAL_CONFIG_BYTES) {
      return { status: 'invalid', error: 'file is too large' };
    }
    text = buf.subarray(0, read).toString('utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'absent' };
    if (code === 'ELOOP') {
      return { status: 'invalid', error: 'is a symbolic link' };
    }
    return { status: 'invalid', error: errorText(err) };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  // Pick the flavour from the raw value, then validate exactly like config.json.
  let raw: unknown;
  try {
    raw = (JSON.parse(text) as { dataDir?: unknown } | null)?.dataDir;
  } catch {
    raw = undefined;
  }
  return parseLocalConfigText(
    text,
    typeof raw === 'string' ? flavourOf(raw) : path.posix,
  );
}

/**
 * Normalize a HOST path for comparison: resolve (`.`/`..`, duplicate
 * separators), drop trailing separators, and lowercase when the host
 * filesystem is case-insensitive by default (Windows paths; macOS home and
 * volume paths `/Users/…`, `/Volumes/…`). Relative input → undefined (it
 * cannot be judged from inside the container).
 */
export function normalizeHostPath(p: string): string | undefined {
  const trimmed = p.trim();
  if (trimmed === '' || trimmed.includes('\0')) return undefined;
  const api = flavourOf(trimmed);
  if (!api.isAbsolute(trimmed)) return undefined;
  let resolved = api.resolve(trimmed);
  const root = api.parse(resolved).root;
  while (resolved.length > root.length && /[\\/]$/.test(resolved)) {
    resolved = resolved.slice(0, -1);
  }
  const caseInsensitive =
    api === path.win32 || /^\/(Users|Volumes)(\/|$)/i.test(resolved);
  return caseInsensitive ? resolved.toLowerCase() : resolved;
}

/** True when both are absolute host paths naming the same folder. */
export function sameHostPath(a: string, b: string): boolean {
  const na = normalizeHostPath(a);
  const nb = normalizeHostPath(b);
  return na !== undefined && nb !== undefined && na === nb;
}

/** The mismatch banner copy (ADR 0011 D3). */
export function hostMismatchText(hostConfigDataDir: string): string {
  return `Your non-Docker setup uses ${hostConfigDataDir}. To use the same notes in Docker, set IBAI_HOST_DATA_DIR=${hostConfigDataDir} in .env and restart.`;
}

/** `GET /api/data-dir` `docker` block (present only inside the container). */
export interface DockerDataInfo {
  /** Display-only host folder mounted at /data (`IBAI_HOST_DATA_DIR`). */
  readonly hostDataDir: string | null;
  /** `/data` passed the boot writability check. */
  readonly writable: boolean;
  /** Fixed help text when not writable. */
  readonly writableHelp?: string;
  /**
   * The host folder the NON-Docker app uses (from the host's config.json),
   * set only when it differs from `hostDataDir` (the mismatch banner).
   */
  readonly hostConfigDataDir?: string;
}

/**
 * Build the Docker info (or undefined outside a container). `writable` is the
 * boot check; `hostConfig` defaults to reading {@link HOST_CONFIG_PATH}.
 */
export function dockerDataInfo(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly writable: WritableCheck;
  readonly hostConfig?: HostConfigRead;
}): DockerDataInfo | undefined {
  if (!isContainer(input.env)) return undefined;
  const hostDataDir = input.env.IBAI_HOST_DATA_DIR?.trim() || null;
  const hostConfig = input.hostConfig ?? readHostConfig();
  const mismatch =
    hostDataDir !== null &&
    hostConfig.status === 'ok' &&
    normalizeHostPath(hostDataDir) !== undefined &&
    !sameHostPath(hostConfig.dataDir, hostDataDir);
  return {
    hostDataDir,
    writable: input.writable.writable,
    ...(!input.writable.writable && {
      writableHelp: notWritableHelp(hostDataDir ?? undefined),
    }),
    ...(mismatch &&
      hostConfig.status === 'ok' && { hostConfigDataDir: hostConfig.dataDir }),
  };
}
