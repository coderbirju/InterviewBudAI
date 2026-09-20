/**
 * Anthropic (Claude) LLM Provider Adapter — bring-your-own-key.
 *
 * Sends fully-built prompts to the user-configured Anthropic endpoint over
 * plain HTTP (Node built-in fetch, NO vendor SDK) and returns a CompletionResponse.
 *
 * Design rules:
 *  - API key and model are user-supplied configuration — never baked in.
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
import { postJson } from './http-provider.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for the AnthropicProvider. */
export interface AnthropicProviderConfig {
  /** REQUIRED user-supplied key. Never hardcoded/committed. */
  readonly apiKey: string;
  /** REQUIRED user-supplied model (e.g. 'claude-3-5-sonnet-20241022'). No hardcoded-only default. */
  readonly model: string;
  /** Endpoint. Default 'https://api.anthropic.com/v1/messages'. */
  readonly endpoint?: string;
  /** anthropic-version header. Default '2023-06-01'. */
  readonly anthropicVersion?: string;
  /** Optional default generation options merged UNDER per-request options (request wins). */
  readonly defaultOptions?: CompletionOptions;
  /** Optional fetch injection for testing; defaults to global fetch (resolved lazily in complete()). */
  readonly fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

// ---------------------------------------------------------------------------
// Anthropic API Types (internal, for response validation)
// ---------------------------------------------------------------------------

/** A content block in the Anthropic response. */
interface AnthropicContentBlock {
  type: string;
  text?: string;
}

/** Usage information from Anthropic response. */
interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/** Expected shape of Anthropic Messages API response. */
interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason?: string;
  model?: string;
  usage?: AnthropicUsage;
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

/** Type guard to validate AnthropicResponse shape. */
function isValidAnthropicResponse(data: unknown): data is AnthropicResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;

  // content must be an array
  if (!Array.isArray(obj.content)) {
    return false;
  }

  // Each content block that is a text block must have type === 'text' and text is a string
  for (const block of obj.content) {
    if (typeof block !== 'object' || block === null) {
      return false;
    }
    const b = block as Record<string, unknown>;
    // If it's a text block, validate text field
    if (b.type === 'text' && typeof b.text !== 'string') {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Request Body Builder
// ---------------------------------------------------------------------------

/** Anthropic request body shape. */
interface AnthropicRequestBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
}

/** Build the Anthropic Messages API request body. */
function buildRequestBody(
  model: string,
  messages: readonly PromptMessage[],
  options?: CompletionOptions,
): string {
  // Extract system messages and join with '\n\n'
  const systemMessages = messages.filter((m) => m.role === 'system');
  const systemContent = systemMessages.map((m) => m.content).join('\n\n');

  // Non-system messages (user/assistant only)
  const nonSystemMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  // Determine max_tokens: use provided or default
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;

  const body: AnthropicRequestBody = {
    model,
    messages: nonSystemMessages,
    max_tokens: maxTokens,
  };

  // Only include system if non-empty
  if (systemContent) {
    body.system = systemContent;
  }

  // Add optional fields if present
  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }
  if (options?.topP !== undefined) {
    body.top_p = options.topP;
  }
  if (options?.stop !== undefined) {
    body.stop_sequences = [...options.stop];
  }

  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// Response Mapping
// ---------------------------------------------------------------------------

/** Map validated Anthropic response to CompletionResponse. */
function mapResponse(data: AnthropicResponse): CompletionResponse {
  // Concatenate text from all text blocks
  const content = data.content
    .filter(
      (block): block is AnthropicContentBlock & { text: string } =>
        block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('');

  // Build usage if present
  let usage: CompletionUsage | undefined;
  const inputTokens = data.usage?.input_tokens;
  const outputTokens = data.usage?.output_tokens;

  if (inputTokens !== undefined || outputTokens !== undefined) {
    usage = {
      ...(inputTokens !== undefined && { promptTokens: inputTokens }),
      ...(outputTokens !== undefined && { completionTokens: outputTokens }),
      ...(inputTokens !== undefined || outputTokens !== undefined
        ? { totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0) }
        : {}),
    };
  }

  // Build metadata with backend-specific fields
  const metadata: Record<string, unknown> = {};
  if (data.stop_reason !== undefined) metadata.stopReason = data.stop_reason;
  if (data.model !== undefined) metadata.model = data.model;

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
// AnthropicProvider
// ---------------------------------------------------------------------------

/**
 * Anthropic (Claude) LLM Provider — bring-your-own-key adapter.
 *
 * Implements the LlmProvider interface, sending prompts to the Anthropic
 * Messages API and returning completions. Requires user-supplied API key.
 */
export class AnthropicProvider implements LlmProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly anthropicVersion: string;
  private readonly defaultOptions?: CompletionOptions;
  private readonly fetchImpl?: typeof fetch;

  constructor(config: AnthropicProviderConfig) {
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.anthropicVersion =
      config.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    this.defaultOptions = config.defaultOptions;
    // Store fetchImpl for lazy resolution in complete()
    this.fetchImpl = config.fetchImpl;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const mergedOptions = mergeOptions(this.defaultOptions, request.options);
    const body = buildRequestBody(this.model, request.messages, mergedOptions);

    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'anthropic-version': this.anthropicVersion,
      'content-type': 'application/json',
    };

    // Resolve fetch lazily (use injected or global)
    const fetchFn = this.fetchImpl ?? globalThis.fetch;

    const data = await postJson({
      url: this.endpoint,
      headers,
      body,
      fetchImpl: fetchFn,
      providerName: 'Anthropic',
    });

    if (!isValidAnthropicResponse(data)) {
      throw new Error('Anthropic response has invalid content array shape');
    }

    return mapResponse(data);
  }
}
