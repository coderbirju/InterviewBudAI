# InterviewBudAI

InterviewBudAI (pronounced "Interview Buddy") is an open-source, local-first,
AI-assisted interview-prep coach. It tracks what you have practised, quizzes you
on it, and builds a personal competency map that stays on your machine. Bring
your own LLM (Anthropic or local Ollama today).

The project ships a problem catalog as links + difficulty only — no answers.
Your notes and progress live in your own local data directory, never in this repo.

## Packages

| Package | What it is |
|---|---|
| `packages/core` | Engine: assess / plan / coach. Depends on interfaces only. |
| `packages/providers` | LLM provider interface + `AnthropicProvider`, `OllamaProvider`. |
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

# or Ollama (local)
export IBAI_OLLAMA_MODEL=llama3
export IBAI_OLLAMA_URL=http://127.0.0.1:11434   # optional
```

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` (or `IBAI_ANTHROPIC_API_KEY`) | Anthropic API key — never commit | — |
| `IBAI_ANTHROPIC_MODEL` | Anthropic model name | — |
| `IBAI_OLLAMA_MODEL` | Ollama model name | — |
| `IBAI_OLLAMA_URL` | Ollama endpoint | `http://127.0.0.1:11434` |
| `IBAI_DATA_DIR` | Your private progress directory (not auto-created when you set it) | web: `~/.interviewbudai/data` (auto-created on first run) |
| `IBAI_WEB_PORT` | Web server port | `4173` |

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
