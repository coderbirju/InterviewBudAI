# ADR 0019 — Node 24 LTS minimum

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** Founder, Architect
- **Amends:** ADR 0009 D5 (run the zip "with Node ≥ 20.12"), ADR 0011 D2
  (Docker image "major ≥ 20.12 LTS line"), ADR 0016 D2 ("Set up Node 20",
  `--target=node20.12`, the release notes header). Everything else in those
  ADRs stands.

## Context

`01-architecture.md` locks the runtime as "Node.js (LTS)". The repo still
declared `engines.node >=20.12`, CI and the release workflow ran Node 20, and
the Docker image used Node 22. Node 20 reached end of life in April 2026, so
the minimum points at an unsupported line.

Founder decision (2026-10-05): upgrade to Node 24 LTS. The founder's machine
already runs v24.

## Decisions

### D1 — `engines.node` is `>=24`

- The root `package.json` declares `"engines": { "node": ">=24" }`. No
  workspace `package.json` declares `engines`, so none change.
- The release zip's `package.json` copies the root `engines` (ADR 0016 D2),
  so it says `>=24` too.
- `.npmrc` does not set `engine-strict`, so older Node versions get an npm
  `EBADENGINE` warning, not a hard failure. They are simply no longer
  supported or tested.

### D2 — CI, Docker and the release zip all use Node 24

- `.github/workflows/ci.yml` and `release.yml`: `node-version: 24`.
- `actions/cache` goes from v4.3.0 to **v5.1.0**, pinned by full SHA
  (`caa296126883cff596d87d8935842f9db880ef25`, checked with
  `git ls-remote`). v5 runs on the Node 24 action runtime and needs runner
  2.327.1+ (GitHub-hosted runners have it). Its inputs (`path`, `key`,
  `restore-keys`) are unchanged.
- `Dockerfile` `NODE_IMAGE` default and the `compose.ci.yaml` fake-server
  image: `node:24.21.0-bookworm-slim`, pinned by tag **and** index digest
  (`sha256:0e0ff40c…f9b6`, from `docker manifest inspect`), the same pinning
  style as before (charter §7.1).
- The release bundle: esbuild `--target=node24`; the release notes header
  says "Node.js 24 LTS or newer".
- `@types/node` goes from 20.14.10 to **24.19.1** (exact pin). It was a
  trivial bump: `npm run verify` stayed green with no code change.

### D3 — This is a breaking change

Anyone running `npm start` or the release zip on Node 20 or 22 must install
Node 24 LTS (for example `nvm install 24`, or the installer from
nodejs.org), then run `npm ci` again in a clone. Docker users are not
affected: the image ships its own Node. The CHANGELOG `[Unreleased]`
`### Breaking changes` section says this (ADR 0009 D4/D5 style: say what
changed and what to do).

### D4 — `htmlparser2` stays at 10.1.0 for now

ADR 0015 D2 / ADR 0006 held `htmlparser2` at 10.1.0 only because 11.x and
12.x declare `engines.node >= 20.19`. With a Node 24 floor that reason is
gone, so 11.x/12.x may be adopted later. **Not in this PR:** a major bump of
a runtime sanitizer dependency needs its own PR with the sanitizer tests and
a license/transitive-dependency check.

## Consequences

- **Positive:** the supported runtime is a maintained LTS line; CI, Docker,
  the release zip and the founder's machine all run the same major.
- **Positive:** the `htmlparser2` Node-version constraint is lifted.
- **Tradeoff:** contributors and zip users on Node 20/22 must upgrade.

Any change to these decisions requires a new ADR.
