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

### Plan Command

Show your recommended next session plan based on your assessment:

```bash
ibai plan
```

The plan command uses your assessment data to generate a personalized session plan with:
- **Warmup**: Your strongest topic to build confidence
- **Focus**: Gap areas that need the most attention
- **Twist**: A recurring weakness to stretch your skills

### Coach Command

Run a coaching session with AI evaluation. The model evaluates your typed answers and returns per-topic verdicts; the engine fails closed on malformed model output (no storage writes).

```bash
# Ollama (local-first)
ibai coach --model llama3 --answer "Use a hash map for O(1) lookup" --answer "BFS for shortest path"

# Anthropic
IBAI_ANTHROPIC_API_KEY=your-key IBAI_ANTHROPIC_MODEL=<model-name> ibai coach --provider anthropic --answer "..."
```

**Provider REQUIRED:** Anthropic (`IBAI_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY`, plus `IBAI_ANTHROPIC_MODEL`) or Ollama (`--model` / `IBAI_OLLAMA_MODEL`). Without `--provider`, Anthropic is chosen if its key + model are set, else Ollama if a model is set.

`--answer` is repeatable; answers map **in order** to the topics of your session plan (see `ibai plan`). Fewer answers than topics proceeds with a warning.

### Options

#### `--data-dir <path>`

Specify a custom data directory where your progress files are stored.

```bash
ibai assess --data-dir /path/to/my/data
ibai plan --data-dir /path/to/my/data
```

#### `--session <id>`

Include recent session context in the assessment:

```bash
ibai assess --session my-session-123
```

#### `--ollama-url <url>`

Ollama endpoint URL (coach command only):

```bash
ibai coach --model llama3 --ollama-url http://localhost:11434
```

Default: `http://127.0.0.1:11434` (or `IBAI_OLLAMA_URL` env var)

#### `--model <name>`

Ollama model name (coach command, Ollama provider):

```bash
ibai coach --model llama3
```

Can also be set via `IBAI_OLLAMA_MODEL` environment variable.

#### `--provider <name>`

`anthropic` or `ollama` (coach command only). Default: auto-detect from env.

#### `--answer <text>`

Your answer for the next plan topic (coach command only, repeatable).

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
| `IBAI_OLLAMA_URL` | Ollama endpoint URL (default: `http://127.0.0.1:11434`) |
| `IBAI_OLLAMA_MODEL` | Ollama model name (required for coach if `--model` not provided) |
| `IBAI_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` | Anthropic API key (never commit) |
| `IBAI_ANTHROPIC_MODEL` | Anthropic model name |

## Output Examples

### Assess Output

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

### Plan Output

```
=== Your Next Session ===

  warmup  sorting  ( 92%)  strongest area (92%) — warm up here
   focus  graphs   ( 25%)  lowest proficiency (25%)
   focus  dp       ( 33%)  lowest proficiency (33%) with 3 recurring misses
   twist  trees    ( 45%)  recurring weakness: 2 misses — stretch

Summary: Focus on 2 gap topics; warm up on sorting; stretch on trees.
```

### Coach Output

```
=== Coaching Session ===

Session ID: cli-1725984000000

Topics covered: 3
Plan summary: Focus on graphs and dp; warm up on sorting.

Session Recap:
Great session! You showed strong problem-solving skills on sorting.
Graphs need more practice — focus on BFS vs DFS traversal patterns.

--- Persistence ---
Saved session summary
Competency entries: 3
Weakness entries: 1
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
