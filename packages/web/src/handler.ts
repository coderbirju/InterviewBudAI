import type { StorageAdapter, SessionId, IsoTimestamp } from '@ibai/storage';
import type { LlmProvider } from '@ibai/providers';
import { assess, plan, coach } from '@ibai/core';
import type {
  AssessmentView,
  SessionPlan,
  CoachResult,
  TopicOutcome,
} from '@ibai/core';
import {
  renderAssessmentJson,
  renderPlanJson,
  renderDashboardHtml,
  renderCoachForm,
  renderCoachResult,
  renderCoachJson,
  escapeHtml,
} from './render.js';

/** Minimal response shape, decoupled from Node http types. */
export interface HandlerResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

/** Dependencies for the assess handler (DI). */
export interface AssessHandlerDeps {
  readonly storage: StorageAdapter;
}

/**
 * Dependencies for the coach handler (DI).
 * Extends AssessHandlerDeps with an optional provider for coach operations.
 */
export interface CoachHandlerDeps extends AssessHandlerDeps {
  readonly provider?: LlmProvider;
}

/**
 * Minimal request shape for the handler.
 * Extended to support POST bodies for coach operations.
 */
export interface HandlerRequest {
  readonly method: string;
  readonly url: string;
  /** Optional request body (for POST requests). */
  readonly body?: string;
  /** Optional content-type header. */
  readonly contentType?: string;
}

/**
 * Parse form-encoded outcomes from POST body.
 * Form field naming: outcome_<topicId>=pass|fail, note_<topicId>=...
 * Only topics with submitted outcomes are included (no fabrication).
 */
function parseFormOutcomes(body: string): TopicOutcome[] {
  const params = new URLSearchParams(body);
  const outcomes: TopicOutcome[] = [];
  const seenTopics = new Set<string>();

  // Find all outcome_* fields
  for (const [key, value] of params.entries()) {
    if (key.startsWith('outcome_')) {
      const topicId = key.slice('outcome_'.length);
      if (!seenTopics.has(topicId) && (value === 'pass' || value === 'fail')) {
        seenTopics.add(topicId);
        const note = params.get(`note_${topicId}`) || undefined;
        outcomes.push({
          topicId,
          succeeded: value === 'pass',
          note: note && note.trim() ? note.trim() : undefined,
        });
      }
    }
  }

  return outcomes;
}

/**
 * Parse JSON outcomes from POST body.
 * Expected shape: { sessionId?: string, outcomes: Array<{ topicId, succeeded, note? }> }
 */
function parseJsonOutcomes(body: string): {
  sessionId?: string;
  outcomes: TopicOutcome[];
} {
  const parsed = JSON.parse(body);
  const outcomes: TopicOutcome[] = [];

  if (Array.isArray(parsed.outcomes)) {
    for (const o of parsed.outcomes) {
      if (typeof o.topicId === 'string' && typeof o.succeeded === 'boolean') {
        outcomes.push({
          topicId: o.topicId,
          succeeded: o.succeeded,
          note:
            typeof o.note === 'string' && o.note.trim()
              ? o.note.trim()
              : undefined,
        });
      }
    }
  }

  return {
    sessionId:
      typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
    outcomes,
  };
}

/**
 * Check if an error looks like a connection refused error (Ollama not running).
 */
function isConnectionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('fetch failed') ||
      msg.includes('connection refused') ||
      msg.includes('network error')
    );
  }
  return false;
}

/**
 * Create the assess handler with injected dependencies.
 * Supports both assess-only routes (GET) and coach routes (GET form, POST execute).
 */
export function createAssessHandler(
  deps: AssessHandlerDeps,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  return createCoachHandler(deps);
}

/**
 * Create the full handler with optional coach support.
 * If provider is not supplied, coach POST routes return an error instructing
 * the user to configure IBAI_OLLAMA_MODEL.
 */
export function createCoachHandler(
  deps: CoachHandlerDeps,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  return async (req: HandlerRequest): Promise<HandlerResponse> => {
    // Parse URL
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // Determine route
    const isGet = req.method === 'GET';
    const isPost = req.method === 'POST';

    // GET routes
    const isAssessJson = isGet && pathname === '/assess.json';
    const isPlanJson = isGet && pathname === '/plan.json';
    const isHtml = isGet && (pathname === '/' || pathname === '/assess');
    const isCoachForm = isGet && pathname === '/coach';

    // POST routes
    const isCoachPost = isPost && pathname === '/coach';
    const isCoachJsonPost = isPost && pathname === '/coach.json';

    // Known paths (for 405 vs 404 distinction)
    const knownPaths = [
      '/',
      '/assess',
      '/assess.json',
      '/plan.json',
      '/coach',
      '/coach.json',
    ];
    const isKnownPath = knownPaths.includes(pathname);

    // 405 for unsupported methods on known paths
    if (isKnownPath && !isGet && !isPost) {
      return {
        status: 405,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // 405 for POST on GET-only paths
    if (
      isPost &&
      (pathname === '/' ||
        pathname === '/assess' ||
        pathname === '/assess.json' ||
        pathname === '/plan.json')
    ) {
      return {
        status: 405,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // 404 for unknown paths
    if (
      !isAssessJson &&
      !isPlanJson &&
      !isHtml &&
      !isCoachForm &&
      !isCoachPost &&
      !isCoachJsonPost
    ) {
      return {
        status: 404,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Not found' }),
      };
    }

    // Extract optional sessionId from query
    const sessionIdParam = url.searchParams.get('sessionId');
    const sessionId: SessionId | undefined = sessionIdParam ?? undefined;

    try {
      // Get assessment view (reads storage once)
      const view: AssessmentView = await assess(deps.storage, sessionId);

      // Derive session plan (pure, sync - no storage read)
      const sessionPlan: SessionPlan = plan(view);

      // Handle GET routes
      if (isAssessJson) {
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: renderAssessmentJson(view),
        };
      }

      if (isPlanJson) {
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: renderPlanJson(sessionPlan),
        };
      }

      if (isHtml) {
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderDashboardHtml(view, sessionPlan),
        };
      }

      if (isCoachForm) {
        // GET /coach - render the coaching session form (read-only, no write-back)
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderCoachForm(sessionPlan, view),
        };
      }

      // Handle POST routes (coach with write-back)
      if (isCoachPost || isCoachJsonPost) {
        const isJson = isCoachJsonPost;

        // Check if provider is configured
        if (!deps.provider) {
          const errorMsg =
            'Coach requires IBAI_OLLAMA_MODEL to be set. Please configure the model environment variable.';
          if (isJson) {
            return {
              status: 400,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({ error: errorMsg }),
            };
          }
          return {
            status: 400,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml('Configuration Error', errorMsg),
          };
        }

        // Parse outcomes from body
        let outcomes: TopicOutcome[];
        let bodySessionId: string | undefined;

        try {
          if (isJson) {
            const parsed = parseJsonOutcomes(req.body ?? '');
            outcomes = parsed.outcomes;
            bodySessionId = parsed.sessionId;
          } else {
            outcomes = parseFormOutcomes(req.body ?? '');
            // Form may also include sessionId
            const formParams = new URLSearchParams(req.body ?? '');
            bodySessionId = formParams.get('sessionId') ?? undefined;
          }
        } catch (parseError) {
          const errorMsg =
            parseError instanceof Error
              ? parseError.message
              : 'Invalid request body';
          if (isJson) {
            return {
              status: 400,
              contentType: 'application/json; charset=utf-8',
              body: JSON.stringify({ error: errorMsg }),
            };
          }
          return {
            status: 400,
            contentType: 'text/html; charset=utf-8',
            body: renderErrorHtml('Parse Error', errorMsg),
          };
        }

        // Use sessionId from body if provided, otherwise from query, otherwise generate
        const coachSessionId =
          bodySessionId ?? sessionId ?? generateSessionId();

        // Build CoachInput
        const input = {
          sessionId: coachSessionId,
          plan: sessionPlan,
          outcomes,
          assessment: view,
          completedAt: new Date().toISOString() as IsoTimestamp,
        };

        // Execute coach (with write-back)
        let result: CoachResult;
        try {
          result = await coach(
            { storage: deps.storage, provider: deps.provider },
            input,
          );
        } catch (coachError) {
          // Check for connection errors
          if (isConnectionError(coachError)) {
            const errorMsg =
              "Could not connect to Ollama. Is Ollama running? Start it with 'ollama serve'.";
            if (isJson) {
              return {
                status: 502,
                contentType: 'application/json; charset=utf-8',
                body: JSON.stringify({ error: errorMsg }),
              };
            }
            return {
              status: 502,
              contentType: 'text/html; charset=utf-8',
              body: renderErrorHtml('Connection Error', errorMsg),
            };
          }
          throw coachError;
        }

        // Return result
        if (isJson) {
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: renderCoachJson(result),
          };
        }

        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderCoachResult(coachSessionId, sessionPlan, result),
        };
      }

      // Should not reach here
      return {
        status: 500,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Internal routing error' }),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Internal server error';
      const isJson = isAssessJson || isPlanJson || isCoachJsonPost;
      const contentType = isJson
        ? 'application/json; charset=utf-8'
        : 'text/html; charset=utf-8';
      const body = isJson
        ? JSON.stringify({ error: message })
        : renderErrorHtml('Error', message);

      return {
        status: 500,
        contentType,
        body,
      };
    }
  };
}

/**
 * Render a simple error HTML page with the dark theme.
 */
function renderErrorHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InterviewBudAI - ${escapeHtml(title)}</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent-red: #ef4444;
      --border-color: #475569;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .error-card {
      background-color: var(--bg-secondary);
      border-radius: 12px;
      padding: 2rem;
      max-width: 500px;
      text-align: center;
      border-left: 4px solid var(--accent-red);
    }
    h1 {
      color: var(--accent-red);
      margin-bottom: 1rem;
    }
    p {
      color: var(--text-secondary);
    }
    a {
      color: #3b82f6;
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="error-card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <p style="margin-top: 1rem;"><a href="/">← Back to Dashboard</a></p>
  </div>
</body>
</html>`;
}

/**
 * Generate a simple session ID based on timestamp.
 */
function generateSessionId(): string {
  return `session-${Date.now()}`;
}
