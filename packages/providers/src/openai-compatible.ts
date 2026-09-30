/**
 * OpenAI-compatible LLM Provider Adapter — bring-your-own-LLM.
 *
 * Speaks the de-facto standard Chat Completions wire format
 * (`POST <baseUrl>/chat/completions`) that many servers expose: Docker Model
 * Runner, llama.cpp server, vLLM, LM Studio, Ollama's `/v1`, and hosted
 * OpenAI-style APIs. Plain HTTP through the shared `postJson` core (Node
 * built-in fetch, NO vendor SDK).
 *
 * Design rules:
 *  - Base URL and model are user-supplied configuration — no default model,
 *    no default endpoint.
 *  - The API key is OPTIONAL (local servers need none); the `Authorization`
 *    header is sent only when a key is set, and the key never appears in an
 *    error message.
 *  - Lazy network: importing / constructing performs no I/O.
 *  - Every HTTP response is untrusted; `choices[0].message.content` is
 *    validated before mapping, and failures are classified (auth /
 *    connection / timeout / HTTP / malformed / empty) with sanitized text.
 */

import type {
  CompletionOptions,
  CompletionRequest,
  CompletionResponse,
  CompletionUsage,
  LlmProvider,
  PromptMessage,
} from './index.js';
import { HttpProviderError, postJson } from './http-provider.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for the OpenAICompatibleProvider. */
export interface OpenAICompatibleProviderConfig {
  /**
   * REQUIRED base URL of the server's OpenAI-compatible API, e.g.
   * `http://localhost:12434/engines/v1`. Normalized by
   * {@link normalizeOpenAIBaseUrl}. Must not contain a username/password.
   */
  readonly baseUrl: string;
  /** REQUIRED user-supplied model id. Never hardcoded. */
  readonly model: string;
  /** OPTIONAL bearer key. Omitted/empty → no `Authorization` header. */
  readonly apiKey?: string;
  /** Optional default generation options merged UNDER per-request options. */
  readonly defaultOptions?: CompletionOptions;
  /**
   * Whole-call deadline in ms (request + body). Default 120 000 (the web app
   * reads `IBAI_OPENAI_TIMEOUT_MS`, clamped to 5 000–600 000).
   */
  readonly timeoutMs?: number;
  /** Optional fetch injection for testing; defaults to global fetch (lazily). */
  readonly fetchImpl?: typeof fetch;
}

/** Label used in every error message. */
const PROVIDER_NAME = 'OpenAI-compatible server';

/** Default whole-call deadline: generous for local models on a CPU (ADR 0011 D1). */
export const OPENAI_DEFAULT_TIMEOUT_MS = 120_000;

/** Cap on the (untrusted) response body (ADR 0011 D1). */
const MAX_BODY_BYTES = 1024 * 1024;

/** Hosts a key may be sent to over plain `http:` — loopback only (ADR 0011 D1). */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    /^127(\.\d{1,3}){3}$/.test(h) ||
    h === '[::1]'
  );
}

/**
 * Key-transport rule (ADR 0011 D1): with a key, the base URL must be
 * `https:`, or `http:` to a loopback host — never a key over plain HTTP to the
 * network (Docker Model Runner's `model-runner.docker.internal` needs no key,
 * so it gets no exception). Without a key any http(s) base URL is fine. An
 * unparseable URL → false.
 */
export function openAIKeyTransportAllowed(
  rawBaseUrl: string,
  hasKey: boolean,
): boolean {
  if (!hasKey) return true;
  try {
    const url = new URL(rawBaseUrl.trim());
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

const RESPONSE_FORMAT_RE = /response_format/i;

/** A string field that names `response_format`. */
function mentionsResponseFormat(value: unknown): boolean {
  return typeof value === 'string' && RESPONSE_FORMAT_RE.test(value);
}

/**
 * Does an HTTP 400 body say the server rejected `response_format`?
 * Conservative (ADR 0011 D1): the mention must be in an error field — the
 * error's `param`, or its `message` / `detail` text — not just anywhere in the
 * body, so a server that echoes the request in an unrelated 400 does not turn
 * JSON mode off. A non-JSON (plain text) body counts only when it does not
 * look like an echoed request (no `"messages"`).
 */
function rejectsResponseFormat(error: unknown): boolean {
  if (
    !(error instanceof HttpProviderError) ||
    error.kind !== 'http' ||
    error.status !== 400
  ) {
    return false;
  }
  const snippet = error.bodySnippet ?? '';
  let data: unknown;
  try {
    data = JSON.parse(snippet);
  } catch {
    return RESPONSE_FORMAT_RE.test(snippet) && !/"messages"/.test(snippet);
  }
  const obj = asRecord(data);
  if (obj === null) return false;
  const candidates: unknown[] = [obj.message, obj.param, obj.detail];
  const nested = asRecord(obj.error);
  if (nested !== null) {
    candidates.push(nested.message, nested.param, nested.detail);
  } else {
    candidates.push(obj.error);
  }
  if (Array.isArray(obj.detail)) {
    // FastAPI-style `[{ loc: [...], msg }]` validation detail.
    for (const item of obj.detail) {
      const rec = asRecord(item);
      if (rec === null) continue;
      candidates.push(rec.msg);
      if (Array.isArray(rec.loc)) candidates.push(rec.loc.join('.'));
    }
  }
  return candidates.some(mentionsResponseFormat);
}

/** "20 ms" / "5 s" for error text. */
function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`;
}

// ---------------------------------------------------------------------------
// Base URL normalization
// ---------------------------------------------------------------------------

/** Docker Model Runner's host-side TCP port (ADR 0011 verified facts). */
const DMR_PORT = '12434';

/** A Docker Model Runner host (ADR 0011 D5), judged on host + port only. */
function isBareDmrHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'model-runner.docker.internal') return true;
  return (
    url.port === DMR_PORT &&
    (host === 'localhost' ||
      /^127(\.\d{1,3}){3}$/.test(host) ||
      host === '172.17.0.1')
  );
}

/**
 * Normalize a user-supplied OpenAI-compatible base URL. Rules:
 *
 *  1. Must parse as an `http:`/`https:` URL, else throws.
 *  2. Query string and fragment are dropped; trailing slashes are removed.
 *  3. A pasted full endpoint (`…/chat/completions` or `…/models`) is cut back
 *     to its base.
 *  4. Docker Model Runner (ADR 0011 D5): a path of `/engines` or
 *     `/engines/<engine>` gets `/v1` appended, and a bare DMR host
 *     (`model-runner.docker.internal` on any port, or a loopback host /
 *     `172.17.0.1` on port 12434) becomes `…/engines/v1`.
 *  5. Any other bare origin (no path) gets `/v1` appended — the OpenAI
 *     convention (`http://localhost:11434` → `http://localhost:11434/v1`).
 *  6. Any other path is kept as-is — `/v1` is NEVER appended twice, and
 *     custom prefixes (`/engines/v1`, `/engines/llama.cpp/v1`, `/openai`) are
 *     respected.
 *
 * Userinfo is preserved here (callers reject it separately) so the function
 * stays a pure string transform.
 */
export function normalizeOpenAIBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${PROVIDER_NAME}: base URL is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${PROVIDER_NAME}: base URL must use http or https`);
  }
  url.search = '';
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  pathname = pathname.replace(/\/(chat\/completions|models)$/, '');
  if (/^\/engines(\/(?!v1$)[^/]+)?$/i.test(pathname)) {
    pathname = `${pathname}/v1`;
  } else if (pathname === '') {
    pathname = isBareDmrHost(url) ? '/engines/v1' : '/v1';
  }
  const auth =
    url.username !== '' || url.password !== ''
      ? `${url.username}${url.password !== '' ? `:${url.password}` : ''}@`
      : '';
  return `${url.protocol}//${auth}${url.host}${pathname}`;
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

interface ChatCompletionsBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  response_format?: { type: 'json_object' };
}

function buildRequestBody(
  model: string,
  messages: readonly PromptMessage[],
  options?: CompletionOptions,
): string {
  // Roles map 1:1 (system stays a message, unlike Anthropic).
  const body: ChatCompletionsBody = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }
  if (options?.topP !== undefined) body.top_p = options.topP;
  if (options?.stop !== undefined) body.stop = [...options.stop];
  // `json_object` only (ADR 0011: DMR documents it; `json_schema` is unverified).
  if (options?.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }
  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// Response validation + mapping (UNTRUSTED input)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function mapResponse(data: unknown): CompletionResponse {
  const obj = asRecord(data);
  if (obj === null || !Array.isArray(obj.choices)) {
    throw new Error(
      `${PROVIDER_NAME} response is malformed: expected a "choices" array`,
    );
  }
  if (obj.choices.length === 0) {
    throw new Error(`${PROVIDER_NAME} returned an empty response (no choices)`);
  }
  const choice = asRecord(obj.choices[0]);
  const message = asRecord(choice?.message);
  const content = message?.content;
  if (content === null || content === '') {
    throw new Error(`${PROVIDER_NAME} returned an empty response (no content)`);
  }
  if (typeof content !== 'string') {
    throw new Error(
      `${PROVIDER_NAME} response is malformed: choices[0].message.content must be a string`,
    );
  }
  if (content.trim() === '') {
    throw new Error(`${PROVIDER_NAME} returned an empty response (no content)`);
  }

  let usage: CompletionUsage | undefined;
  const u = asRecord(obj.usage);
  if (u !== null) {
    const promptTokens = optionalNumber(u.prompt_tokens);
    const completionTokens = optionalNumber(u.completion_tokens);
    const totalTokens = optionalNumber(u.total_tokens);
    if (
      promptTokens !== undefined ||
      completionTokens !== undefined ||
      totalTokens !== undefined
    ) {
      usage = {
        ...(promptTokens !== undefined && { promptTokens }),
        ...(completionTokens !== undefined && { completionTokens }),
        ...(totalTokens !== undefined && { totalTokens }),
      };
    }
  }

  const metadata: Record<string, unknown> = {};
  if (typeof choice?.finish_reason === 'string') {
    metadata.finishReason = choice.finish_reason;
  }
  if (typeof obj.model === 'string') metadata.model = obj.model;

  return {
    content,
    ...(usage && { usage }),
    ...(Object.keys(metadata).length > 0 && { metadata }),
  };
}

// ---------------------------------------------------------------------------
// Error classification (sanitized: never the key, never URL userinfo/path)
// ---------------------------------------------------------------------------

function redact(text: string, secret: string | undefined): string {
  return secret ? text.split(secret).join('[redacted]') : text;
}

function classify(
  error: unknown,
  origin: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Error {
  if (!(error instanceof HttpProviderError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  switch (error.kind) {
    case 'timeout':
      return new Error(
        `${PROVIDER_NAME} at ${origin} timed out after ${formatMs(timeoutMs)}`,
      );
    case 'connection':
      return new Error(
        `${PROVIDER_NAME} request failed: network error — could not reach ${origin}. Is the server running?`,
      );
    case 'malformed':
      return new Error(
        `${PROVIDER_NAME} response is malformed: ${
          error.message.includes('too large')
            ? 'too large (over 1 MiB)'
            : 'invalid JSON'
        }`,
      );
    case 'http': {
      const status = error.status ?? 0;
      if (status === 401 || status === 403) {
        return new Error(
          `${PROVIDER_NAME} rejected the request (HTTP ${status} unauthorized): check IBAI_OPENAI_API_KEY`,
        );
      }
      if (status === 404) {
        return new Error(
          `${PROVIDER_NAME} returned HTTP 404: model or endpoint not found — check IBAI_OPENAI_MODEL and IBAI_OPENAI_BASE_URL`,
        );
      }
      const snippet = redact(error.bodySnippet ?? '', apiKey).slice(0, 200);
      return new Error(
        `${PROVIDER_NAME} returned HTTP ${status}${snippet ? `: ${snippet}` : ''}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider
// ---------------------------------------------------------------------------

/** OpenAI-compatible Chat Completions provider (Docker Model Runner et al.). */
export class OpenAICompatibleProvider implements LlmProvider {
  private readonly rawBaseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly defaultOptions?: CompletionOptions;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  /**
   * Capability latch (ADR 0011 D1): set once the server has answered 400 to
   * `response_format`; JSON mode is then not sent again for this process.
   */
  private jsonModeUnsupported = false;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.rawBaseUrl = config.baseUrl;
    this.model = config.model;
    if (config.apiKey) this.apiKey = config.apiKey;
    this.defaultOptions = config.defaultOptions;
    this.timeoutMs = config.timeoutMs ?? OPENAI_DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const baseUrl = normalizeOpenAIBaseUrl(this.rawBaseUrl);
    const parsed = new URL(baseUrl);
    if (parsed.username !== '' || parsed.password !== '') {
      throw new Error(
        `${PROVIDER_NAME}: base URL must not contain a username/password (use IBAI_OPENAI_API_KEY)`,
      );
    }
    const origin = parsed.origin;
    if (!openAIKeyTransportAllowed(baseUrl, Boolean(this.apiKey))) {
      throw new Error(
        `${PROVIDER_NAME}: refusing to send an API key over plain http to ${origin} (use https, or a loopback host)`,
      );
    }

    const merged =
      this.defaultOptions || request.options
        ? { ...this.defaultOptions, ...request.options }
        : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    // ONE deadline per call (ADR 0011 D1): a JSON-mode retry only gets what
    // is left of the original budget.
    const deadline = Date.now() + this.timeoutMs;
    const send = (options: CompletionOptions | undefined): Promise<unknown> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return Promise.reject(
          new HttpProviderError(
            `${PROVIDER_NAME} request timed out`,
            'timeout',
          ),
        );
      }
      return postJson({
        url: `${baseUrl}/chat/completions`,
        headers,
        body: buildRequestBody(this.model, request.messages, options),
        fetchImpl: this.fetchImpl ?? globalThis.fetch,
        providerName: PROVIDER_NAME,
        timeoutMs: remaining,
        maxBodyBytes: MAX_BODY_BYTES,
      });
    };
    const withoutJsonMode = (
      options: CompletionOptions | undefined,
    ): CompletionOptions | undefined => {
      if (options?.responseFormat !== 'json') return options;
      return { ...options, responseFormat: 'text' };
    };

    const wantsJson = merged?.responseFormat === 'json';
    let data: unknown;
    try {
      try {
        data = await send(
          this.jsonModeUnsupported ? withoutJsonMode(merged) : merged,
        );
      } catch (error) {
        // One retry without JSON mode when the server rejects it (latched).
        if (!wantsJson || this.jsonModeUnsupported) throw error;
        if (!rejectsResponseFormat(error)) throw error;
        this.jsonModeUnsupported = true;
        data = await send(withoutJsonMode(merged));
      }
    } catch (error) {
      throw classify(error, origin, this.apiKey, this.timeoutMs);
    }
    return mapResponse(data);
  }
}
