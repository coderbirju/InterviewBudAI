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
  `IBAI_HOST_DATA_DIR` (default `~/.interviewbudai/data`, the same default as
  `npm start`). A folder you picked at `/setup` or `/data` outside Docker is
  **not** used automatically — the app shows a banner with the path. Put
  `IBAI_HOST_DATA_DIR=/path/to/your/folder` in a `.env` next to
  `compose.yaml` and restart. Windows users should always set it.
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
is enabled (Settings → AI). **Settings → Test connection** tells you whether
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
| `IBAI_BIND_HOST` | Bind address: `127.0.0.1` or `::1`; `0.0.0.0` only inside the Docker image (the server refuses it otherwise) | `127.0.0.1` |
| `IBAI_HOST_DATA_DIR` | Docker only: the host folder mounted at `/data` | `~/.interviewbudai/data` |

## Run

```bash
npm start                             # web app: open http://127.0.0.1:4173/
node packages/cli/dist/cli.js --help  # CLI (frozen; web is the product; after a build)
```

Details: [packages/web/README.md](packages/web/README.md),
[packages/cli/README.md](packages/cli/README.md).

## Contributing

Project context, architecture, and ADRs live in `context-files/`. Current
status: `context-files/progress/status.md`.
