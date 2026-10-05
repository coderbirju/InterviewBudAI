# ADR 0018 — Usage metrics move to a private `repo-metrics` repo

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** Founder, Architect
- **Supersedes:** ADR 0016 D1 (nightly in-repo metrics workflow) and the
  PR A row of its roadmap.
- **Amends:** — (ADR 0016 D2 and D3 are unchanged.)

## Context

ADR 0016 D1 put a nightly `metrics.yml` workflow in this repo. It copied
GitHub's clone, view and release download counts to a data-only `metrics`
branch, with a founder-held `METRICS_TOKEN` secret. It shipped in #94 but
was never in a release, and the `metrics` branch was never created.

Founder decision (2026-10-04): metrics collection moves out of this repo into
a separate **private** repo, `coderbirju/repo-metrics`, that tracks several
public repos nightly and is built on its own.

ADR 0016 says any change to its decisions needs a new ADR, so this is one,
not an in-place amendment.

ARCC was queried through the arcc CLI fallback because `search_arcc` was not
registered in this session. It returned no guidance for cross-repo tokens, so
standard practice is applied (least privilege, fine-grained token, secret
held only where it is used).

## Decisions

### D1 — Metrics are collected by `coderbirju/repo-metrics`

- The private repo reads this repo's traffic (clones, views) and release
  download counts (`assets[].download_count`) through the GitHub API on a
  schedule, and stores the history there.
- It uses a **fine-grained personal access token stored only in that repo**,
  scoped to the repos it tracks, with read-only permissions. Its design,
  token scope and storage are decided in that repo, not here.
- The merge logic from ADR 0016 D1 (dedupe by key, oldest-day per-field max,
  zero-fill, idempotence) is reused there as a starting point.

### D2 — This repo has no metrics code and no metrics secret

- Removed: `.github/workflows/metrics.yml`, `scripts/metrics/` (merge script
  and tests), `metrics` in `ci.yml` `branches-ignore`, and the README usage
  metrics / `METRICS_TOKEN` text.
- **No `METRICS_TOKEN` secret** is needed in this repo. If one was added, the
  founder may delete it.
- The `vitest.config.ts` include for `scripts/**/*.test.mjs` stays: the
  release scripts' tests (`scripts/release/release.test.mjs`) use it.

### D3 — Release zip unchanged

ADR 0016 D2 stands as written: `release.yml` attaches
`interviewbudai-vX.Y.Z.zip` to each GitHub Release. That uploaded asset is
what makes downloads countable, now read by `repo-metrics`.

### D4 — Still no telemetry in the app

ADR 0016 D3 stands: the app sends nothing anywhere for metrics (§6.4,
principle 1). All counts come from GitHub's API, read from outside.

## Consequences

- **Positive:** this repo holds no admin-read token and no data branch;
  one place tracks every repo.
- **Positive:** less CI surface here (one workflow and one script fewer).
- **Tradeoff:** the metrics code lives outside this repo's CI and review
  flow.
- **Tradeoff:** until `repo-metrics` runs, GitHub's 14-day traffic window is
  not being saved.

Any change to these decisions requires a new ADR.
