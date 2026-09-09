# @ibai/web

Locally-hosted web front-end for InterviewBudAI's ASSESS and PLAN capabilities.

## Overview

This package provides a thin, localhost-only web server that exposes the ASSESS and PLAN functionality through a polished dashboard UI. It maintains **front-end parity** with the CLI—the same engine capabilities are available through both interfaces.

## Features

- **Where You Stand** — View your current proficiency across topics, top strengths, focus areas, and recurring weaknesses
- **Your Next Session** — AI-derived session plan with warmup, focus, and twist topics displayed as cards with role badges and proficiency bars
- **JSON APIs** — Machine-readable endpoints for integration with other tools
- **Dark theme** — Modern, accessible UI with dark color scheme
- **Local-first** — All data stays on your machine, no external requests

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

Precedence: CLI flag > environment variable > default.

## Endpoints

| Path | Format | Description |
|------|--------|-------------|
| `/` | HTML | Full dashboard with Where You Stand + Your Next Session |
| `/assess` | HTML | Same as `/` |
| `/assess.json` | JSON | AssessmentView as JSON |
| `/plan.json` | JSON | SessionPlan as JSON |

Optional query parameter: `?sessionId=<id>` to assess/plan for a specific session.

## Dashboard Sections

### Where You Stand

Displays your current interview prep status:
- **Topics tracked** — Total number of topics you've practiced
- **Top Strengths** — Your highest proficiency topics (green indicators)
- **Focus Areas** — Topics needing improvement (yellow indicators)
- **Recurring Weaknesses** — Patterns that keep appearing (red indicators with occurrence count)
- **Recent Session** — Last session summary

### Your Next Session

AI-derived recommendations for your next practice session:
- **Plan Summary** — One-line description of the session focus
- **Topic Cards** — Each recommended topic shows:
  - Topic name
  - Role badge (warmup/focus/twist)
  - Proficiency bar with color coding
  - Rationale explaining why this topic was selected

## Security

- **Localhost-only**: The server binds to `127.0.0.1` and is not accessible from external networks.
- **No telemetry**: No data is sent to external services.
- **XSS prevention**: All dynamic content is HTML-escaped.
- **Self-contained**: No external CDN or asset requests.

## Architecture

The web package is a composition root that:
1. Resolves configuration (data directory, port)
2. Constructs a `LocalFileStorageAdapter` from `@ibai/storage`
3. Calls `assess()` from `@ibai/core` (reads storage once)
4. Calls `plan()` from `@ibai/core` (pure sync, no storage read)
5. Renders the combined view as HTML or JSON

No business logic lives in the web package—it delegates entirely to `@ibai/core`.
