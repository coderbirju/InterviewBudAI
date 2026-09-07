# @ibai/web

Locally-hosted web front-end for InterviewBudAI's ASSESS capability.

## Overview

This package provides a thin, localhost-only web server that exposes the ASSESS functionality. It maintains **front-end parity** with the CLI—the same engine capabilities are available through both interfaces.

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
| `/` | HTML | Where You Stand dashboard |
| `/assess` | HTML | Same as `/` |
| `/assess.json` | JSON | AssessmentView as JSON |

Optional query parameter: `?sessionId=<id>` to assess a specific session.

## Security

- **Localhost-only**: The server binds to `127.0.0.1` and is not accessible from external networks.
- **No telemetry**: No data is sent to external services.
- **XSS prevention**: All dynamic content is HTML-escaped.

## Architecture

The web package is a composition root that:
1. Resolves configuration (data directory, port)
2. Constructs a `LocalFileStorageAdapter` from `@ibai/storage`
3. Calls `assess()` from `@ibai/core`
4. Renders the `AssessmentView` as HTML or JSON

No business logic lives in the web package—it delegates entirely to `@ibai/core`.
