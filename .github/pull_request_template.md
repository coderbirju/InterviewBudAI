<!--
  Required by the team charter (§2.6). The founder reads this every morning to
  decide what to merge. Keep it short and in plain language.
-->

## Summary of changes
<!-- What changed and why, in 2–5 plain-language sentences. -->

## Agent & scope
- Agent role: <!-- architect / engine-dev / integrations-dev / interface-dev / qa-test -->
- Branch: <!-- <role>/<topic> -->
- Package(s) touched: <!-- e.g. packages/core -->

## How it was tested
<!-- Commands run, what passed. CI must also be green. -->

## Checklist (charter Definition of Done §4)
- [ ] Typecheck, lint, build, and tests pass locally (`npm run verify`)
- [ ] New behavior has tests / bug fixes have a regression test
- [ ] Relevant docs updated (README / package README / context files)
- [ ] `context-files/progress/status.md` updated
- [ ] No secrets, user progress data, or shipped answers committed
- [ ] No new dependency cycles; `core` depends on interfaces only
- [ ] Architectural changes recorded as an ADR in `context-files/decisions/`

## Blocked / deferred
<!-- Anything not finished, and what would unblock it. Write "None" if nothing. -->
