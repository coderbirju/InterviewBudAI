# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. Keep entries short and current.
> Format per active item: **[agent] branch — what / status / PR link / next**.

_Last updated: 2026-09-04 (design session)_

## Legend
- ✅ done & merged   🟡 in progress / PR open   ⛔ blocked   ⬜ not started

## Milestone: Foundation (this session)

| Item | Status | Notes |
|---|---|---|
| Project context + architecture docs | ✅ (in this PR) | `context-files/00`, `01` |
| Team charter (RFC 2119 rules) | ✅ (in this PR) | `context-files/team-charter.md` |
| Five team agent files | ✅ (in this PR) | `context-files/team/*.md` |
| ADR 0001 foundational decisions | ✅ (in this PR) | `context-files/decisions/0001-*` |
| CI workflow + PR template | ✅ (in this PR) | `.github/` |
| Branch-protection setup guide | ✅ (in this PR) | `.github/BRANCH_PROTECTION.md` |

## Next up (not started — for future sessions)

1. ⬜ **[architect]** Scaffold the npm workspaces monorepo skeleton
   (`packages/{core,providers,storage,cli,web}`) + root TS/ESLint/Prettier/Vitest
   config + `npm run verify`. First real code PR; makes CI meaningful.
2. ⬜ **[architect]** Draft the **storage interface** and **LLM provider
   interface** contracts (ADR + skeletons) so other agents can parallelize.
3. ⬜ **[integrations-dev]** Implement the default **git/local storage adapter**.
4. ⬜ **[engine-dev]** Implement the **Assess** path against the storage
   interface (read progress → "where you stand").
5. ⬜ **[interface-dev]** Minimal **CLI** entry that wires config + adapters and
   calls the engine.

## Blocked / needs founder action

- ⛔ **Branch protection on `main`** must be enabled in GitHub settings by the
  founder (cannot be set from committed files). See `.github/BRANCH_PROTECTION.md`.
  Until then, the "never push to main / green-CI-required" guarantee is not
  enforced by the platform.

## Open questions / decisions pending

- _None open._ (Foundational decisions recorded in ADR 0001.)
