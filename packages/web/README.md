# @ibai/web

Locally-hosted web front-end for InterviewBudAI's ASSESS, PLAN, and COACH capabilities.

## Overview

This package provides a thin, localhost-only web server that exposes the ASSESS, PLAN, and COACH functionality through a polished dashboard UI. It maintains **front-end parity** with the CLI—the same engine capabilities are available through both interfaces.

## Provider Required

The AI interview **requires a configured LLM provider**. All processing is local-first; your data never leaves your machine. The only outbound call is to your configured provider.

### Option 1: Anthropic (Claude)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export IBAI_ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

### Option 2: Ollama (Local)

```bash
# Start Ollama
ollama serve

# Pull a model
ollama pull llama2

# Configure
export IBAI_OLLAMA_MODEL=llama2

# Optionally set a custom URL (default: http://127.0.0.1:11434)
export IBAI_OLLAMA_URL=http://127.0.0.1:11434
```

## Features

- **Navigation bar** — Shared top nav on all pages. The **InterviewBudAI wordmark** sits on the left (appears on every page); nav links (Home, Dashboard, Interview) sit on the right. Catalog is no longer a separate nav item — the Home page surfaces the catalog directly (see below).
- **Home page = the catalog** — The landing page at `/` has two states:
  - **No database**: Shows a "Create your database" start CTA linking to `/setup`.
  - **Database configured**: The home page **is** the problem catalog — the grouped-by-topic table is rendered directly on `/`, with a **"Continue practicing"** button in a top action bar. There is no separate "database ready" interstitial; you land straight on the problems.
- **Per-row status** — Each problem row on the home catalog shows its **status badge** (resolved via `resolveNoteStatus`): **Done** (green), **To revisit** (amber), **Did not understand** (red), or none. Read-only and safe when no database is configured.
- **Problem Catalog** — Browse curated problems grouped by topic with a status column, difficulty badges, LeetCode links, and Notes links. Available directly on the home page and at the standalone `/catalog` route (same grouped table).
- **Catalog-first onboarding** — New users see the create-database CTA; once a database exists, the home page shows the full catalog to explore and track.
- **Create database** — Simple setup flow to create and remember your data directory via browser cookie
- **Where You Stand** — View your current proficiency across topics, top strengths, focus areas, and recurring weaknesses
- **Your Next Session** — AI-derived session plan with warmup, focus, and twist topics displayed as cards with role badges and proficiency bars
- **Turn-by-turn AI Interview** — Conduct mock interviews where the AI asks questions and evaluates your answers
- **AI-Evaluation** — The model evaluates your performance; no self-assessment required
- **JSON APIs** — Machine-readable endpoints for integration with other tools
- **Dark theme** — Modern, accessible UI with dark color scheme
- **Local-first** — All data stays on your machine; no telemetry, no cloud dependencies
- **Cookie-based directory persistence** — Browser remembers your data directory across visits (no login required)
- **Notes editor** — Capture your intuition, solution approach, time/space complexity, and set a **status tag** for each problem
- **Status tags** — Each note carries a status: **None**, **Done**, **To revisit**, or **Did not understand**. `Done` keeps the legacy `completed` flag consistent, so the dashboard count and catalog ✓ markers keep working
- **Completion tracking** — Dashboard shows completed problems count and list; catalog shows ✓ done markers (driven by the `Done` status)
- **Per-request data resolution** — Home and dashboard honor the cookie-specified data directory

## Quick Start

```bash
# Build
npm run build

# Configure a provider (choose one)
export IBAI_OLLAMA_MODEL=llama2  # For Ollama
# OR
export ANTHROPIC_API_KEY=sk-ant-... && export IBAI_ANTHROPIC_MODEL=claude-sonnet-4-20250514  # For Anthropic

# Start the server
npm --workspace @ibai/web run start
```

Open http://127.0.0.1:4173/coach and start your AI-powered interview!

## Building

```bash
npm run build
```

## Starting the Server

```bash
# With default settings (data dir: ~/.interviewbudai/data, port: 4173)
npm --workspace @ibai/web run start

# With custom data directory
IBAI_DATA_DIR=/path/to/data npm --workspace @ibai/web run start

# With custom port
IBAI_WEB_PORT=8080 npm --workspace @ibai/web run start

# Using CLI flags
node packages/web/dist/server-bin.js --data-dir=/path/to/data --port=8080
```

## Configuration

| Setting | CLI Flag | Environment Variable | Default |
|---------|----------|---------------------|----------|
| Data directory | `--data-dir=<path>` | `IBAI_DATA_DIR` | `~/.interviewbudai/data` |
| Port | `--port=<port>` | `IBAI_WEB_PORT` | `4173` |
| Ollama URL | — | `IBAI_OLLAMA_URL` | `http://127.0.0.1:11434` |
| Ollama Model | — | `IBAI_OLLAMA_MODEL` | *(required for Ollama)* |
| Anthropic API Key | — | `ANTHROPIC_API_KEY` | *(required for Anthropic)* |
| Anthropic Model | — | `IBAI_ANTHROPIC_MODEL` | *(required for Anthropic)* |

Precedence: CLI flag > environment variable > default.

## Endpoints

| Path | Method | Format | Description |
|------|--------|--------|-------------|
| `/` | GET | HTML | Home page. With a database configured it renders the problem catalog directly (grouped table + per-row status + "Continue practicing"); with no database it shows the create-database CTA. |
| `/dashboard` | GET | HTML | Full dashboard with Where You Stand and Your Next Session sections |
| `/assess` | GET | HTML | Alias for `/dashboard` |
| `/catalog` | GET | HTML | Standalone problem catalog grouped by topic (same table as home) with status, LeetCode, and Notes links |
| `/notes/<id>` | GET | HTML | View/edit notes for a problem. Shows setup CTA if no database exists. |
| `/notes/<id>` | POST | HTML | Save notes content, status tag, and complexity. Shows 'Saved' banner on success. |
| `/setup` | GET | HTML | Form to create/select data directory |
| `/setup` | POST | HTML | Create data directory and set cookie |
| `/assess.json` | GET | JSON | AssessmentView as JSON |
| `/plan.json` | GET | JSON | SessionPlan as JSON |
| `/coach` | GET | HTML | Start turn-by-turn AI interview (requires provider) |
| `/coach` | POST | HTML | Submit answer, get next question or final evaluation |
| `/coach.json` | POST | JSON | Execute coaching session with JSON API |

Optional query parameter: `?sessionId=<id>` to assess/plan/coach for a specific session.

## AI Interview Flow

### GET /coach

Starts a turn-by-turn AI interview. The model generates interviewer questions for each topic in your session plan. Requires a configured provider.

### POST /coach

Submits your answer to the current question. If more topics remain, returns the next question. When all topics are complete, the model evaluates your answers and returns:
- AI-generated coaching narrative
- Per-topic evaluations (succeeded/failed with feedback)
- Updated competency map and weakness register

### POST /coach.json

JSON API for programmatic access. Accepts:
```json
{
  "sessionId": "optional-session-id",
  "answers": [
    { "topicId": "arrays", "question": "What is...", "answer": "My answer..." },
    { "topicId": "graphs", "answer": "My answer..." }
  ]
}
```

Returns the full `CoachResult` object with evaluations, summary, and updated competency/weakness data.

### Error Handling

| Scenario | Status | Message |
|----------|--------|---------|
| No provider configured | 200 (HTML) / 400 (JSON) | Configuration instructions |
| Provider connection error | 502 | "Could not reach the model provider..." |
| Authentication error | 502 | "The model rejected the request..." |
| Malformed model output | 502 | "The model returned an unusable response..." |
| Invalid request | 400 | Specific validation error |

## Dashboard Sections

### Where You Stand

Displays your current proficiency across topics with:
- Proficiency bars for each topic
- Top 3 strengths highlighted
- Focus areas that need work
- Recurring weaknesses from the weakness register

### Your Next Session

Shows the AI-derived session plan with:
- Topic cards with role badges (warmup/focus/twist)
- Proficiency indicators
- Rationale for each topic selection

## Privacy & Security

- **Localhost-only** — Server binds to 127.0.0.1 by default
- **No telemetry** — No usage data is collected or transmitted
- **Local-first** — All user data stored locally in your data directory
- **Provider calls only** — The only network calls are to your configured LLM provider
