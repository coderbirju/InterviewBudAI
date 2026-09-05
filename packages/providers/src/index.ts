/**
 * @ibai/providers — the LLM provider boundary.
 *
 * Will expose the pluggable LLM provider *interface* and concrete adapters
 * (OpenAI, Anthropic, Ollama, community). The engine builds prompts; a provider
 * only transports them to the user-configured model. No model is ever hardcoded
 * or required (see ADR 0001 D2).
 *
 * Scaffold placeholder; the interface contract lands in a subsequent ADR-backed
 * PR.
 */

export const PACKAGE_NAME = '@ibai/providers';
