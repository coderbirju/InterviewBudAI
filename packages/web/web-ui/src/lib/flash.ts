/**
 * A one-shot message carried across an in-app navigation (no reload), e.g.
 * "Deleted … (backup at …)" shown on Home after deleting from Notes. In
 * memory only — a reload drops it, which is fine for a toast.
 */

let pending: string | null = null;

/** Queue a message for the next view that reads it ({@link peekFlash}). */
export function setFlash(message: string): void {
  pending = message;
}

/**
 * Read the queued message without clearing it — pure, so it is safe in a
 * `useState` initializer (StrictMode may call that twice); clear it with
 * {@link clearFlash} from an effect.
 */
export function peekFlash(): string | null {
  return pending;
}

/** Drop the queued message (once it has been shown). */
export function clearFlash(): void {
  pending = null;
}
