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
import {
  parseCookies,
  resolveDataDir,
  resolvePort,
  validateSetupPath,
  createDataDir,
} from './config.js';
import { isSpaRequest, handleSpaRequest } from './spa.js';
import { isApiRoute, handleApiRoute } from './api.js';
import {
  allowedHostsFor,
  checkSameOrigin,
  createCsrfToken,
  headerValue,
  isAllowedHost,
  isMutatingMethod,
  mediaType,
  securityHeaders,
  tokensEqual,
  SERVER_PAGE_CSP,
} from './security.js';

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
  /**
   * The port the server is bound to. Only `Host: 127.0.0.1|localhost|[::1]`
   * on THIS port is accepted (DNS-rebinding defense). Defaults to the
   * configured port (`resolvePort(env, argv)`).
   */
  readonly port?: number;
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

/** A rejection: JSON for `/api`, plain text elsewhere. */
function reject(
  isApi: boolean,
  status: number,
  message: string,
): HandlerResponse {
  if (isApi) {
    return {
      status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: message }),
    };
  }
  return {
    status,
    contentType: 'text/plain; charset=utf-8',
    body: message,
  };
}

/**
 * A server-rendered HTML page response (script-free CSP). Uses
 * `Referrer-Policy: same-origin` (not the global `no-referrer`) so the /setup
 * form post carries a real `Origin` — under `no-referrer` browsers send
 * `Origin: null`, which older browsers without `Sec-Fetch-Site` (Safari <16.4,
 * Firefox <90) could then not prove same-origin. Nothing leaks cross-origin.
 */
function serverPage(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): HandlerResponse {
  return {
    status,
    contentType: 'text/html; charset=utf-8',
    body,
    headers: {
      'Content-Security-Policy': SERVER_PAGE_CSP,
      'Referrer-Policy': 'same-origin',
      ...headers,
    },
  };
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
 * Every request first passes the localhost hardening in `security.ts` (Host
 * allowlist, same-origin check on mutating methods, JSON-only `/api` writes),
 * and every response carries the security headers.
 */
export function createCoachHandler(
  deps: CoachHandlerDeps,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  const allowedHosts = allowedHostsFor(
    deps.port ?? resolvePort(deps.env, deps.argv),
  );
  // Per-process CSRF token for the server-rendered /setup form. The form is
  // only readable same-origin (Host allowlist + SOP), so a foreign page cannot
  // learn it.
  const setupCsrfToken = createCsrfToken();

  const route = async (req: HandlerRequest): Promise<HandlerResponse> => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const isApi = isApiRoute(pathname);

    // 1. Host allowlist (DNS rebinding).
    if (!isAllowedHost(headerValue(req.headers, 'host'), allowedHosts)) {
      return reject(isApi, 421, 'misdirected request: unexpected Host header');
    }

    const contentType =
      req.contentType ?? headerValue(req.headers, 'content-type');

    if (isMutatingMethod(req.method)) {
      // 2. Same-origin check (CSRF).
      const verdict = checkSameOrigin(req.headers, allowedHosts);
      if (!verdict.ok) {
        return reject(isApi, 403, verdict.reason);
      }
      // 3. JSON-only API writes (defeats "simple request" CSRF).
      if (isApi && mediaType(contentType) !== 'application/json') {
        return reject(
          isApi,
          415,
          'unsupported media type: use Content-Type: application/json',
        );
      }
    }

    const isGet = req.method === 'GET';
    const isPost = req.method === 'POST';

    // /api/* — JSON API layer (ADR 0006 D4). Always JSON, never HTML; data-dir
    // resolved per-request via the cookie>env>default precedence. Unknown /api
    // paths 404 (JSON), wrong methods 405 (JSON). Routed FIRST so the SPA
    // catch-all never shadows it.
    if (isApi) {
      const apiCookieHeader = headerValue(req.headers, 'cookie');
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
      const defaultDataDir =
        deps.defaultDataDir ?? resolveDataDir(deps.env, deps.argv);
      if (isGet) {
        return serverPage(200, renderSetupHtml(defaultDataDir, setupCsrfToken));
      }
      if (isPost) {
        if (mediaType(contentType) !== 'application/x-www-form-urlencoded') {
          return reject(false, 415, 'unsupported media type');
        }
        const formParams = new URLSearchParams(req.body ?? '');
        if (!tokensEqual(setupCsrfToken, formParams.get('csrfToken'))) {
          return reject(
            false,
            403,
            'invalid or missing CSRF token: reload /setup and try again',
          );
        }

        const checked = validateSetupPath(
          formParams.get('dataDir') ?? defaultDataDir,
        );
        if (!checked.ok) {
          return serverPage(400, renderSetupErrorHtml(checked.error));
        }

        try {
          // Create the directory (mkdir -p) with owner-only permissions.
          createDataDir(checked.path);
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : 'Unknown error creating directory';
          return serverPage(400, renderSetupErrorHtml(message));
        }

        // Set the persistent cookie and return the success page.
        const cookieValue = encodeURIComponent(checked.path);
        return serverPage(200, renderSetupSuccessHtml(checked.path), {
          'Set-Cookie': `ibai_data_dir=${cookieValue}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`,
        });
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
    return serverPage(404, render404Html());
  };

  return async (req: HandlerRequest): Promise<HandlerResponse> => {
    const res = await route(req);
    // Security headers on every response; a route's own CSP (server pages)
    // overrides the SPA default.
    return { ...res, headers: { ...securityHeaders(), ...res.headers } };
  };
}
