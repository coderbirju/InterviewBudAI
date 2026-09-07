# @ibai/cli

Command-line interface for InterviewBudAI. Thin front-end that delegates to `@ibai/core`.

## Installation

From the repo root:

```bash
npm install
npm run build
```

The CLI binary will be available as `ibai` when linked, or run directly:

```bash
node packages/cli/dist/cli.js
```

## Usage

### Assess Command

Show your current standing — strengths, focus areas, and recurring weaknesses:

```bash
ibai assess
```

### Options

#### `--data-dir <path>`

Specify a custom data directory where your progress files are stored.

```bash
ibai assess --data-dir /path/to/my/data
```

#### `--session <id>`

Include recent session context in the assessment:

```bash
ibai assess --session my-session-123
```

#### `--help`

Show help information:

```bash
ibai --help
```

## Configuration

### Data Directory Resolution

The CLI determines the data directory using this precedence:

1. **CLI flag**: `--data-dir /path/to/data`
2. **Environment variable**: `IBAI_DATA_DIR=/path/to/data`
3. **Default**: `~/.ibai/data`

### Environment Variables

| Variable | Description |
|----------|-------------|
| `IBAI_DATA_DIR` | Default data directory path |

## Output Example

```
=== Where You Stand ===

Topics tracked: 7

Top Strengths:
  - sorting: 92%
  - arrays: 85%
  - trees: 78%

Focus Areas:
  - graphs: 25%
  - dp: 33%

Recurring Weaknesses:
  - graphs (5x): BFS vs DFS confusion
  - dp (3x): Memoization patterns

Recent Session:
  Session ID: session-abc-123
  Turns: 12
  Last role: assistant
  Last activity: 2026-09-05T14:30:00.000Z
```

## Development

```bash
# Build
npm run build -w packages/cli

# Test
npm run test -w packages/cli

# Verify all (from repo root)
npm run verify
```
