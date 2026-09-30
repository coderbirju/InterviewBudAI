/**
 * Ollama LLM Provider Adapter — local-first, bring-your-own-LLM.
 *
 * Sends fully-built prompts to a user-configured local Ollama endpoint over
 * plain HTTP (Node built-in fetch, NO vendor SDK) and returns a CompletionResponse.
 *
 * Design rules:
 *  - Model names and endpoints are user-supplied configuration — never baked in.
 *  - No API key required (local-first).
 *  - Lazy network: importing this module performs no I/O; only complete() touches the network.
 *  - Treat all HTTP responses as untrusted; validate before mapping.
 */

import type {
  CompletionOptions,
  CompletionRequest,
  CompletionResponse,
  CompletionUsage,
  LlmProvider,
  PromptMessage,
} from './index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for the OllamaProvider. */
export interface OllamaProviderConfig {
  /** Base URL of the Ollama server. Default http://127.0.0.1:11434. Overridable. */
  readonly endpoint?: string;
  /** REQUIRED model name (user-supplied, e.g. 'llama3'). Never hardcoded default. */
  readonly model: string;
  /** Optional default generation options merged under per-request options. */
  readonly defaultOptions?: CompletionOptions;
  /** Optional fetch injection for testing; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Ollama API Types (internal, for response validation)
// ---------------------------------------------------------------------------

/** Expected shape of Ollama /api/chat response message. */
interface OllamaMessage {
  role: string;
  content: string;
}

/** Expected shape of Ollama /api/chat non-streaming response. */
interface OllamaResponse {
  model?: string;
  created_at?: string;
  message: OllamaMessage;
  done?: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

/** Type guard to validate OllamaResponse shape. */
function isValidOllamaResponse(data: unknown): data is OllamaResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.message !== 'object' || obj.message === null) {
    return false;
  }
  const message = obj.message as Record<string, unknown>;
  return typeof message.content === 'string';
}

// ---------------------------------------------------------------------------
// Request Body Builder
// ---------------------------------------------------------------------------

/** Ollama options object for the request body. */
interface OllamaRequestOptions {
  temperature?: number;
  num_predict?: number;
  top_p?: number;
  stop?: string[];
}

/** Build the Ollama /api/chat request body. */
function buildRequestBody(
  model: string,
  messages: readonly PromptMessage[],
  options?: CompletionOptions,
): string {
  const body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    stream: boolean;
    format?: 'json';
    options?: OllamaRequestOptions;
  } = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  };

  // Optional JSON-mode hint (additive): Ollama's native `format: 'json'`.
  if (options?.responseFormat === 'json') {
    body.format = 'json';
  }

  // Build options object, omitting undefined values
  if (options) {
    const ollamaOptions: OllamaRequestOptions = {};
    if (options.temperature !== undefined) {
      ollamaOptions.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      ollamaOptions.num_predict = options.maxTokens;
    }
    if (options.topP !== undefined) {
      ollamaOptions.top_p = options.topP;
    }
    if (options.stop !== undefined) {
      ollamaOptions.stop = [...options.stop];
    }
    // Only add options if non-empty
    if (Object.keys(ollamaOptions).length > 0) {
      body.options = ollamaOptions;
    }
  }

  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// Response Mapping
// ---------------------------------------------------------------------------

/** Map validated Ollama response to CompletionResponse. */
function mapResponse(data: OllamaResponse): CompletionResponse {
  const content = data.message.content;

  // Build usage if counts are present
  let usage: CompletionUsage | undefined;
  const promptTokens = data.prompt_eval_count;
  const completionTokens = data.eval_count;

  if (promptTokens !== undefined || completionTokens !== undefined) {
    usage = {
      ...(promptTokens !== undefined && { promptTokens }),
      ...(completionTokens !== undefined && { completionTokens }),
      ...(promptTokens !== undefined || completionTokens !== undefined
        ? { totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0) }
        : {}),
    };
  }

  // Build metadata with backend-specific fields
  const metadata: Record<string, unknown> = {};
  if (data.model !== undefined) metadata.model = data.model;
  if (data.done !== undefined) metadata.done = data.done;
  if (data.done_reason !== undefined) metadata.done_reason = data.done_reason;
  if (data.created_at !== undefined) metadata.created_at = data.created_at;
  if (data.total_duration !== undefined)
    metadata.total_duration = data.total_duration;
  if (data.load_duration !== undefined)
    metadata.load_duration = data.load_duration;
  if (data.prompt_eval_duration !== undefined)
    metadata.prompt_eval_duration = data.prompt_eval_duration;
  if (data.eval_duration !== undefined)
    metadata.eval_duration = data.eval_duration;

  return {
    content,
    ...(usage && { usage }),
    ...(Object.keys(metadata).length > 0 && { metadata }),
  };
}

// ---------------------------------------------------------------------------
// Merge Options
// ---------------------------------------------------------------------------

/** Merge defaultOptions with per-request options (request wins). */
function mergeOptions(
  defaults?: CompletionOptions,
  request?: CompletionOptions,
): CompletionOptions | undefined {
  if (!defaults && !request) {
    return undefined;
  }
  if (!defaults) {
    return request;
  }
  if (!request) {
    return defaults;
  }
  return {
    ...defaults,
    ...request,
  };
}

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

/** Default Ollama endpoint. */
const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';

/**
 * Ollama LLM Provider — local-first adapter for the Ollama server.
 *
 * Implements the LlmProvider interface, sending prompts to a local Ollama
 * instance and returning completions. No API key required.
 */
export class OllamaProvider implements LlmProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly defaultOptions?: CompletionOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OllamaProviderConfig) {
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.model = config.model;
    this.defaultOptions = config.defaultOptions;
    // Use injected fetch or fallback to global fetch lazily
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.endpoint}/api/chat`;
    const mergedOptions = mergeOptions(this.defaultOptions, request.options);
    const body = buildRequestBody(this.model, request.messages, mergedOptions);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      });
    } catch (error) {
      // Network error (fetch rejected)
      const message =
        error instanceof Error ? error.message : 'Unknown network error';
      throw new Error(`Ollama request failed to ${url}: ${message}`);
    }

    // Handle non-2xx responses
    if (!response.ok) {
      let bodySnippet = '';
      try {
        const text = await response.text();
        bodySnippet = text.slice(0, 200);
      } catch {
        // Ignore errors reading body
      }
      throw new Error(
        `Ollama returned HTTP ${response.status}: ${bodySnippet}`,
      );
    }

    // Parse JSON response
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('Ollama returned invalid JSON response');
    }

    // Validate response shape
    if (!isValidOllamaResponse(data)) {
      throw new Error(
        'Ollama response missing required field: message.content must be a string',
      );
    }

    return mapResponse(data);
  }
}
