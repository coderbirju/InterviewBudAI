# Docker

`docker compose up` starts the app and a local AI model through Docker Model
Runner (ADR 0011). No account and no key. The short version is in the
[README](../README.md#local-ai-with-docker-no-api-key).

## Requirements

- Docker Desktop with **Model Runner enabled**. Model Runner is off by
  default in recent Docker Desktop versions. To turn it on: open Docker
  Desktop, go to Settings → AI, check "Enable Docker Model Runner", then
  click Apply.
- Docker Compose **2.38 or later** (`docker compose version`).
- Supported hardware: an Apple silicon Mac, or Windows with an NVIDIA
  (driver 576.57 or later) or Qualcomm Adreno GPU. On Linux, Docker Engine
  with `docker-model-plugin` (below). Intel Macs are probably not supported.
- About 8 GB of RAM. The default model needs about 3.5 GB (an estimate,
  not measured).
- About 4 GB of free disk space. The default model is a 2.5 GB download
  (Docker Hub); the app image and its build add about 1 GB (an estimate).

## Start and stop

```bash
docker compose up        # then open http://localhost:4173
docker compose down      # stop and remove the containers
```

`compose.yaml` sets `restart: "no"`, so the app and the model do not start
again by themselves after a Docker restart or a reboot. Change it to
`unless-stopped` to keep it running in the background.

## Change the model

Edit the `model:` line in `compose.yaml` (use a pinned `ai/…` tag, never
`latest`), then run `docker compose up` again. Lighter options are listed in
the file, for example `ai/qwen2.5:3B-Q4_K_M` (about 1.9 GB) for tight RAM.
To use another provider instead, delete the `models:` blocks and see
[AI providers](providers.md).

## Your notes folder

Under Docker the notes folder on your computer is, in this order:

1. `IBAI_HOST_DATA_DIR`;
2. else `IBAI_DATA_DIR` (so a folder you pinned for `npm start` in `.env` is
   used here too);
3. else `~/.interviewbudai/data`, the same default as `npm start`.

Use absolute paths. A folder you picked on the Data page outside Docker is
**not** used automatically; the app shows a banner with its path. To use it,
put `IBAI_HOST_DATA_DIR=/path/to/your/folder` in a `.env` next to
`compose.yaml` and restart.

## Settings in `.env`

Compose reads a `.env` next to `compose.yaml` only to fill in
`compose.yaml`. The file is never passed into the container, so API keys in
it stay out of the app. The values it uses:

- `IBAI_HOST_DATA_DIR`: your notes folder (above).
- `IBAI_WEB_PORT`: the port on your computer, for example `8080`. The app is
  published on 127.0.0.1 only, never on your network.
- `IBAI_UID` / `IBAI_GID`: Linux Docker Engine (below).

## Windows

Always set `IBAI_HOST_DATA_DIR` (or `IBAI_DATA_DIR`) to an absolute path.
`HOME` is often unset on Windows; Compose then falls back to
`%USERPROFILE%` (not verified on Windows), and without the variable the
"other folder" banner may not show.

## Linux and Docker Engine

With Docker Engine (not Docker Desktop), create the folders as your user
first. Do this even if `IBAI_HOST_DATA_DIR` points elsewhere, because it also
creates `~/.interviewbudai`. Then use the Engine override file:

```bash
mkdir -p -m 700 ~/.interviewbudai/data
export IBAI_UID=$(id -u) IBAI_GID=$(id -g)
docker compose -f compose.yaml -f compose.engine.yaml up
```

Use Docker Engine 28.0 or newer. Older releases could expose loopback-only
published ports to other hosts on the same network (not verified here).
Rootless Docker or Podman: set `IBAI_UID` / `IBAI_GID` to match your uid
mapping.

## If the quiz cannot reach the model

Check that Model Runner is on: Docker Desktop → Settings → AI → Enable Docker
Model Runner. On Docker Engine, install the `docker-model-plugin` package
(`docker model status` checks it). In the app, **Settings → Test connection**
tells you whether the model is available.
