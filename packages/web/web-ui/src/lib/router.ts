/**
 * Minimal client-side router for the SPA (ADR 0006, M3).
 *
 * M2 rendered a single view (`<Home />`) with no router. M3 introduces a second
 * view (the notes editor), so we need to switch views by URL — but a full
 * routing library would be a new heavy dependency (charter §7.1 / M3 no-new-deps
 * constraint). Instead this is a tiny path parser + `navigate` helper built on
 * React built-ins and the History API only.
 *
 * The SPA is served under `/app` (Vite `base: '/app/'`), and the server does a
 * SPA fallback for extensionless deep paths under `/app` (see `spa.ts`), so
 * `/app/notes/<id>` loads `index.html` and this router picks the view.
 */

import { useEffect, useState } from 'react';

/** The base path the SPA is mounted at on the server (matches Vite `base`). */
export const APP_BASE = '/app';

/** A parsed SPA route. `home` is the default; `notes` carries the problem id. */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'notes'; readonly problemId: string };

/**
 * Parse a full pathname (e.g. `/app/notes/two-sum`) into a `Route`. Anything
 * that is not a recognized notes path resolves to `home`, so unknown/legacy
 * paths degrade to the catalog rather than a blank screen.
 */
export function parseRoute(pathname: string): Route {
  // Strip the app base, tolerating a trailing slash.
  let rest = pathname;
  if (rest === APP_BASE) {
    rest = '';
  } else if (rest.startsWith(APP_BASE + '/')) {
    rest = rest.slice(APP_BASE.length + 1);
  }
  // Trim leading/trailing slashes.
  rest = rest.replace(/^\/+/, '').replace(/\/+$/, '');

  const segments = rest.length > 0 ? rest.split('/') : [];
  if (segments[0] === 'notes' && segments[1]) {
    return { kind: 'notes', problemId: decodeURIComponent(segments[1]) };
  }
  return { kind: 'home' };
}

/** Build the SPA URL for the notes editor of a given problem. */
export function notesHref(problemId: string): string {
  return `${APP_BASE}/notes/${encodeURIComponent(problemId)}`;
}

/** The SPA home (catalog) URL. */
export function homeHref(): string {
  return APP_BASE;
}

/**
 * Push a new SPA URL and update the current route without a full page reload.
 * Same-origin, history-only — no network. Guards for non-browser (test) envs.
 */
export function navigate(href: string): void {
  if (typeof window !== 'undefined' && window.history) {
    window.history.pushState({}, '', href);
    // Notify listeners (useRoute) that the location changed.
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

/**
 * React hook: the current parsed route, kept in sync with browser back/forward
 * (`popstate`) and `navigate()` calls. In a non-browser env it resolves to
 * `home`.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    typeof window !== 'undefined'
      ? parseRoute(window.location.pathname)
      : { kind: 'home' },
  );

  useEffect(() => {
    function onPopState(): void {
      setRoute(parseRoute(window.location.pathname));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return route;
}
