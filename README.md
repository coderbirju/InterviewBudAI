# InterviewBudAI

InterviewBudAI (pronounced "Interview Buddy") is an open-source, local-first,
AI-assisted interview-prep coach. It tracks what you have practised, quizzes you
on it, and builds a personal competency map that stays on your machine. Bring
your own LLM (Anthropic, any OpenAI-compatible server such as Docker Model
Runner, or local Ollama).

The project ships a problem catalog as links + difficulty only — no answers.
Your notes and progress live in your own local data directory, never in this repo.

## Packages

| Package | What it is |
|---|---|
| `packages/core` | Engine: assess / plan / coach. Depends on interfaces only. |
| `packages/providers` | LLM provider interface + `AnthropicProvider`, `OpenAICompatibleProvider`, `OllamaProvider`. |
| `packages/storage` | Storage interface + `LocalFileStorageAdapter` (local files). |
| `packages/curriculum` | Curated, read-only problem catalog (links + difficulty). |
| `packages/cli` | `ibai` CLI: `assess`, `plan`, `coach` (frozen — the web app is the product). |
| `packages/web` | Localhost server + React SPA: Home, Notes, Analytics, Quiz Master. |

## Quick start

Requires Node.js 20.12+.

```bash
npm ci
npm start        # builds if needed, then serves http://127.0.0.1:4173/
```

On boot it prints the local URL, the data directory, and which model provider
is configured (never your API key). On first run it creates your data
directory at `~/.interviewbudai/data` (owner-only permissions), so the app is
usable immediately; `/setup` lets you pick a different location. Stop with
Ctrl+C. The server only listens on 127.0.0.1.

## Install from a release

No clone and no `npm install`: download `interviewbudai-vX.Y.Z.zip` from the
[Releases](https://github.com/coderbirju/InterviewBudAI/releases) page, unzip
it, and run (Node.js 20.12+):

```bash
node interviewbudai-vX.Y.Z/dist/server.js   # serves http://127.0.0.1:4173/
```

The zip holds one bundled server file (`dist/server.js`), the built web app
(`dist-ui/`), `.env.example`, this README, the LICENSE and the CHANGELOG. To
configure a provider, copy `interviewbudai-vX.Y.Z/.env.example` to
`interviewbudai-vX.Y.Z/.env` (the release reads `.env` from the unzipped
folder; shell exports still win). Your data stays in `~/.interviewbudai/data`
(or the folder you choose), outside the zip, so a new release keeps it. Read
the release's **Breaking changes** before upgrading.

## Run with local AI (Docker)

One command starts the app **and** a local model — no account, no key
(ADR 0011).

**Prerequisites**

- Docker Desktop with **Model Runner enabled**: Settings → AI → Enable Docker
  Model Runner (it is off by default in recent versions).
- Docker Compose **2.38 or later** (`docker compose version`).
- Supported hardware: an Apple silicon Mac, or Windows with an NVIDIA
  (driver ≥ 576.57) or Qualcomm Adreno GPU. On Linux, Docker Engine with
  `docker-model-plugin` (see below). Intel Macs are probably not supported.
- About 8 GB of RAM. The default model needs roughly 3.5 GB (an estimate).

```bash
docker compose up
```

Then open <http://localhost:4173>. The first run downloads the model
(**~2.5 GB**), so the first quiz answer can take a while.

- **Change the model:** edit the `model:` line in `compose.yaml` (pinned
  `ai/…` tags; lighter options are listed there, e.g. `ai/qwen2.5:3B-Q4_K_M`
  for tight RAM), then run `docker compose up` again.
- **Use your existing notes:** under Docker the notes folder is
  `IBAI_HOST_DATA_DIR`, else `IBAI_DATA_DIR` (so a folder you pinned for
  `npm start` in `.env` is used here too), else `~/.interviewbudai/data` (the
  same default as `npm start`). Use absolute paths. A folder you picked at
  `/setup` or `/data` outside Docker is **not** used automatically — the app
  shows a banner with the path. Put `IBAI_HOST_DATA_DIR=/path/to/your/folder`
  in a `.env` next to `compose.yaml` and restart.
- **Windows:** always set `IBAI_HOST_DATA_DIR` (or `IBAI_DATA_DIR`). `HOME`
  is often unset there; Compose then falls back to `%USERPROFILE%` for `~`
  (not verified on Windows), so without it the "other folder" banner may not
  show.
- **Runs only while you want it:** `restart: "no"` in `compose.yaml`, so the
  app and the model do not start again by themselves after a Docker restart
  or reboot. Change it to `unless-stopped` to keep it running in the
  background (`docker compose down` stops it).
- **Port:** `IBAI_WEB_PORT=8080` in `.env` (the app is published on
  127.0.0.1 only, never on your network).
- Your `.env` is only used to fill in `compose.yaml`; it is never passed into
  the container, so API keys in it stay out of the app.

**Linux / Docker Engine** (not Docker Desktop): create the folders as your
user first (even if `IBAI_HOST_DATA_DIR` points elsewhere — this also creates
`~/.interviewbudai`), and use the Engine override:

```bash
mkdir -p -m 700 ~/.interviewbudai/data
export IBAI_UID=$(id -u) IBAI_GID=$(id -g)
docker compose -f compose.yaml -f compose.engine.yaml up
```

Use Docker Engine 28.0 or newer (older releases could expose loopback-only
published ports to hosts on the same network; not verified here). Rootless
Docker / Podman: set `IBAI_UID`/`IBAI_GID` to match your uid mapping.

If the quiz says it can't reach Docker Model Runner, check that Model Runner
is enabled: Docker Desktop → Settings → AI → Enable Docker Model Runner; on
Docker Engine, install the `docker-model-plugin` package (`docker model
status` checks it). **Settings → Test connection** tells you whether
the model is available.

## Build and verify

```bash
npm run verify   # typecheck -> lint -> format -> build -> test
```

## Configure a provider

A provider is required for the Quiz Master; the catalog, notes and analytics
work without one. Copy `.env.example` to `.env` at the repo root and fill it in
(loaded automatically by the web server; shell exports win over the file), or
`export` the variables in your shell (read by `packages/web` and
`packages/cli`):

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...        # or IBAI_ANTHROPIC_API_KEY
export IBAI_ANTHROPIC_MODEL=<model-name>

# or any OpenAI-compatible server, e.g. Docker Model Runner (local)
export IBAI_OPENAI_BASE_URL=http://localhost:12434/engines/v1
export IBAI_OPENAI_MODEL=<model-id>
export IBAI_OPENAI_API_KEY=...             # optional; only if the server needs one

# or Ollama (local)
export IBAI_OLLAMA_MODEL=llama3
export IBAI_OLLAMA_URL=http://127.0.0.1:11434   # optional
```

**Precedence** (first match wins): Anthropic (key + model) → OpenAI-compatible
(base URL + model) → Ollama (model) → none. With an OpenAI-compatible key the
base URL must be `https` or loopback `http`; otherwise that provider is skipped
and Settings shows a hint.

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` (or `IBAI_ANTHROPIC_API_KEY`) | Anthropic API key — never commit | — |
| `IBAI_ANTHROPIC_MODEL` | Anthropic model name | — |
| `IBAI_OPENAI_BASE_URL` | OpenAI-compatible base URL (ends in `/v1`, e.g. `http://localhost:12434/engines/v1` for Docker Model Runner) | — |
| `IBAI_OPENAI_MODEL` | OpenAI-compatible model id | — |
| `IBAI_OPENAI_API_KEY` (or `OPENAI_API_KEY`, used only for `https://api.openai.com`) | Optional OpenAI-compatible bearer key — never commit | — |
| `IBAI_OPENAI_TIMEOUT_MS` | OpenAI-compatible request timeout (clamped 5 000–600 000) | `120000` |
| `IBAI_OLLAMA_MODEL` | Ollama model name | — |
| `IBAI_OLLAMA_URL` | Ollama endpoint | `http://127.0.0.1:11434` |
| `IBAI_DATA_DIR` | Your private progress directory (not auto-created when you set it) | web: `~/.interviewbudai/data` (auto-created on first run) |
| `IBAI_WEB_PORT` | Web server port | `4173` |
| `IBAI_BIND_HOST` | Bind address: `127.0.0.1` or `::1`. `0.0.0.0` is accepted only together with `IBAI_CONTAINER=1`; the Docker image sets both. **Never set these outside Docker:** on a normal computer they make the app listen on all network interfaces with **no authentication** (only a startup warning) | `127.0.0.1` |
| `IBAI_HOST_DATA_DIR` | Docker only: the host folder mounted at `/data` | `IBAI_DATA_DIR`, else `~/.interviewbudai/data` |

## Run

```bash
npm start                             # web app: open http://127.0.0.1:4173/
node packages/cli/dist/cli.js --help  # CLI (frozen; web is the product; after a build)
```

Details: [packages/web/README.md](packages/web/README.md),
[packages/cli/README.md](packages/cli/README.md).

## Releases and usage metrics (maintainers)

### Cutting a release

1. In a release PR, rename `## [Unreleased]` in `CHANGELOG.md` to
   `## [X.Y.Z] - YYYY-MM-DD` and keep its `### Breaking changes` section
   (write "None." if empty). Merge it.
2. The founder tags `main` by hand and pushes the tag (agents never push
   tags):
   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
3. `.github/workflows/release.yml` runs `npm ci` and `npm run verify`, checks
   the CHANGELOG section, builds `interviewbudai-vX.Y.Z.zip` (esbuild bundle +
   built SPA), smoke-tests it, and creates the GitHub Release with the zip
   attached. The notes are an Install block followed by the CHANGELOG
   section. **The run fails, and no release is created, if the tag is not
   `vX.Y.Z`, if `## [X.Y.Z]` is missing, or if it has no
   `### Breaking changes` heading.**

### Usage metrics

The app never reports anything (no telemetry). Instead,
`.github/workflows/metrics.yml` runs every night (03:17 UTC, or by hand from
the Actions tab) and copies GitHub's own counts to the data-only **`metrics`**
branch, which is never merged into `main` (ADR 0016):

- [`traffic.csv`](https://github.com/coderbirju/InterviewBudAI/blob/metrics/traffic.csv)
  — `date,clones,unique_clones,views,unique_views`, one row per UTC day,
  kept past GitHub's 14-day window.
- [`downloads.csv`](https://github.com/coderbirju/InterviewBudAI/blob/metrics/downloads.csv)
  — `date,tag,asset,download_count`, a daily snapshot of each release zip's
  cumulative download count.

The first run creates the branch. Only aggregate counts are stored (no
names, IPs or referrers). While the repo is private, clones and views come
only from people with access, so the numbers mean little until it is public.
GitHub counts downloads only for uploaded release assets, not for the
automatic "Source code" archives.

**One-time setup of `METRICS_TOKEN` (founder).** Reading clones and views
needs a token; the built-in workflow token cannot. Until this is done the
workflow records downloads only and shows a notice (it does not fail).

1. GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token.
2. Resource owner `coderbirju`; Repository access **Only select repositories**
   → `coderbirju/InterviewBudAI`.
3. Repository permissions: **Administration: Read-only**. Nothing else
   (Metadata: Read is added automatically). Pick the longest expiry you
   accept.
4. Copy the token. In the repo: Settings → Secrets and variables → Actions →
   **New repository secret**, name `METRICS_TOKEN`, paste, save.
5. Optional: Actions → Metrics → Run workflow to check it.

When the token expires (or lacks the permission), the run shows a warning
and skips traffic; create a new token and update the secret.

## Contributing

Project context, architecture, and ADRs live in `context-files/`. Current
status: `context-files/progress/status.md`.
