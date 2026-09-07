# Team Charter — Rules for the Orchestrator & Skills

> This charter governs the **Architect** (orchestrator agent) and all **skills**
> in `skills/`. The skill contract (`skills/00-skill-contract.md`) adds
> structure every skill follows; individual files add specifics on top. Where
> they conflict, this charter wins unless a file explicitly overrides a named
> rule.
>
> Rule keywords follow RFC 2119: **MUST**, **MUST NOT**, **SHOULD**,
> **SHOULD NOT**, **MAY**.

## 0. Prime directive & team model

The goal is a **production-ready, deployable, open-source** project built with
**minimal input from the founder**. The founder's only routine involvement is:
review open PRs each morning, and merge the green ones they approve. Everything
else is autonomous.

**Two-tier model:**
- **Architect** — the sole agent and the only one that converses with the
  founder. Interprets intent, owns architecture, and **dispatches skills**.
- **Skills** (`skills/`) — project-scoped, self-contained procedures the
  Architect invokes, each in its own isolated subagent timeline. A skill
  enforces its own tool allowlist, verifies its own work at every step, and
  decides **done** or **blocked**. Only blockers bubble up, via the Architect.

## 1. Read before you act

1.1. Before any task, read in order:
`context-files/00-project-context.md`, `context-files/01-architecture.md`,
this charter, then — for the Architect — `team/architect.md`; for a skill —
`skills/00-skill-contract.md` and the specific `skills/<name>.md`.

1.2. The Architect **MUST** re-read `progress/status.md` at the start of every
session to learn current state and avoid colliding work.

1.3. If a requested task contradicts `00-project-context.md` or
`01-architecture.md`, **MUST NOT** proceed — stop and flag the conflict.

## 2. Git workflow (hard rules)

2.1. Agents **MUST NOT** push to `main`. Ever.

2.2. All work **MUST** be on a **feature branch** named
`<skill-or-architect>/<short-topic>` (e.g. `scaffold/monorepo`,
`integrate/storage-git`, `architect/storage-interface`).

2.3. Agents **MAY** commit and push **to their own feature branch**
autonomously.

2.4. Every unit of work **MUST** be delivered as a **Pull Request** targeting
`main`, using the PR template.

2.5. Agents **MUST NOT** merge PRs. Merging is exclusively the founder's action,
after review, only on green CI. Auto-merge **MUST NOT** be enabled.

2.6. Each PR **MUST** include a **short, plain-language description** of what
changed and why, what was tested, and anything blocked or deferred. The founder
reads this every morning — it is the primary status signal.

2.7. Commit messages **MUST** be clear and imperative (e.g., "Add storage
interface for progress layer"). Group related changes; avoid noise commits.

2.8. Agents **MUST NOT** use destructive git operations on shared history
(`push --force` to shared branches, history rewrites of `main`, deleting others'
branches).

## 3. CI is the quality gate

3.1. CI (typecheck → lint → build → test) is the source of truth for
correctness. A PR is not ready until CI is green.

3.2. An agent **MUST NOT** open a PR it knows to be red. It **MUST** run the
equivalent checks locally first (`npm run verify` or the documented equivalent).

3.3. An agent **MUST NOT** weaken, disable, or skip CI checks, tests, lint
rules, or type strictness to make a build pass. Fix the root cause. Loosening a
check requires an ADR.

3.4. If CI is red on a PR, the owning agent **MUST** fix it before the work is
considered done.

## 4. Definition of Done (applies to every task)

A task is done only when **all** hold:
4.1. Code typechecks, lints, builds, and all tests pass locally and in CI.
4.2. New behavior has tests; fixed bugs have a regression test.
4.3. Relevant docs are updated (README, package README, or context files).
4.4. `progress/status.md` is updated.
4.5. A PR is open with a complete description. (Not merged — that's the founder.)

## 5. Architecture discipline

5.1. Agents **MUST** stay within their package/scope as defined in their role
file. Cross-cutting or interface-level changes **MUST** be coordinated through
the **Architect** agent.

5.2. Any change to a public interface, package boundary, dependency graph, tech
choice, or anything in `01-architecture.md` **MUST** be recorded as an **ADR**
in `decisions/` and approved before implementation.

5.3. Agents **MUST NOT** introduce a dependency cycle between packages.

5.4. `core` **MUST NOT** depend on a concrete LLM provider or storage adapter —
only on interfaces.

## 6. Product-integrity rules (from the vision)

6.1. Agents **MUST NOT** commit user progress data (intuitions, tracking,
competency data) to this repository.

6.2. Agents **MUST NOT** add shipped answers, solutions, or intuitions to the
curriculum layer. The catalog is links + difficulty only.

6.3. Agents **MUST NOT** hardcode or require a specific LLM provider or model.

6.4. Agents **MUST NOT** add mandatory network calls, telemetry, or cloud
dependencies. The tool runs local-first.

6.5. Agents **MUST NOT** pull a "later feature ring" item (voice, graphs,
gamification, cloud, external tool integrations) into v1 without an ADR.

## 7. Dependencies & security

7.1. New dependencies **MUST** be pinned to exact versions and be widely used
and maintained. Unusual or possibly typosquatted names **MUST** be flagged.

7.2. Secrets, API keys, and endpoints **MUST NOT** be committed. Provide
`.env.example` and read config from the environment.

7.3. Inputs from files, model outputs, and the network are **untrusted**.
Validate and handle errors; never execute untrusted content.

## 8. Communication & handoff

8.1. Every agent **MUST** update `progress/status.md` when it starts and
finishes a unit of work: what it's doing, the branch, the PR link, and what's
next.

8.2. When work depends on another agent, the dependency **MUST** be recorded in
`progress/status.md` and named in the PR description.

8.3. Agents **SHOULD** keep PRs small and focused — one coherent change per PR —
so morning review is fast.

## 9. When blocked or uncertain

9.1. If an agent cannot satisfy the Definition of Done, it **MUST NOT** fake
completion. It **MUST** open a draft PR (or note in status) describing the
blocker and what would unblock it.

9.2. If two reasonable approaches exist and the choice affects architecture, the
Architect **MUST** raise an ADR rather than guess; a skill **MUST** bubble the
choice up to the Architect.

## 9A. Skill dispatch & layered review

9A.1. **All work runs in subagents. The Architect's chat window is purely
conversational.** The Architect **MUST NOT** call file-write, build, or git
tools inline. This includes the Architect's own architecture authoring (ADRs,
interface skeletons, decision-log and status updates), which is dispatched via
the `architect-task` skill. Build work is dispatched via the build skills.

9A.2. Each skill **MUST** be self-contained: enforce its own tool allowlist and
scope, verify its own work at every step (run `verify`), and decide **done** or
**blocked** against explicit acceptance criteria. It **MUST NOT** fake done.

9A.3. **Layered review is mandatory.** A skill self-verifies (build/lint/test)
*and* the Architect **MUST** invoke the independent **`code-review`** skill
after any implementation skill and before a PR is finalized.

9A.4. `code-review` **MUST NOT** review code it authored. On blocking findings
it emits `NEEDS_CHANGES`; the Architect re-dispatches the owning skill to fix,
then re-review.

9A.5. Only genuine **blockers** bubble up to the founder (via the Architect).
Routine done-work does not.

## 10. Subagent isolation (keep the timeline clean)

10.1. **The main chat window is conversational only.** The Architect **MUST**
perform *all* work — exploration, authoring, build, git, verification — inside a
**subagent timeline**, never in the main conversation. No file-write, build, or
git tool may be invoked inline. Talking, planning, and dispatch decisions are
the only things that happen in the window.

10.2. Only **clean, final results** surface to the main timeline: the outcome,
the branch/PR, and the status update. Intermediate noise, dead ends, repeated
attempts, and any hallucinated detours **MUST NOT** leak into the main
conversation or the repo.

10.3. Agents **MUST NOT** commit scratch work, exploratory files, or
trial-and-error artifacts. The repo reflects finished work only.

## 11. Decision logs (audit trail for the founder)

11.1. Every agent **MUST** append a short entry to `decision-logs/<role>.md`
whenever it makes a non-trivial choice (approach taken, alternative rejected,
why). One-line-per-decision is ideal.

11.2. Decision logs are **write-only for agents and read-only for the founder**.
Agents **MUST NOT** read decision logs to inform their work — source of truth is
the context files and ADRs, not the logs.

11.3. Logs are for the founder's oversight, separate from ADRs: ADRs are binding
architectural contracts; decision logs are a lightweight running record of what
each agent did and why.

## 12. Minimal responses (no verbosity, ever)

12.1. All agent responses **MUST** be as minimal as possible: state the outcome
and the next step, nothing more. No preamble, no restating the task, no walls of
text, no filler.

12.2. Detail belongs in the PR description, the ADR, and the decision log — not
in conversational output.
