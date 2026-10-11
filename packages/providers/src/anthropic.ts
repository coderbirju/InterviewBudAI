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
 *  - Behaviour and configuration only: no model is named or special-cased
 *    (charter §6.3). Models that think before answering are handled by the
 *    output-token floor and the optional `effort` setting, for every model.
 */

import type {
  CompletionOptions,
  CompletionRequest,
  CompletionResponse,
  CompletionUsage,
  LlmProvider,
  PromptMessage,
} from './index.js';
import {
  HttpProviderError,
  ProviderReplyError,
  postJson,
} from './http-provider.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for the AnthropicProvider. */
export interface AnthropicProviderConfig {
  /** REQUIRED user-supplied key. Never hardcoded/committed. */
  readonly apiKey: string;
  /** REQUIRED user-supplied model (`<model-name>`). No hardcoded-only default. */
  readonly model: string;
  /** Endpoint. Default 'https://api.anthropic.com/v1/messages'. */
  readonly endpoint?: string;
  /** anthropic-version header. Default '2023-06-01'. */
  readonly anthropicVersion?: string;
  /** Optional default generation options merged UNDER per-request options (request wins). */
  readonly defaultOptions?: CompletionOptions;
  /** Optional fetch injection for testing; defaults to global fetch (resolved lazily in complete()). */
  readonly fetchImpl?: typeof fetch;
  /**
   * OPTIONAL effort level, sent as `output_config: { effort }` only when set
   * (user configuration, `IBAI_ANTHROPIC_EFFORT`). Unset sends nothing, so
   * models that reject the parameter keep working.
   */
  readonly effort?: AnthropicEffort;
}

/** The effort levels the Messages API accepts in `output_config.effort`. */
export const ANTHROPIC_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/** One of {@link ANTHROPIC_EFFORT_LEVELS}. */
export type AnthropicEffort = (typeof ANTHROPIC_EFFORT_LEVELS)[number];

/** True when `value` is one of {@link ANTHROPIC_EFFORT_LEVELS}. */
export function isAnthropicEffort(value: unknown): value is AnthropicEffort {
  return (
    typeof value === 'string' &&
    (ANTHROPIC_EFFORT_LEVELS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Lowest `max_tokens` this adapter ever sends:
 * `max_tokens = max(requested ?? default, ANTHROPIC_MIN_MAX_TOKENS)`.
 *
 * Why: some models served by the Messages API always think before they
 * answer, and the thinking tokens count toward `max_tokens`. With the app's
 * small budgets (Settings "Test connection" asks for 1 token; the quiz and
 * the coach ask for a few hundred) the thinking can use the whole budget, so
 * the reply has no text at all. The app's small budgets exist to keep
 * replies short on small local models; that stays true for the other
 * adapters. Here the prompts' own length rules keep the replies short.
 *
 * Cost: the call is non-streaming and the model stops when it is done, so
 * billing follows the tokens actually used, not this ceiling. 16000 leaves
 * room for thinking plus a short reply while staying modest for a
 * non-streaming call. A larger request (e.g. 20000) is sent unchanged.
 */
export const ANTHROPIC_MIN_MAX_TOKENS = 16_000;

/** Fixed text: the reply hit `max_tokens` with no text (all thinking). */
export const ANTHROPIC_BUDGET_EXHAUSTED_MESSAGE =
  'The model used its whole token budget thinking. Set IBAI_ANTHROPIC_EFFORT=low.';

/** Fixed text: a 400 that says the model does not take `effort`. */
export const ANTHROPIC_EFFORT_REJECTED_MESSAGE =
  'This model does not accept this IBAI_ANTHROPIC_EFFORT value. Try `low`, or unset it.';

/** Fixed text for a refusal (the model's own text is never shown). */
const REFUSAL_MESSAGE = 'The model declined to answer this request';

/** A refusal category is shown only if it is a plain identifier. */
const SAFE_CATEGORY = /^[a-z_]{1,40}$/;

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
  /** Set on `stop_reason: 'refusal'` (UNTRUSTED). */
  stop_details?: { category?: unknown; explanation?: unknown };
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
  output_config?: { effort: AnthropicEffort };
}

/** Build the Anthropic Messages API request body. */
function buildRequestBody(
  model: string,
  messages: readonly PromptMessage[],
  options?: CompletionOptions,
  effort?: AnthropicEffort,
): string {
  // Extract system messages and join with '\n\n'
  const systemMessages = messages.filter((m) => m.role === 'system');
  const systemContent = systemMessages.map((m) => m.content).join('\n\n');

  // Non-system messages (user/assistant only)
  const nonSystemMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  // Requested (or default), never below the floor (see ANTHROPIC_MIN_MAX_TOKENS).
  const maxTokens = Math.max(
    options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    ANTHROPIC_MIN_MAX_TOKENS,
  );

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
  // Only when configured: models that do not take `effort` reject it.
  if (effort !== undefined) {
    body.output_config = { effort };
  }

  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// Response Mapping
// ---------------------------------------------------------------------------

/** Map validated Anthropic response to CompletionResponse. */
function mapResponse(data: AnthropicResponse): CompletionResponse {
  if (data.stop_reason === 'refusal') {
    const raw = data.stop_details?.category;
    const category =
      typeof raw === 'string' && SAFE_CATEGORY.test(raw) ? raw : undefined;
    throw new ProviderReplyError(
      category !== undefined
        ? `${REFUSAL_MESSAGE} (refusal category: ${category}).`
        : `${REFUSAL_MESSAGE}.`,
      'refusal',
      category !== undefined ? { category } : {},
    );
  }

  // Concatenate ONLY text blocks: `thinking` / `redacted_thinking` (and any
  // other block type) are never part of the reply.
  const content = data.content
    .filter(
      (block): block is AnthropicContentBlock & { text: string } =>
        block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('');

  if (data.stop_reason === 'max_tokens' && content.trim() === '') {
    throw new ProviderReplyError(
      ANTHROPIC_BUDGET_EXHAUSTED_MESSAGE,
      'budget_exhausted',
    );
  }

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
  private readonly effort?: AnthropicEffort;

  constructor(config: AnthropicProviderConfig) {
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.anthropicVersion =
      config.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    this.defaultOptions = config.defaultOptions;
    // Store fetchImpl for lazy resolution in complete()
    this.fetchImpl = config.fetchImpl;
    this.effort = config.effort;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const mergedOptions = mergeOptions(this.defaultOptions, request.options);
    const body = buildRequestBody(
      this.model,
      request.messages,
      mergedOptions,
      this.effort,
    );

    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'anthropic-version': this.anthropicVersion,
      'content-type': 'application/json',
    };

    // Resolve fetch lazily (use injected or global)
    const fetchFn = this.fetchImpl ?? globalThis.fetch;

    let data: unknown;
    try {
      data = await postJson({
        url: this.endpoint,
        headers,
        body,
        fetchImpl: fetchFn,
        providerName: 'Anthropic',
      });
    } catch (error) {
      // A 400 about `effort` while we sent one: the model does not take it.
      // Say so plainly; never retry without it silently.
      if (
        this.effort !== undefined &&
        error instanceof HttpProviderError &&
        error.kind === 'http' &&
        error.status === 400 &&
        /effort/i.test(error.bodySnippet ?? '')
      ) {
        throw new ProviderReplyError(
          ANTHROPIC_EFFORT_REJECTED_MESSAGE,
          'option_rejected',
        );
      }
      throw error;
    }

    if (!isValidAnthropicResponse(data)) {
      throw new Error('Anthropic response has invalid content array shape');
    }

    return mapResponse(data);
  }
}
