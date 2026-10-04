# Skill — architect-task

### 1. Purpose
Perform the Architect's own authoring work in an isolated subagent so the chat
window stays purely conversational: ADRs, interface contracts/skeletons,
decision-log entries, status updates, and merges under charter §2.5
(ADR 0017).

### 2. Inputs
`kind` (adr | interface-skeleton | decision-log | status-update | merge),
`content/intent`, `branch`, `acceptance criteria`.

### 3. Tool allowlist (predefined permissions)
- Read/write files, shell (`npm` for typecheck when skeletons involve code;
  `git` branch/commit/push).
- Write scope: `context-files/decisions/`, `context-files/decision-logs/`,
  `context-files/progress/status.md`, and interface/skeleton files under the
  package the Architect owns the contract for.
- MUST NOT: implement feature logic (that's `implement`/`integrate`/`frontend`);
  push to main; force-push.
- MAY (kind `merge` only): `gh pr merge <n> --merge --match-head-commit <sha>`
  when the charter §2.5 / ADR 0017 D1 conditions hold: CI green on the head,
  a `code-review` `pass` with `reviewedSha` equal to the head, and
  `gh pr view <n> --json mergeStateStatus` = `CLEAN`. Not `CLEAN` → do not
  merge; report it so the owning skill merges `main` into the branch, CI goes
  green, and the new head is re-reviewed. Never `--admin`, never `--auto`. If
  the harness denies `gh pr merge` (no founder-granted rule), return
  `blocked: ready for founder merge` with the reviewed SHA.

### 4. Steps
1. Produce the artifact (ADR / skeleton / log line / status edit) per intent.
2. If a skeleton includes code, ensure it typechecks/builds.
3. Commit on a feature branch; open a PR if the artifact is repo-affecting.

### 5. Self-evaluation & verification
- For code skeletons: run `verify`; must be green.
- For docs/logs: confirm the artifact matches the intent and links correctly.

### 6. Done / Blocked
- Done: artifact created, verifies, acceptance criteria met.
- Blocked: intent ambiguous or conflicts with an existing ADR → bubble up.

### 7. Output contract
`status`, `branch`, `PR (if any)`, `summary`, `blocker?`.

### 8. Project binding (InterviewBudAI)
Interfaces the Architect owns: storage interface, LLM provider interface (see
`../01-architecture.md`). ADRs numbered sequentially in `../decisions/`.
