# ADR 0020 — Local code runner (Python, Go): Run and Run examples

- **Status:** Proposed (founder reviews and merges, ADR 0017 D1.4)
- **Date:** 2026-10-08
- **Deciders:** Founder, Architect
- **Supersedes:** the "running code" item of ADR 0013 D6 ("A code editor,
  running code, and in-app problem definitions or test cases" is out of
  scope), and the "running code is still out of scope" clause of ADR 0014's
  Amends line (its ADR 0013 D6 amendment).
- **Amends:** `team-charter.md` §7.3 (one narrow execution exception, D1);
  `00-project-context.md` and `01-architecture.md` non-negotiables (the same
  exception); ADR 0015 D1 (the GraphQL query gains `metaData`, and a sidecar
  cache file is added, D6), ADR 0015 API (`ApiProblemStatement` and
  `/api/preferences` gain additive fields, D7); ADR 0011 D2 (the Docker image
  gains Python, D9). Hidden tests, judging and submission stay out of scope.

## Context

The Notes page is code-first (ADR 0015): the note is LeetCode's starter code
plus the user's solution, and "Copy code" pastes it into LeetCode. Today the
only way to see whether the code even runs is to paste it into LeetCode.
LeetCode does not publish its hidden tests, but every problem's statement has
sample inputs (`exampleTestcases`) and sample outputs ("Output:" lines).

Running code is new ground for this project. The local server listens on
localhost, so **any website the user visits can try to POST to it**. A run
route that accepted such a request would be remote code execution on the
user's machine. D2 exists for that reason and is the most important part of
this ADR.

Verified on 2026-10-08 with four manual requests to
`POST https://leetcode.com/graphql` (no cookies, no auth), asking for
`titleSlug exampleTestcases metaData`:

- `metaData` is a **JSON string** (it must be parsed again). For `two-sum`:
  `{"name":"twoSum","params":[{"name":"nums","type":"integer[]"},{"name":"target","type":"integer"}],"return":{"type":"integer[]","size":2},"manual":false}`.
- `rotate-array` (in-place): `"return":{"type":"void"}` plus
  `"output":{"paramindex":0}` (the result is the modified first argument).
- `lru-cache` (design problem): `classname`, `constructor`, `methods`, and
  `exampleTestcases` holds an ops list and an args list, not one line per
  parameter.
- `add-two-numbers`: types `ListNode`; the string uses `\r\n` line endings.
- `exampleTestcases` is newline-separated, one JSON value per parameter per
  example (`two-sum`: `[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6`).
- The statement HTML has `<strong>Output:</strong> [0,1]` inside `<pre>`, and
  for `longest-palindromic-substring` `Output: "bab"` followed by
  `Explanation: "aba" is also a valid answer.` (a case where a plain
  comparison gives a false mismatch).
- On the founder's machine `python3` and `go` are **shims** (mise, goenv):
  shell scripts that need the user's `PATH` and `HOME`. D3 resolves the real
  binaries for that reason.

ARCC was not queried (the tool is not registered in this session). Standard
practice is applied: defense in depth against cross-site requests, least
privilege for the child process, data never interpolated into code, bounded
time and output.

## Founder decisions (2026-10-08)

1. The Notes page gets **Run** (runs the editor code as written: the user's
   own prints or `main`) and **Run examples** (calls the user's `Solution`
   method, or Go function, with LeetCode's sample inputs, and shows actual vs
   expected per example).
2. **Python first, then Go.**
3. Execution happens **on the user's machine**, through the local server,
   which spawns the user's installed `python3` / `go`.
4. It is **opt-in and off by default**: a Settings toggle, plus an env
   override that pins it (`IBAI_CODE_RUNNER`, like `IBAI_LEETCODE_FETCH`).
5. **Docker image:** Python is included. Go is optional (build arg); the
   image-size tradeoff is recorded (D9).
6. **Hidden tests and judging are out of scope.** LeetCode does not publish
   them. Submission stays "Copy code" into LeetCode.

## Decisions

### D1 — Rule amendment (charter §7.3): one narrow execution exception

Charter §7.3 now reads: "Inputs from files, model outputs, and the network
are **untrusted**. Validate and handle errors; never execute untrusted
content. *Amended by ADR 0020:* the one exception is the **user's own editor
code**, executed only on an explicit **Run** / **Run examples** click, only
when the opt-in code runner setting is on. Model output and fetched content
are still never executed."

What this means in code:

- The only code that is executed is the `code` string of a `POST /api/run`
  request, which the SPA builds from the text in the editor at click time.
- **Model output is never executed** and no feature may put model output into
  the editor or into a run request (the coach and the quiz never write code,
  ADR 0013 / ADR 0014 D3).
- **Fetched content is never executed.** LeetCode's `exampleTestcases`,
  `metaData` and statement text go to the child **only as JSON data files**
  (D5). They are never part of any program text. The Go harness is generated
  from `metaData`, but only from values that pass a closed allowlist (an
  identifier regex and a fixed type table), never from raw strings (D5).
- A note may contain text that came from a CSV import or a paste. Once it is
  in the editor, the user sees it, and clicking Run is the user's choice. The
  UI warning (D3) says so.

### D2 — Security: the run route must not be reachable from other websites

**Threat.** The server answers on `127.0.0.1:<port>`. A page on any site can
make the browser send requests there (CSRF), or rebind a DNS name to
`127.0.0.1` (DNS rebinding). Without the controls below, a malicious page
could run arbitrary code as the user. Each layer below stops that on its own;
together they are defense in depth.

**Layers on `POST /api/run` (all required; a failure spawns nothing):**

1. **Host allowlist (DNS-rebinding defense), existing.** `Host` must be
   exactly `127.0.0.1:<publicPort>`, `localhost:<publicPort>` or
   `[::1]:<publicPort>` (`security.ts` `isAllowedHost`, ADR 0011 D2). A
   rebinding page sends `Host: evil.example` and is rejected. The container's
   read-only listen port (`readOnlyHosts`) rejects all mutations, so the run
   route is reachable only on the public port.
2. **Same-origin, stricter than the general rule.** The general check
   (`checkSameOrigin`) allows a request with neither `Origin` nor
   `Sec-Fetch-Site` (curl). The run route does **not**: `Origin` **MUST** be
   present and exactly `http://<allowed public host>`, and `Sec-Fetch-Site`,
   when present, **MUST** be `same-origin`. Browsers send `Origin` on every
   `POST` `fetch`, same-origin included.
3. **JSON only, existing.** `Content-Type: application/json`, else 415. A
   cross-site page cannot send that without a CORS preflight, which the
   server never approves.
4. **Per-launch run token (the main control).**
   - At boot the server makes `RUN_TOKEN = crypto.randomBytes(32)` in
     base64url (43 characters). It lives only in memory and changes on every
     restart. It is never logged, never written to disk, and never returned
     by any `/api` route.
   - **Injection:** the same single function that serves every `index.html`
     response (ADR 0014 D2: `/`, `/index.html` and the SPA fallback) also
     replaces a second placeholder,
     `<meta name="ibai-run-token" content="__IBAI_RUN_TOKEN__" />`, with the
     token. Those responses are already `Cache-Control: no-store`. The token
     is injected whether or not the runner is on (it is useless while the
     runner is off, and enabling it needs the token too, below).
   - **Client:** reads the meta `content` once at startup, accepts it only if
     it matches `^[A-Za-z0-9_-]{43}$` (so the unreplaced placeholder and the
     Vite dev server's copy are rejected), keeps it in a module variable,
     **removes the meta element** from the DOM, and sends it as the header
     **`X-IBAI-Run-Token`** on `POST /api/run`, `POST /api/run/detect` and on
     a `PUT /api/preferences` that sets `codeRunner: true`. No token → Run
     and Run examples are hidden and Settings explains "Open the app from
     the server (`npm start`) to use the code runner."
   - **Server:** compares with the existing constant-time `tokensEqual`
     (`crypto.timingSafeEqual`; false on a missing header, a type or a length
     mismatch). Mismatch → 403 `bad_run_token`, nothing parsed further,
     nothing spawned.
   - **Why it works.** A cross-site page cannot read our `index.html`: there
     is no CORS, the Host check blocks a rebound name, and
     `frame-ancestors 'none'` blocks framing. So it cannot learn the token.
     A custom header on a cross-site request also forces a preflight, which
     fails.
   - **After a server restart** an open tab holds an old token and gets 403
     `bad_run_token`. The UI shows "The app restarted. Reload the page to run
     code."
5. **Opt-in setting.** Off by default (D8). When off, the route returns
   `status: 'disabled'` and spawns nothing. The check comes after the token,
   so an unauthenticated caller learns nothing.
6. **Enabling also needs the token.** `PUT /api/preferences` with
   `codeRunner: true` requires a valid `X-IBAI-Run-Token` (403
   `bad_run_token` otherwise), on top of the existing same-origin and JSON
   checks. Turning it **off** does not need the token. Enabling also needs
   the per-machine acknowledgment (D8).
7. **Loopback peer (non-Docker).** When `IBAI_CONTAINER` is not set, the
   route also requires `req.socket.remoteAddress` to be a loopback address
   (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), else 403 `forbidden`. With the
   default `127.0.0.1` bind this is always true; it guards a future bind
   mistake. In the container the peer is the Docker gateway, so this check is
   skipped there, and isolation comes from the `127.0.0.1:` publish (below).
8. **Limits.** One run in flight per process: a second request gets 429
   `busy` with `retryAfterMs` (500). At most **20 runs per minute** per
   process (sliding window): 429 `rate_limited` with `retryAfterMs`. `code`
   ≤ **64 KiB** (UTF-8 bytes): else 413 `code_too_large`. The 1 MiB body cap
   still applies first.

**Bind address assumptions.**

- `npm start` and the release zip bind `127.0.0.1` (or `::1`) only. Other
  machines cannot connect.
- **Other local users** on a shared, multi-user machine can connect to
  loopback, fetch `index.html` and read the token, so they could run code as
  this user while the runner is on. The token protects against **browsers**,
  not against local processes. This is recorded as a limit: the README and the
  Settings card say "Do not turn this on on a shared computer where other
  people have accounts." (The rest of the app, notes included, is already
  readable by them in that setup.)
- **Docker:** the app binds `0.0.0.0` inside the container (ADR 0011 D2), and
  Compose publishes `127.0.0.1:${IBAI_WEB_PORT}:4173` only. The container is
  reachable only through that published port, from the host's loopback. Any
  other container attached to the same Compose network could also reach port
  4173 and read the token; the shipped `compose.yaml` has no other service on
  that network, and the README says not to add one while the runner is on.
  The ADR 0011 D2 Linux Docker Engine caveat (older Engine releases exposed
  loopback-published ports to the LAN; minimum Engine ≥ 28.0) matters more
  now: on an affected Engine a LAN client could read the token. The README
  states it next to the runner setting.

**Threats out of scope** (recorded, not defended in code):

- **Browser extensions** with host permissions for `localhost` /
  `127.0.0.1` can read our pages, the token included, and send requests as
  the page. An extension with those permissions already has full control of
  the app's pages; the app cannot defend against it.
- Malware already running as the user (it can run code anyway).
- Other local accounts, and LAN exposure on affected Docker Engines (above):
  documented, not enforced.

**Tests (PR A, required):** a request without the token, with a wrong token,
with a token of the wrong length, with a cross-site `Origin`, with no
`Origin`, with `Sec-Fetch-Site: cross-site`, with a rebinding `Host`
(`Host: evil.example:4173`, 421 as today), with `text/plain`, on the container read-only
listen port, and with the runner off: each is rejected and **no process is
spawned** (the spawner is a spy in these tests). The token in the header and
in `index.html` match, the token is the same across `index.html` responses in
one process and differs between two server instances, and no `/api` response
body contains it.

### D3 — Process: how a run is spawned

**This is not a sandbox.** The user's code runs with the user's own account
and can do anything the user can: read, change or delete files, use the
network, start other programs. That is acceptable here because it is the
user's own code, on the user's own machine, run only on the user's click,
behind an off-by-default setting, and D2 keeps other websites out. It is the
same trust as running `python3 solution.py` in a terminal. The limits below
contain mistakes (infinite loops, runaway output, accidental memory blowups),
not attackers.

**UI warning text** (Settings card, shown above the toggle, and as the
confirm text the first time the toggle is turned on):

> Run executes your code on this computer, with your account's permissions.
> It is not a sandbox: code can read, change or delete your files and use the
> network. Only run code you wrote or trust. Do not turn this on on a shared
> computer.

Under Docker the first two sentences read "Run executes your code inside the
app container. It is not a sandbox: code can read, change or delete your data
folder, read the read-only `/host-config` folder, and use the network the
container can reach, including Docker Model Runner."

**Executable discovery** (`packages/web/src/runner/detect.ts`):

- Python: try `python3`, then `python` (on Windows: `py -3`, then
  `python`), found on the **server's** `PATH`. Go: `go`.
- The candidate is asked for its real binary with a fixed argv, timeout 5 s,
  `cwd` = the user's home directory (so version managers pick the user's
  global version, not one from wherever the server was started), and a
  **detection env**: `PATH`, `HOME`, and, only when set, `MISE_*`,
  `PYENV_ROOT`, `PYENV_VERSION`, `GOENV_ROOT`, `GOENV_VERSION`, `ASDF_*`
  and `XDG_*` (plus `SystemRoot`, `PATHEXT` and `USERPROFILE` on Windows).
  So shims work, but no `IBAI_*` or provider key reaches them. These
  version-manager variables never reach a run's child (the run env is the
  allowlist below):
  - Python: `[-c, "import sys,platform;print(sys.executable);print(platform.python_version())"]`.
    Accept only Python ≥ **3.9** (LeetCode snippets use `list[int]`).
  - Go: `[env, GOROOT, GOVERSION]`; the binary is `<GOROOT>/bin/go`
    (`go.exe` on Windows). Accept only Go ≥ **1.21** (for `GOTOOLCHAIN`).
- What every run spawns: for Python, `sys.executable` **as printed, without
  `realpath`** (a venv's `bin/python` is a symlink; resolving it would lose
  the venv's site-packages, so the venv is kept); for Go, `<GOROOT>/bin/go`.
  Both are absolute, so runs do not depend on a shim or on `PATH`. The
  detected Go version also gives the temp `go.mod` its `go` line (below).
- **When detection runs (decided: never on a GET).** `GET /api/run/status`
  **never spawns anything**: it returns the cached result, or
  `available: false` with `version` and `path` `null` when nothing is
  cached. (Reason: a GET skips the same-origin check, so a cross-site
  `<img src>` could otherwise make the server spawn processes; on macOS,
  spawning the `/usr/bin/python3` stub without the developer tools opens
  the "install command line developer tools" dialog.) Detection runs only:
  - when the runner is on (enabled and acknowledged, or pinned on by env):
    at boot, when the setting is turned on, and before a run if the cached
    result is older than 60 s;
  - on `POST /api/run/detect` ("Check for Python and Go" / "Re-check" in
    Settings), which needs same-origin, JSON **and** the run token (D2), and
    works while the runner is off so the user can see versions before
    turning it on.
  It never takes user input. Settings shows the version and the path, or
  "Not found: install Python 3.9+ (or Go 1.21+) and press Re-check."

**Spawn rules** (`packages/web/src/runner/spawn.ts`; Node `child_process`, no
new dependency):

| Rule | Value |
|---|---|
| Call | `spawn(absPath, argsArray, { shell: false, cwd: runDir, env: runEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true (POSIX), windowsHide: true })`. **Never** a shell, never `exec`/`execFile` with a command string. |
| Temp dir | `fs.mkdtemp(<os.tmpdir()>/ibai-run-)`, mode 0700, one per run, **never** inside the data folder (backups and git would pick it up). Deleted with `fs.rm(dir, { recursive: true, force: true })` in a `finally`, after the process group is dead. A boot sweep removes leftover `ibai-run-*` entries in `os.tmpdir()` older than 1 hour (a crash): it uses `lstat`, removes only **real directories** (never a symlink, never followed) **owned by the current uid** (POSIX), and `fs.rm` does not follow symlinks inside them. |
| cwd | the temp dir |
| stdin | **empty** (`'ignore'`, reads see EOF). LeetCode-style code does not read stdin. User-provided stdin is out of scope (a later ADR). |
| Env | an **allowlist** (below), built from scratch. Nothing is inherited, so `IBAI_*`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `IBAI_OPENAI_API_KEY` and every other secret are absent. |
| Wall clock | Python: **5 s** per run (all examples together). Go: **30 s** for `go build`, then **5 s** for the binary. On expiry the whole process group gets `SIGKILL` (`process.kill(-pid, 'SIGKILL')`); on Windows `taskkill /PID <pid> /T /F` (argv array). |
| End of a run | A run ends when the **leader process exits** (or is killed). The server then kills the whole process group, waits at most **200 ms** for the pipes to drain, and **destroys** stdout/stderr without waiting for their `close` event. So a grandchild that called `setsid` and still holds the pipes cannot keep the run lock (D2 single flight) or the request open. Such an escaped grandchild may keep running: this is not a sandbox. |
| Output cap | stdout and stderr: **64 KiB each** (UTF-8 bytes). Past the cap, the rest is dropped, `truncated: true`, and the process group is killed at once (`reason: 'output_limit'`), so `while True: print()` ends in milliseconds, not at the timeout. Output is decoded as UTF-8 with replacement; C0 controls other than `\t` `\n` `\r` are removed. |
| Resource limits | Linux, when `/usr/bin/prlimit` (util-linux) exists: the child is spawned as `prlimit --cpu=<s> --as=<bytes> --fsize=16777216 --nofile=256 --core=0 -- <absPath> <args…>` (still an argv array). Python and the Go binary: `--cpu=5 --as=1073741824` (1 GiB). `go build`: `--cpu=60`, no `--as` (the compiler needs more). PR A runs a Go hello world under `prlimit` on CI; if the Go runtime fails under the 1 GiB `--as`, `--as` is dropped for Go (the other limits stay) and this row is updated. macOS and Windows: no rlimits; the wall clock, the output cap and the process-group kill are the limits. Documented as best-effort. |
| Exit | `exitCode` and `signal` from the child. `status: 'ok'` when the exit code is 0 and nothing was cut; `'timeout'` on the wall clock; `'error'` otherwise (with `reason`, D7). |

**Run env allowlist** (every value set by the server):

- All runs: `PATH` = the directory of the resolved binary, then `/usr/bin:/bin`
  (Windows: that directory plus `%SystemRoot%\System32`); `HOME`,
  `USERPROFILE`, `TMPDIR`, `TMP`, `TEMP` = the temp dir; `LANG=C.UTF-8`;
  Windows also `SystemRoot`.
- Python: no `PYTHON*` variables (`-I` implies `-E`, which would ignore
  them anyway). Python is spawned as **`[-I, -B, -u, -X, utf8, run.py]`**
  (or `harness.py`): `-I` isolated mode (ignores `PYTHON*` env vars and the
  user site directory, and does not put the script's folder on `sys.path`),
  `-B` no `.pyc` files, `-u` unbuffered stdout/stderr (output printed before
  a timeout or crash is not lost), `-X utf8` UTF-8 I/O. Site-packages stay
  on, so installed libraries (and a venv's) can be imported.
- Platform keys the OS or the runtime adds by itself are tolerated in the
  child env and named in the test: `__CF_USER_TEXT_ENCODING` (macOS), and
  `LC_CTYPE` set by Python's C-locale coercion (PEP 538).
- Go: `GOCACHE=<cacheDir>/go-build`, `GOPATH=<cacheDir>/gopath`,
  `GOMODCACHE=<cacheDir>/gopath/pkg/mod`, `GOENV=off`, `GOFLAGS=`,
  `GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local` (never download a
  toolchain), `GOWORK=off`, `GO111MODULE=on`, `CGO_ENABLED=0`. Go's local
  telemetry counters follow `HOME`, so they land in the temp dir and are
  deleted with it.

**Go build cache: decided, persistent and app-owned.**

- Each run gets a **temp module**: the temp dir holds `go.mod`
  (`module ibairun` and `go <major>.<minor>` taken from the detected
  `GOVERSION`, never below `1.21`) and the source files. Parsing: the
  leading `go<major>.<minor>` is taken and any suffix dropped (`go1.22rc1`
  → `1.22`, `go1.25.0` → `1.25`); a value that does not start that way (for
  example `devel go1.26-abc…`) falls back to `1.21`, with one server log
  line saying so. The `go` line sets
  the language version, so newer syntax such as `for i := range 3` (Go 1.22)
  builds; a fixed `go 1.21` would reject it. Nothing is shared
  between runs except the build cache.
- `<cacheDir>` is the OS cache folder plus `interviewbudai/`:
  `$XDG_CACHE_HOME` or `~/.cache` (Linux), `~/Library/Caches` (macOS),
  `%LOCALAPPDATA%` (Windows); created 0700. Under Docker it is
  `/home/app/.cache/interviewbudai` (inside the container, lost on rebuild).
  It is **not** in the data folder and **not** the user's own `GOCACHE`
  (the app does not touch the user's Go setup).
- **Compile-time cost.** Since Go 1.20 the standard library is not shipped
  precompiled. The first build compiles `fmt`, `encoding/json`, `reflect`
  and their dependencies into the cache: expect roughly 5–20 s on a laptop
  (PR A measures it on CI and records it in the README). With a warm cache a
  small program builds in about 0.3–1.5 s. The 30 s build limit covers the
  cold case. Rejected: a fresh cache per run (every run would pay the cold
  cost and could hit the limit); the user's own `GOCACHE` (needs their `HOME`
  and env, and the app would write into the user's toolchain state).
- The cache grows with use (tens of MB). Settings shows its path; deleting
  the folder is safe.

**Language specifics for Run mode.**

- **Python.** The temp dir gets `solution.py` (the code as sent) and the
  constant `run.py`, spawned as `[-I, -B, -u, -X, utf8, run.py]`. `run.py` executes
  `solution.py` with `exec(compile(src, 'solution.py', 'exec'), ns)` in a
  namespace with `__name__ = '__main__'` in Run mode (so an
  `if __name__ == "__main__":` block runs; in examples mode it is
  `'solution'`, D5), pre-filled with a **LeetCode-style prelude**: `from typing
  import *`; `import collections, heapq, bisect, math, itertools, functools,
  string, re, random, operator`; `from collections import deque,
  defaultdict, Counter, OrderedDict`; `from functools import lru_cache,
  cache, reduce`; `from heapq import heappush, heappop, heapify`; `from bisect
  import bisect_left, bisect_right, insort`; `from math import inf`. So
  `List[int]` annotations work as on LeetCode. Tracebacks keep the user's
  line numbers.
- **Go.** The temp dir gets `solution.go`. The `package` clause is found by
  scanning from the top and skipping blank lines, `//` comment lines and
  `/* … */` comments. If the code has no `package` clause, the server
  prepends `package main` and a line directive
  `//line solution.go:1`, so compiler errors keep the user's line numbers.
  `go build -o prog .` then `./prog`. Code without `func main` fails to build;
  the UI shows the hint "Run needs a main function. Use Run examples to call
  your solution."
- **Go imports (decided: added to the temp file only).** LeetCode's Go
  environment appears to add common standard-library imports by itself:
  LeetCode Go solutions routinely call `sort.Ints` or `math.MaxInt` with no
  `import` line. This is observed behaviour that LeetCode does not document,
  and it was not verified for this ADR; PR A checks it by hand on one
  problem and records the result in the README. So the server adds missing
  imports to the **temp `solution.go` only, never to the note**: for each
  package in the fixed table below whose **name** (the last element of the
  import path, for example `heap` for `container/heap`) matches
  `(^|[^A-Za-z0-9_.])<name>\.` in the code (so `node.list.Next` does not
  pull in `container/list`), and that the code does not already import, it
  adds:
  - an `import "<path>"` line **right after the `package` clause** (Go
    requires imports before any other declaration; a second import
    declaration after the user's own import block is legal), followed by a
    `//line solution.go:<n>` directive so the user's line numbers are kept.
    `<n>` is the line number of the user's package clause + 1, or `1` when
    the server added `package main` itself;
  - at the **end** of the temp `solution.go`, a `//line ibai_imports.go:1`
    directive and then one `var _ = <symbol>` line per added package, so a
    false match cannot cause an "imported and not used" error and errors in
    these lines are never attributed to the user's code.

  | Import path | Name | Symbol |
  |---|---|---|
  | `sort` | `sort` | `sort.Ints` |
  | `strings` | `strings` | `strings.Contains` |
  | `strconv` | `strconv` | `strconv.Itoa` |
  | `math` | `math` | `math.Pi` |
  | `math/bits` | `bits` | `bits.Len` |
  | `container/heap` | `heap` | `heap.Init` |
  | `container/list` | `list` | `list.New` |
  | `unicode` | `unicode` | `unicode.IsDigit` |
  | `fmt` | `fmt` | `fmt.Sprint` |
  | `slices` | `slices` | `slices.Sort[[]int]` |
  | `maps` | `maps` | `maps.Clone[map[int]int]` |
  | `bytes` | `bytes` | `bytes.Equal` |
  | `errors` | `errors` | `errors.New` |

  The `slices` and `maps` symbols are instantiated generics (a plain generic
  name does not compile as a value); `maps.Clone` exists since Go 1.21. The
  note
  stays exactly as the user wrote it, so it pastes back into LeetCode
  unchanged; an `import` block the user wrote also works on LeetCode. A
  package-level identifier of the user's with the same name as a listed
  package (rare) can clash with the added import; the compiler error says
  so.

**Which code is sent.** The SPA sends the same code that "Copy code" copies
(`extractCode(text, preferred)`, ADR 0015 D3): the whole note for a
code-only note, or the chosen fence for a Markdown note. The language is the
editor mode (Python or Go), or for a Markdown note the language of the
chosen fence, else the preferred language. One pure helper,
`runTarget(text, preferred): { language, code }`, next to `extractCode`.

**Tests:** see D11.

### D4 — Cache: `metaData` in a sidecar file (additive)

**Fetch.** The ADR 0015 D1 query gains one field, `metaData`. Nothing else in
the fetch changes (same URL, limits and rate window).

**Where it is stored: a sidecar, decided.** ADR 0015's cache reader
(`parseProblemCacheEntry`) rejects any entry whose key set is not exactly the
`schema: 1` keys. A new field inside `<id>.json` would make an **older build
treat every new file as "not cached"**, hide a pasted statement, and then
overwrite the file on its next fetch, losing the paste. So `metaData` goes in
a new file next to it:

- `<dataDir>/problem-cache/<id>.meta.json` (covered by the existing
  `problem-cache/.gitignore` `*`). Path helper `problemMetaPath(dataDir, id)`
  with the same `^lc-[0-9]+$` rule and `path.relative` check as
  `problemCachePath`.
- Shape (`schema: 1`), written atomically, 0600, ≤ 16 KiB:

```json
{
  "schema": 1,
  "id": "lc-1",
  "fetchedAt": "2026-10-08T12:00:00.000Z",
  "meta": {
    "kind": "function",
    "name": "twoSum",
    "params": [
      { "name": "nums", "type": "integer[]" },
      { "name": "target", "type": "integer" }
    ],
    "returnType": "integer[]",
    "outputParamIndex": null
  }
}
```

  `meta` is `null` when LeetCode returned no `metaData`, or when it did not
  parse or validate. `kind` is `'function'` or `'design'` (a `classname`
  with `methods`; stored with `kind: 'design'` and no further fields in phase
  1, so a later PR can tell the cases apart without refetching).
- **Validation on write and on read** (untrusted both times): `metaData`
  must be a string ≤ 16 KiB that parses as a JSON object. `name` and each
  param `name` must match `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. Each `type` and
  `returnType` must match `^[A-Za-z0-9<>\[\]_]{1,64}$` and is kept as the
  string; support is decided later by the D5 type table. ≤ 10 params.
  `outputParamIndex` is an integer within `params` or `null`. Anything else
  → `meta: null`. A sidecar that fails to read or validate is treated as
  missing.
- Written in the same fetch that writes `<id>.json`. When the main file
  cannot be written (read-only folder, size cap) the sidecar is not written
  either. A paste never touches the sidecar.
- **A failed sidecar write** (the main file was written) is treated as
  `meta: null` for that reply: `runExamples` is
  `{ state: 'needs-refresh', reason: 'needs_refresh' }`; the
  once-per-page-load cap below prevents a refresh loop.
  The client starts the refresh-on-demand below at most **once per problem
  per page load**; if the state is still not `ready` after it, Run examples
  stays disabled with the reason and is not retried until the page is
  reloaded.

**Old cache entries.** An `<id>.json` without a sidecar comes from an older
build. The statement reply says `runExamples.state: 'needs-refresh'` (D7).
When fetching is enabled, clicking **Run examples** first calls the existing
`POST /api/problems/:id/statement/fetch` with `{ refresh: true }` (subject
to the ADR 0015 rate window and single flight; the paste is kept, as today),
then runs. When fetching is off or the refresh fails, Run examples is
disabled with the reason "Needs one refresh from LeetCode" (or "Fetching is
turned off in Settings"), and **Run** still works. `POST /api/run` itself
never calls the network.

### D5 — Harness for Run examples

**Inputs.** From the cached `exampleTestcases` (ADR 0015) and the sidecar
`meta`, parsed on the server in TypeScript (`packages/web/src/runner/examples.ts`):

1. Normalize `\r\n` to `\n`, drop one trailing newline, split on `\n`.
2. `meta.kind` must be `'function'`, and the number of lines must be a
   positive multiple of `params.length`; else Run examples is unavailable
   (`examples_unavailable`, reason `bad_testcases` or `unsupported_kind`).
3. Each line must `JSON.parse` and must match its param's type (the type
   table below). For `long`, the raw token is also checked with
   `^-?[0-9]{1,19}$` and a `BigInt` range check (a `JSON.parse`d number
   loses precision past 2^53). At most **20 examples**. A line that fails
   gives that example `error: "Input is not valid JSON for <type>"` and it is
   not run.
4. **`input.json`** in the temp dir holds the **original line text** of each
   argument, not the re-serialized value:
   `{ "examples": [["[2,7,11,15]", "9"], …] }`. The harness decodes each
   string itself (Python `json.loads`, which has exact big integers; Go
   `json.Unmarshal` into the declared type, so an `int64` is exact). The
   inputs are never placed in program text.

**Expected outputs ("expected (from the statement)").** Parsed from the
statement the user sees: the cached `blocks` (ADR 0015 D2) or, when a paste
wins, the pasted text.

- Flatten to lines: text nodes are concatenated; `br`, every block boundary
  (`p`, `pre`, `li`) **and every `\n` inside a text node** end a line. (In
  LeetCode's `<pre>` examples, `Input:`, `Output:` and `Explanation:` share
  one text node separated by `\n`; the newer `div.example-block` format is
  sanitized to one `p` per line, ADR 0015 D2.)
- **Required fixtures (PR C), synthetic text (§6.2):** a `<pre>` example
  block and a `div.example-block` example block, each run through the
  ADR 0015 D2 sanitizer, both giving the same expected values.
- A line matching `^\s*Output\s*:\s*(.*)$` (case-sensitive `Output`) gives
  one expected value: the captured text, trimmed, or if it is empty, the next
  non-empty line. Values are collected in document order.
- Each value is `JSON.parse`d after trimming. A value that does not parse
  (for example `2.00000` parses, `"bab"` parses, `[1,2] or [2,1]` does not)
  → that example has **no `expected` key** (absent, never `null`, matching
  D7 `expected?`).
- **Alignment rule:** expected values are matched to examples by index
  **only when the counts are equal**. If they differ, **no** example has an
  `expected` key: the app does not guess.
- When `expected` is absent, the row shows the actual output only and
  `pass: null` ("No expected output found in the statement"). (`null` is a
  valid expected JSON value, for example a `TreeNode` answer in a later
  phase, which is why "not found" is an absent key.)

**Comparison (normalized JSON equality).** Both sides are JSON values.
Equal when: same type and value for strings, booleans and `null`; numbers
equal, or both finite with `|a − b| ≤ 1e-5` when either is not an integer;
arrays with the same length and equal items in order; objects never occur in
phase 1.

**Big integers.** `BigInt` is used **only inside the server** to compute
`pass`: for the comparison, the expected text and each `actual` result line
are parsed with a reviver (Node 24's `context.source` gives the raw text)
that turns integers beyond `Number.MAX_SAFE_INTEGER` (no `.` or `e`) into
`BigInt`, so `pass` is exact. The reply's `expected` / `actual` are plain
`JSON.parse` values and may be inexact past 2^53. For display, each row
carries `expectedText` (present exactly when `expected` is) and
`actualText` (present exactly when `actual` is): the value's JSON text as
received. A text over 2 000 chars is cut and ends with `…`; `pass` is still
computed on the full value. The UI shows the text field when present.

The row label is **"expected (from the statement)"**, and the pane
notes: "Some problems accept any order or any valid answer. A mismatch here
is not a LeetCode verdict." (for example Longest Palindromic Substring's
"aba" vs "bab").

**Type table, phase 1** (anything else → Run examples unavailable, reason
`unsupported_type`, and Run still works):

| LeetCode type | JSON | Python | Go |
|---|---|---|---|
| `integer`, `long` | integer | `int` | `int`, `int64` |
| `double` | number | `float` | `float64` |
| `boolean` | boolean | `bool` | `bool` |
| `string` | string | `str` | `string` |
| `character` | 1-char string | `str` | `byte` (decoded from and encoded back to a 1-char string) |
| `T[]`, `T[][]`, `list<T>`, `list<list<T>>` of the above | arrays | `list` | `[]T`, `[][]T` |
| `void` with `outputParamIndex` | — | the argument at that index after the call | same |

Later phases: `ListNode` and `TreeNode` converters (PR E: LeetCode's level
order with `null`, and its linked-list array form), then design problems (a
class with ops and args lists, its own ADR or amendment).

**Python harness** (`harness.py`, a **constant file** in the repo, copied
into the temp dir; never generated, never templated):

- Reads `meta.json` (`name`, `params` types, `outputParamIndex`, a per-run
  random `delimiter` of 16 bytes in hex) and `input.json`.
- Executes `solution.py` like Run mode (same prelude), but with
  `__name__ = 'solution'`, so the user's `if __name__ == "__main__":` test
  block does not run in examples mode. Then it gets
  `Solution` from the namespace (missing → one `harness` error: "No class
  Solution found"), and `getattr(Solution(), name)` (missing → "Solution has
  no method <name>").
- For each example: `result = method(*args)` with a fresh `Solution()`
  instance, inside `try/except BaseException` (but `SystemExit` and
  `KeyboardInterrupt` stop the loop), and with `sys.setrecursionlimit(10000)`
  set once. A `void` problem reads `args[outputParamIndex]` after the call.
  Tuples become lists. Results are encoded with
  `json.dumps(value, allow_nan=False)`; any value it cannot encode (an
  object, `NaN`, `inf`) gives an `error: "Return value is not JSON: <type
  name>"`.
- Writes one result per example to the real stdout as `"\n" +
  "IBAI-RESULT:<delimiter>:<json>" + "\n"`, then calls `sys.stdout.flush()`.
  The leading `\n` means a user's `print(..., end="")` cannot glue its text
  onto the result line and hide it; the flush (with `-u`) means results
  printed before a timeout survive. Here `<json>` is
  `{"i": n, "actual": <value>}` or `{"i": n, "error": "<exception type>:
  <message, ≤ 2 000 chars>"}` (`json.dumps`, so no raw newline can appear).
  The user's own prints go to the same stdout and stay visible in the output
  pane. The server takes only lines that start with the exact prefix and the
  run's delimiter, removes each one from the shown `stdout` together with
  the `\n` the harness added before it, and ignores malformed ones.
- **The delimiter prevents accidental collisions; it is not a security
  boundary.** User code can read `meta.json` and print a valid result line.
  That only lets the user fool their own results, which is not a threat. An example with no result line gets `error: "No result
  (the run stopped early)"` (timeout, crash or output cap).

**Go harness** (PR D; generated, but only from allowlisted values):

- `solution.go` holds the user's code (with `package main` and the line
  directive added when missing, as in Run mode). A user `func main` in
  examples mode is a build error; the UI shows "Remove your main function to
  use Run examples."
- `harness_main.go` is built from a fixed template. The only values inserted
  are the function name (already matched against
  `^[A-Za-z_][A-Za-z0-9_]{0,63}$`) and Go type expressions taken **from the
  type table**, never from the raw `metaData` string. It reads `input.json`
  into `[][]json.RawMessage`, decodes each argument with `json.Unmarshal`
  into a variable of the declared type, calls the function inside a
  `defer recover()` closure per example, and prints the same
  `IBAI-RESULT:<delimiter>:<json>` lines with `json.Marshal`. The delimiter
  is read from `meta.json` at run time, not inserted into the source.
- Names the template uses are prefixed `ibai_` to avoid clashes with user
  identifiers.

**Custom problems** (`u-` ids, ADR 0010) have no `exampleTestcases` or
`metaData`: **Run only**. User-written examples are out of scope (later).

**Tests (PR C / PR D):** Two Sum style pass, a wrong answer (`pass: false`),
a `void` in-place problem, two integers that differ only past 2^53
(`pass: false`), an `actualText` over 2 000 chars (cut, ending with `…`), a
statement with fewer "Output:" lines than
examples (no `expected` key on any row), an `Output:` value that is not JSON (that row has no `expected`), the `<pre>` and `div.example-block` fixtures, an
unsupported type (examples unavailable, Run works), a user print interleaved
with results, a forged `IBAI-RESULT:` line printed by the user with a wrong
delimiter (ignored), a user `print("x", end="")` right before a result (the result is still found), a `long` input above 2^53 (exact), an `if __name__ == "__main__":` block (not run in examples mode), a `NaN` result (error), an exception in one example (the others still run), a
timeout midway (earlier results kept), and **a malicious example input**: an
`exampleTestcases` line such as `"]); import os; os.system('touch pwned') #`
and a valid JSON string containing Python or Go code. The test asserts the
first is rejected as bad JSON, the second arrives as a plain string argument,
no `pwned` file exists, and the harness file on disk is byte-identical to
the repo constant (Python) or to the template with only the allowlisted
values (Go). A `metaData` `name` like `twoSum(){}; func init(){` is rejected
by the regex, so the Go harness is never generated from it.

### D6 — Data: additive, not breaking

- The only new on-disk data is the sidecar `problem-cache/<id>.meta.json`
  (D4) and the optional `codeRunner` key in `preferences.json` (D8). Older
  builds ignore both. Per ADR 0009 D4: **no `formatVersion` bump, no
  migration, not a breaking change.**
- Notes do not change. **Running never saves the note**: the run request
  carries the editor text, and the server never writes it anywhere except
  the temp dir, which is deleted.
- The Go build cache lives outside the data folder (D3) and is not user data.
- ADR 0009 D3 backups copy the sidecars like any other file (small, bounded
  by the catalog).
- **A `CHANGELOG.md` entry is required in each PR** (`### Added`, and for
  PR F `### Changed` for the Docker image size). Breaking changes: None.

### D7 — API (exact shapes, so the UI can be built against fixtures)

All under the existing `/api` protections, plus D2 on `POST /api/run`.
Unknown body fields → 400.

```ts
type RunLanguage = 'python' | 'go';
type RunMode = 'run' | 'examples';

interface RunRequest {
  language: RunLanguage;
  code: string;          // ≤ 64 KiB UTF-8
  mode: RunMode;
  problemId?: string;    // required for 'examples'; catalog id
}

type RunStatus = 'ok' | 'error' | 'timeout' | 'disabled' | 'not_installed';
type RunReason =
  | 'exit_nonzero'       // the program exited with a non-zero code or a signal
  | 'compile_failed'     // Go build failed (stderr holds the compiler output)
  | 'output_limit'       // stdout or stderr passed 64 KiB; the run was stopped
  | 'harness'            // Run examples could not call the solution (no class / method)
  | null;

interface ExampleResult {
  input: string;            // the example's input lines as in exampleTestcases, joined with '\n'
  expected?: unknown;       // parsed JSON, absent when not found (D5)
  expectedText?: string;    // present iff expected is; JSON text as in the statement, ≤ 2 000 chars (cut ends with '…')
  actual?: unknown;         // parsed JSON, absent on error
  actualText?: string;      // present iff actual is; JSON text from the harness, ≤ 2 000 chars (cut ends with '…')
  pass?: boolean | null;    // null when expected is absent or the example errored
  error?: string;           // ≤ 2 000 chars
}

interface RunResponse {
  status: RunStatus;
  reason: RunReason;
  exitCode: number | null;
  stdout: string;           // ≤ 64 KiB, result lines removed
  stderr: string;           // ≤ 64 KiB
  truncated: boolean;
  durationMs: number;       // spawn to exit (Go: build + run)
  phase: 'compile' | 'run' | null; // Go only; where it stopped
  examples?: ExampleResult[];      // mode 'examples' only
}

type ExamplesUnavailableReason =
  | 'custom_problem' | 'not_cached' | 'needs_refresh' | 'unsupported_type'
  | 'unsupported_kind' | 'bad_testcases' | 'language';

interface RunExamplesInfo {     // on ApiProblemStatement
  state: 'ready' | 'needs-refresh' | 'unsupported' | 'none';
  reason: ExamplesUnavailableReason | null; // null only when state is 'ready'
}

interface RunStatusReply {     // GET /api/run/status, POST /api/run/detect
  enabled: boolean;            // setting (or env pin) on AND acknowledged (D8)
  pinned: boolean;             // set by IBAI_CODE_RUNNER
  needsAck: boolean;           // setting on, but no acknowledgment on this machine (D8)
  detectedAt: string | null;   // ISO time of the cached detection; null = never detected
  container: boolean;          // running under Docker (UI warning variant)
  languages: Record<RunLanguage, {
    available: boolean;        // false (with null version/path) until detected
    version: string | null;    // e.g. "3.11.8", "go1.25.0"
    path: string | null;       // binary every run spawns
    examples: boolean;         // harness shipped for this language (Go: false until PR D)
  }>;
  goCacheDir: string | null;
}
```

| Method + path | Result |
|---|---|
| `POST /api/run` | `RunRequest` → **200 `RunResponse`** for every outcome that reached the runner: `ok`, `error`, `timeout`, `disabled` (runner off; nothing spawned; empty output), `not_installed` (no usable interpreter; nothing spawned). **Rejections** (nothing spawned) use `{ error, code }`: 400 `bad_request` (shape, unknown field, bad `language` / `mode`, `problemId` missing for examples); 400 `examples_unavailable` with `reason: 'custom_problem' \| 'not_cached' \| 'needs_refresh' \| 'unsupported_type' \| 'unsupported_kind' \| 'bad_testcases' \| 'language'`; 403 `bad_run_token`; 403 `forbidden` (Origin missing or wrong, `Sec-Fetch-Site` not same-origin, non-loopback peer, read-only port; the existing rejections keep their current status and bodies: Host → 421, cross-site Origin → 403); 404 `not_found` (unknown `problemId`); 413 `code_too_large`; 415 (existing, not JSON); 429 `busy` / `rate_limited` with `retryAfterMs`. Error text is fixed. |
| `GET /api/run/status` | 200 `RunStatusReply`. Read-only; no token (it reveals only versions and paths, which a cross-site page cannot read). **Never spawns** (D3): the cached detection, or `available: false` with `null` version and path. |
| `POST /api/run/detect` | `{}` → 200 `RunStatusReply` after a fresh detection ("Check for Python and Go" / "Re-check"). Same-origin, JSON **and** `X-IBAI-Run-Token` (403 `bad_run_token`); works while the runner is off. 429 `busy` while a detection or run is in flight. |
| `GET /api/preferences` | gains `codeRunner: { stored: boolean, pinned: boolean, needsAck: boolean }` (additive). `stored` is the value in `preferences.json` (or the env value when `pinned`); it is **not** "the runner is on". Whether the runner is on is only `RunStatusReply.enabled` (stored or pinned on **and** acknowledged). |
| `PUT /api/preferences` | accepts `codeRunner?: boolean` and `acknowledgeRunnerWarning?: true`. `codeRunner: true` needs `X-IBAI-Run-Token` (403 `bad_run_token`) and, when this machine has no acknowledgment, `acknowledgeRunnerWarning: true` (else 400 `ack_required`); the server then writes the acknowledgment (D8). `acknowledgeRunnerWarning: true` **without** `codeRunner: true` also needs the token, writes only the acknowledgment, changes no preference, and returns 200 (the same shape as GET). While pinned → 400 "Set by IBAI_CODE_RUNNER" for `codeRunner`. |
| `GET /api/problems/:id/statement` | `ApiProblemStatement` gains `runExamples: RunExamplesInfo` (additive; `state: 'none'` with `reason: 'custom_problem'` for custom problems, or `'not_cached'` when nothing is cached). |
| `GET /api/settings` | env list gains `IBAI_CODE_RUNNER` (set ✓/✗ only). |

**Fixtures (PR A):** `packages/web/web-ui/src/test/fixtures/run/`: a
`RunResponse` for `ok` (Python Run with stdout), `error` / `exit_nonzero`
(traceback in stderr), `error` / `compile_failed` (Go, `phase: 'compile'`),
`error` / `output_limit` (`truncated: true`), `timeout`, `disabled`,
`not_installed`, and an `examples` reply with a pass, a fail, an
`expected`-missing row, an errored row, and a big-integer row (a value past
2^53 with `expectedText` / `actualText`); every rejection body above;
`RunStatusReply` enabled with both languages, disabled and pinned, with Go
missing, and with `needsAck: true` (`enabled: false`); `GET /api/preferences`
with `codeRunner` `{ stored: false, pinned: false, needsAck: false }`,
`{ stored: true, pinned: false, needsAck: true }` (a copied data folder) and
`{ stored: true, pinned: true, needsAck: false }`; and `ApiProblemStatement`
with each `runExamples` state. They ship in **PR A0** with the shared types (below).
PR A's server test checks each fixture against what the live routes return
(as in ADR 0015), so they cannot drift.

**Shared types.** The D7 types live in `packages/web/src/run-types.ts`, a
zero-import module that web-ui imports by relative path, like
`statement-tree.ts` (ADR 0015 D2).

### D8 — Setting: `codeRunner`, off by default, `IBAI_CODE_RUNNER`

- "Run code on this computer" — default **off**. Stored as `codeRunner`
  (boolean) in `<dataDir>/preferences.json` (ADR 0015 D4 rules: untrusted on
  read, unknown keys kept, atomic, 0600, read-only folder → 409).
- **Env override `IBAI_CODE_RUNNER`:** `off` / `0` / `false` turns it off
  and `on` / `1` / `true` turns it on. Either value **pins** it: the toggle is
  read-only with "Set by IBAI_CODE_RUNNER". Any other value is ignored with
  one boot warning. Same parser as `IBAI_LEETCODE_FETCH`. Added to
  `.env.example`, the Settings env list, and `compose.yaml`
  (`IBAI_CODE_RUNNER: ${IBAI_CODE_RUNNER:-}`).
- **First-enable acknowledgment, once per machine.** Turning the runner on
  the first time on a machine shows the D3 warning as a confirm. Accepting
  it writes `<home>/.interviewbudai/code-runner-ack.json`
  (`{ "acknowledgedAt": "<ISO>", "appVersion": "<v>" }`, 0600, atomic), in
  the **machine** config folder, **not** the data folder. So a data folder
  copied from another machine, with `codeRunner: true` in its
  `preferences.json`, does not turn the runner on: the server treats it as
  off (`codeRunner.stored: true`, `needsAck: true`, and
  `RunStatusReply.enabled: false`) until the user confirms on this
  machine. Under Docker, `<home>` is `/home/app` inside the container (the
  host's `~/.interviewbudai` is mounted read-only at `/host-config`), so the
  confirm is asked again after the container is recreated. Accepted. If the
  file cannot be written, enabling fails with 409 and a fixed message.
- Pinning **on** by env counts as the acknowledgment (it is an explicit act
  on this machine) and skips the confirm; the warning stays visible in
  Settings.
- The setting lives in the data folder, like the fetch toggle, so switching
  data folders can switch it. Accepted.

### D9 — Docker image

- **Python: included (PR F).** The runtime stage installs Debian's
  `python3` with `apt-get install --no-install-recommends`, the version pinned
  to the bookworm package version (`python3=<exact>`), and removes the apt
  lists. bookworm ships Python 3.11. Expected cost: roughly **+30–50 MB**
  uncompressed (PR F measures and records the real number in the README and
  CHANGELOG). The runner is still off by default in the container.
- **Go: optional, build arg `IBAI_WITH_GO` (default `0`).** With `1`, the
  image copies `/usr/local/go` from an official `golang:<ver>-bookworm`
  image pinned by tag **and** digest (charter §7.1). Cost: about **+250 MB**
  uncompressed for the toolchain, plus the build cache under
  `/home/app/.cache` as it grows, and the first build is cold after every
  container rebuild. That is too much for every user of a default image whose
  main feature is notes and the quiz, so the default stays Python only.
  Users who want Go in Docker run `docker compose build --build-arg
  IBAI_WITH_GO=1`; `npm start` users use their own Go. A default change needs
  a founder decision (recorded below).
- The container keeps the non-root `node` user. User code there can read and
  write `/data` (the bind mount) and `/home/app`, and reach the network the
  container can reach. The Docker variant of the warning (D3) says so.

### D10 — UI

- **Notes toolbar:** **Run** and **Run examples** buttons, shown only when
  `GET /api/run/status` says `enabled` and the run token was read. Run
  examples is shown only when the language has `examples: true`, and is
  disabled (with the reason as its `title` and visible helper text) when
  `runExamples.state` is not `ready` (D4 handles `needs-refresh`). Both are
  disabled while a run is in flight. The language that will run is shown on
  the button (`Run (Python)`), from `runTarget` (D3). Keyboard: no new
  global shortcuts in phase 1.
- **Output pane** under the editor (a `region` labelled "Run output",
  `aria-live="polite"` on the status line only):
  - a status line ("Finished in 120 ms", "Exited with code 1", "Stopped
    after 5 s", "Output cut at 64 KiB", "Build failed", "Python 3.9+ was not
    found", "Code runner is off in Settings");
  - stdout and stderr in `<pre>` blocks (React text, never HTML), stderr
    styled as an error;
  - for Run examples, one row per example: the input, "expected (from the
    statement)", actual, and a pass / fail / "no expected output" badge with
    text, not colour alone; plus the order-insensitive note (D5);
  - a "Clear" button. The pane is not persisted.
- **Settings card "Code runner":** the warning text (D3) above the toggle,
  the toggle (first enable asks for confirmation with the same text), "Set
  by IBAI_CODE_RUNNER" when pinned, the detected Python and Go versions and
  paths, a "Re-check" button, the Go cache path, and the Docker note when
  `container` is true.
- **Running never saves the note and never sends anything to the AI.** The
  run request goes only to `/api/run`. The coach (ADR 0013) and the quiz
  (ADR 0007) do not see run output. **The quiz is unaffected.**
- The output text is untrusted (it came from a program) and is rendered only
  as React text.

### D11 — Testing

- **Real process spawning in CI.** `ubuntu-latest` has `python3` and `go`
  preinstalled, and `prlimit` from util-linux. The runner tests spawn real
  processes there. They are not mocked away. If an interpreter is missing on
  a developer's machine, those tests skip with a clear message; **on CI they
  must not skip** (the test fails when `CI=true` and `python3` or `go` is not
  found). `.github/workflows/ci.yml` gains a `python3 --version` and
  `go version` step so the versions are visible in the log. If
  `ubuntu-latest` (Ubuntu 26 from 2026-10-19) drops either tool, PR A adds
  `actions/setup-python` / `actions/setup-go` pinned by full SHA.
- **Required cases (PR A):**
  - the timeout kill: `while True: pass` and a child that spawns a
    grandchild sleeping 60 s; after the result, neither process exists
    (checked by pid);
  - the output cap: `while True: print("x" * 1000)` returns in well under
    the timeout with `truncated: true`, `reason: 'output_limit'`, and stdout
    ≤ 64 KiB;
  - temp-dir cleanup: the temp dir is gone after `ok`, `error`, `timeout` and
    `output_limit` runs, and the boot sweep removes an old `ibai-run-*` dir;
  - env stripping: with `IBAI_TEST_SECRET`, `ANTHROPIC_API_KEY`,
    `OPENAI_API_KEY` and `MISE_TEST` set in the server env, the child prints
    its environment and has **no key outside** the D3 allowlist plus the
    documented platform keys (`__CF_USER_TEXT_ENCODING`, `LC_CTYPE`), for
    Python and Go;
  - cwd is the temp dir and `HOME` is the temp dir;
  - the memory limit on Linux with `prlimit`: allocating 2 GiB fails;
  - every D2 rejection, with a spy spawner showing nothing ran;
  - Go: a compile error (`phase: 'compile'`, line numbers match the user's
    code), a run, and `GOTOOLCHAIN=local` / `GOPROXY=off` in the child env;
  - stdin is empty (`input()` raises `EOFError`);
  - output printed just before a timeout is in the reply (`-u`);
  - a `setsid` grandchild that keeps the pipes open does not hold the run:
    the reply arrives within the timeout plus about 200 ms and the next run
    is accepted;
  - **`GET /api/run/status` spawns nothing**, with the runner off and on
    (spy spawner), and `POST /api/run/detect` without the token is 403;
  - Go: `for i := range 3` builds (the `go.mod` line follows the detected
    version; CI's Go is ≥ 1.22), a Go hello world runs under `prlimit` with
    the D3 limits, and a missing std import (`sort.Ints` without an import)
    is added to the temp file only;
  - the boot sweep skips a symlink named `ibai-run-old` and a directory
    owned by another uid (where the test can create one);
  - a copied `preferences.json` with `codeRunner: true` and no
    acknowledgment file leaves the runner off (`stored: true`,
    `needsAck: true`, `RunStatusReply.enabled: false`);
  - `PUT /api/preferences` with only `acknowledgeRunnerWarning: true` (and
    the token) writes the acknowledgment file, leaves `codeRunner`
    unchanged, and returns 200;
  - Go imports: a `slices.Sort` call with no import builds; `node.list.Next`
    does not add `container/list`; user code with its **own import block** that also uses a
    package it did not import (`import "strings"` plus a `sort.Ints` call)
    still builds, and compiler line numbers still match the user's code;
  - `GOVERSION` parsing: `go1.22rc1` → `1.22`, `go1.25.0` → `1.25`, and
    `devel …` → `1.21` with the log line.
- **Harness cases:** D5 list, including the malicious example input.
- No test calls LeetCode (the fetch stays injected, ADR 0015).

## Roadmap (each PR with a `code-review` pass)

| PR | Scope | Depends on |
|---|---|---|
| **A0 — shared types and fixtures** | `packages/web/src/run-types.ts` (the D7 types, zero imports), every D7 fixture under `web-ui/src/test/fixtures/run/`, a type-level test that each fixture matches its type. No routes, no user-visible change. CHANGELOG: none needed. | — |
| **A — runner core** | `runner/detect.ts`, `runner/spawn.ts` (D3 rules, rlimits, kill, caps, temp dir and boot sweep, env allowlist, Go temp module and cache), `run.py`, the run token and its `index.html` placeholder (D2), `POST /api/run` (Run mode, Python and Go), `GET /api/run/status`, `POST /api/run/detect`, `codeRunner` preference, the per-machine acknowledgment and `IBAI_CODE_RUNNER` (config, `.env.example`, `compose.yaml`, Settings env list), the token and ack rules on `PUT /api/preferences`, the server test that validates the A0 fixtures against the live routes, D11 tests, README section (what it does, the not-a-sandbox warning, shared-computer and Docker notes), CHANGELOG `### Added`. | A0 |
| **B — Notes UI** | Run button, output pane, Settings "Code runner" card with the warning, confirm, versions and Re-check, `runTarget`, token reading, `lib/api` clients, the restart message, tests against the A0 fixtures, CHANGELOG `### Added`. | A0. Builds in parallel with A against the fixtures; merge after A. |
| **C — Python examples** | `metaData` in the fetch query, the sidecar (`problemMetaPath`, validation), `runExamples` on the statement reply, `examples.ts` (inputs, expected parser, comparison, type table), `harness.py`, Run examples button and rows, the refresh-on-demand flow, D5 tests, CHANGELOG `### Added`. | A and B. |
| **D — Go examples** | The Go harness template and the Go column of the type table, `examples: true` for Go, D5 Go tests, CHANGELOG `### Added`. | C. |
| **E — ListNode / TreeNode** | Converters for both harnesses (LeetCode's array forms), tests, CHANGELOG `### Added`. | C (Python), D (Go). |
| **F — Docker** | `python3` in the runtime stage (pinned Debian version), the `IBAI_WITH_GO` build arg (pinned `golang` image), measured image sizes in README and CHANGELOG `### Changed`, a container smoke test of a Python run. | A. |

PR A0 lands first; then PR A and PR B run in parallel against its fixtures.

## Consequences

- **Positive:** the user can check that the code runs and passes LeetCode's
  sample cases without leaving the app, then copy it to LeetCode.
- **Positive:** off by default, local only, and nothing new leaves the
  machine (the one extra GraphQL field rides on the existing fetch).
- **Tradeoff:** the app can now execute code. D2 keeps other websites out,
  but anyone who can reach the server as a process (other local users, or a
  LAN client on an affected Docker Engine) can read the token. Recorded and
  documented; the setting is off by default.
- **Tradeoff:** not a sandbox. User code can harm the user's files. That is
  the same as running it in a terminal, and the warning says so.
- **Tradeoff:** the expected outputs come from the statement text and can be
  wrong for problems that accept any order or several answers.
- **Tradeoff:** Go's first build is slow (cold standard library), and the
  app keeps its own Go build cache that grows over time.
- **Tradeoff:** the Docker image grows by Python (and by about 250 MB more
  with Go when built with the arg).
- **Tradeoff:** a second cache file per problem (the sidecar), chosen so that
  older builds never lose a pasted statement.

## Recommendations pending founder confirmation

These are the Architect's choices; the founder confirms or changes them when
reviewing this PR.

1. **Limits:** Python 5 s; Go 30 s build + 5 s run; 64 KiB per stream;
   64 KiB code; 20 runs per minute; 1 GiB memory and 5 s CPU where `prlimit`
   exists.
2. **Go in Docker:** build arg, default off (about +250 MB otherwise).
3. **Shared computers:** documented as "do not enable" rather than blocked
   in code (the app cannot detect it reliably).
4. **stdin:** empty in phase 1; user-provided stdin later.

Any change to these decisions requires a new ADR.
