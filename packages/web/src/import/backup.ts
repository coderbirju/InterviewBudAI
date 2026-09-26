/**
 * Safety snapshots before destructive-ish writes (ADR 0009 D3).
 *
 * Copies the data dir to `<dataDir>/.backups/<YYYYMMDDTHHMMSSZ>[-N]/`,
 * excluding `.backups/` itself; symlinks are never followed (skipped); dirs
 * are created 0700. Keeps the last {@link BACKUP_RETENTION}, pruning only
 * entries whose names match the timestamp pattern, and writes
 * `.backups/.gitignore` (`*`) so a git-tracked data dir never commits them.
 * Throws on failure — the caller MUST NOT write anything then.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const BACKUPS_DIR = '.backups';
export const BACKUP_RETENTION = 5;
const BACKUP_NAME = /^(\d{8}T\d{6}Z)(?:-(\d+))?$/;

/** UTC ISO 8601 basic format `YYYYMMDDTHHMMSSZ` (valid on Windows). */
export function backupTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

async function copyTree(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { mode: 0o700 });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    // lstat semantics: Dirent types are not followed through symlinks.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

/** Sort key: timestamp, then numeric suffix (none = 0). */
function compareBackups(a: string, b: string): number {
  const ma = BACKUP_NAME.exec(a);
  const mb = BACKUP_NAME.exec(b);
  const ta = ma?.[1] ?? '';
  const tb = mb?.[1] ?? '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return Number(ma?.[2] ?? 0) - Number(mb?.[2] ?? 0);
}

/**
 * Snapshot `dataDir` and prune old snapshots. Returns the new backup's
 * absolute path.
 */
export async function createBackup(dataDir: string, now: Date): Promise<string> {
  const root = path.join(dataDir, BACKUPS_DIR);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(root, '.gitignore'), '*\n', 'utf8');

  const stamp = backupTimestamp(now);
  let name = stamp;
  for (let n = 2; ; n++) {
    try {
      await fs.lstat(path.join(root, name));
      name = `${stamp}-${n}`;
    } catch {
      break;
    }
  }
  const target = path.join(root, name);
  await fs.mkdir(target, { mode: 0o700 });

  try {
    const entries = await fs.readdir(dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === BACKUPS_DIR || entry.isSymbolicLink()) continue;
      const from = path.join(dataDir, entry.name);
      const to = path.join(target, entry.name);
      if (entry.isDirectory()) await copyTree(from, to);
      else if (entry.isFile()) await fs.copyFile(from, to);
    }
  } catch (err) {
    // Never leave a partial snapshot that looks complete.
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  const snapshots = (await fs.readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && BACKUP_NAME.test(e.name))
    .map((e) => e.name)
    .sort(compareBackups);
  for (const old of snapshots.slice(0, -BACKUP_RETENTION)) {
    // Pruning is best-effort: the new snapshot is already complete.
    await fs
      .rm(path.join(root, old), { recursive: true, force: true })
      .catch(() => {});
  }
  return target;
}
