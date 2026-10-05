# ADR 0016 — Usage metrics: clone and release download counts

- **Status:** Accepted; D1 superseded by ADR 0018 (metrics move to the
  private `coderbirju/repo-metrics` repo). D2 and D3 unchanged.
- **Date:** 2026-10-04
- **Deciders:** Founder, Architect
- **Supersedes:** —
- **Amends:** ADR 0009 D5 (PR D, the release zip, is scheduled and its open
  packaging choices are made here, D2).

## Context

The founder wants to know whether people use the project: how often it is
cloned and how often the release is downloaded.

Constraints:

- **No telemetry in the app** (§6.4, principle 1). The app never reports
  anything. All metrics come from GitHub, on the repo side.
- GitHub keeps traffic data (clones, views) for **14 days only**. To keep a
  history, it must be copied somewhere on a schedule.
- `GET /repos/{owner}/{repo}/traffic/*` needs a token with push or admin
  access to the repo. The workflow's built-in `GITHUB_TOKEN` cannot read
  traffic.
- GitHub counts downloads only for **uploaded release assets**
  (`assets[].download_count`). The automatic "Source code (zip/tar.gz)"
  archives are not counted. So a release needs a real asset.
- While the repo is **private**, clones and views come only from people with
  access (the founder and agents). The numbers mean something only once the
  repo is public.

ARCC was queried through the arcc CLI fallback because `search_arcc` was not
registered in this session. It returned no guidance for CI tokens and secrets,
so standard practice is applied (least privilege, fine-grained token, secret
never logged, actions pinned by SHA).

## Decisions

### D1 — Nightly metrics workflow

**File:** `.github/workflows/metrics.yml`.

- **Triggers:** `schedule` (daily, `cron: '17 3 * * *'`, off the hour) and
  `workflow_dispatch`.
- **Permissions:** `contents: write` (to push the `metrics` branch), nothing
  else. `concurrency: metrics` so two runs never race.
- **Actions pinned by full commit SHA** (with the version in a comment), for
  every action in this workflow.

**Reads:**

| Endpoint | Token |
|---|---|
| `GET /repos/{owner}/{repo}/traffic/clones?per=day` | `METRICS_TOKEN` |
| `GET /repos/{owner}/{repo}/traffic/views?per=day` | `METRICS_TOKEN` |
| `GET /repos/{owner}/{repo}/releases?per_page=100`, **all pages** (`gh api --paginate`, which follows the `Link` header), each `assets[].download_count` | `GITHUB_TOKEN` |

**Token.** The founder creates a **fine-grained personal access token**:

- Repository access: only `coderbirju/InterviewBudAI`.
- Permission: **Administration: Read** only (the traffic endpoints need it).
  GitHub adds Metadata: Read by itself. Nothing else; releases are read with
  `GITHUB_TOKEN`.
- Saved as the repo secret **`METRICS_TOKEN`**.
- Expiry: the longest the founder accepts. When it expires the workflow warns
  (below) and the founder renews it.

The token is passed only as an env var to the step that calls the API, and
only as an `Authorization: Bearer` header. It is never echoed or written to a
file.

**Missing or failing token: skip, do not fail.**

- No `METRICS_TOKEN` → the traffic step prints a
  `::notice::METRICS_TOKEN is not set; skipping traffic` line and a line in
  the job summary, and the run stays green. Release downloads are still
  recorded.
- `401` / `403` from a traffic endpoint → a `::warning::` (token expired or
  missing permission) and the same skip. Other errors fail the run.

**Storage: a dedicated `metrics` branch.**

- The branch holds only data files, never code, and is **never merged** into
  `main`. If it does not exist, the first run creates it as an orphan branch.
- Files:
  - `traffic.csv` — `date,clones,unique_clones,views,unique_views`
  - `downloads.csv` — `date,tag,asset,download_count` (a cumulative count per
    asset, one snapshot per day)
  - `README.md` — one paragraph on what the files are.
- **Merge rule (so history grows past 14 days):** rows are keyed by `date`
  (UTC `YYYY-MM-DD`) for traffic and by `date,tag,asset` for downloads.
  - A new fetch **replaces** rows with the same key (GitHub's last days are
    partial and change) and keeps every older row.
  - **Oldest day of the window:** GitHub may report it only in part (the
    14-day window can start mid-day). For that one date the merge keeps the
    **per-field maximum** of the stored row and the new one, so a later,
    smaller view of it never lowers the count.
  - **Zero-fill:** clones and views come from two endpoints. A date that
    appears in only one of them gets `0` for the other's two fields.
  - Rows are sorted by key. The merge is idempotent: running twice on one
    day gives the same files.
- The merge is a small Node script, `scripts/metrics/merge-metrics.mjs`
  (Node built-ins only, no dependency), with unit tests
  (`scripts/metrics/merge-metrics.test.mjs`). The root `vitest.config.ts`
  `include` today covers only `packages/*/src/**/*.test.ts`, so PR A adds
  `scripts/**/*.test.mjs` to it; then `npm test` and CI run them.
- **CI:** PR A adds `metrics` to `branches-ignore` in `ci.yml` (next to
  `main`), so data pushes to that branch do not start CI runs.
- The push uses `GITHUB_TOKEN` (`contents: write`), commits as
  `github-actions[bot]`, and is skipped when the files did not change.
- The data is aggregate counts only. No user names, IPs or referrers are
  stored.

### D2 — Release asset (resolves ADR 0009 D5 PR D)

**File:** `.github/workflows/release.yml`, triggered by `push` of a `v*` tag.
**The founder still pushes tags by hand**; agents never push tags.
Permissions: `contents: write`. Uses only `GITHUB_TOKEN` (no npm token).
Actions pinned by SHA.

**Steps:**

1. Check out the tag. Set up Node 20. `npm ci`. `npm run verify`.
2. Read the CHANGELOG section `## [x.y.z]` for the tag `vx.y.z`. **The run
   fails** if that section is missing, **or if it has no
   `### Breaking changes` heading** (ADR 0009 D5: every release has one,
   "None." if empty). No release is created in either case.
3. Build the zip (layout below).
4. **Smoke test:** unzip into a temp folder, start the server on a free port
   with a temp data dir, check that `GET /` and `GET /api/catalog` return 200,
   then stop it.
5. Write `notes.md`: a fixed "Install" block first, then the CHANGELOG
   section. The block is a template in `scripts/release/notes-header.md`
   with `{{TAG}}` replaced by the tag: "Download `interviewbudai-{{TAG}}.zip`,
   unzip it, and run `node interviewbudai-{{TAG}}/dist/server.js` (Node ≥
   20.12)." So the run command is always in the release notes.
6. `gh release create "$TAG" interviewbudai-$TAG.zip --notes-file notes.md
   --title "$TAG"`. The zip is an uploaded asset, so GitHub counts its
   downloads (D1).

**Packaging choice (ADR 0009 D5 left this open): one bundled server file.**

- **`esbuild`**, pinned as a direct root devDependency at **0.21.5**, the
  version already in the lockfile through Vite. No new package enters the
  tree. It bundles `packages/web/dist/server-bin.js` and every runtime
  dependency (the `@ibai/*` workspaces, `htmlparser2` from ADR 0015) into one
  ESM file (`--platform=node --format=esm --target=node20.12`).
- Rejected: copying the compiled workspaces plus production `node_modules`.
  The workspace links are symlinks, and symlinks in a zip break on Windows.
- `react`, `react-dom`, `lucide-react` and CodeMirror are only in the built
  SPA, not in the server bundle.

**Zip layout** (`interviewbudai-vX.Y.Z.zip`):

```
interviewbudai-vX.Y.Z/
  dist/server.js      the bundled server
  dist-ui/            the built SPA (spa.ts resolves ../dist-ui)
  package.json        { name, version: X.Y.Z, type: "module", engines }
  .env.example
  README.md  LICENSE  CHANGELOG.md
```

- `settings.ts` reads `../package.json`, which resolves to the zip's
  `package.json`, so Settings shows the release version.
- **Run command** (README and release notes):
  `node interviewbudai-vX.Y.Z/dist/server.js`, with Node ≥ 20.12. Nothing is
  installed or built on the user's machine.
- **`.env` location (ADR 0009 D5 follow-up):** today `REPO_DOTENV_PATH` is
  `../../../.env` from the compiled module, which would point outside the
  zip. The bundle build sets a build-time constant (esbuild `--define`) so
  the bundled server reads **`interviewbudai-vX.Y.Z/.env`** (the unzipped
  folder) instead. Plain env vars still work. Unit test: the path resolver
  returns the repo `.env` unbundled and the folder `.env` bundled.
- The zip contains no user data, no `.env`, and no LeetCode text (§6.2,
  ADR 0015 D1).

### D3 — No app telemetry

The app sends nothing anywhere for metrics. Nothing in `packages/` changes
for D1. D2 changes only the build. This keeps §6.4 and principle 1 as they
are.

## Roadmap (each with a `code-review` pass)

| PR | Scope |
|---|---|
| **A — metrics** | `metrics.yml`, `scripts/metrics/merge-metrics.mjs` + tests (merge, dedupe, oldest-day max, zero-fill, idempotence, missing-token skip logic as a pure function), the `vitest.config.ts` include, `metrics` in `ci.yml` `branches-ignore`, README "Usage metrics" note (what is counted, private-repo caveat, how to add `METRICS_TOKEN`). |
| **B — release zip** | `release.yml`, the bundle script (`scripts/release/build-zip.mjs`), `notes-header.md` and the CHANGELOG section check (section and `### Breaking changes`), the `esbuild` pin, the bundled `.env` path + test, README "Install from a release" section, CHANGELOG `### Added`. |

Founder action after PR A: create the fine-grained token and add it as
`METRICS_TOKEN`. Until then the workflow records downloads only.

## Consequences

- **Positive:** clone, view and download history beyond 14 days, with no
  telemetry in the app.
- **Positive:** users get a prebuilt zip; ADR 0009 D5 PR D is done.
- **Tradeoff:** a founder-held token with Administration: Read. It is
  read-only, limited to one repo, and used by one workflow step.
- **Tradeoff:** the `metrics` branch grows by about two small rows a day.
- **Tradeoff:** traffic numbers mean little while the repo is private.
- **Tradeoff:** one more pinned dev dependency (`esbuild`), already in the
  tree.

Any change to these decisions requires a new ADR.
