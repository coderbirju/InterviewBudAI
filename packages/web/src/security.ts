/**
 * Localhost request hardening for the web server (defense in depth).
 *
 * The server binds 127.0.0.1 only, but "localhost-only" does not stop a web
 * page the user visits from talking to it through the browser. This module
 * holds the pure checks the handler applies to EVERY request:
 *
 *   1. Host allowlist — only `127.0.0.1:<port>`, `localhost:<port>` and
 *      `[::1]:<port>` are accepted. A DNS-rebinding attack makes the browser
 *      send `Host: evil.example` to our socket; rejecting unknown Hosts blocks
 *      it (the attacker page can then never read our responses).
 *   2. Same-origin check on state-changing methods (POST/PUT/PATCH/DELETE):
 *      a present `Origin` must be exactly `http://<allowed host>`; if Origin is
 *      absent, `Sec-Fetch-Site` must be `same-origin` or `none`. If BOTH are
 *      absent the request is allowed: every modern browser sends at least one
 *      of them on a cross-site state-changing request, so a request with
 *      neither comes from a non-browser client (curl, scripts) that already
 *      runs as the user and is not a CSRF vector.
 *   3. `/api` mutating requests must be `Content-Type: application/json`.
 *      Browsers cannot send that cross-site without a CORS preflight (which we
 *      never approve), so this kills "simple request" CSRF (`text/plain`,
 *      form posts) even if checks 1–2 were bypassed.
 *
 * Plus a fixed set of security response headers (nosniff, no-referrer, no
 * framing, CSP). Node built-ins only; no dependencies.
 */

import * as crypto from 'node:crypto';

/** Methods that can change server state (need the same-origin check). */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/** The exact `host:port` values this server answers to. */
export function allowedHostsFor(port: number): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

type Headers = Record<string, string | string[] | undefined>;

/** Read a single header value case-insensitively (first value if repeated). */
export function headerValue(
  headers: Headers | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}

/** True when the Host header is exactly one of the allowed `host:port`s. */
export function isAllowedHost(
  host: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (!host) return false;
  return allowed.has(host.trim().toLowerCase());
}

export type OriginVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Same-origin check for a state-changing request (see module doc, rule 2).
 *
 * `Origin: null` is ambiguous: browsers send it for our OWN `/setup` form post
 * (the page is served with `Referrer-Policy: no-referrer`, and the Fetch spec
 * then serializes a non-CORS request's Origin as `null`), but also for
 * sandboxed frames / file:// pages. So `null` defers to `Sec-Fetch-Site`
 * (which pages cannot forge), and is rejected if that header is absent.
 */
export function checkSameOrigin(
  headers: Headers | undefined,
  allowed: ReadonlySet<string>,
): OriginVerdict {
  const origin = headerValue(headers, 'origin')?.trim().toLowerCase();
  const isNullOrigin = origin === 'null';
  if (origin !== undefined && !isNullOrigin) {
    const prefix = 'http://';
    if (origin.startsWith(prefix) && allowed.has(origin.slice(prefix.length))) {
      return { ok: true };
    }
    return { ok: false, reason: 'cross-origin request rejected' };
  }

  const site = headerValue(headers, 'sec-fetch-site');
  if (site !== undefined) {
    const value = site.trim().toLowerCase();
    if (value === 'same-origin' || value === 'none') return { ok: true };
    return { ok: false, reason: 'cross-site request rejected' };
  }

  if (isNullOrigin) {
    return { ok: false, reason: 'opaque-origin request rejected' };
  }
  // Neither header: a non-browser client (curl, scripts). Not a CSRF vector.
  return { ok: true };
}

/** The media type of a Content-Type header, lowercased, without params. */
export function mediaType(contentType: string | undefined): string {
  if (!contentType) return '';
  return (contentType.split(';')[0] ?? '').trim().toLowerCase();
}

/** Random per-process CSRF token (URL/form safe). */
export function createCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Constant-time token comparison (false on any length/type mismatch). */
export function tokensEqual(
  expected: string,
  provided: string | null | undefined,
): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * CSP for the React SPA bundle and JSON: everything same-origin, no inline
 * script or style (the Vite build emits only external `/assets/*` files; React
 * `style` props go through the CSSOM, which CSP does not block).
 */
export const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * CSP for the small server-rendered pages (`/setup`, 404, "UI not built"):
 * no scripts at all; inline `<style>` is needed for their embedded CSS.
 */
export const SERVER_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Security headers sent on every response (CSP defaults to {@link SPA_CSP}). */
export function securityHeaders(csp: string = SPA_CSP): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': csp,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
