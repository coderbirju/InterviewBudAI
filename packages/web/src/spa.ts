import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HandlerResponse } from './handler.js';
import { SERVER_PAGE_CSP } from './security.js';

/**
 * Serves the built React SPA (ADR 0006) at the site ROOT.
 *
 * M6: the SPA is the whole app. It is built by Vite (`npm run build:ui`) into
 * packages/web/dist-ui with `base: '/'`, so all emitted asset URLs are
 * root-relative (e.g. `/assets/index-*.js`). This module maps request paths to
 * files in that directory — all local, no runtime network. For any GET path
 * that is not a real asset file it serves `index.html`, so client-side routing
 * (`/notes/:id`, `/analytics`, `/interview`, …) works on a hard refresh.
 *
 * The handler routes `/api/*` and `/setup` BEFORE consulting this module, so
 * those surfaces are never shadowed by the SPA. If the bundle is absent (UI not
 * built), it degrades gracefully with a clear message and never throws.
 */

/** Resolve the built-bundle directory: packages/web/dist-ui.
 *  This module compiles to packages/web/dist/spa.js, so dist-ui is one level up. */
const BUNDLE_DIR = fileURLToPath(new URL('../dist-ui', import.meta.url));

/** Minimal, explicit content-type map for the asset types Vite emits. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * True if this GET request should be served by the SPA. The SPA owns the site
 * root: everything except the `/api/*` and `/setup` surfaces (which the handler
 * routes first) is either a bundle asset or a client-side route that resolves
 * to `index.html`. Callers MUST route `/api` and `/setup` before this.
 */
export function isSpaRequest(pathname: string): boolean {
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (pathname === '/setup') return false;
  return true;
}

/** True if the built bundle (index.html) exists on disk. */
export function bundleExists(): boolean {
  try {
    return fs.statSync(path.join(BUNDLE_DIR, 'index.html')).isFile();
  } catch {
    return false;
  }
}

/** Graceful message shown when the SPA has not been built yet. */
function notBuiltResponse(): HandlerResponse {
  return {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<title>InterviewBudAI — build the UI</title></head>',
      '<body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:2rem">',
      '<h1>Web UI not built yet</h1>',
      '<p>The React SPA bundle was not found. Build it locally with:</p>',
      '<pre style="background:#1e293b;padding:1rem;border-radius:8px">npm run build:ui</pre>',
      '<p>Then reload the page.</p>',
      '</body></html>',
    ].join(''),
    // Inline styles only, no scripts: the server-page CSP, not the SPA one.
    headers: { 'Content-Security-Policy': SERVER_PAGE_CSP },
  };
}

/**
 * Resolve a request pathname to a file inside the bundle directory, guarding
 * against path traversal. Returns an absolute path inside BUNDLE_DIR, or null
 * if the resolved path escapes the bundle. `/` maps to index.html.
 */
function resolveBundleFile(pathname: string): string | null {
  let rel = pathname;
  if (rel === '' || rel === '/') {
    rel = '/index.html';
  }
  const resolved = path.resolve(BUNDLE_DIR, '.' + rel);
  const bundleRoot = path.resolve(BUNDLE_DIR);
  if (resolved !== bundleRoot && !resolved.startsWith(bundleRoot + path.sep)) {
    return null;
  }
  return resolved;
}

/** Read and serve index.html, or the not-built message if it is missing. */
function serveIndexHtml(): HandlerResponse {
  try {
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: fs.readFileSync(path.join(BUNDLE_DIR, 'index.html'), 'utf8'),
    };
  } catch {
    return notBuiltResponse();
  }
}

/**
 * Handle a GET request for the SPA. Assumes `isSpaRequest(pathname)` is already
 * true. Never throws: a missing bundle degrades to a friendly message, a real
 * asset is served with its content type, and any other (extensionless) path
 * falls back to index.html so client-side routing works on refresh. A missing
 * asset-looking path (has an extension) 404s.
 */
export function handleSpaRequest(pathname: string): HandlerResponse {
  if (!bundleExists()) {
    return notBuiltResponse();
  }

  const filePath = resolveBundleFile(pathname);
  if (filePath === null) {
    return {
      status: 404,
      contentType: 'text/plain; charset=utf-8',
      body: 'Not found',
    };
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      return {
        status: 200,
        contentType: contentTypeFor(filePath),
        body: fs.readFileSync(filePath, 'utf8'),
      };
    }
  } catch {
    // fall through to SPA fallback
  }

  // SPA fallback: an extensionless path is a client-side route -> index.html.
  // Asset-looking paths (with an extension) that do not exist are a real 404.
  if (path.extname(pathname) === '') {
    return serveIndexHtml();
  }

  return {
    status: 404,
    contentType: 'text/plain; charset=utf-8',
    body: 'Not found',
  };
}
