# 00 — Skill Contract (spec all skills conform to)

> Skills are **project-scoped, self-contained procedures** the Architect invokes.
> Each runs in its own isolated subagent timeline. A skill knows what to do,
> enforces its own permissions, verifies its own work, and decides done vs.
> blocked. Only blockers bubble up (via the Architect) to the founder.
>
> Written to be **portable**: the procedure is generic; a `Project binding`
> section maps it to this project. To reuse elsewhere, change only the binding.

## Every skill definition MUST have these sections

### 1. Purpose
One line: what this skill accomplishes.

### 2. Inputs
What the Architect passes in (e.g. `scope`, `branch`, `task`,
`acceptance criteria`). Explicit; no hidden assumptions.

### 3. Tool allowlist (predefined permissions)
The exact set of tools the skill MAY use. It **MUST NOT** use anything outside
this list. Also states path/scope it may write to.

### 4. Steps
The ordered procedure. Generic where possible.

### 5. Self-evaluation & verification (at every step)
- Runs the project `verify` gate (typecheck → lint → build → test) after changes.
- Checks its output against an explicit rubric/acceptance criteria.
- Re-runs until clean or a real blocker is confirmed. No faking done.

### 6. Done / Blocked decision
- **Done** when all acceptance criteria + `verify` pass. Completes silently
  (result only).
- **Blocked** only when it cannot proceed after genuine attempts (missing
  contract, external dependency, ambiguous requirement). Bubbles up with: what
  blocked, what was tried, what would unblock.

### 7. Output contract
Fixed shape returned to the Architect: `status: done|blocked`, `branch`,
`PR (or draft)`, `summary`, `blocker (if any)`.

### 8. Project binding (this project only)
Paths, stack, and rules specific to InterviewBudAI. The only part that changes
when the skill is reused on another project.

## Universal rules (all skills)

- Obey the team charter, especially §2 (never push to main; skills never
  merge — only the Architect may, under §2.5 / ADR 0017; feature
  branches + PR), §10 (subagent isolation), §11 (append to
  `../decision-logs/`), §12 (minimal output).
- Never weaken checks to pass (charter §3.3).
- Never commit secrets or user progress data; never ship answers to the
  curriculum (charter §6–7).
- Stay within the tool allowlist and scope. Cross-cutting or interface changes
  go back to the Architect (ADR), not handled unilaterally.
