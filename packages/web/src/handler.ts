import type { StorageAdapter, SessionId } from '@ibai/storage';
import { assess } from '@ibai/core';
import { renderAssessmentHtml, renderAssessmentJson } from './render.js';

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

/** Minimal request shape for the handler. */
export interface HandlerRequest {
  readonly method: string;
  readonly url: string;
}

/**
 * Create the assess handler with injected dependencies.
 */
export function createAssessHandler(
  deps: AssessHandlerDeps,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  return async (req: HandlerRequest): Promise<HandlerResponse> => {
    // Only allow GET
    if (req.method !== 'GET') {
      return {
        status: 405,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // Parse URL
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // Determine format
    const isJson = pathname === '/assess.json';
    const isHtml = pathname === '/' || pathname === '/assess';

    if (!isJson && !isHtml) {
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
      const view = await assess(deps.storage, sessionId);

      if (isJson) {
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: renderAssessmentJson(view),
        };
      } else {
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: renderAssessmentHtml(view),
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Internal server error';
      const contentType = isJson
        ? 'application/json; charset=utf-8'
        : 'text/html; charset=utf-8';
      const body = isJson
        ? JSON.stringify({ error: message })
        : `<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Error</h1><p>${escapeHtml(message)}</p></body></html>`;

      return {
        status: 500,
        contentType,
        body,
      };
    }
  };
}

// Import escapeHtml for error page
import { escapeHtml } from './render.js';
