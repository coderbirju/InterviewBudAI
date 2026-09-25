# Branch Protection Setup (one-time, founder action)

Branch protection can't be set from committed files — it's a GitHub repository
setting. This enforces the team's core guarantee: **agents never push to `main`,
and only green, reviewed PRs get merged.** Do this once.

## Steps (GitHub UI)

1. Go to **Settings → Branches → Add branch ruleset** (or "Add rule" under
   *Branch protection rules*).
2. **Target branch:** `main`.
3. Enable:
   - ✅ **Require a pull request before merging**
     - ✅ Require approvals: **1** (you are the approver).
     - ✅ Dismiss stale approvals when new commits are pushed.
   - ✅ **Require status checks to pass before merging**
     - ✅ Require branches to be up to date before merging.
     - Add the required check: **`typecheck / lint / build / test`**
       (the `verify` job in `.github/workflows/ci.yml`). It appears in the list
       after CI has run at least once.
   - ✅ **Do not allow bypassing the above settings** (applies rules to admins
     too — keeps the guarantee honest).
   - ✅ **Block force pushes** to `main`.
   - ✅ **Restrict deletions** of `main`.
4. **Do NOT enable auto-merge** for the repo (Settings → General → Pull
   Requests → leave "Allow auto-merge" unchecked). Merging is a deliberate
   morning action.
5. Save.

## Result

- Agents can push only to feature branches and open PRs.
- A PR can be merged only when CI is green **and** you approve it.
- No direct pushes, force-pushes, or deletions of `main`.
- You merge the PRs you approve each morning — nothing merges on its own.

## Note for agents

Until this is enabled, the platform does not enforce these rules; the charter
still does. This item is tracked as **blocked (founder action)** in
`context-files/progress/status.md`.

## Availability (checked 2026-09-25)

The GitHub API returns `403 — Upgrade to GitHub Pro or make this repository
public` for both branch protection and rulesets on this repo. Protection
cannot be enabled while the repo is private on GitHub Free: make it public,
upgrade the plan, or accept charter-only enforcement.
