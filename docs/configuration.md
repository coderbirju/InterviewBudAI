# Configuration reference

Startup settings come from environment variables and command-line flags.
Keys are only ever read from the environment, never stored by the app. The
frozen CLI also reads the data folder, Anthropic and Ollama variables.

## Where settings come from

- **`.env` file:** `npm start` reads `.env` in the repo folder (the release
  zip reads `.env` in the unzipped folder). The path is fixed; it does not
  depend on where you start from. A `.env` that cannot be read prints a
  warning and the app starts without it.
- **Your shell:** variables you `export` win over `.env`.
- **Command-line flags** (when you run the server directly) win over both:
  `node packages/web/dist/server-bin.js --data-dir=/path --port=8080`
  (after `npm start` or `npm run build`).
- **Docker:** Compose reads `.env` only to fill in `compose.yaml`. The file
  is never passed into the container. See [Docker](docker.md).

Restart the app after a change. **Settings → Configuration reference** lists
the variables the server reads and which ones are set (never their values).

## Variables

| Variable | What it does | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` / `IBAI_ANTHROPIC_API_KEY` | Anthropic API key (the `IBAI_` one wins). Never commit it. | none |
| `IBAI_ANTHROPIC_MODEL` | Anthropic model name. Required with a key. | none |
| `IBAI_OPENAI_BASE_URL` | OpenAI-compatible base URL, ending in `/v1`. | none |
| `IBAI_OPENAI_MODEL` | OpenAI-compatible model id. | none |
| `IBAI_OPENAI_API_KEY` | Optional key, sent to any OpenAI-compatible base URL. | none |
| `OPENAI_API_KEY` | Used only for `https://api.openai.com`. | none |
| `IBAI_OPENAI_TIMEOUT_MS` | OpenAI-compatible request timeout in ms (kept between 5000 and 600000). | `120000` |
| `IBAI_OLLAMA_MODEL` | Ollama model name. | none |
| `IBAI_OLLAMA_URL` | Ollama address. | `http://127.0.0.1:11434` |
| `IBAI_DATA_DIR` | Your data folder. Not created for you when you set it. | `~/.interviewbudai/data` (created on first run) |
| `IBAI_WEB_PORT` | Port. Under Docker, the port on your computer. | `4173` |
| `IBAI_LEETCODE_FETCH` | `off`/`0`/`false` or `on`/`1`/`true` pins the problem statement fetch. Blank: the Settings toggle decides. See [Problem statements](problem-statements.md). | the Settings toggle (on) |
| `IBAI_HOST_DATA_DIR` | Docker only: the folder on your computer mounted as the data folder. | `IBAI_DATA_DIR`, else `~/.interviewbudai/data` |
| `IBAI_UID` / `IBAI_GID` | Docker Engine on Linux: your `id -u` / `id -g`. | `1000` |
| `IBAI_BIND_HOST` | Listen address: `127.0.0.1` or `::1`. See the warning below. | `127.0.0.1` |

Which provider is used when several are set: see
[AI providers](providers.md#when-several-are-set).

The data folder is chosen in this order: `--data-dir` flag, `IBAI_DATA_DIR`,
the folder you picked on the Data page (saved in
`~/.interviewbudai/config.json`), then the default. See
[Your data](data.md#how-the-folder-is-chosen).

## Set by the Docker image only

`IBAI_CONTAINER`, `IBAI_PUBLIC_PORT` and `IBAI_BIND_HOST=0.0.0.0` are set by
the Docker image and `compose.yaml`. The app accepts `0.0.0.0` only together
with `IBAI_CONTAINER=1`.

**Never set these outside Docker.** On a normal computer they make the app
listen on all network interfaces with **no authentication** (only a startup
warning). Under Docker, Compose publishes the port on `127.0.0.1` only, so
the app stays off your network.
