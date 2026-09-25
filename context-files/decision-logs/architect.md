# Decision Log — Architect

> Write-only running record for founder oversight. Format:
> `YYYY-MM-DD  <branch/PR>  — decision — rejected alternative — why`

2026-09-05  architect/scaffold-monorepo (PR #2)  — Scaffold monorepo with npm workspaces + TS project references (`tsc --build`) — rejected a single flat tsconfig — project refs enforce package build order and the dependency direction (cli/web → core) at compile time.
2026-09-05  architect/scaffold-monorepo (PR #2)  — Kept scaffold to structure + tooling + placeholder exports only; did NOT define the storage/LLM interfaces — rejected shipping interfaces here — charter §5.2 requires interface contracts to land via their own ADR (next-up item 2).
2026-09-05  architect/scaffold-monorepo (PR #2)  — `verify` = typecheck → lint → format(check) → build → test, matching CI order — rejected omitting format from verify — keeps local `npm run verify` a true mirror of the CI gate (charter §3.2).
2026-09-05  architect/scaffold-monorepo (PR #2)  — Scoped Prettier to code and ignored prose docs (`*.md`, `context-files/`, `.github/`) — rejected reformatting the committed foundation docs to satisfy `prettier --check` — reformatting design-session prose is out of scope and would churn files owned elsewhere.
2026-09-05  architect/scaffold-monorepo (PR #2)  — Pinned all devDeps to exact versions (charter §7.1); deferred ESLint 9 upgrade despite audit warnings on eslint@8 transitive deps — rejected `npm audit fix --force` — it would force a major ESLint bump (flat config) mid-scaffold; tracked as a follow-up. Dev-only, not shipped.
2026-09-05  architect/two-tier-restructure (PR #3)  — Split the two-tier team-model restructure into its own PR, separate from scaffold PR #2 — rejected bundling it into the scaffold PR — keeps scaffold PR focused on monorepo skeleton/tooling; also excluded .kiro/ (local agent tooling) from version control via .gitignore.
2026-09-05  architect/interface-skeletons (PR #4)  — Landed Storage + LLM Provider interface contracts as types-only skeletons (ADR 0002) — rejected shipping concrete adapters in same PR — charter §5.2 requires interface contracts land separately from implementations; keeps verify green without feature logic.
2026-09-06  integrate/storage-git  — LocalFileStorageAdapter with JSON diffable files under user-configured basePath, zero new deps (node:fs/promises + node:path), type guards for untrusted input validation — rejected env-based config — constructor arg keeps config explicit and testable without global state.
2026-09-06  frontend/web-assess  — web front-end (ASSESS slice): Node built-in http localhost:127.0.0.1 composition root; env IBAI_DATA_DIR (+ --data-dir flag) → LocalFileStorageAdapter → core assess() → HTML/JSON render — rejected external web framework (kept zero-dep, local-first) — no product logic in web, front-end parity with engine.
2026-09-07  implement/assess  — Assess implemented against StorageAdapter (type-only import), takes optional front-end-supplied sessionId, no interface change, no ADR needed.
2026-09-07  frontend/cli-assess (PR)  — Chose node:util parseArgs (built-in) for arg parsing — rejected CLI frameworks (commander, yargs) — zero-dep, consistent with local-first hard constraint.
2026-09-07  frontend/cli-assess (PR)  — CLI is composition root that constructs concrete LocalFileStorageAdapter, injects into core's assess() — rejected having core instantiate adapters — keeps core stateless, adapters injectable for testing.
2026-09-07  frontend/cli-assess (PR)  — Assess slice only; Plan/Coach commands deferred — rejected full CLI in one PR — matches incremental delivery model, engine capability not yet available.
2026-09-07  architect/note-ui-rework  — Recorded founder request to rework the web UI/UX into a polished experience — rejected doing it now — deferred/backlogged pending Plan/Coach engine work so the UI has richer content to present.
2026-09-07  implement/plan  — Plan: signature plan(view: AssessmentView): SessionPlan — takes pre-computed view, NOT StorageAdapter — rejected plan(storage, sessionId?) that calls assess() internally — avoids duplicate storage reads and duplicate ranking; keeps Plan a pure synchronous derivation; caller (Coach/orchestrator) already has the view or can call assess() once.
2026-09-07  integrate/provider-ollama  — OllamaProvider uses Node built-in fetch (no vendor SDK), constructor config (endpoint default localhost:11434, user-supplied model required), untrusted-response validation with type guard before mapping — rejected Ollama SDK dependency — keeps zero-dep + local-first.
2026-09-08  frontend/web-plan-ux  — Wired plan() into web handler, reusing AssessmentView from single assess() call (no duplicate storage read). Added /plan.json endpoint. Redesigned HTML with dark theme, 'Where You Stand' + 'Your Next Session' sections, topic cards with role badges (warmup/focus/twist) and proficiency bars. All dynamic content escaped via escapeHtml(). Self-contained CSS, no external assets. — rejected serving plan separately — plan derives from view; single request pattern reduces latency and keeps front-end thin.
2026-09-08  frontend/cli-plan  — Added plan subcommand to CLI for parity with web app — plan is separate command from assess — reuses core plan() function, no interface changes needed.
2026-09-08  implement/coach  — Coach closes the growth loop: engine builds role-tagged prompt (persona+session structure), provider transports to model, SessionSummary + competency/weakness updates derived DETERMINISTICALLY from front-end-supplied outcomes (not parsed from model text). Narrative is sole model-sourced field. No-authored-answers safeguard: persona explicitly instructs model to ELICIT user intuition and NEVER provide solutions — rejected model-parsing for numeric updates — keeps updates reproducible and testable; the engine scaffolds, the model coaches.

- 2026-09-08: Added explicit @ibai/core → @ibai/providers dependency declaration for correctness (Coach import edge).
2026-09-10  frontend/cli-coach  — Wired coach into CLI as thin composition root; outcomes via repeatable --outcome flag (topicId:pass|fail[:note]); OllamaProvider config via --ollama-url/--model (env fallbacks IBAI_OLLAMA_URL/IBAI_OLLAMA_MODEL); friendly Ollama-down error; no interface changes — rejected embedding provider config in core — keeps CLI as sole composition root, adapters injectable for testing.

2026-09-10  frontend/web-coach  — Wired Coach into the local web app for parity with CLI; composition root constructs LocalFileStorageAdapter + OllamaProvider and injects into core; GET /coach (form), POST /coach (run assess→plan→coach with write-back → HTML), POST /coach.json; mutating trigger uses POST; localhost-only, friendly Ollama-down error, all output HTML-escaped — rejected putting any session logic in web — keeps web thin, parity with CLI, core owns the loop.
2026-09-12  architect/curriculum-adr  — new @ibai/curriculum leaf package; Problem schema = id/title/url/difficulty/topics (links + difficulty only, NO answers/solutions/hints); read-only CurriculumSource contract; CurriculumTopicId aligns with storage TopicId by convention — rejected putting catalog in @ibai/core (violates core decoupling), in @ibai/storage (blurs shipped-vs-personal), or fetching from remote service (adds infra, breaks offline-first).

2026-09-13  feature/demo-provider  — demo-provider: ship built-in deterministic EchoDemoProvider (opt-in default-for-demo, interviewer-style prompting only, NO answers/solutions) to enable a zero-config offline demo — rejected requiring Ollama for any demo & a random/LLM-ish fake — keeps bring-your-own-LLM (§6.3) + §6.2 intact, deterministic/testable, local-first.

2026-09-13  feature/interview-ui  — interactive interview UI with EchoDemoProvider default: stateless turn-by-turn flow gathers answers then ONE coach() call; provider always present (demo fallback); chat-like transcript; XSS-escaped all dynamic content — rejected session storage in core/web — keeps web stateless and thin, all state in form hidden fields.

### 2026-09-15: ui-hardening — IntuitionNote extension + home-bug fix

**What:** Additive amendment to ADR 0005 IntuitionNote interface with three new
optional fields (`completed`, `timeComplexity`, `spaceComplexity`) for tracking
completion and solution complexity. Notes editor UI extended with checkbox and
text inputs. Dashboard shows completed count/list. Catalog shows ✓ done marker.

**Home bug root cause:** Boot file (server.ts) created `LocalFileStorageAdapter`
at startup and passed it to `createCoachHandler` WITHOUT the `createStorage`
factory or `defaultDataDir`. The handler's per-request resolution code
(`deps.createStorage ? deps.createStorage(resolvedDataDir) : deps.storage`)
always fell back to the stale boot-time storage. After `/setup` set the cookie
and created the dir, home still read the OLD boot dir.

**Fix:** Inject `createStorage` factory + `defaultDataDir` + `env` + `argv` at
boot. Per-request resolution now honors cookie>env>default precedence.

**Why not a new ADR:** This is an additive, backward-compatible extension within
the existing IntuitionNote model (ADR 0005 D3). No new interfaces, no breaking
changes. A decision-log entry is sufficient.
2026-09-24  feature/m6-spa-is-app (PR open)  — M6 (ADR 0006): the React SPA is now the whole UI, served at the site root `/` (Vite base `/`; client-side routing for /notes/:id, /analytics, /interview with index.html fallback). Retired all server-rendered product pages + their render*Html functions and their tests; kept /api/*, the SPA bundle+assets, and the /setup create-database flow server-rendered (create dir + persistent ibai_data_dir cookie, links back to /). — rejected approach (b) redirect-to-/app — adjusting the Vite base to / was clean, so one canonical root URL with no redirects beats keeping the /app prefix. Verified CLEAN npm ci → npm run verify GREEN + live curl (/ serves SPA local assets no CDN; /api works; create-db → dbConfigured true; retired paths serve the SPA not old HTML).

2026-09-24  feature/q4-competency-analytics (PR)  — Surfaced competency intelligence in Analytics via a dedicated read-only `GET /api/competency` (reads `readCompetencySignals`; returns flat sorted `{topics,patterns}`, safe-empty when no DB/signals) + a hand-built inline-SVG Competency section in `Analytics.tsx` (per-topic strength bars weak=red/improving=amber/strong=emerald + recurring miss-patterns list, own empty state → `/interview`), pure helpers in `lib/competency.ts` — rejected extending `/api/progress` or a chart library/CDN — a dedicated endpoint keeps the progress contract stable and read-only, and hand-rolled SVG (reusing the M4 style) honors §6.4 local-first + §7.1 no-new-deps; storage/Q1/Q2 interfaces consumed unchanged, no user data committed (§6.1), dataset is the user's OWN outcomes/patterns only (§6.2). Completes the Quickfire Quiz Master (Q1–Q4).