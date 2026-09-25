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
| `packages/cli` | `ibai` CLI: `assess`, `plan`, `coach`. |
| `packages/web` | Localhost server + React SPA: Home, Notes, Analytics, Quiz Master. |

## Quick start

Requires Node.js 20+ (20.12+ for automatic `.env` loading).

```bash
npm ci
npm start        # builds if needed, then serves http://127.0.0.1:4173/
```

On boot it prints the local URL, the data directory, and which model provider
is configured (never your API key). On first run it creates your data
directory at `~/.interviewbudai/data` (owner-only permissions), so the app is
usable immediately; `/setup` lets you pick a different location. Stop with
Ctrl+C. The server only listens on 127.0.0.1.

## Configure a provider

A provider is required for the Quiz Master; the catalog, notes and analytics
work without one. Copy `.env.example` to `.env` and fill it in (loaded
automatically by `npm start`), or `export` the variables in your shell:

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...        # or IBAI_ANTHROPIC_API_KEY
export IBAI_ANTHROPIC_MODEL=<model-name>

# or Ollama (local)
export IBAI_OLLAMA_MODEL=llama3
export IBAI_OLLAMA_URL=http://127.0.0.1:11434   # optional
```

Optional: `IBAI_DATA_DIR` (your progress directory; not auto-created when you
set it), `IBAI_WEB_PORT` (default 4173).

## Build and verify

```bash
npm run verify   # typecheck -> lint -> format -> build -> test
```

The CLI (`node packages/cli/dist/cli.js --help`) is frozen; the web app is the
product.

Details: [packages/web/README.md](packages/web/README.md),
[packages/cli/README.md](packages/cli/README.md).

## Contributing

Project context, architecture, and ADRs live in `context-files/`. Current
status: `context-files/progress/status.md`.
