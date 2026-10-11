# Releases

## Install from a release

No clone and no `npm install` needed. You need Node.js 24 LTS or newer.

1. Download `interviewbudai-vX.Y.Z.zip` from the
   [Releases](https://github.com/coderbirju/InterviewBudAI/releases) page and
   unzip it.
2. Optional: copy `interviewbudai-vX.Y.Z/.env.example` to
   `interviewbudai-vX.Y.Z/.env` and set up a provider (see
   [AI providers](providers.md)). The release reads `.env` from the unzipped
   folder; shell exports still win.
3. Run:

   ```bash
   node interviewbudai-vX.Y.Z/dist/server.js   # serves http://127.0.0.1:4173/
   ```

The zip holds one bundled server file (`dist/server.js`), the built web app
(`dist-ui/`), `.env.example`, the README, the LICENSE and the CHANGELOG.

Your data stays in `~/.interviewbudai/data` (or the folder you chose), outside
the zip, so a new release keeps it. Read the release's **Breaking changes**
before you upgrade.

## Cutting a release (maintainers)

1. In a release PR, rename `## [Unreleased]` in `CHANGELOG.md` to
   `## [X.Y.Z] - YYYY-MM-DD` and keep its `### Breaking changes` section
   (write "None." if it is empty). Merge it.
2. The founder tags `main` by hand and pushes the tag (agents never push
   tags):

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

3. `.github/workflows/release.yml` runs `npm ci` and `npm run verify`, checks
   the CHANGELOG section, builds `interviewbudai-vX.Y.Z.zip` (esbuild bundle
   plus the built web app), smoke-tests it, and creates the GitHub Release
   with the zip attached. The notes are an Install block followed by the
   CHANGELOG section.

**The run fails, and no release is created, if the tag is not `vX.Y.Z`, if
`## [X.Y.Z]` is missing, or if it has no `### Breaking changes` heading.**
