# Skill — code-review

### 1. Purpose
Independent quality pass invoked by the Architect **after** an implementation
skill and **before** a PR is finalized. Keeps quality consistent across the
project. Reviews work the author did not review themselves.

### 2. Inputs
`branch` / `diff` to review, `scope`, `acceptance criteria`, the originating
skill's output.

### 3. Tool allowlist (predefined permissions)
- Read files, read git diff, shell (read-only checks, run `verify`).
- MAY write: review notes to the PR / `../decision-logs/`.
- MUST NOT: rewrite the code itself (it sends findings back to the owning skill);
  push/merge to main; approve its own prior work.

### 4. Steps
1. Read the diff against the acceptance criteria and the rubric below.
2. Run `verify` independently to confirm green.
3. Produce findings: blocking vs. non-blocking.

### 5. Rubric (consistency gate)
- Architecture: no cross-session state; `core` interfaces-only; no dep cycles;
  interface changes have an ADR.
- Product integrity: no committed user data; no shipped answers; no hardcoded
  provider; local-first; no out-of-scope later-ring features.
- Quality: tests cover new/changed paths; errors handled; inputs treated as
  untrusted; naming/style consistent; deps pinned; no secrets.
- Scope: change is focused; stays within the owning skill's scope.
- Data lifecycle (ADR 0009 D4): a change to where data lives, how the data dir is resolved, or a BREAKING on-disk format change (additive, back-compatible format changes are exempt) that is missing either a migration/recovery path or a `CHANGELOG.md` `### Breaking changes` entry is blocking.

### 6. Done / Blocked
- **Pass**: no blocking findings → PR ready for the founder's morning review.
- **Changes needed**: return blocking findings to the owning skill to fix, then
  re-review. Emit `NEEDS_CHANGES` so the Architect re-dispatches.
- **Blocked**: architectural conflict needing a decision → bubble up.

### 7. Output contract
`status: pass|needs_changes|blocked`, `findings`, `summary`.

### 8. Project binding (InterviewBudAI)
Rubric enforces the non-negotiables in `../01-architecture.md` and product rules
in `../00-project-context.md`. Independent from the authoring skill — never
reviews code it wrote.
