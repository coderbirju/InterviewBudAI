/**
 * Minimal client-side router for the SPA (ADR 0006).
 *
 * M2 rendered a single view (`<Home />`) with no router. M3 introduced a second
 * view (the notes editor), so we switch views by URL — but a full routing
 * library would be a new heavy dependency (charter §7.1 / no-new-deps
 * constraint). Instead this is a tiny path parser + `navigate` helper built on
 * React built-ins and the History API only.
 *
 * M6 makes the SPA the whole app: it is served at the site ROOT (Vite
 * `base: '/'`), and the server does a SPA fallback for extensionless,
 * non-API, non-/setup GET paths (see `spa.ts`), so `/notes/<id>`,
 * `/analytics`, and `/interview` all load `index.html` and this router picks
 * the view.
 */

import { useEffect, useState } from 'react';

/**
 * The base path the SPA is mounted at on the server (matches Vite `base`).
 * M6: the SPA owns the site root, so the base is empty ('' = '/').
 */
export const APP_BASE = '';

/**
 * A parsed SPA route. `home` is the default; `notes` carries the problem id;
 * `analytics` is the analytics/charts page; `interview` is the interview
 * chat page.
 */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'notes'; readonly problemId: string }
  | { readonly kind: 'analytics' }
  | { readonly kind: 'interview' };

/**
 * Parse a full pathname (e.g. `/notes/two-sum`) into a `Route`. Anything that
 * is not a recognized path resolves to `home`, so unknown/legacy paths degrade
 * to the catalog rather than a blank screen.
 */
export function parseRoute(pathname: string): Route {
  // Trim leading/trailing slashes; the SPA lives at the root.
  const rest = pathname.replace(/^\/+/, '').replace(/\/+$/, '');

  const segments = rest.length > 0 ? rest.split('/') : [];
  if (segments[0] === 'notes' && segments[1]) {
    return { kind: 'notes', problemId: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === 'analytics' && segments.length === 1) {
    return { kind: 'analytics' };
  }
  if (segments[0] === 'interview' && segments.length === 1) {
    return { kind: 'interview' };
  }
  return { kind: 'home' };
}

/** Build the SPA URL for the notes editor of a given problem. */
export function notesHref(problemId: string): string {
  return `/notes/${encodeURIComponent(problemId)}`;
}

/** The SPA analytics (charts) URL. */
export function analyticsHref(): string {
  return '/analytics';
}

/** The SPA interview chat URL. */
export function interviewHref(): string {
  return '/interview';
}

/** The SPA home (catalog) URL. */
export function homeHref(): string {
  return '/';
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
 * The current URL query string (e.g. `?q=sum`), or `''` outside a browser.
 * The router matches on pathname only, so views that keep state in the query
 * (Home's catalog filter) read it here.
 */
export function currentSearch(): string {
  return typeof window !== 'undefined' ? window.location.search : '';
}

/**
 * Replace the current URL's query string in place (History `replaceState`),
 * keeping the pathname and hash. Replace — not push — so typing in a search box
 * doesn't flood the back stack, while reload and back-from-another-view still
 * restore it. Does not emit `popstate`: the route (pathname) is unchanged.
 */
export function replaceSearch(search: string): void {
  if (typeof window !== 'undefined' && window.history) {
    const { pathname, hash } = window.location;
    if (search !== window.location.search) {
      window.history.replaceState(
        window.history.state,
        '',
        `${pathname}${search}${hash}`,
      );
    }
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
