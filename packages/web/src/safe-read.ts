/**
 * Read a small, untrusted file from the data folder (ADR 0015 caches and
 * preferences): opened with `O_NOFOLLOW` (a symlink is refused) and
 * `O_NONBLOCK` (a FIFO cannot hang the open), then checked with `fstat` on
 * the SAME handle (no lstat-then-open race), and read with a hard byte cap.
 */

import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';

export type CappedRead =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'missing' }
  /** Not a regular file, a symlink, over the cap, or unreadable. */
  | { readonly kind: 'bad' };

const OPEN_FLAGS =
  constants.O_RDONLY |
  (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);

export async function readCappedFile(
  file: string,
  maxBytes: number,
): Promise<CappedRead> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, OPEN_FLAGS);
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return { kind: 'bad' };
    // Read one byte past the cap, in case the file grows meanwhile.
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return { kind: 'bad' };
    return { kind: 'ok', text: buffer.subarray(0, bytesRead).toString('utf8') };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    return code === 'ENOENT' ? { kind: 'missing' } : { kind: 'bad' };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
