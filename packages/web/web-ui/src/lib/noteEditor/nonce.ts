/**
 * The per-response style nonce for the note editor (ADR 0014 D2).
 *
 * The server writes a fresh 16-byte base64 nonce into
 * `<meta name="ibai-style-nonce" nonce="…">` and into the CSP's `style-src`.
 * The editor needs it so CodeMirror can mount its `<style nonce>` element.
 * Only the exact shape of 16 random bytes in base64 is accepted: the
 * unreplaced placeholder (Vite dev server, an old bundle), an empty value or
 * anything else means "no nonce", and Notes keeps the plain textarea.
 *
 * Main-chunk code: no CodeMirror imports here.
 */

/** 16 bytes in base64: 22 significant chars plus `==`. */
export const STYLE_NONCE_RE = /^[A-Za-z0-9+/]{22}==$/;

export function isValidStyleNonce(value: unknown): value is string {
  return typeof value === 'string' && STYLE_NONCE_RE.test(value);
}

/**
 * Read the nonce from the meta element. Browsers hide a nonce attribute once
 * a CSP applies, so the `nonce` IDL property comes first; `getAttribute` is
 * the fallback (jsdom, older engines). Returns null unless it is valid.
 */
export function readStyleNonce(doc: Document = document): string | null {
  const meta = doc.querySelector('meta[name="ibai-style-nonce"]');
  if (!meta) return null;
  const idl = (meta as HTMLElement).nonce;
  const value = idl ? idl : meta.getAttribute('nonce');
  return isValidStyleNonce(value) ? value : null;
}
