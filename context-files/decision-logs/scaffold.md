# Decision log — scaffold

Format: `YYYY-MM-DD  <branch/PR>  — decision — rejected alternative — why`

2026-09-25  feature/w4-one-command-start  — root `npm start` runs `packages/web/bin/start.mjs` (incremental `tsc --build`, Vite build only if `dist-ui/` missing/older than `web-ui/`, then server) — `npm run build && npm start` in docs, or always running `npm run build` — one command after `npm ci`; tsc is a no-op when current, and skipping an unneeded Vite build keeps restarts fast.
2026-09-25  feature/w4-one-command-start  — start helper lives in `packages/web/bin/` — `scripts/` dir — `**/scripts/` is eslint/prettier-ignored as dev-only; this runs for every user so it should be linted and formatted.
2026-09-25  feature/w4-one-command-start  — boot auto-creates ONLY the default `~/.interviewbudai/data` (mkdir -p, chmod 0700) when absent — also creating an explicit `IBAI_DATA_DIR` / `--data-dir` — explicit-path behavior must not change, and a typo in an explicit path must not silently create a stray dir; the banner flags it as missing and `/setup` still creates it.
2026-09-25  feature/w4-one-command-start  — load `./.env` via built-in `process.loadEnvFile` in `server-bin` only, guarded by file existence + API presence (warn on Node < 20.12) — `dotenv` dep, or `--env-file` flag — no new deps; `--env-file` errors when the file is missing and needs Node 20.6+; guard keeps engines `>=20` working. Shell env wins over the file.
2026-09-25  feature/w4-one-command-start  — startup banner prints provider kind + model only (key checked for presence) and omits the Ollama URL — printing the full provider config — never log secrets; a URL may carry userinfo credentials.
2026-09-25  feature/w4-one-command-start  — `startServer` rejects on listen errors (e.g. port in use) — leave the promise pending — previously a busy port hung boot silently.
2026-09-25  feature/w4-one-command-start  — web workspace `start` now also runs the build-if-needed helper; added `serve` for the raw `dist/server-bin.js` — keep `start` as raw node — consistent behavior whichever `start` a user runs.
