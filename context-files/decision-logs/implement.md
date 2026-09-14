# Decision Log — Implement

> Write-only running record for founder oversight. Format:
> `YYYY-MM-DD  <branch/PR>  — decision — rejected alternative — why`

2026-09-13  implement/seed-catalog  — seed-catalog: ship ~35 real problem catalog (LeetCode lc-<n> + a few sysd-<slug>) + pure createCatalogSource factory over CATALOG, links+difficulty+tags only — rejected embedding any answers/hints or a runtime loader — keeps §6.2/ADR 0003 invariant, zero-dep leaf, testable read-only source.
