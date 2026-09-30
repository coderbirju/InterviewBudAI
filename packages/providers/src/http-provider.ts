/**
 * Reusable HTTP provider core for chat-style LLM adapters.
 *
 * This module provides a generic HTTP POST+JSON transport layer that concrete
 * adapters (Anthropic, OpenAI, etc.) call. It centralizes transport and
 * untrusted-response handling while remaining agnostic to API differences.
 *
 * ## API Shape Differences (for future adapter authors)
 *
 * ### Anthropic Messages API
 * - System prompt is a TOP-LEVEL `system` string field (NOT a message)
 * - Messages array contains only user/assistant roles
 * - `max_tokens` is REQUIRED
 * - Response text is in `content[]` blocks: `{ type: 'text', text: '...' }`
 * - Usage: `input_tokens` / `output_tokens`
 * - Auth: `x-api-key` header + `anthropic-version` header
 *
 * ### OpenAI Chat Completions (`openai-compatible.ts`)
 * - System IS a message in the `messages` array with role 'system'
 * - `max_tokens` is optional
 * - Response text in `choices[0].message.content`
 * - Usage: `prompt_tokens` / `completion_tokens`
 * - Auth: `Authorization: Bearer <key>` header
 *
 * The `postJson` function is agnostic to these differences — adapters build
 * headers+body and validate the response; the core only transports + guards.
 */

/** Failure class of a {@link postJson} call (additive; message text unchanged). */
export type HttpProviderErrorKind =
  | 'connection'
  | 'http'
  | 'malformed'
  | 'timeout';

/**
 * Error thrown by {@link postJson}. A plain `Error` subclass, so existing
 * callers that match on `message` keep working; adapters that want a precise
 * classification read `kind` / `status` instead of parsing text.
 */
export class HttpProviderError extends Error {
  readonly kind: HttpProviderErrorKind;
  /** HTTP status for `kind === 'http'`. */
  readonly status?: number;
  /** First 500 chars of an error body for `kind === 'http'` (UNTRUSTED). */
  readonly bodySnippet?: string;

  constructor(
    message: string,
    kind: HttpProviderErrorKind,
    extra: { status?: number; bodySnippet?: string } = {},
  ) {
    super(message);
    this.name = 'HttpProviderError';
    this.kind = kind;
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.bodySnippet !== undefined) this.bodySnippet = extra.bodySnippet;
  }
}

/** Configuration for an HTTP POST request to an LLM provider. */
export interface HttpProviderRequest {
  /** Full URL to POST to. */
  readonly url: string;
  /** HTTP headers (Content-Type, auth, etc.). */
  readonly headers: Readonly<Record<string, string>>;
  /** Pre-serialized JSON body. */
  readonly body: string;
  /** Fetch implementation (for testing injection). */
  readonly fetchImpl: typeof fetch;
  /** Provider name for error messages (e.g. 'Anthropic'). */
  readonly providerName: string;
  /**
   * OPTIONAL deadline (ms) for the whole call — request AND body read. Unset =
   * no deadline (the historical behavior).
   */
  readonly timeoutMs?: number;
}

/**
 * POST `body` to `url` with `headers` using `fetchImpl`. Returns the parsed
 * JSON as `unknown` (UNTRUSTED — caller MUST validate shape before use).
 *
 * Rejects with a clear, provider-labeled {@link HttpProviderError} on:
 * - network/connection failure (fetch throws) — `connection`
 * - non-2xx HTTP status (includes status + body snippet) — `http`
 * - malformed/invalid JSON body — `malformed`
 * - the optional deadline passing — `timeout`
 */
export async function postJson(req: HttpProviderRequest): Promise<unknown> {
  const { url, headers, body, fetchImpl, providerName, timeoutMs } = req;

  const controller = timeoutMs !== undefined ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = (): HttpProviderError =>
    new HttpProviderError(
      `${providerName} request timed out after ${Math.round((timeoutMs ?? 0) / 1000)} s`,
      'timeout',
    );
  // A deadline that also covers a stalled body read (fetchImpl may ignore the
  // signal, e.g. a test fake or a buggy polyfill).
  const deadline =
    controller === null
      ? null
      : new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(timeoutError());
          }, timeoutMs);
        });
  const race = <T>(p: Promise<T>): Promise<T> =>
    deadline === null ? p : Promise.race([p, deadline]);

  try {
    let response: Response;
    try {
      response = await race(
        fetchImpl(url, {
          method: 'POST',
          headers,
          body,
          ...(controller !== null && { signal: controller.signal }),
        }),
      );
    } catch (error) {
      if (error instanceof HttpProviderError) throw error;
      if (controller?.signal.aborted) throw timeoutError();
      const message =
        error instanceof Error ? error.message : 'Unknown network error';
      throw new HttpProviderError(
        `${providerName} request failed to ${url}: ${message}`,
        'connection',
      );
    }

    if (!response.ok) {
      let bodySnippet = '';
      try {
        const text = await race(response.text());
        bodySnippet = text.slice(0, 500);
      } catch (error) {
        if (error instanceof HttpProviderError) throw error;
        // Ignore errors reading body
      }
      throw new HttpProviderError(
        `${providerName} returned HTTP ${response.status}: ${bodySnippet}`,
        'http',
        { status: response.status, bodySnippet },
      );
    }

    let data: unknown;
    try {
      data = await race(response.json() as Promise<unknown>);
    } catch (error) {
      if (error instanceof HttpProviderError) throw error;
      if (controller?.signal.aborted) throw timeoutError();
      throw new HttpProviderError(
        `${providerName} returned invalid JSON response`,
        'malformed',
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}
