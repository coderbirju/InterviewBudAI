# ADR 0017 — Architect merge authority

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Founder, Architect
- **Supersedes:** —
- **Amends:** `team-charter.md` §0, §2.5 and §4.5; `team/architect.md`
  (the "MUST NOT merge" line); `skills/00-skill-contract.md` and
  `skills/architect-task.md` (merge wording); `.github/BRANCH_PROTECTION.md`
  (the "you merge" line).

## Context

Until now only the founder merged PRs (charter §2.5). Green, reviewed PRs
waited for the morning review, and stacked PRs (ADR roadmaps with PR A then
PR B) waited a day per step. Founder decision (2026-10-04): the Architect may
merge.

## Decisions

### D1 — When the Architect MAY merge

The Architect **MAY** merge a PR into `main` only when **all** of these hold:

1. **CI is green** on the PR's current head commit (every check passed;
   none pending, skipped by error, or failing).
2. An **independent `code-review` pass** (charter §9A.3–9A.4) on **that same
   head commit** returned `pass`, with no blocking findings. A new commit
   after the review needs a new review.
3. The PR is not a draft and has no `do-not-merge` label.
4. For an ADR PR: it records decisions the founder **already made**. An ADR
   that proposes a question the founder has not answered **MUST NOT** be
   merged by the Architect.
5. The PR's stated merge order is respected (for example "merge after #N").

### D2 — How

- `gh pr merge <n> --merge --match-head-commit <reviewed-sha>`. A merge
  commit only; no squash, no rebase.
- The merge runs inside a subagent (charter §9A.1, §10), like all git work.
- **Never** push directly to `main`. **Never** force-push. **Never** use
  `--admin` or bypass a check. **Auto-merge stays disabled** (`--auto` is not
  used, and the repo setting stays off).
- The merge is recorded in `decision-logs/architect.md` and in
  `progress/status.md`.

### D3 — What does not change

- Skills still never merge. Only the Architect may, under D1.
- The founder can still review and merge any PR, and can revert.
- Release tags stay the founder's action (ADR 0009 D5, ADR 0016 D2).
- Agents still never push to `main`, never rewrite shared history, and never
  delete others' branches (§2.1, §2.8).

## Consequences

- **Positive:** stacked PRs land the same day; the morning review becomes a
  review of what landed, plus the open questions.
- **Tradeoff:** less human review before merge. Mitigated by green CI plus an
  independent review on the exact commit, and by `--match-head-commit`.

Any change to these decisions requires a new ADR.
