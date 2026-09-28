/**
 * A one-shot message carried across an in-app navigation (no reload), e.g.
 * "Deleted … (backup at …)" shown on Home after deleting from Notes. In
 * memory only — a reload drops it, which is fine for a toast.
 */

let pending: string | null = null;

/** Queue a message for the next view that calls {@link takeFlash}. */
export function setFlash(message: string): void {
  pending = message;
}

/** Read and clear the queued message. */
export function takeFlash(): string | null {
  const message = pending;
  pending = null;
  return message;
}
