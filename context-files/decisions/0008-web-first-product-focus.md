# ADR 0008 — Web-first product focus

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Founder, Architect
- **Supersedes:** — (amends `01-architecture.md` "Front-end parity principle"
  and the `00-project-context.md` v1-core bullet "CLI **and** a locally hosted
  web UI, on the same engine")

## Context

`00-project-context.md` lists "CLI **and** a locally hosted web UI, on the same
engine" as v1 core, and `01-architecture.md` locks a **front-end parity
principle**: every capability is expressed in `core` first and a feature must
never live in only one front-end.

In practice the product has moved to the web:

- The React SPA (ADR 0006, M0–M6) is the whole web app, and the Quickfire Quiz
  Master (ADR 0007) is its core coaching loop. The quiz engine lives in
  `packages/web/src/quiz.ts`, not `core` — already an open parity conflict
  (status.md).
- The CLI (`ibai assess|plan|coach`) has not moved since PR #33 and has known
  issues nobody is using it enough to hit.
- On 2026-09-25 the founder decided: **the web app is the product**; the CLI is
  frozen; the web data-dir default is canonical (recorded in status.md, pending
  this ADR).

This ADR records that decision, relaxes the parity principle to match, and
records the roadmap to a usable web product.

## Decisions

### D1 — The local web app is THE v1 product; the CLI is FROZEN

- The locally hosted web app (`@ibai/web`) is the v1 product surface.
- The CLI (`@ibai/cli`) is **frozen**: it MUST keep compiling and passing its
  tests under `npm run verify`, but gets **no new features**.
- Known CLI issues are **recorded, not fixed**:
  - CLI data-dir default `~/.ibai/data` differs from the canonical web default
    `~/.interviewbudai/data` (D3).
  - `ibai coach` with fewer `--answer`s than plan topics prints "Proceeding with
    partial answers" and exits 0 **without running `coach()`**.
- Un-freezing the CLI requires a new ADR.

### D2 — Front-end parity principle RELAXED

- **Web-only features are allowed.** A capability need not exist in the CLI.
- **Engine-first remains PREFERRED** for new domain logic (assess / plan /
  coach / competency logic) where it is cheap — i.e. put logic in `core` when
  it is pure and has no HTTP/UI coupling. It is no longer **required**.
- The Quiz Master engine MAY stay in `packages/web` (resolves the open parity
  question from Q2 / PR #47).
- Unchanged: the two hard rules (stateless engine; no hardcoded provider/store),
  the dependency rule (front-ends depend on `core`; `core` depends on interfaces
  only; no cycles), and all product-integrity rules (charter §6).

### D3 — Canonical data dir

- The canonical default data directory is **`~/.interviewbudai/data`**,
  auto-created with mode **0700** on first run — as shipped in PR #55 (W4).
- The CLI's `~/.ibai/data` default is a frozen known issue (D1), not a second
  canonical location.

### D4 — Wave roadmap to a usable web product (the plan)

Each item is its own PR on a feature branch with a `code-review` pass. Items
marked "needs ADR" or "pending founder" do not start until that lands.

**Wave 1 — reliability & first run (done / in flight)**
- W1 quiz reliability — questions presented from the catalog (ADR 0007 A8) — #56 merged.
- W3 catalog search + difficulty/status filters on Home — #54 merged.
- W4 one-command start (`npm start`, first-run data dir, accurate `.env.example`) — #55 merged.
- W2 localhost hardening — Host/Origin checks, CSRF protection, content-type
  enforcement on the `/api` server — in progress (`feature/w2-localhost-hardening`).

**Wave 2 — the product loop**
- (a) **Growth loop** — feed quiz `CompetencySignals` into
  `CompetencyMap`/`WeaknessRegister` and bring back "Where you stand / Next up"
  in the web (Home card).
- (b) **User-added custom problems** (v1 core per `00-project-context.md`) —
  needs its own storage-interface ADR first.
- (c) **Settings / provider status UI** — show the active provider, test
  connection. Key-storage scope pending founder decision (D5).
- (d) **Server-side data dir as the single source of truth** — reduce reliance
  on the `ibai_data_dir` browser cookie.

**Wave 3 — pending founder decisions (D5)**
- Backup/export and/or real git-backing.
- OpenAI-compatible provider.
- System Design curriculum.

**Hygiene (small PRs, any time)**
- Test cleanup: duplicate `@testing-library/dom` (→ `act()` warnings); Home
  re-filters on unchanged `popstate`; test isolation of `rememberHomeSearch`;
  add an App-level filter → notes → back test.
- Remove dead `POST /api/chat` and the `postChat`/`sendChat` client helpers.
- lc-209 double-topic catalog check.

### D5 — Open founder decisions (listed, NOT decided)

1. System Design in v1 — yes/no, and its shape (links only).
2. Whether API keys may be stored on disk (affects Wave 2c).
3. What "git-backed" means — auto-commit vs export vs drop the claim.
4. Quiz-only vs also free-form coach/plan in the web.
5. Distribution — clone + build vs `npx`. **Answered** by ADR 0009 D5
   (amendment d5-zip, 2026-09-25): contributors clone; users download a
   prebuilt zip from tagged GitHub Releases; no npm/`npx` for now.
6. Branch protection — 403 on the free private repo: make public / Pro / accept
   charter-only enforcement.
7. Delete ADR 0004 (superseded demo provider)?
8. Delete stale branches/worktrees?

## Consequences

- **Positive:** One product surface to finish; effort goes to the web instead of
  keeping two front-ends at parity. The quiz-engine-in-web conflict is resolved.
- **Positive:** A single canonical data dir and a recorded, sequenced roadmap.
- **Tradeoff:** Domain logic may accumulate in `packages/web`; a future CLI (or
  other front-end) revival would need to extract it into `core`. Mitigated by
  keeping engine-first as the preferred default.
- **Tradeoff:** CLI users (if any) keep the known issues in D1 and the
  non-canonical `~/.ibai/data` default.
- **Amends:** `01-architecture.md` "Front-end parity principle" (now references
  this ADR) and `00-project-context.md` v1-core bullet (now "local web UI
  (primary); CLI frozen per ADR 0008"). No other locked rule changes.
