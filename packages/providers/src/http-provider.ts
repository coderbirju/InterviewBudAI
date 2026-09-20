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
 * ### OpenAI Chat Completions (future)
 * - System IS a message in the `messages` array with role 'system'
 * - `max_tokens` is optional
 * - Response text in `choices[0].message.content`
 * - Usage: `prompt_tokens` / `completion_tokens`
 * - Auth: `Authorization: Bearer <key>` header
 *
 * The `postJson` function is agnostic to these differences — adapters build
 * headers+body and validate the response; the core only transports + guards.
 */

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
}

/**
 * POST `body` to `url` with `headers` using `fetchImpl`. Returns the parsed
 * JSON as `unknown` (UNTRUSTED — caller MUST validate shape before use).
 *
 * Rejects with a clear, provider-labeled message on:
 * - network/connection failure (fetch throws)
 * - non-2xx HTTP status (includes status + body snippet)
 * - malformed/invalid JSON body
 */
export async function postJson(req: HttpProviderRequest): Promise<unknown> {
  const { url, headers, body, fetchImpl, providerName } = req;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown network error';
    throw new Error(`${providerName} request failed to ${url}: ${message}`);
  }

  if (!response.ok) {
    let bodySnippet = '';
    try {
      const text = await response.text();
      bodySnippet = text.slice(0, 500);
    } catch {
      // Ignore errors reading body
    }
    throw new Error(
      `${providerName} returned HTTP ${response.status}: ${bodySnippet}`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${providerName} returned invalid JSON response`);
  }

  return data;
}
