# Skill — architect-task

### 1. Purpose
Perform the Architect's own authoring work in an isolated subagent so the chat
window stays purely conversational: ADRs, interface contracts/skeletons,
decision-log entries, and status updates.

### 2. Inputs
`kind` (adr | interface-skeleton | decision-log | status-update), `content/intent`,
`branch`, `acceptance criteria`.

### 3. Tool allowlist (predefined permissions)
- Read/write files, shell (`npm` for typecheck when skeletons involve code;
  `git` branch/commit/push).
- Write scope: `context-files/decisions/`, `context-files/decision-logs/`,
  `context-files/progress/status.md`, and interface/skeleton files under the
  package the Architect owns the contract for.
- MUST NOT: implement feature logic (that's `implement`/`integrate`/`frontend`);
  push/merge to main.

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
