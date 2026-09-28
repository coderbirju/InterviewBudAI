import * as os from 'node:os';
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
import { resolvePort, resolveServerDataDir } from './config.js';
import type { DataDirSource } from './config.js';
import {
  DataDirControl,
  isSettlingResponse,
  pinnedBy,
  settlesLegacy,
} from './data-dir-control.js';
import { isSpaRequest, handleSpaRequest } from './spa.js';
import { isApiRoute, handleApiRoute } from './api.js';
import { createProviderTester } from './settings.js';
import {
  allowedHostsFor,
  checkSameOrigin,
  createCsrfToken,
  hasLegacyDataDirCookie,
  headerValue,
  isAllowedHost,
  isMutatingMethod,
  mediaType,
  securityHeaders,
  tokensEqual,
  EXPIRE_LEGACY_DATA_DIR_COOKIE,
  MAX_BODY_BYTES,
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
 * The provider is passed through to the JSON API (the Quiz Master routes).
 * Storage/catalog wiring is likewise forwarded to the API and setup routes.
 */
export interface CoachHandlerDeps extends AssessHandlerDeps {
  readonly provider?: LlmProvider;
  /** Human-readable label for the active provider (shown in UI). */
  readonly providerLabel?: string;
  /** Curriculum catalog source for problem lookup. */
  readonly catalog?: CurriculumSource;
  /** Factory to create storage adapter for a given data directory. */
  readonly createStorage?: (dataDir: string) => StorageAdapter;
  /**
   * The server's data directory, already resolved at boot by the composition
   * root. When absent the handler resolves it ONCE at creation (flag > env >
   * config.json > default) from `env`/`argv`/`homeDir`. Per-request code only
   * ever uses this server state — never anything the browser sends.
   */
  readonly dataDir?: string;
  /** Where `dataDir` came from; `'flag'`/`'env'` pin it (/setup refuses). */
  readonly dataDirSource?: DataDirSource;
  /**
   * Home directory holding `.interviewbudai/config.json` (tests inject a temp
   * dir). Defaults to `os.homedir()`.
   */
  readonly homeDir?: string;
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
  /** Sink for one-time warnings (default: console.warn). */
  readonly warn?: (line: string) => void;
  /**
   * fetch for POST /api/settings/test-provider (tests inject a fake; no real
   * network in CI). Default: global fetch, resolved at call time.
   */
  readonly fetchImpl?: typeof fetch;
  /** ms clock for the test-provider rate limit + latency (default Date.now). */
  readonly clock?: () => number;
}

/**
 * Minimal request shape for the handler.
 * Supports POST bodies and headers.
 */
export interface HandlerRequest {
  readonly method: string;
  readonly url: string;
  /** Optional request body (for POST requests). */
  readonly body?: string;
  /**
   * Set by the transport when the body exceeded {@link MAX_BODY_BYTES} and was
   * not buffered; the handler answers 413.
   */
  readonly bodyTooLarge?: boolean;
  /** Optional content-type header. */
  readonly contentType?: string;
  /** Optional headers map (Host, Origin, Cookie, ...). */
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
 * The header-only localhost checks, in order: Host allowlist (DNS rebinding →
 * 421), same-origin on mutating methods (CSRF → 403), and JSON-only `/api`
 * writes (→ 415). Returns the rejection, or `null` to continue. Needs no body,
 * so the transport runs it BEFORE reading one.
 */
export function precheckRequest(
  req: Pick<HandlerRequest, 'method' | 'url' | 'contentType' | 'headers'>,
  allowedHosts: ReadonlySet<string>,
): HandlerResponse | null {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const isApi = isApiRoute(pathname);
  if (!isAllowedHost(headerValue(req.headers, 'host'), allowedHosts)) {
    return reject(isApi, 421, 'misdirected request: unexpected Host header');
  }
  if (isMutatingMethod(req.method)) {
    const verdict = checkSameOrigin(req.headers, allowedHosts);
    if (!verdict.ok) {
      return reject(isApi, 403, verdict.reason);
    }
    const contentType =
      req.contentType ?? headerValue(req.headers, 'content-type');
    if (isApi && mediaType(contentType) !== 'application/json') {
      return reject(
        isApi,
        415,
        'unsupported media type: use Content-Type: application/json',
      );
    }
  }
  return null;
}

/** The 413 response for an over-cap body (JSON for `/api`, plain elsewhere). */
export function payloadTooLarge(pathname: string): HandlerResponse {
  return reject(
    isApiRoute(pathname),
    413,
    `payload too large: request body exceeds ${MAX_BODY_BYTES} bytes`,
  );
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
 *   - `/api/*`   — JSON API the SPA consumes (catalog/notes/progress/config/quiz)
 *   - `/setup`   — the one remaining server-rendered page: GET shows the
 *                  create-database form, POST creates the data dir, persists
 *                  it to `~/.interviewbudai/config.json` and switches the
 *                  server's active data dir, then links back to the SPA
 *   - everything else (GET) — the React SPA bundle + assets, with an
 *                  index.html fallback for client-side routes
 *
 * The SERVER owns the data directory (ADR 0005 amendment w2d): it is resolved
 * once (flag > env > config.json > default) into handler state and only /setup or
 * POST /api/data-dir can change it. The legacy `ibai_data_dir` cookie never selects the dir (it is
 * only a recovery hint, expired once the user switches or dismisses — ADR 0009).
 *
 * Every request first passes the localhost hardening in `security.ts` (Host
 * allowlist, body-size cap, same-origin check on mutating methods, JSON-only
 * `/api` writes), and every response carries the security headers.
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
  const homeDir = deps.homeDir ?? os.homedir();

  // The server's data dir: resolved ONCE here (or passed in by the
  // composition root, which already resolved it at boot). Mutated only via
  // `state.choose` (POST /setup, POST /api/data-dir).
  // One catalog instance for the API and for recognising notes on disk.
  const catalog = deps.catalog ?? createCatalogSource();
  const state = new DataDirControl({
    homeDir,
    isKnownProblemId: (id) => catalog.getById(id) !== undefined,
    ...((): { dataDir: string; source: DataDirSource } => {
      if (deps.dataDir !== undefined) {
        return {
          dataDir: deps.dataDir,
          source: deps.dataDirSource ?? 'default',
        };
      }
      const resolved = resolveServerDataDir(deps.env, deps.argv, homeDir);
      if (resolved.warning !== undefined) {
        (deps.warn ?? ((line: string) => console.warn(line)))(
          `Warning: ${resolved.warning}`,
        );
      }
      return { dataDir: resolved.dataDir, source: resolved.source };
    })(),
  });

  // Settings (ADR 0008 W2c): env is read for presence only; one tester per
  // handler holds the in-process rate limit.
  const settingsEnv = deps.env ?? process.env;
  const settings = {
    env: settingsEnv,
    testProvider: createProviderTester({
      env: settingsEnv,
      ...(deps.fetchImpl !== undefined && { fetchImpl: deps.fetchImpl }),
      ...(deps.clock !== undefined && { clock: deps.clock }),
    }),
  };

  const route = async (req: HandlerRequest): Promise<HandlerResponse> => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const isApi = isApiRoute(pathname);

    // 1–3. Host allowlist, same-origin, JSON-only API writes (header-only).
    const rejected = precheckRequest(req, allowedHosts);
    if (rejected !== null) {
      return rejected;
    }

    // Legacy-cookie recovery: capture (never follow) a previous cookie-chosen
    // folder (the browser may drop the cookie later). Only after the Host /
    // Origin checks, so a rebinding or cross-site request cannot plant one.
    state.observeLegacyCookie(headerValue(req.headers, 'cookie'));

    // 4. Body-size cap (before any parsing).
    if (
      req.bodyTooLarge === true ||
      (req.body !== undefined &&
        Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES)
    ) {
      return payloadTooLarge(pathname);
    }

    const contentType =
      req.contentType ?? headerValue(req.headers, 'content-type');

    const isGet = req.method === 'GET';
    const isPost = req.method === 'POST';

    // /api/* — JSON API layer (ADR 0006 D4). Always JSON, never HTML; uses the
    // server's data dir. Unknown /api paths 404 (JSON), wrong methods 405
    // (JSON). Routed FIRST so the SPA catch-all never shadows it.
    if (isApi) {
      return handleApiRoute(
        req.method,
        pathname,
        {
          catalog,
          createStorage: deps.createStorage,
          storage: deps.storage,
          dataDir: state.dataDir,
          dataDirControl: state,
          provider: deps.provider,
          providerLabel: deps.providerLabel,
          settings,
        },
        req.body,
      );
    }

    // /setup — the one remaining server-rendered page (create-database flow).
    // Routed before the SPA catch-all so it is never shadowed.
    if (pathname === '/setup') {
      const pinned = state.pinned;
      const pinnedNotice = pinned
        ? `The data directory is pinned to ${state.dataDir} by ${pinnedBy(state.source)}; /setup can create it but cannot change it. Restart the server without it to choose a different location here.`
        : undefined;
      if (isGet) {
        return serverPage(
          200,
          renderSetupHtml(state.dataDir, setupCsrfToken, pinnedNotice),
        );
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

        // The shared validate → create → persist → switch path.
        const chosen = state.choose(formParams.get('dataDir') ?? state.dataDir);
        if (!chosen.ok) {
          return serverPage(400, renderSetupErrorHtml(chosen.error));
        }

        return settlesLegacy(
          serverPage(200, renderSetupSuccessHtml(chosen.path, chosen.pinnedBy)),
        );
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
    // overrides the SPA default. The legacy `ibai_data_dir` cookie never
    // selects the data dir; it is kept (as a recovery hint, ADR 0009 D1)
    // until the user switches folders or dismisses the prompt, and expired
    // on exactly those responses.
    const expireLegacy: Record<string, string> =
      isSettlingResponse(res) &&
      hasLegacyDataDirCookie(headerValue(req.headers, 'cookie'))
        ? { 'Set-Cookie': EXPIRE_LEGACY_DATA_DIR_COOKIE }
        : {};
    return {
      ...res,
      headers: { ...securityHeaders(), ...res.headers, ...expireLegacy },
    };
  };
}
