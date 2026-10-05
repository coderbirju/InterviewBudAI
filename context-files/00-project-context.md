# 00 — Project Context (Single Source of Truth)

> Every agent MUST read this file first, before doing any work.
> If anything you are asked to do contradicts this file, STOP and flag it.

## What InterviewBudAI is

InterviewBudAI (pronounced "Interview Buddy") is an **open-source, local-first,
AI-assisted interview-prep coach** for software engineers preparing for
**Data Structures & Algorithms (DSA)** and **System Design** interviews.

It does **not** replace hard work. It provides personalized guidance: it tracks
where a candidate stands, surfaces their strengths and weaknesses, and directs
their limited prep time so they are not overwhelmed by the sea of resources.

## The core problem

Engineers changing jobs have limited time and no personalized signal on where to
focus. Generic resources overwhelm; they don't tell you *your* weak spots. This
project turns a candidate's own practice history into a growing, personal
competency map that any AI coaching session can read and build on.

## The founding insight (non-negotiable)

**The agent is stateless. The user's knowledge is persistent and portable.**

- A coaching session holds no long-term memory. When it ends, it forgets.
- All durable state lives in a **storage layer** (default: the user's own
  git-backed local files).
- Any session, started from any front-end, reads the full history and writes
  back to it. The user's competency grows with them across their whole journey.

## Product principles (guardrails for every decision)

1. **Local-first.** Runs on the user's machine. No mandatory cloud, no central
   server, no telemetry. Cloud is an *optional future*, never a requirement.
   No mandatory network calls except the configured LLM; the optional,
   user-triggered LeetCode statement fetch (ADR 0015) can be turned off.
2. **Bring-your-own-LLM.** The project is **not opinionated** about models. Any
   LLM works on day one — OpenAI, Anthropic, local Ollama, etc. — behind a
   pluggable interface. The project never requires a specific model, and
   code never names one; the optional Docker Compose setup ships an
   opinionated, swappable **default** local model that users can change or
   drop (ADR 0011).
3. **Not opinionated about content.** The project ships a **catalog of problems
   as links + difficulty rankings only**. It ships NO intuitions, NO answers, NO
   solutions. All intuition, notes, and direction are authored and owned by the
   user.
4. **Personal and private.** A user's intuitions, tracking, and competency data
   are theirs, stored in their private repo. Never bundled, never uploaded.
5. **Extensible.** Storage and LLM providers are interfaces. The community can
   add adapters (Notion, Postgres, SQLite, other models) without touching the
   core or anyone's private data.
6. **AI-first, autonomously built.** This codebase is built by a team of AI
   builder agents (see `team/`). Automation and CI enforce quality — not manual
   human review of every line.

## The two data layers (clean ownership separation)

| Layer | Ships with project? | Contains | Access |
|---|---|---|---|
| **Curriculum** (generic) | Yes | Problem catalog (links + difficulty), strategy scaffolding templates | Read-only to users; improved via community PRs |
| **Progress** (personal) | No | User's intuitions, custom questions/links, tracking, competency map, weakness register | Owned by user, in their private git repo |

The curriculum layer must **never** contain personal data or opinionated
answers. The progress layer must **never** be bundled into the shipped project.

## The engine's three jobs

Derived from a working hand-run prototype (see "Prototype origins" below):

1. **Assess** — read the user's progress, surface where they stand.
2. **Plan** — pick the next session's focus from competency gaps.
3. **Coach** — run a persona-driven session, then write back a structured
   progress update.

**The growth loop:** session ends → structured summary written to storage →
competency map updates → next session starts by reading that map to choose focus.

## Prototype origins (this is proven, not theoretical)

The founder ran this system by hand in Notion. The proven pieces:
- **Pattern triggers** — "if you see X, reach for Y" signal→pattern reference.
- **Solving process** — a fallback ladder for when a problem isn't a direct
  pattern match; invariants; the twist drill.
- **Tracking log** — per-problem result / time / note, plus "recurring misses"
  and "highest-leverage fix" — a human-written competency map.
- **Session prompts** — persona + rules + warm-up + problem set + twist round.
- **Struggle topics** — a running weakness register.

The product **generalizes this** so any engineer can run it, automating with
LLMs the parts the founder did by hand (writing the tracking block, choosing the
next focus, generating twist variants).

## Scope discipline: v1 core vs. later feature rings

**v1 core (shippable):**
- Curated higher-order problem catalog (links + difficulty) + user-added
  problems/links/questions.
- User authors/narrates intuition; system persists it.
- Cross-session progress tracking + competency map that never resets.
- Local web UI (primary); CLI frozen per ADR 0008.
- Pluggable LLM providers + pluggable storage.

**Later feature rings (explicitly NOT v1):**
- Voice narration (e.g., Whisper-flow style) so users can speak intuition.
- Suggested/linked external LLM tools.
- Progress graphs and gamification.
- Optional cloud deployment.

If a task pulls a later-ring feature into v1 without an explicit decision
recorded in `decisions/`, an agent MUST decline and flag it.

## Related documents

- `01-architecture.md` — the locked technical blueprint.
- `team-charter.md` — rules every agent follows.
- `team/*.md` — individual agent mandates.
- `decisions/*.md` — Architecture Decision Records (ADRs).
- `progress/status.md` — the live "what's done / in progress / next" dashboard.
