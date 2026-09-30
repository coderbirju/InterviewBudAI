# ADR 0011 — Local AI via Docker Model Runner (compose-up experience)

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Founder, Architect
- **Supersedes:** —
- **Amends:** `team-charter.md` §6.3 (one-line amendment);
  `00-project-context.md` principle 2 (default model in the
  optional Compose setup); ADR 0002 D3 (additive optional
  `CompletionOptions.responseFormat`); ADR 0005 D7 ("OpenAI adapter is
  FUTURE" → scheduled here); the #58 localhost-hardening model (ADR 0008 W2:
  bind host + Host allowlist port become configurable, D2); ADR 0008 D4
  Wave 3 "OpenAI-compatible provider" (settled here).

## Context

Today a user must bring a cloud key (Anthropic) or install and run Ollama
before the Quiz Master works. The founder wants a **one-command local
experience**: `docker compose up` starts the web app **and** a local model,
with no account and no key, on an ordinary **8 GB RAM** laptop.

Docker Model Runner (DMR) serves models from Docker Hub's `ai/` namespace
through an **OpenAI-compatible** API, and Compose can declare models next to
services and inject the endpoint and model name into a service's environment.
That makes one new adapter — an OpenAI-compatible chat-completions provider —
enough for DMR, and it also covers OpenAI, LM Studio, vLLM and llama.cpp's
server.

Constraints: charter §5.2 (interface/tech change ⇒ ADR), §6.2 (no shipped
answers), §6.3 (no hardcoded/required model), §6.4 (no mandatory network
calls), §7.2 (no committed secrets), §7.3 (model output untrusted); the #58
protections (127.0.0.1 bind, Host allowlist, same-origin, JSON-only `/api`,
CSRF on `/setup`); ADR 0005 w2d (server owns the data dir); ADR 0009 D4.

ARCC was queried through the arcc CLI fallback because `search_arcc` was not
registered in this session; it returned no guidance for container network
binding / API-key handling, so standard practice is applied (least exposure,
env-only secrets, defense in depth).

Founder decisions (2026-09-29), verbatim intent:

- Ship a **default, swappable, optional** local model in the Compose file.
- Target **8 GB RAM** machines: a small model, compensated by the user's own
  note as grounding context.
- **No benchmarking now** — pick a sensible default from verified tags; users
  change it by editing `compose.yaml` (the Dockerfile only if ever needed).

## Verified platform facts (web, 2026-09-29)

Checked on docs.docker.com and Docker Hub (URLs in References). No Docker
command was run and no model was pulled. **Unverified** items are marked.

- **Platforms [R1]:** macOS on Apple silicon; Windows amd64 with NVIDIA
  (driver ≥ 576.57) and Windows arm64 with Qualcomm Adreno 6xx+ (OpenCL);
  Linux on **Docker Engine** with CPU, CUDA, ROCm or Vulkan backends.
  Intel Macs are not listed, so they are probably unsupported
  (**inferred**).
- **Docker Desktop minimum version: UNVERIFIED.** No current page states one.
  Release notes [R6] say that from **4.71.0** Model Runner is "disabled by
  default and must be explicitly enabled in Settings". 4.72.0 added
  `/responses`.
- **Enabling it [R2]:** Docker Desktop → Settings → **AI** → **Enable Docker
  Model Runner**. **Enable host-side TCP support** is optional and has a
  port field; the default Desktop port is **unverified**. From the CLI:
  `docker desktop enable model-runner --tcp <port>` [R3].
- **Linux [R2]:** `apt-get install docker-model-plugin` (or `dnf`), then
  check with `docker model version`. TCP is on by default on port
  **12434**. The docs say "Docker Engine"; that this includes Engine CE is
  **inferred**.
- **Endpoints [R3]:**
  - In a container on Docker Desktop: `http://model-runner.docker.internal`.
  - On the host: `http://localhost:12434`, which needs TCP support.
  - In a container on Docker Engine: `http://172.17.0.1:12434`. The docs warn
    this address may not be available in Compose; the fix is
    `extra_hosts: model-runner.docker.internal:host-gateway`, then
    `http://model-runner.docker.internal:12434/`.
  - OpenAI base URL: `…/engines/v1`. The engine segment is optional, as in
    `/engines/llama.cpp/v1/…`.
  - Routes: `GET /models`, `GET /models/{ns}/{name}`, and `POST
    /chat/completions`, `/completions`, `/embeddings`.
- **JSON mode [R3]:** DMR documents `response_format: {"type":
  "json_object"}` as supported. It does **not** mention `json_schema`.
  llama.cpp's server accepts `json_schema` / schema-constrained output
  [R7], so it probably also works through DMR, but that is **inferred and
  unverified**. This ADR relies on `json_object` only.
- **Context [R4]:** llama.cpp in DMR defaults to **4096** tokens. Change it
  with `docker model configure --context-size N` or Compose `context_size`.
- **Compose [R5]:** requires Docker Compose **v2.38 or later**.
  - Top level: `models: <name>: { model (required), context_size,
    runtime_flags: [...] }`, plus `x-*` extensions.
  - Service short syntax: `models: [llm]` injects `LLM_URL` and `LLM_MODEL`
    (the key uppercased, `-`→`_`, plus `_URL` / `_MODEL`).
  - Service long syntax: `models: { llm: { endpoint_var: …, model_var: … } }`.
  - The spec page [R8] lists `model`, `context_size` and `runtime_flags`. It
    shows `endpoint_var` in an example but never mentions `model_var`, a gap
    between the two pages. [R5] is taken as authoritative, and PR B's
    `docker compose config` check must confirm it.
  - The older `provider: type: model` service still exists [R9], and the
    docs say to use the top-level `models` element instead. It is not
    formally marked deprecated. This ADR uses `models:`.
- **Docker Hub `ai/` tags, ~3–4B at Q4 [R10]:**

  | Tag | Size | Notes |
  |---|---|---|
  | `ai/qwen3:4b-instruct-2507-q4_K_M` | ~2.50 GB | non-thinking instruct; `ai/qwen3:latest` = `8b-q4_K_M` (5.0 GB); `4b` = thinking variant |
  | `ai/qwen2.5:3B-Q4_K_M` | ~1.93 GB (card: 1.79 GB) | `latest` = 7B |
  | `ai/llama3.2:3B-Q4_K_M` | ~2.02 GB (card: 1.87 GB) | = `latest`; `3B-Q4_0` 1.78 GB |
  | `ai/gemma3:4b-q4_K_M` | ~3.34 GB | `latest` = 12B (8.15 GB); `4B-Q4_0` 2.36 GB; Hub marks tags "inactive" (meaning **unverified**) |
  | `ai/phi4` | 14B only (~9.05 GB Q4_K_M) | **`ai/phi4-mini` does not exist** (404) |

  The API sizes are in bytes. Newer gemma3/qwen3 tags are lowercase, and the
  uppercase ones are older, separate artifacts.

## Decisions

### D1 — `OpenAICompatibleProvider` in `packages/providers`

- New adapter `OpenAICompatibleProvider implements LlmProvider` (Node
  `fetch`, no vendor SDK). Config: `baseUrl` (required; the OpenAI-style base
  that ends in `/v1`, trailing slash normalized), `model` (required),
  `apiKey` (optional → `Authorization: Bearer <key>` only when set),
  `timeoutMs`, `fetchImpl` (tests).
- Transport: `POST {baseUrl}/chat/completions`, non-streaming. System prompt
  stays a `system` message; `temperature`/`max_tokens`/`top_p`/`stop` mapped
  from `CompletionOptions`.
- **Contract amendment (ADR 0002 D3, additive):**
  `CompletionOptions.responseFormat?: 'text' | 'json'`. Adapters that cannot
  honour it ignore it. OpenAI-compatible maps `'json'` to
  `response_format: { type: 'json_object' }`; if the server answers **400**
  and the error mentions `response_format`, the adapter retries **once**
  without it and remembers that for the process (capability latch). Ollama
  MAY map it to `format: 'json'` (PR C); Anthropic ignores it. JSON mode is a
  hint, never a trust boundary — callers still parse fail-closed.
- **Timeouts:** one `AbortController` deadline covers the request and the
  body read. Default **120 s** (CPU inference + first-request model load on
  8 GB machines); `IBAI_OPENAI_TIMEOUT_MS` overrides, clamped to
  5 000–600 000 ms. (Existing adapters are unchanged here.)
- **Untrusted response:** body read with a **1 MiB** cap; must parse as JSON
  with `choices[0].message.content` a string, else reject. Usage mapped from
  `prompt_tokens`/`completion_tokens`/`total_tokens` only when numbers;
  `finish_reason` goes to `metadata`. Error messages carry the HTTP status and
  at most a short snippet, **never** the key or `Authorization` header.
- **Key safety:** if an API key is set, the base URL must be `https:`, or
  `http:` to a loopback host; otherwise the provider is not constructed and
  settings show a hint (no key over plain HTTP to the network). Without a key
  plain `http:` is allowed (DMR's in-container endpoint, LAN vLLM).
- **Env vars** (all optional; read in `config.ts`, listed in
  `.env.example` and `/api/settings` `envHelp`):
  - `IBAI_OPENAI_BASE_URL` — e.g. `https://api.openai.com/v1`,
    `http://localhost:12434/engines/v1` (DMR host TCP),
    `http://localhost:1234/v1` (LM Studio).
  - `IBAI_OPENAI_MODEL` — model id as the server names it.
  - `IBAI_OPENAI_API_KEY` > `OPENAI_API_KEY` — optional.
  - `IBAI_OPENAI_TIMEOUT_MS` — optional.
- **Provider precedence** (startServer, `resolveProviderStatus`, settings —
  one shared function): **Anthropic** (key + model) → **OpenAI-compatible**
  (base URL + model, key rule above) → **Ollama** (model) → none. Half-set
  configs yield `kind: 'none'` with a hint, as today. Rejected: an explicit
  `IBAI_PROVIDER` selector — not needed yet (Compose passes only the
  OpenAI-compatible vars into the container); can be added additively.
- **Compose injection:** the service's `models:` long syntax sets
  `endpoint_var: IBAI_OPENAI_BASE_URL` and `model_var: IBAI_OPENAI_MODEL`, so
  the app needs no DMR-specific code.

### D2 — Containerization and the localhost-hardening amendment

- **`Dockerfile`** (repo root), multi-stage:
  - *build*: official Node image (major ≥ 20.12 LTS line, exact version tag
    **and digest pinned**, charter §7.1), `npm ci`, `npm run build` (TS +
    SPA), then `npm prune --omit=dev` (or a clean `npm ci --omit=dev`).
  - *runtime*: same Node line, `-slim`; copies only `package*.json`,
    `node_modules`, each package's `dist/` and the web `dist-ui/`; no source,
    no `.env`. Runs as the image's non-root **`node`** user (uid 1000).
    `CMD ["node", "packages/web/dist/server-bin.js"]` (not `start.mjs`: no
    build at runtime). `ENV IBAI_BIND_HOST=0.0.0.0 IBAI_CONTAINER=1
    IBAI_DATA_DIR=/data HOME=/home/app`; `/home/app` is created and owned by
    the runtime user, and stays writable when Compose overrides `user:` with
    another uid. `EXPOSE 4173`.
  - `HEALTHCHECK` with Node's built-in `fetch` against the existing
    **`GET /api/config`** on `http://127.0.0.1:4173` (no curl in slim).
- **`.dockerignore`**: `node_modules`, `**/dist`, `**/dist-ui`, `.git`,
  `.env*` (keep `.env.example` out too), `.claude`, coverage, logs, any local
  data folders.
- **Bind host** — `IBAI_BIND_HOST` (new; `resolveHost()` stops being a
  constant):
  - default and normal value `127.0.0.1`; `::1` also accepted;
  - `0.0.0.0` **only** when `IBAI_CONTAINER=1` is also set (the Dockerfile
    sets it); otherwise the server **refuses to start** with a clear
    message. Any other value → refuse to start. The banner prints a warning
    whenever the bind is not loopback.
  - Rationale: inside a container, loopback is unreachable from the
    published port, so the container must listen on all of its own
    interfaces; exposure to the host network is controlled by Compose's port
    publishing (below), not by the app.
- **Host allowlist port**: `IBAI_PUBLIC_PORT` (new; defaults to the listen
  port).
  - The accepted hostnames stay loopback-only: `127.0.0.1`, `localhost` and
    `[::1]`. **No** free-form `IBAI_ALLOWED_HOSTS` (rejected: it would invite
    LAN exposure and reopen DNS rebinding).
  - **Public port:** loopback hosts are allowed for every request. This is
    the only port the **same-origin (Origin / Sec-Fetch-Site) check**
    accepts, so all state-changing requests go through it.
  - **Listen port** (4173 inside the container, when it differs from the
    public port): loopback hosts are allowed for **non-mutating requests
    only**, so the `HEALTHCHECK` works. Mutating requests on it get 403.
  - **What this does and does not protect.** The Host and Origin checks stop
    **browser**-borne attacks: DNS rebinding and cross-site requests. They do
    **not** stop a LAN client, which can send any `Host` it likes. LAN
    isolation comes from the Compose publish on `127.0.0.1:` below; the app
    bind address and the allowlist are defense in depth only.
- **Compose publishing:** `ports: ["127.0.0.1:${IBAI_WEB_PORT:-4173}:4173"]`
  only, with `IBAI_PUBLIC_PORT: ${IBAI_WEB_PORT:-4173}` so the allowlist
  matches the browser's `Host`. Never `0.0.0.0` / bare `4173:4173`.
  - **Linux Engine:** loopback-published ports were reachable from other
    hosts on the local network on older Docker Engine releases. The minimum
    is **Docker Engine ≥ 28.0**, which is **not verified here**; PR B
    verifies it and records it in the README, or lists it as a known
    limitation. Docker Desktop is not affected by this.
- **Linux Engine endpoint:** Compose injects the endpoint through
  `endpoint_var`. PR B checks that it is reachable on Linux Engine. If it is
  not, add `extra_hosts: ["model-runner.docker.internal:host-gateway"]`, the
  documented workaround [R3], in a Linux-only override file, never in the
  Desktop default path.
- Unchanged: Origin/Sec-Fetch-Site rules, JSON-only `/api` mutations, the
  `/setup` CSRF token, body caps, security headers, request timeouts.

### D3 — Data: host bind mount, pinned `/data`

- **Location under Docker.** The container's data dir comes from
  **`IBAI_HOST_DATA_DIR`**, defaulting to
  `${HOME}/.interviewbudai/data` (the canonical default, ADR 0008 D3). It
  is bind-mounted at `/data`, and the image sets `IBAI_DATA_DIR=/data`. The
  app's own `~/.interviewbudai/config.json` is **not** used to choose the
  folder. A user who picked a custom folder at `/setup` or `/data` outside
  Docker therefore gets the default folder under Docker until they set
  `IBAI_HOST_DATA_DIR`; see the mismatch banner below.
  - Compose documents nested interpolation (`${A:-${B}}`) but does **not**
    document `~` expansion [R12], hence `${HOME}`.
  - Windows users (no `HOME`) set `IBAI_HOST_DATA_DIR`.
- **Mount options.** The default `compose.yaml` uses the long syntax with
  `bind.create_host_path: true` [R11], so on Docker Desktop (macOS /
  Windows) a plain `docker compose up` creates the folder and works on the
  first run.
  - **Linux:** there Docker creates a missing folder as **root**, and the
    non-root app then cannot write to it. So a `compose.linux.yaml` override
    sets `create_host_path: false`, and the docs tell Linux users to run
    `mkdir -p -m 700 ~/.interviewbudai/data` first.
  - **No named-volume fallback** (rejected: it would split the user's data
    across two places, the #60 failure mode).
- **Writability check on boot.** Inside a container (`IBAI_CONTAINER=1`),
  the app checks on boot that `/data` is writable (a temp file create and
  remove).
  - If it is not, it logs a clear error and serves an error page / `/data`
    state with the fix: the ownership and `mkdir` steps below. It never
    falls back silently to another folder.
- **Pinned, with the Docker source shown.** `compose.yaml` passes
  `IBAI_HOST_DATA_DIR` into the container as a **display-only** variable. It
  is never used as a path inside the container.
  - `/data` shows "Pinned by Docker (`IBAI_HOST_DATA_DIR=<host path>`)" and
    never offers switching. The switching refusal itself is already
    implemented (ADR 0005 w2d, ADR 0009 D1).
  - To use another folder, the user changes `IBAI_HOST_DATA_DIR`.
- **Mismatch banner.** Compose also mounts
  `${HOME}/.interviewbudai/config.json` **read-only** at a fixed path
  (`/host-config/config.json`); it is optional, and a missing file is fine.
  - If that file parses (same untrusted validation as today) and its
    `dataDir` differs from the display-only `IBAI_HOST_DATA_DIR`, then `/data`
    and Home show a banner: "Your /setup choice outside Docker is `<path>`
    (saved in `~/.interviewbudai/config.json`; `npm start` ignores it when
    `IBAI_DATA_DIR` is set)…"
    *(Amended 2026-09-30: wording replaced per PR #79, from the #78 review.)*
  - The container cannot read that other folder, so the banner shows only
    the path and never counts its notes.
  - Implementation note for PR B: a bind mount of a missing file would make
    Docker create a directory there. Mount the parent `${HOME}/.interviewbudai`
    read-only at `/host-config` instead if needed; either way the mount is
    read-only and missing content is tolerated.
- **Container paths in the UI:** `/data` and backup messages show container
  paths such as `/data/.backups/…`. Under Docker, a label next to them maps
  `/data` to the host path (`IBAI_HOST_DATA_DIR`).
- **File ownership.**
  - On Linux Docker Engine, files are written with the container uid.
    `compose.yaml` sets `user: "${IBAI_UID:-1000}:${IBAI_GID:-1000}"`, and
    Linux users whose uid is not 1000 export `IBAI_UID=$(id -u)
    IBAI_GID=$(id -g)`.
  - **Rootless Docker / Podman** users should set `IBAI_UID`/`IBAI_GID` to
    match or drop `user:`, because uids are remapped there.
  - Docker Desktop is expected to map ownership to the host user, but that
    is **unverified**; PR B checks it on macOS.
  - Permission errors surface through the writability check above.
- **ADR 0009 D4.** There is no on-disk format change and no change to
  non-Docker resolution. Under Docker, however, the location is resolved
  **differently** (`IBAI_HOST_DATA_DIR`, not `config.json`). That is covered
  by the recovery path (mismatch banner + pinned label) and a CHANGELOG
  **`### Breaking changes`** note in PR B ("Under Docker the data folder
  comes from `IBAI_HOST_DATA_DIR` (default `~/.interviewbudai/data`), not
  from the folder chosen at /setup"). No migration.

### D4 — Default model and small-model robustness

- **Default** (in `compose.yaml` only, never in code): **`ai/qwen3:4b-instruct-2507-q4_K_M`**
  (~2.5 GB download, ≤ 3 GB). Its **estimated** total resident memory with
  `context_size` 4096 is **~3.5 GB** (an estimate, not measured). Users with
  tight RAM switch to `ai/qwen2.5:3B-Q4_K_M`. It follows instructions well and is reliable at JSON,
  and it is the non-thinking variant, so it emits no reasoning preamble that
  would break the JSON verdict. Chosen from the verified tags with **no
  benchmarking** (founder decision).
  - Alternatives, recorded in the Compose file as comments:
    `ai/qwen2.5:3B-Q4_K_M` (~1.9 GB, the lightest; for tight RAM) and
    `ai/llama3.2:3B-Q4_K_M` (~2.0 GB).
  - Rejected: `ai/gemma3:4b-q4_K_M` (~3.3 GB, over budget, and its Hub status
    is unclear); `ai/phi4` (14B only; `phi4-mini` is not published under
    `ai/`); bare `ai/qwen3` or `ai/qwen3:4b` (8B, or the thinking variant).
  - Tags are pinned exactly and never use `latest`, because `latest` moves:
    it points to 7B, 8B and 12B on those repos.
- `context_size: 4096` — fits 8 GB alongside the app; the verdict prompt is
  small (one problem + the user's note + the current question's turns).
- Swapping: edit the `model:` line (any `ai/…` tag, or any model DMR can
  pull), or drop the `models:` block and set another provider's env vars.
  The app never names a model; §6.3 is honoured because nothing is
  hardcoded or required — the default is a user-editable config value.
- **Robustness (PR C):**
  - Verdict calls send `responseFormat: 'json'` and a bounded `maxTokens`.
  - **Prompt compaction:** keep persona + rules short; include only the
    current question's turns; cap the injected user note (≈ 4 000 chars,
    trimmed with a marker) so it fits `context_size`.
  - The user's own note stays the grounding input (ADR 0007 D2) — no
    reference solutions are added (D7).
  - **One retry** on a malformed verdict (same request plus a terse "reply
    with only the JSON object" reminder); a second failure fails closed
    exactly as today (no writes, clear error). The A3 one-nudge coercion is
    unchanged.
  - **"Model loading / unavailable" state:** connection refused, timeout,
    HTTP 503, or a DMR "loading" error map to a fixed, friendly message
    (quiz + settings): "The local model is starting or unavailable — try
    again in a moment." No writes on that path.
  - When the D5 label is "Docker Model Runner (local)", a connection failure
    adds: "Is Docker Model Runner enabled in Docker Desktop → Settings → AI?"

### D5 — Settings / test connection

- `SettingsProviderKind` gains `'openai'`. `GET /api/settings` reports
  `model`, `endpoint` (origin only, via existing `sanitizeEndpoint`),
  `keyConfigured`, and a display `label`:
  **"Docker Model Runner (local)"** when the base URL host is
  `model-runner.docker.internal` (any port), or a loopback host or
  `172.17.0.1` on port `12434` with a path under `/engines/` (see the
  endpoints in Verified facts). Otherwise it shows **"OpenAI-compatible"**.
- **Injected endpoint format: unverified.** It is not documented whether the
  URL injected through `endpoint_var` already ends in `/engines/v1`, only
  in `/engines/`, or is the bare host. So the provider and settings
  **normalize** it: trailing slashes are dropped and `/v1` is appended when
  the path is `/engines` or `/engines/<engine>`. A bare DMR host becomes
  `…/engines/v1`. PR B's CI and README record the observed form.
- `POST /api/settings/test-provider`: `GET {baseUrl}/models` (Bearer only
  when a key is set), same single deadline + rate limit as today; ok when the
  response is valid JSON whose `data[].id` list contains the configured
  model. Errors mapped to fixed text (never echoed); "model not listed" and
  the D4 loading state get their own messages.
- New env vars appear in `envHelp` (set ✓/✗ only; the key is never
  returned).

### D6 — CI

- Existing `verify` job unchanged; the non-Docker path needs no Docker.
- New job `docker` (ubuntu-latest):
  1. `docker build` of the Dockerfile.
  2. `docker compose -f compose.yaml config -q` (validates the `models:`
     syntax; install a pinned Compose plugin version if the runner's is
     older than v2.38, the minimum in Verified facts).
  3. **Smoke** with a standalone `compose.ci.yaml` (same Dockerfile, **no**
     `models:`) plus a tiny fake OpenAI-compatible server
     (`scripts/ci/fake-openai.mjs`, Node built-ins, serves `/v1/models` and
     `/v1/chat/completions`) — DMR is not available on GitHub runners. Wait
     for `healthy`; assert `GET /api/settings` (Host `localhost:<port>`)
     reports `openai`; `POST /api/settings/test-provider` ok; `Host:
     evil.example` → 403; a note write lands in the bind-mounted temp dir
     owned by the runner uid.

### D7 — Explicitly out of scope

- Shipping reference solutions/answers — §6.2 unchanged. (A separate founder
  decision is pending on a **user-authored** "reference approach" note
  field; not part of this ADR.)
- Benchmarking models; GPU/backend tuning; streaming.
- Publishing images to a registry (later; needs an ADR 0009 D5 amendment).
- Any change to the non-Docker `npm start` experience beyond the new
  optional env vars.

## Consequences

- **Positive:** `docker compose up` gives a keyless, local quiz on an 8 GB
  machine; one adapter also unlocks OpenAI, LM Studio, vLLM and llama.cpp.
- **Positive:** the #58 protections still hold in the container; the only
  new exposure is an explicitly loopback-published port (LAN isolation
  comes from that publish; the Host allowlist stops browsers, not LAN
  clients).
- **First run:** on Docker Desktop, `docker compose up` works with no
  preparation (`create_host_path: true`). Linux users must
  `mkdir -p -m 700 ~/.interviewbudai/data` and use `compose.linux.yaml`,
  otherwise the root-owned-folder problem hits; the boot writability check
  turns that into a clear error instead of silent failures.
- **Tradeoff:** a custom folder chosen at `/setup` outside Docker is not
  picked up automatically under Docker; the mismatch banner tells the user
  what to set.
- **Tradeoff:** a 3–4B Q4 model judges less reliably than a frontier model;
  mitigated by JSON mode, the user's note as grounding, one retry, and
  fail-closed parsing. Users can swap the model.
- **Tradeoff:** principle 2 now allows an opinionated default in packaging;
  code and the non-Docker path remain model-agnostic.
- **Tradeoff:** the Docker path needs Model Runner (Desktop on Apple silicon
  or a supported Windows GPU, or Linux Engine with `docker-model-plugin`)
  and Compose ≥ v2.38. Windows users must set `IBAI_HOST_DATA_DIR`. On other
  machines, users run `npm start` or point the app at any OpenAI-compatible
  server.

## Prerequisites (Docker path)

- Docker Desktop with **Model Runner enabled** (Settings → AI → Enable
  Docker Model Runner), on supported hardware (Apple silicon Mac; Windows
  with NVIDIA or Qualcomm Adreno GPU), **or** Linux Docker Engine
  (≥ 28.0, see D2) with `docker-model-plugin`.
- Docker Compose **≥ v2.38**.
- ~8 GB RAM (default model ~3.5 GB estimated; see D4).
- Linux only: `mkdir -p -m 700 ~/.interviewbudai/data` and matching
  `IBAI_UID`/`IBAI_GID`.

## Roadmap (small serial PRs, each with a `code-review` pass)

| PR | Scope | Depends on |
|---|---|---|
| A | `OpenAICompatibleProvider` + `responseFormat` option + tests (fake fetch); config/env vars + precedence; settings kind/label/test-connection; `.env.example`, README, CHANGELOG `### Added` | this ADR |
| B | Dockerfile (`HOME=/home/app`), `.dockerignore`, `compose.yaml` (default model, endpoint_var/model_var, loopback publish, `/data` bind with `create_host_path: true`, read-only config mount, display-only `IBAI_HOST_DATA_DIR`, `user:`) + `compose.linux.yaml`; `IBAI_BIND_HOST`/`IBAI_CONTAINER`/`IBAI_PUBLIC_PORT` (Origin on public port only) + tests; `/data` writability check, pinned-by-Docker label, mismatch banner; CHANGELOG `### Breaking changes` note (D3); CI `docker` job with fake server; README "Run with Docker" | A |
| C | Quiz small-model robustness: JSON mode, one retry, prompt compaction/note cap, loading/unavailable state (quiz + settings) | A |

## References

- [R1] https://docs.docker.com/ai/model-runner/ (source:
  https://raw.githubusercontent.com/docker/docs/main/content/manuals/ai/model-runner/_index.md)
- [R2] https://docs.docker.com/ai/model-runner/get-started/
- [R3] https://docs.docker.com/ai/model-runner/api-reference/
- [R4] https://docs.docker.com/ai/model-runner/configuration/
- [R5] https://docs.docker.com/ai/compose/models-and-compose/
- [R6] https://docs.docker.com/desktop/release-notes/
- [R7] https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- [R8] https://docs.docker.com/reference/compose-file/models/
- [R9] https://docs.docker.com/compose/how-tos/provider-services/
- [R10] https://hub.docker.com/v2/namespaces/ai/repositories/<name>/tags?page_size=100
  and https://hub.docker.com/v2/repositories/ai/<name>/ for qwen3, qwen2.5,
  llama3.2, gemma3, phi4 (https://hub.docker.com/u/ai)
- [R11] https://docs.docker.com/reference/compose-file/services/ (volumes:
  short syntax creates missing host dirs; `create_host_path` default `true`;
  `user`; `healthcheck`)
- [R12] https://docs.docker.com/reference/compose-file/interpolation/
  (nested `${A:-${B}}`; no `~` expansion documented)
