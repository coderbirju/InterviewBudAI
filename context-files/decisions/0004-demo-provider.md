# ADR 0004 — Built-in Deterministic Demo Provider

- **Status:** Superseded by ADR 0005 (D6) — `EchoDemoProvider` removed in PR #33
- **Date:** 2026-09-13
- **Deciders:** Founder + Architect
- **Supersedes:** —

## Context

InterviewBudAI needs a zero-config happy-path demo that works immediately after
cloning the repository — no external LLM install, no API keys, no configuration.
This lowers the bar to first value and lets potential users experience the
interview flow before committing to setting up Ollama or another provider.

However, the product's bring-your-own-LLM principle (§6.3) means no provider
should be required or privileged. The engine must remain provider-agnostic;
front-ends inject whichever adapter the user configured. Additionally, the
local-first constraint (§6.4) requires offline operation.

Product rule §6.2 states the engine must never author interview answers or
solutions — it elicits the user's own intuition. Any demo provider must respect
this guardrail. ADR 0002 established the `LlmProvider` contract that all
providers implement.

## Decisions

### D1 — Ship EchoDemoProvider implementing LlmProvider

We ship a built-in `EchoDemoProvider` class in `packages/providers` that
implements the `LlmProvider` contract exactly. It is deterministic (same request
→ same response), fully offline (no network, no filesystem, no randomness, no
Date/time, no env reads), and has zero external dependencies.

The provider mechanically reflects the user's last turn into an interviewer-
style follow-up: a neutral acknowledgement, a probing question that quotes a
snippet of their message, and a nudge to reason aloud. This simulates the
interviewer's coaching role without generating substantive content.

### D2 — Guardrails preserving bring-your-own-LLM (§6.3)

EchoDemoProvider is **OPT-IN** — a convenience for zero-config demos, not a
required or privileged provider. Real providers (Ollama, OpenAI, community
adapters) remain first-class and are the recommended path for actual interview
prep.

The engine and `@ibai/core` still never hardcode or instantiate a provider;
front-ends are composition roots that choose which adapter to inject. The
`packages/providers` package remains a leaf (no dependency on `@ibai/core`).

### D3 — Product-rule guardrail (§6.2): no shipped answers

Demo output is generic scripted interviewer-style prompts and acknowledgements.
It asks questions, probes the user's reasoning, and offers neutral wrap-ups —
consistent with the principle that the engine elicits the user's own intuition.

The provider **MUST NOT** emit real interview answers or solutions. This is
enforced by a guard unit test that asserts the output does not contain forbidden
phrases like "the answer is", "the solution is", "here is the code", etc.

**Rejected alternatives:**

**(a) Require Ollama (or any real LLM) for any demo** — Rejected: breaks
zero-config trial. A fresh clone cannot run the flow without installing and
configuring a model first, raising the bar to first value significantly.

**(b) A random / LLM-ish fake generator** — Rejected: non-deterministic outputs
are untestable and risk drifting into fabricating answers or solutions over
time. A mechanical reflective echo is honest about what it is, fully testable,
and safe from guardrail violations.

## Consequences

- **Positive:** Zero-config demo is unblocked. New users can clone and
  immediately run the interview flow. The provider is deterministic and fully
  testable. Offline/local-first constraint is satisfied. Bring-your-own-LLM
  principle remains intact.

- **Tradeoff:** Demo output is intentionally shallow and scripted — it does not
  provide real coaching value. This is clearly labeled as demo-only; users are
  guided toward real providers for actual interview prep.

- Any change that makes the demo provider a default, privileged, or required
  provider in the engine requires a new ADR.
