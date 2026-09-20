# @ibai/web

Locally-hosted web front-end for InterviewBudAI's ASSESS, PLAN, and COACH capabilities.

## Overview

This package provides a thin, localhost-only web server that exposes the ASSESS, PLAN, and COACH functionality through a polished dashboard UI. It maintains **front-end parity** with the CLI—the same engine capabilities are available through both interfaces.

## Features

- **Navigation bar** — Shared top nav on all pages with links to Home, Catalog, Dashboard, and Interview
- **Home page** — Landing page at `/` with action buttons and progress summary (works for new users too)
- **Problem Catalog** — Browse 175 curated problems grouped by topic with difficulty badges, LeetCode links, and Notes links
- **Catalog-first onboarding** — New users start by exploring the catalog, then create their database to start tracking progress
- **Create database** — Simple setup flow to create and remember your data directory via browser cookie
- **Where You Stand** — View your current proficiency across topics, top strengths, focus areas, and recurring weaknesses
- **Your Next Session** — AI-derived session plan with warmup, focus, and twist topics displayed as cards with role badges and proficiency bars
- **Coaching Sessions** — Run full coaching sessions from the browser with outcome tracking and AI-generated feedback
- **JSON APIs** — Machine-readable endpoints for integration with other tools
- **Dark theme** — Modern, accessible UI with dark color scheme
- **Local-first** — All data stays on your machine; the only outbound call is to your configured Ollama endpoint
- **Cookie-based directory persistence** — Browser remembers your data directory across visits (no login required)
- **Zero-config demo** — Try the interactive interview with no LLM install required
- **Notes editor** — Capture your intuition, solution approach, time/space complexity, and mark problems as complete
- **Completion tracking** — Dashboard shows completed problems count and list; catalog shows ✓ done markers
- **Per-request data resolution** — Home and dashboard honor the cookie-specified data directory (not stale boot-time dir)

## Quick Start (Demo Mode)

Try the interactive interview demo with NO LLM install:

```bash
# Build and start
npm run build
npm --workspace @ibai/web run start
```

Open http://127.0.0.1:4173/coach and start an interview!

The demo mode uses a built-in EchoDemoProvider that simulates an interviewer by reflecting your answers into follow-up questions. It's deterministic and offline — perfect for exploring the UI.

### With Ollama (AI-Powered)

For AI-powered interviews with real language model responses:

```bash
# Install and start Ollama
ollama serve
ollama pull llama2

# Configure and start
export IBAI_OLLAMA_MODEL=llama2
npm --workspace @ibai/web run start
```

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

# With Ollama configured for coaching
IBAI_OLLAMA_MODEL=llama2 npm --workspace @ibai/web run start

# Using CLI flags
node packages/web/dist/server-bin.js --data-dir=/path/to/data --port=8080
```

## Configuration

| Setting | CLI Flag | Environment Variable | Default |
|---------|----------|---------------------|----------|
| Data directory | `--data-dir=<path>` | `IBAI_DATA_DIR` | `~/.interviewbudai/data` |
| Port | `--port=<port>` | `IBAI_WEB_PORT` | `4173` |
| Ollama URL | — | `IBAI_OLLAMA_URL` | `http://127.0.0.1:11434` |
| Ollama Model | — | `IBAI_OLLAMA_MODEL` | *(required for coach)* |

Precedence: CLI flag > environment variable > default.

### Ollama Configuration

The coach functionality requires a running Ollama instance. To enable coaching:

1. Install Ollama: https://ollama.ai
2. Start Ollama: `ollama serve`
3. Pull a model: `ollama pull llama2` (or your preferred model)
4. Set the model: `export IBAI_OLLAMA_MODEL=llama2`
5. Optionally set a custom URL: `export IBAI_OLLAMA_URL=http://localhost:11434`

If `IBAI_OLLAMA_MODEL` is not set, the coach form (GET /coach) will still display, but submitting the form will return an error instructing you to configure the model.

## Endpoints

| Path | Method | Format | Description |
|------|--------|--------|-------------|
| `/` | GET | HTML | Home/landing page with action buttons (Catalog, Interview) and progress summary |
| `/dashboard` | GET | HTML | Full dashboard with Where You Stand and Your Next Session sections |
| `/assess` | GET | HTML | Alias for `/dashboard` |
| `/catalog` | GET | HTML | Browse all 175 problems grouped by topic with LeetCode and Notes links |
| `/notes/<id>` | GET | HTML | View/edit notes for a problem. Shows setup CTA if no database exists. |
| `/notes/<id>` | POST | HTML | Save notes content. Shows 'Saved' banner on success. |
| `/setup` | GET | HTML | Form to create/select data directory |
| `/setup` | POST | HTML | Create data directory and set cookie |
| `/assess.json` | GET | JSON | AssessmentView as JSON |
| `/plan.json` | GET | JSON | SessionPlan as JSON |
| `/coach` | GET | HTML | Coaching session form (read-only, no write-back) |
| `/coach` | POST | HTML | Execute coaching session with write-back, return HTML result |
| `/coach.json` | POST | JSON | Execute coaching session with write-back, return JSON result |

Optional query parameter: `?sessionId=<id>` to assess/plan/coach for a specific session.

## Coaching Sessions

### GET /coach (Form)

Displays the current session plan as an interactive form. For each planned topic:
- Pass/Fail buttons to mark the outcome
- Optional text area for notes

This is **read-only**: no data is written until the form is submitted.

### POST /coach (HTML Result)

Accepts `application/x-www-form-urlencoded` body with:
- `outcome_<topicId>=pass|fail` for each topic you want to report
- `note_<topicId>=<text>` for optional notes
- `sessionId=<id>` (optional)

Runs the full assess → plan → coach loop with write-back:
1. Reads competency map and weakness register
2. Builds session plan from assessment
3. Sends outcomes to the LLM for coaching feedback
4. Writes session summary, updates competency map, updates weakness register

Returns an HTML page showing:
- AI-generated coaching narrative
- Identified strengths and weaknesses
- Confirmation of write-back operations

**Behavior note:** Only topics with explicitly submitted outcomes are included. Topics without an outcome selection are omitted (no fabrication).

### POST /coach.json (JSON Result)

Accepts JSON body:
```json
{
  "sessionId": "optional-session-id",
  "outcomes": [
    { "topicId": "arrays", "succeeded": true, "note": "optional note" },
    { "topicId": "graphs", "succeeded": false }
  ]
}
```

Returns the full `CoachResult` object as JSON:
```json
{
  "summary": {
    "sessionId": "...",
    "completedAt": "2026-09-10T12:00:00Z",
    "topics": ["arrays", "graphs"],
    "narrative": "AI-generated coaching feedback...",
    "strengths": ["arrays"],
    "weaknesses": ["graphs"]
  },
  "competencyMap": { "entries": { ... } },
  "weaknessRegister": { "entries": [ ... ] },
  "request": { "messages": [ ... ] }
}
```

### Error Handling

| Scenario | Status | Message |
|----------|--------|---------|  
| `IBAI_OLLAMA_MODEL` not set | 400 | "Coach requires IBAI_OLLAMA_MODEL to be set..." |
| Ollama not running (ECONNREFUSED) | 502 | "Could not connect to Ollama. Is Ollama running? Start it with 'ollama serve'." |
| Invalid JSON body | 400 | Parse error message |
| Storage error | 500 | Error message |

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

## Onboarding Flow

New users (no `ibai_data_dir` cookie) experience a welcoming onboarding:

1. **`GET /`** shows the home page with action buttons and a "Create your database" CTA (no redirect)
2. **`/catalog`** shows the full problem catalog with a prominent "Create your database" CTA
3. **`/setup`** presents a form to create/select a data directory
4. **`POST /setup`** creates the directory and sets a first-party cookie
5. **`GET /`** now shows progress summary along with action buttons (cookie is set)
6. **`GET /dashboard`** shows the full dashboard with Where You Stand and Your Next Session

The home page works for everyone—new users see the setup CTA, returning users see their progress.

## Cookie Behavior

The `ibai_data_dir` cookie stores the path to the user's data directory as a **persistent cookie** (Max-Age=31536000, ~1 year). This ensures your chosen database path survives browser restarts without requiring login. Multi-database selection is planned for a future release; currently a single path is stored.

| Attribute | Value |
|-----------|-------|
| Name | `ibai_data_dir` |
| Path | `/` |
| Max-Age | 31536000 (~1 year) |
| HttpOnly | Yes |
| SameSite | Strict |
| Secure | No (localhost http) |

**Data directory precedence** (per-request):
1. Cookie value (if set AND directory exists)
2. CLI flag `--data-dir=<path>`
3. Environment variable `IBAI_DATA_DIR`
4. Default `~/.interviewbudai/data`

The cookie enables session persistence across browser restarts without requiring login.

## Notes / Intuition Editor

The notes editor lets you capture your intuition and approach for each problem in the catalog. Access it via `/notes/<id>` (e.g., `/notes/lc-3`).

### Getting Started

1. **Create a database first** — Notes are stored in your local data directory. Visit `/setup` to create one if you haven't already.
2. **Open a problem's notes** — From the catalog (`/catalog`), click the "Notes" link for any problem.
3. **Write your intuition** — The editor provides a textarea for free-form markdown notes.
4. **Save** — Click the Save button. Your notes are persisted locally.

### Routes

| Path | Method | Description |
|------|--------|-------------|
| `/notes/<id>` | GET | View/edit notes for a problem. Shows setup CTA if no database exists. |
| `/notes/<id>` | POST | Save notes content. Requires database. |

### Storage

- Notes are stored as markdown files in `<data-dir>/notes/<id>.md`
- Each file has YAML frontmatter (id, lastUpdated) and a markdown body
- Notes are part of your **local progress data** — never committed to the repo, never uploaded
- The data directory is resolved via cookie > CLI flag > env var > default (`~/.interviewbudai/data`)

### No Database State

If you access `/notes/<id>` without having created a database:
- A friendly page is shown with a link to `/setup`
- No errors are thrown
- POST requests also show the same CTA (content is not lost — just not saved)

## Security

- **Localhost-only**: The server binds to `127.0.0.1` and is not accessible from external networks.
- **No telemetry**: No data is sent to external services (except user-configured Ollama).
- **XSS prevention**: All dynamic content is HTML-escaped.
- **Self-contained**: No external CDN or asset requests.
- **User-configured LLM**: The only outbound call is to your Ollama endpoint.

## Architecture

The web package is a composition root that:
1. Resolves configuration (data directory, port, Ollama settings)
2. Constructs a `LocalFileStorageAdapter` from `@ibai/storage`
3. Optionally constructs an `OllamaProvider` from `@ibai/providers` (if model configured)
4. Creates a handler that routes to assess/plan/coach operations
5. For GET requests: calls `assess()` + `plan()` from `@ibai/core` and renders
6. For POST /coach: calls `assess()` + `plan()` + `coach()` with write-back

No business logic lives in the web package—it delegates entirely to `@ibai/core`.
