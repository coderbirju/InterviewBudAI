/**
 * `EchoDemoProvider` — the OPT-IN deterministic DEMO adapter.
 *
 * This provider enables a ZERO-CONFIG happy-path demo of the interview flow
 * with NO external LLM install. It is deterministic, offline, and has no
 * dependencies.
 *
 * Design rules (ADR 0004):
 *  - OPT-IN / default-for-demo ONLY — NOT a required or privileged provider.
 *  - Real providers (Ollama, OpenAI, etc.) remain first-class.
 *  - The engine still never hardcodes a provider; front-ends inject the adapter.
 *  - Product rule §6.2: MUST NOT emit real interview ANSWERS or SOLUTIONS.
 *    Output is generic INTERVIEWER-style prompting: reflects the user's last
 *    turn into a probing follow-up question + neutral coaching acknowledgement.
 *    It elicits the user's own reasoning; it never solves the problem.
 *  - Deterministic: NO network, NO fs, NO randomness, NO Date/time, NO env reads.
 *    Same request → same response, always.
 *
 * This package NEVER depends on `@ibai/core` (no dependency cycles).
 */

import type {
  CompletionRequest,
  CompletionResponse,
  LlmProvider,
  PromptMessage,
} from './index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Optional configuration for the EchoDemoProvider. All fields are optional with sensible defaults. */
export interface EchoDemoProviderConfig {
  /** Optional label/persona prefix for responses. */
  readonly label?: string;
  /** Maximum characters to reflect from user's last message (default: 160). */
  readonly maxReflectChars?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_REFLECT_CHARS = 160;

const NEUTRAL_OPENING_PROMPT =
  "Let's begin. What problem would you like to work through today, and what's your first instinct for approaching it?";

const RESTATE_PROMPT =
  "I didn't quite catch that. Could you restate your thoughts on the problem you're working through?";

// ---------------------------------------------------------------------------
// EchoDemoProvider
// ---------------------------------------------------------------------------

/** Deterministic demo provider that reflects user input as interviewer-style prompts. */
export class EchoDemoProvider implements LlmProvider {
  private readonly label: string;
  private readonly maxReflectChars: number;

  constructor(config?: EchoDemoProviderConfig) {
    this.label = config?.label ?? '';
    this.maxReflectChars = config?.maxReflectChars ?? DEFAULT_MAX_REFLECT_CHARS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const content = this.buildResponse(request.messages);
    return {
      content,
      metadata: { provider: 'echo-demo', deterministic: true },
    };
  }

  private buildResponse(messages: readonly PromptMessage[]): string {
    // Find the LAST user message (search from the end)
    const lastUserMessage = this.findLastUserMessage(messages);

    // Edge case: no messages or no user message
    if (!lastUserMessage) {
      return this.applyLabel(NEUTRAL_OPENING_PROMPT);
    }

    // Edge case: empty or whitespace-only content
    const trimmedContent = lastUserMessage.content.trim();
    if (!trimmedContent) {
      return this.applyLabel(RESTATE_PROMPT);
    }

    // Build interviewer-style response
    const snippet = this.extractSnippet(trimmedContent);
    const response = this.buildInterviewerResponse(snippet);
    return this.applyLabel(response);
  }

  private findLastUserMessage(
    messages: readonly PromptMessage[],
  ): PromptMessage | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'user') {
        return messages[i];
      }
    }
    return undefined;
  }

  private extractSnippet(content: string): string {
    // Collapse internal whitespace to single spaces
    const normalized = content.replace(/\s+/g, ' ').trim();

    // Truncate to maxReflectChars with ellipsis if needed
    if (normalized.length <= this.maxReflectChars) {
      return normalized;
    }
    return normalized.slice(0, this.maxReflectChars) + '...';
  }

  private buildInterviewerResponse(snippet: string): string {
    return (
      `Thanks for sharing that. You mentioned: "${snippet}". ` +
      'Can you walk me through your reasoning there — ' +
      'what approach are you considering, and what tradeoffs do you see? ' +
      'Take your time and think out loud.'
    );
  }

  private applyLabel(content: string): string {
    if (!this.label) {
      return content;
    }
    return `${this.label}: ${content}`;
  }
}
