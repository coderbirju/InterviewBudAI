/**
 * `@ibai/providers` — the LLM provider boundary.
 *
 * This module defines the **pluggable LLM Provider contract** for
 * InterviewBudAI. It is TYPES/CONTRACTS ONLY: no concrete adapter, no vendor
 * SDK, no network I/O, and NO hardcoded model or endpoint.
 *
 * Design rules (ADR 0001, ADR 0002):
 *  - The engine (`@ibai/core`) BUILDS prompts; a provider only TRANSPORTS them
 *    to whatever model the user configured and returns the completion.
 *  - Model names, endpoints, and credentials are user-supplied configuration
 *    handed to a concrete adapter — never baked into this contract, never
 *    committed.
 *  - This package NEVER depends on `@ibai/core` (no dependency cycles).
 */

// ---------------------------------------------------------------------------
// Message Types
// ---------------------------------------------------------------------------

/** Role of a message in a chat-style completion request. */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * A single provider-agnostic message. Kept minimal so any chat-style backend
 * (OpenAI, Anthropic, Ollama, community adapters) can map it.
 */
export interface PromptMessage {
  readonly role: MessageRole;
  readonly content: string;
}

// ---------------------------------------------------------------------------
// Request Types
// ---------------------------------------------------------------------------

/**
 * Generation options the engine may request. All optional so adapters can fall
 * back to their own/user-configured defaults. Provider-agnostic; no vendor
 * field names.
 */
export interface CompletionOptions {
  /** Sampling temperature, if the backend supports it. */
  readonly temperature?: number;
  /** Upper bound on tokens to generate, if supported. */
  readonly maxTokens?: number;
  /** Nucleus-sampling cutoff, if supported. */
  readonly topP?: number;
  /** Sequences that, if produced, stop generation. */
  readonly stop?: readonly string[];
}

/**
 * A fully-built request the engine hands to a provider. The engine owns prompt
 * construction; the provider owns transport only.
 */
export interface CompletionRequest {
  /** Ordered messages forming the prompt. */
  readonly messages: readonly PromptMessage[];
  /** Optional generation options. */
  readonly options?: CompletionOptions;
}

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

/** Optional token-usage accounting, when the backend reports it. */
export interface CompletionUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

/** A completion returned by a provider. */
export interface CompletionResponse {
  /** The generated text. */
  readonly content: string;
  /** Token usage, if the backend reported it. */
  readonly usage?: CompletionUsage;
  /**
   * Opaque, backend-specific metadata (e.g. finish reason). Kept untyped-ish so
   * the contract stays vendor-neutral; the engine must not depend on its shape.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// LLM Provider Contract
// ---------------------------------------------------------------------------

/**
 * The single contract an LLM backend implements.
 *
 * One responsibility: transport a fully-built prompt to the user-configured
 * model and return the completion. Implementations receive their model,
 * endpoint, and credentials via their own constructor/config — never through
 * this interface.
 */
export interface LlmProvider {
  /**
   * Send a prompt and resolve with the model's completion. Implementations
   * should reject the promise on transport/model errors rather than returning
   * a partial {@link CompletionResponse}.
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

// ---------------------------------------------------------------------------
// Concrete Adapters
// ---------------------------------------------------------------------------

export { OllamaProvider } from './ollama.js';
export type { OllamaProviderConfig } from './ollama.js';

export { EchoDemoProvider } from './demo-provider.js';
export type { EchoDemoProviderConfig } from './demo-provider.js';
export { AnthropicProvider } from './anthropic.js';
export type { AnthropicProviderConfig } from './anthropic.js';
