#!/usr/bin/env bash
# Docker smoke test (ADR 0011 D6). Runs compose.ci.yaml (the real Dockerfile +
# scripts/ci/fake-openai.mjs in place of Docker Model Runner) and checks the
# container end to end. No real model, no secrets, no network beyond the
# image pulls. Needs docker (Compose >= 2.38), curl and jq.
#
#   bash scripts/ci/docker-smoke.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

PORT="${SMOKE_PORT:-4180}"
BASE="http://127.0.0.1:${PORT}"
HOST_HDR="Host: localhost:${PORT}"
ORIGIN_HDR="Origin: http://localhost:${PORT}"
MODEL="ai/fake-model"
PROBLEM_ID="lc-3"

tmp="$(mktemp -d "${SMOKE_TMPDIR:-${TMPDIR:-/tmp}}/ibai-smoke.XXXXXX")"
export IBAI_WEB_PORT="$PORT"
export IBAI_UID="$(id -u)" IBAI_GID="$(id -g)"
export IBAI_CI_DATA_DIR="$tmp/data"
export IBAI_CI_HOST_CONFIG="$tmp/host-config"
mkdir -p -m 700 "$IBAI_CI_DATA_DIR" "$IBAI_CI_HOST_CONFIG"
# The host's non-Docker app uses another folder → the mismatch banner.
printf '{"dataDir":"/home/someone/other-notes/"}\n' >"$IBAI_CI_HOST_CONFIG/config.json"

# Canary secrets in the shell: none of them may reach the container.
export ANTHROPIC_API_KEY="sk-ant-ci-canary" IBAI_ANTHROPIC_MODEL="canary-model"
export OPENAI_API_KEY="sk-ci-canary" IBAI_OPENAI_API_KEY="sk-ci-canary-2"

compose=(docker compose -f compose.ci.yaml)

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "::group::compose logs"
    "${compose[@]}" logs --no-color || true
    echo "::endgroup::"
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp"
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "SMOKE FAIL: $*" >&2
  exit 1
}

# expect <name> <jq-bool-expression> <json>
expect() {
  if ! jq -e "$2" >/dev/null <<<"$3"; then
    echo "$3" >&2
    fail "$1"
  fi
  echo "ok - $1"
}

# http_status <curl args...> → prints only the status code
http_status() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

"${compose[@]}" up --detach --build --wait --wait-timeout 180

# 1. /api/config and /api/settings: OpenAI-compatible provider, DMR label.
config="$(curl -fsS -H "$HOST_HDR" "$BASE/api/config")"
expect "/api/config names the DMR provider and model" \
  ".provider == \"Using Docker Model Runner (local): ${MODEL}\" and .dbConfigured == true" "$config"

settings="$(curl -fsS -H "$HOST_HDR" "$BASE/api/settings")"
expect "/api/settings: kind openai, DMR label, no key, pinned" \
  ".provider.kind == \"openai\" and .provider.label == \"Docker Model Runner (local)\" and .provider.model == \"${MODEL}\" and .provider.keyConfigured == false and .dataDir.pinned == true and .dataDir.path == \"/data\"" \
  "$settings"
expect "/api/settings: no key variable is set in the container" \
  '[.envHelp[] | select(.var | test("API_KEY")) | .set] | all(. == false)' "$settings"

test_provider="$(curl -fsS -X POST -H "$HOST_HDR" -H "$ORIGIN_HDR" \
  -H 'Content-Type: application/json' -d '{}' "$BASE/api/settings/test-provider")"
expect "test-provider reaches the fake server" '.ok == true' "$test_provider"

# 2. /api/data-dir: pinned by Docker, writable, mismatch detected.
datadir="$(curl -fsS -H "$HOST_HDR" "$BASE/api/data-dir")"
expect "/api/data-dir docker block" \
  ".pinned == true and .docker.hostDataDir == \"${IBAI_CI_DATA_DIR}\" and .docker.writable == true and .docker.hostConfigDataDir == \"/home/someone/other-notes\"" \
  "$datadir"

# 3. Localhost hardening still holds through the published port.
[ "$(http_status -H 'Host: evil.example' "$BASE/api/config")" = "421" ] ||
  fail "foreign Host must be rejected (421)"
echo "ok - foreign Host → 421"
[ "$(http_status -X POST -H "$HOST_HDR" -H 'Origin: http://evil.example' \
  -H 'Content-Type: application/json' -d '{}' "$BASE/api/quiz/start")" = "403" ] ||
  fail "cross-origin POST must be rejected (403)"
echo "ok - cross-origin POST → 403"
[ "$(http_status -X POST -H "$HOST_HDR" -H "Origin: http://localhost:4173" \
  -H 'Content-Type: application/json' -d '{}' "$BASE/api/quiz/start")" = "403" ] ||
  fail "Origin on the listen port (not the public port) must be rejected (403)"
echo "ok - listen-port Origin → 403"

# Inside the container: the listen port answers GET (healthcheck) but not writes.
"${compose[@]}" exec -T app node -e "
  const u = 'http://127.0.0.1:4173';
  Promise.all([
    fetch(u + '/api/config').then((r) => r.status),
    fetch(u + '/api/data-dir/legacy/dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status),
  ]).then(([get, post]) => {
    console.log('listen port GET', get, 'POST', post);
    process.exit(get === 200 && post === 403 ? 0 : 1);
  }, () => process.exit(1));
" || fail "listen port must allow GET and refuse POST"
echo "ok - listen port: GET 200, POST 403"

# 4. A note write lands in the bind-mounted folder, owned by the runner uid.
note="$(curl -fsS -X POST -H "$HOST_HDR" -H "$ORIGIN_HDR" -H 'Content-Type: application/json' \
  -d '{"content":"Sliding window with a last-seen map.","status":"done"}' \
  "$BASE/api/notes/${PROBLEM_ID}")"
expect "note saved as done" '.status == "done"' "$note"
note_file="$IBAI_CI_DATA_DIR/notes/${PROBLEM_ID}.md"
[ -f "$note_file" ] || fail "note file missing on the host: $note_file"
[ "$(stat -c '%u' "$note_file" 2>/dev/null || stat -f '%u' "$note_file")" = "$IBAI_UID" ] || fail "note file not owned by uid $IBAI_UID"
echo "ok - note file on the host, owned by uid $IBAI_UID"

# 5. Quiz start + answer against the fake model.
start="$(curl -fsS -X POST -H "$HOST_HDR" -H "$ORIGIN_HDR" -H 'Content-Type: application/json' \
  -d '{}' "$BASE/api/quiz/start")"
expect "quiz started" '.session.status == "active" and .session.deckSize >= 1' "$start"
answer="$(curl -fsS -X POST -H "$HOST_HDR" -H "$ORIGIN_HDR" -H 'Content-Type: application/json' \
  -d '{"answer":"Use a sliding window and a map of last positions."}' "$BASE/api/quiz/answer")"
expect "quiz answer judged by the fake model" '.verdict == "on_track"' "$answer"

# 6. No provider key and no .env inside the container.
leaked="$("${compose[@]}" exec -T app env | grep -E '^(ANTHROPIC_|OPENAI_|IBAI_ANTHROPIC_|IBAI_OPENAI_API_KEY)' || true)"
[ -z "$leaked" ] || fail "provider key variables leaked into the container: $(cut -d= -f1 <<<"$leaked" | tr '\n' ' ')"
echo "ok - no ANTHROPIC_* / OPENAI_* key variables in the container"
"${compose[@]}" exec -T app sh -c 'test ! -e /app/.env && test ! -e /app/.env.example' ||
  fail "an env file is baked into the image"
echo "ok - no .env in the image"

# 7. Built output and production deps only: no source, no dev tooling, no
#    SPA build-time deps, no dangling workspace links.
#    Each failing check is printed, so a red run names its cause.
"${compose[@]}" exec -T app sh -c '
  cd /app || exit 1
  bad=0
  check() { if ! eval "$1"; then echo "image check failed: $1" >&2; bad=1; fi; }
  check "test -z \"\$(find packages -maxdepth 2 -name src)\""
  # Scoped deps are checked by package dir: npm may leave an empty scope dir.
  for dep in typescript vite react react-dom lucide-react \
    @codemirror/state @codemirror/view @codemirror/language \
    @lezer/common @lezer/markdown @lezer/highlight \
    style-mod crelt w3c-keyname @marijn/find-cluster-break; do
    check "test ! -e node_modules/$dep"
  done
  # An empty scope dir is fine; any entry inside one is a leaked SPA dep.
  for scope in @codemirror @lezer; do
    if [ -d "node_modules/$scope" ] && [ -n "$(ls -A "node_modules/$scope")" ]; then
      echo "image check failed: node_modules/$scope is not empty: [$(ls -A "node_modules/$scope" | tr "\n" " ")]" >&2
      bad=1
    fi
  done
  check "test ! -L node_modules/@ibai/cli"
  check "test -z \"\$(find node_modules -xtype l)\""
  check "test -z \"\$(find /app /home/app -name .env)\""
  exit $bad
' || fail "the image contains source, dev dependencies, a dangling link or a .env"
echo "ok - no src/, typescript, vite, react, codemirror or .env in the image; no dangling links"

echo "Docker smoke test passed."
