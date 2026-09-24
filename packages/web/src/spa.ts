import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HandlerResponse } from './handler.js';

/**
 * Serves the built React SPA (ADR 0006) under the /app route.
 *
 * The SPA is built by Vite (`npm run build:ui`) into packages/web/dist-ui with
 * `base: '/app/'`, so all emitted asset URLs are already /app-prefixed. This
 * module maps request paths to files in that directory, all local — no runtime
 * network. If the bundle is absent (UI not built), it degrades gracefully with
 * a clear message and never throws, so other routes keep working.
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

/** True if this request targets the SPA route (`/app` or `/app/...`). */
export function isAppRoute(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/');
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
      '<p>Then reload <code>/app</code>. Other pages work without the bundle.</p>',
      '</body></html>',
    ].join(''),
  };
}

/**
 * Resolve a request pathname under /app to a file inside the bundle directory,
 * guarding against path traversal. Returns an absolute path inside BUNDLE_DIR,
 * or null if the resolved path escapes the bundle.
 */
function resolveBundleFile(pathname: string): string | null {
  // Strip the leading '/app'; '/app' and '/app/' both mean index.html.
  let rel = pathname.slice('/app'.length);
  if (rel === '' || rel === '/') {
    rel = '/index.html';
  }
  // Normalize and join, then verify containment (no traversal outside bundle).
  const resolved = path.resolve(BUNDLE_DIR, '.' + rel);
  const bundleRoot = path.resolve(BUNDLE_DIR);
  if (resolved !== bundleRoot && !resolved.startsWith(bundleRoot + path.sep)) {
    return null;
  }
  return resolved;
}

/**
 * Handle a GET request under the /app route. Assumes `isAppRoute(pathname)` is
 * already true. Never throws: missing bundle or missing file degrade to a
 * friendly 200/404 so the rest of the server stays healthy.
 */
export function handleAppRoute(pathname: string): HandlerResponse {
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

  // SPA fallback: unknown sub-path under /app returns index.html so client-side
  // routing (added in later milestones) works. Asset-looking paths 404.
  if (path.extname(pathname) === '') {
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

  return {
    status: 404,
    contentType: 'text/plain; charset=utf-8',
    body: 'Not found',
  };
}
