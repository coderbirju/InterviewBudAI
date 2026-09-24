import type { StorageAdapter } from '@ibai/storage';
import type { LlmProvider } from '@ibai/providers';
import {
  renderSetupHtml,
  renderSetupSuccessHtml,
  renderSetupErrorHtml,
  render404Html,
} from './render.js';
import { createCatalogSource } from '@ibai/curriculum';
import type { CurriculumSource } from '@ibai/curriculum';
import { parseCookies, expandTilde, resolveDataDir } from './config.js';
import { isSpaRequest, handleSpaRequest } from './spa.js';
import { isApiRoute, handleApiRoute } from './api.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Minimal response shape, decoupled from Node http types. */
export interface HandlerResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  /** Optional headers to include in response (e.g., Set-Cookie, Location). */
  readonly headers?: Record<string, string>;
}

/** Dependencies for the assess handler (DI). */
export interface AssessHandlerDeps {
  readonly storage: StorageAdapter;
}

/**
 * Dependencies for the coach handler (DI).
 *
 * The provider is passed through to the JSON API (POST /api/chat); the
 * server-rendered coach page was retired in M6. Storage/catalog wiring is
 * likewise forwarded to the API and setup routes.
 */
export interface CoachHandlerDeps extends AssessHandlerDeps {
  readonly provider?: LlmProvider;
  /** Human-readable label for the active provider (shown in UI). */
  readonly providerLabel?: string;
  /** Curriculum catalog source for problem lookup. */
  readonly catalog?: CurriculumSource;
  /** Factory to create storage adapter for a given data directory. */
  readonly createStorage?: (dataDir: string) => StorageAdapter;
  /** Default data directory (from config). */
  readonly defaultDataDir?: string;
  /** Environment variables for config resolution. */
  readonly env?: NodeJS.ProcessEnv;
  /** CLI argv for config resolution. */
  readonly argv?: string[];
}

/**
 * Minimal request shape for the handler.
 * Supports POST bodies and headers for cookie-based routing.
 */
export interface HandlerRequest {
  readonly method: string;
  readonly url: string;
  /** Optional request body (for POST requests). */
  readonly body?: string;
  /** Optional content-type header. */
  readonly contentType?: string;
  /** Optional headers map for cookie parsing and other header access. */
  readonly headers?: Record<string, string | string[] | undefined>;
}

/**
 * Create the assess handler with injected dependencies.
 * Retained as a thin alias of {@link createCoachHandler} for existing callers.
 */
export function createAssessHandler(
  deps: AssessHandlerDeps,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  return createCoachHandler(deps);
}

/**
 * Create the web handler (ADR 0006 M6 — the SPA is the whole app).
 *
 * The server surface is intentionally small:
 *   - `/api/*`   — JSON API the SPA consumes (catalog/notes/progress/config/chat)
 *   - `/setup`   — the one remaining server-rendered page: GET shows the
 *                  create-database form, POST creates the data dir + sets the
 *                  persistent `ibai_data_dir` cookie, then links back to the SPA
 *   - everything else (GET) — the React SPA bundle + assets, with an
 *                  index.html fallback for client-side routes
 *
 * All server-rendered product pages (home/catalog/notes/coach/analytics/…) were
 * retired in M6; the SPA owns those surfaces via client-side routing.
 */
export function createCoachHandler(
  deps: CoachHandlerDeps,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  return async (req: HandlerRequest): Promise<HandlerResponse> => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    const isGet = req.method === 'GET';
    const isPost = req.method === 'POST';

    // /api/* — JSON API layer (ADR 0006 D4). Always JSON, never HTML; data-dir
    // resolved per-request via the cookie>env>default precedence. Unknown /api
    // paths 404 (JSON), wrong methods 405 (JSON). Routed FIRST so the SPA
    // catch-all never shadows it.
    if (isApiRoute(pathname)) {
      const apiCookieHeader =
        typeof req.headers?.cookie === 'string'
          ? req.headers.cookie
          : undefined;
      const apiCookieDataDir = parseCookies(apiCookieHeader)['ibai_data_dir'];
      return handleApiRoute(
        req.method,
        pathname,
        {
          catalog: deps.catalog ?? createCatalogSource(),
          createStorage: deps.createStorage,
          storage: deps.storage,
          defaultDataDir: deps.defaultDataDir,
          provider: deps.provider,
          providerLabel: deps.providerLabel,
          env: deps.env,
          argv: deps.argv,
        },
        apiCookieDataDir,
        req.body,
      );
    }

    // /setup — the one remaining server-rendered page (create-database flow).
    // GET shows the form; POST creates the directory and sets the persistent
    // cookie. Routed before the SPA catch-all so it is never shadowed.
    if (pathname === '/setup') {
      if (isGet) {
        const defaultDataDir =
          deps.defaultDataDir ?? resolveDataDir(deps.env, deps.argv);
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderSetupHtml(defaultDataDir),
        };
      }
      if (isPost) {
        const defaultDataDir =
          deps.defaultDataDir ?? resolveDataDir(deps.env, deps.argv);
        const formParams = new URLSearchParams(req.body ?? '');
        let rawPath = formParams.get('dataDir') ?? defaultDataDir;

        // Normalize path: expand ~, resolve to absolute.
        rawPath = expandTilde(rawPath);
        const resolvedPath = path.resolve(rawPath);

        try {
          // Create directory (recursive, like mkdir -p).
          fs.mkdirSync(resolvedPath, { recursive: true });

          // Set the persistent cookie and return the success page.
          const cookieValue = encodeURIComponent(resolvedPath);
          return {
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: renderSetupSuccessHtml(resolvedPath),
            headers: {
              'Set-Cookie': `ibai_data_dir=${cookieValue}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`,
            },
          };
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : 'Unknown error creating directory';
          return {
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: renderSetupErrorHtml(message),
          };
        }
      }
      // Any other method on /setup.
      return {
        status: 405,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // Everything else is the SPA surface (ADR 0006 M6). Only GET serves the
    // bundle/assets/client-routes; other methods on a non-API, non-/setup path
    // are not allowed.
    if (isSpaRequest(pathname)) {
      if (!isGet) {
        return {
          status: 405,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
      }
      return handleSpaRequest(pathname);
    }

    // Unreachable in practice (isSpaRequest is true for all non-api/non-setup
    // paths), but kept as a coherent final 404 for safety.
    return {
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: render404Html(),
    };
  };
}
