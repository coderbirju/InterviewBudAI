# AI providers

The app needs an AI provider for the Quiz and the intuition check. The
catalog, notes and analytics work without one.

Put the settings in a `.env` file in the repo folder (the folder with
`package.json`). `npm start` reads it. Variables you `export` in your shell
win over the file. Restart the app after a change. Never commit your `.env`.
[`.env.example`](../.env.example) lists every variable.

## Anthropic (Claude)

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
IBAI_ANTHROPIC_MODEL=claude-opus-5-5
```

- `ANTHROPIC_API_KEY` or `IBAI_ANTHROPIC_API_KEY`: your key. If both are
  set, `IBAI_ANTHROPIC_API_KEY` is used.
- `IBAI_ANTHROPIC_MODEL`: the model name. It is required; there is no
  default.

## OpenAI-compatible servers

This covers OpenAI and any server with the OpenAI Chat Completions API, such
as LM Studio, vLLM, llama.cpp's server, Ollama's `/v1` and Docker Model
Runner.

- `IBAI_OPENAI_BASE_URL`: the base URL, the one that ends in `/v1`.
- `IBAI_OPENAI_MODEL`: the model id, exactly as the server names it.
- `IBAI_OPENAI_API_KEY`: optional. Local servers usually need none.
- `OPENAI_API_KEY`: used only when the base URL is `https://api.openai.com`,
  so a key in your shell never goes to another server.
- `IBAI_OPENAI_TIMEOUT_MS`: optional request timeout in milliseconds
  (default 120000, kept between 5000 and 600000).

With a key, the base URL must be `https`, or `http` to a loopback address
(localhost, 127.x, ::1). Otherwise the provider is skipped and Settings shows why. Do not
put a username or password in the URL.

OpenAI:

```bash
IBAI_OPENAI_BASE_URL=https://api.openai.com/v1
IBAI_OPENAI_MODEL=your-model-name
OPENAI_API_KEY=sk-your-key-here
```

LM Studio:

```bash
IBAI_OPENAI_BASE_URL=http://localhost:1234/v1
IBAI_OPENAI_MODEL=your-model-name
```

vLLM or llama.cpp: the same two lines, with your server's address, for
example `http://localhost:8000/v1` or `http://localhost:8080/v1`.

## Ollama

Start Ollama (`ollama serve`) and pull a model (`ollama pull llama3`) first.

```bash
IBAI_OLLAMA_MODEL=llama3
```

- `IBAI_OLLAMA_MODEL`: the model name. Required.
- `IBAI_OLLAMA_URL`: optional. Default `http://127.0.0.1:11434`.

## Docker Model Runner

With `docker compose up` you set nothing: Compose passes the model to the
app. See [Docker](docker.md).

To use Docker Model Runner with `npm start` instead, turn on its host TCP
access in Docker Desktop, then:

```bash
IBAI_OPENAI_BASE_URL=http://localhost:12434/engines/v1
IBAI_OPENAI_MODEL=ai/qwen3:4b-instruct-2507-q4_K_M
```

## When several are set

The first complete one wins:

1. Anthropic: a key **and** `IBAI_ANTHROPIC_MODEL`.
2. OpenAI-compatible: `IBAI_OPENAI_BASE_URL` **and** `IBAI_OPENAI_MODEL`.
3. Ollama: `IBAI_OLLAMA_MODEL`.

If none is complete, the Quiz and the intuition check are off. A half-set
provider (for example a key without a model) shows a hint in Settings and in
the startup message.

## Check the connection

Open **Settings** in the app. The **AI provider** card shows the provider,
the model, and whether a key is set (never the key itself). Click **Test
connection** to check that the model answers. For Anthropic this makes one
tiny call that is billed. The startup message in your terminal also names
the provider and model.
