# Progress / Status Dashboard

> The founder's daily review surface. Every agent MUST update this when it
> starts and finishes a unit of work. Keep entries short and current.
> Format per active item: **[agent] branch — what / status / PR link / next**.

_Last updated: 2026-09-24 (M6 SPA-is-app → **React migration COMPLETE**, PR open on feature/m6-spa-is-app: the React SPA is now the whole UI, served at the site root `/` (Vite base `/`; client-side routing for /notes/:id, /analytics, /interview with index.html fallback). Retired all server-rendered product pages + their render*Html functions (/, /catalog, /notes/* HTML, /coach + /coach.json, /analytics, /dashboard, /assess, /assess.json, /plan.json) and their tests; KEPT all /api/* endpoints, the SPA bundle+assets, and the /setup create-database flow server-rendered (create dir + persistent ibai_data_dir cookie, links back to /). No new deps; core/storage/providers/curriculum interfaces unchanged. Verified CLEAN npm ci → npm run verify GREEN + live curl (/ serves SPA local assets no CDN; /api works; create-db → dbConfigured true; retired paths serve the SPA, not old HTML). M5 Interview chat merged (PR #44); M4 Analytics merged (PR #43); M3 Notes merged (PR #42); M2 Home merged (PR #41); M1 JSON API merged. ADR 0005 onboarding-catalog-first accepted; supersedes ADR 0004 demo-provider path; extends ADR 0003 curriculum usage; 6-step implementation roadmap recorded. Interactive interview UI on feature/interview-ui; Demo provider PR open on feature/demo-provider; Web Coach wiring PR open on frontend/web-coach; CLI Coach wiring PR open on frontend/cli-coach; Coach engine PR merged; Plan PR #12 merged; Ollama provider PR #13 merged; CLI assess+plan merged; web Assess PR #10 open; UI/UX rework backlogged #11)_

## Legend
- ✅ done & merged   🟡 in progress / PR open   ⛔ blocked   ⬜ not started

## Team model

Two tiers: **Architect** (sole orchestrator agent; talks to founder; dispatches
skills) + six **skills** in `skills/` (scaffold, implement, integrate, frontend,
verify, code-review). See `team-charter.md` §0 & §9A and
`skills/00-skill-contract.md`.

## Milestone: Web React migration

| Item | Status | Notes |
|---|---|---|
| M0 — Toolchain scaffold (React + Vite + Tailwind + Lucide) | 🟡 PR open | `feature/m0-react-scaffold` — ADR 0006. React 18.3.1/react-dom 18.3.1/lucide-react 0.462.0 (runtime); vite 5.4.21/@vitejs/plugin-react 4.7.0/tailwindcss 3.4.19/postcss 8.5.28/autoprefixer 10.4.27/@types/react 18.3.31/@types/react-dom 18.3.7 (dev); eslint-plugin-react 7.37.5/eslint-plugin-react-hooks 4.6.2 (root dev). UI lives in `packages/web/web-ui/` (Vite → `dist-ui/`), SEPARATE from the server tsc build (`dist/`). Styled SHELL only (nav + `InterviewBudAI` wordmark + Lucide icons + slate/emerald + status/difficulty design tokens); NO product features. Existing Node server serves the bundle at **GET `/app`** (+ local `/app/assets/*`); `/`, `/catalog`, etc. untouched. Graceful degrade if bundle absent. Root `build` = `tsc --build && build:ui`; `typecheck` includes `tsc --noEmit` on the .tsx. Added project `.npmrc` (public npm registry). Verified from CLEAN `npm ci` → `npm run verify` GREEN (24 files/408 tests incl. lint+format) + live curl: `/app` 200 (local assets, no CDN), `/` 200. Local-first: Tailwind→static CSS, lucide→bundled JS, no runtime network. |
| M1 — JSON API endpoints (SPA fetches them) | 🟡 PR open | `feature/m1-json-api` — added same-origin, localhost-only JSON API under `/api` (server stays storage owner). New `packages/web/src/api.ts` (pure builders + `isApiRoute`/`handleApiRoute`), intercepted early in `handler.ts` after the `/app` block so existing server-rendered routes + `/app` are untouched. Endpoints: `GET /api/catalog` (grouped-by-topic + per-problem `status`/`completed` + `totals`), `GET/POST /api/notes/:id` (catalog-validated → 404 unknown; untrusted body → 400 malformed/invalid-status; `completed`⇔`done`), `GET /api/progress` (`{completed,total,byStatus}`), `GET /api/config` (`{dbConfigured,dataDir?,provider}`). All JSON; unknown `/api`→404, wrong method→405, no HTML; data dir via cookie>env>default; no-DB is a safe state (catalog/progress all-none; notes GET `{dbConfigured:false}`; notes POST `400`). No new deps; interfaces unchanged. Verified CLEAN `npm ci`→`npm run verify` GREEN (25 files/430 tests incl. lint+prettier) + live curl per endpoint (persist/round-trip on disk; counts reflect seed; 404/400/405 JSON; `/` & `/app` still 200; no-DB live). |
| M2 — Home → React | 🟡 PR open | `feature/m2-home` — Home page in the SPA at `/app`: global progress banner (`GET /api/progress`, emerald bar + status breakdown) + categorized accordion problem list (`GET /api/catalog`, per-topic chevron + `done/total` badge). Table columns: interactive 4-state Status control (optimistic update of row+badge+bar, `POST /api/notes/:id`, revert+subtle error on failure), problem Title (→ LeetCode, new tab noopener), Difficulty badge (strict colors), Notes link (→ existing `/notes/<id>`, M3 replaces). No Solution/Video/Code (§6.2). `dbConfigured:false` → create-database CTA (→ `/setup`); loading/error states friendly. Client-side React state only (no router/redux). Added pinned dev deps for the React test setup: `@testing-library/react` 14.3.1, `@testing-library/jest-dom` 6.4.8, `@testing-library/user-event` 14.5.2, `jsdom` 24.1.3 (+ web-ui `vitest.config.ts` jsdom project wired into root `test`). Local-first: served `/app` HTML references only local `/app/assets/*` (no CDN). Verified CLEAN `npm ci`→`npm run verify` GREEN (node 25 files/430 tests + web-ui 5 files/18 tests, incl. typecheck+lint+prettier+build+build:ui) + live: `/app` 200 no-CDN; seeded `POST /api/notes/lc-53 {done}` → `/api/progress` 0→1 and `/api/catalog` shows `lc-53` done; `dbConfigured:false` confirmed. |
| M3 — Notes → React | 🟡 PR open | `feature/m3-notes` — React Notes/intuition editor in the SPA at `/app/notes/<id>`, replacing the server-rendered `/notes/<id>` for SPA users (old HTML route remains until M6). Fetches `GET /api/notes/:id` (saved note) + `GET /api/catalog` (title/url) and pre-fills: problem title (→ LeetCode, `target=_blank rel=noopener`; falls back to the id if catalog lookup fails), the 4-state Status control (reused `StatusControl`), a free-text Intuition `textarea`, and Time/Space complexity inputs. Save → `POST /api/notes/:id {content,status,timeComplexity,spaceComplexity}` → **"Saved"** confirmation (reconciles local state; editing clears stale confirmation). States: no-DB → create-database CTA (→ `/setup`); unknown id (`404`) → friendly "Problem not found"; network/API error → inline error; none crash. Back-to-Home link. Added a minimal in-repo router (`src/lib/router.ts`, History API + React built-ins — **no routing lib**); `App.tsx` switches Home/Notes on the path; Home's Notes link now points at `/app/notes/<id>` with client-side nav. All values via JSX (no `dangerouslySetInnerHTML`). No new deps; M1 API + core/storage/providers/curriculum interfaces unchanged. Verified from CLEAN `npm ci` → `npm run verify` GREEN (incl. typecheck+`eslint .`+`prettier --check .`+build+build:ui+tests; web-ui 7 files/32 tests) + `build:ui` succeeds. |
| M4 — Analytics → React | 🟡 PR open | `feature/m4-analytics` — React Analytics page in the SPA at `/app/analytics` (via the existing History-API router; added an **Analytics** SPA nav link with active state + client-side nav). Fetches `GET /api/config` + `GET /api/progress` + `GET /api/catalog` and renders real, **hand-built inline-SVG** charts (no external chart lib/CDN/network — plain `<svg>` driven by pure geometry helpers): (1) **status-breakdown** vertical bar chart of `byStatus` in the design-system status colors (done=emerald / to_revisit=amber / did_not_understand=red / none=slate); (2) **per-topic completion** horizontal emerald bars (done/total) from the catalog; (3) a concise **summary** (overall completed/total + % + per-status count/share table). Safe **empty state** ("No data yet — start practicing", links catalog/`/setup`) when `dbConfigured:false` or zero tracked; friendly loading + API-error states; none crash. Old server-rendered `/analytics` left untouched (M6 retires it). Pure chart-geometry helpers (`statusSlices`, `barLength`, `topicCompletionBars`, `completionPercent`, `hasTrackedData`) in `src/lib/analytics.ts`, unit-tested; SVG components (`StatusBreakdownChart`, `TopicCompletionChart`) map geometry→shapes. All values via JSX (auto-escaped); no `dangerouslySetInnerHTML`. No new deps; M1 API + core/storage/providers/curriculum interfaces unchanged. Verified from CLEAN `npm ci` → `npm run verify` GREEN (typecheck + `eslint .` + `prettier --check .` + build + test; node 25 files/430 tests + web-ui 10 files/57 tests) + `build:ui` succeeds; built `dist-ui/index.html` references only local `/app/assets/*` (no external CDN). |
| M5 — Interview chat → React | 🟡 PR open | `feature/m5-chat` — React interview chat in the SPA at `/app/interview` (via the existing History-API router; the **Interview** nav link now points here with active state + client-side nav, moved off the server-rendered `/coach` which stays until M6). New server endpoint **`POST /api/chat`** in the `/api` handler (`api.ts`): body `{ messages: [{role:'user'\|'assistant',content},…] }` (prior transcript + new user turn, untrusted → validated: non-empty array ending in a `user` turn, else `400`), builds `PromptMessage[]` = `[{system: coach persona reused from the `/coach` POST}, …conversation]`, calls `provider.complete()`, returns `{ reply }`. Provider **REQUIRED**: none → `400 {error:'no model configured'}`; provider reject classified (auth/connection/malformed/empty) → `502` clear JSON, never crashes; wrong method → `405`. Provider now injected into `ApiDeps` (handler passes `deps.provider`); core/storage/providers/curriculum interfaces UNCHANGED. React `Interview.tsx`: transcript (you=emerald right / coach=slate left, JSX auto-escaped, `whitespace-pre-wrap`, no `dangerouslySetInnerHTML`), composer (Enter sends / Shift+Enter newline), optimistic user-turn append → `POST /api/chat` → append model `{reply}` (the MODEL is the only source of assistant text, §6.2 — no canned answers), "thinking" spinner, provider-required "Configure a model…" state (via `GET /api/config`, and on a send `400`), friendly **inline error banner preserving the transcript** on failure. New `postChat` client + `ChatMessage`/`ChatResponse` types; `interview` route + `interviewHref()` added to the router (no routing lib). No new deps. Verified from CLEAN `npm ci` → `npm run verify` GREEN: typecheck(.tsx) + `eslint .` + `prettier --check .` + build + `build:ui` + tests (node 25 files/**441** tests + web-ui 11 files/**70** tests); `build:ui` succeeds; built `dist-ui/index.html` references only local `/app/assets/*` (no external CDN). Server tests use a fake counting `LlmProvider` (no network): 200 `{reply}` + persona/order asserted, 400 no-provider, 502 auth/connection/empty, 400 malformed/bad-role/not-ending-user, 405 GET. React tests (mocked fetch): render, Send appends+posts+appends reply, multi-turn transcript, no-provider state, error→inline banner preserving transcript, 400→configure state, XSS-safe. |
| M6 — Retire server-rendered HTML | ✅ done (PR open) | `feature/m6-spa-is-app` — **React migration COMPLETE**. Chose serve-at-`/` **approach (a)**: Vite `base` → `/`; the SPA is served at the site root and all non-API, non-`/setup` GET paths fall back to `index.html` for client-side routing (`/notes/:id`, `/analytics`, `/interview`). Router `APP_BASE` → `''` with root-relative hrefs (`/`, `/notes/:id`, `/analytics`, `/interview`). **Retired** the server-rendered pages + their `render*Html` functions: `GET /`, `/catalog`, `/notes/*` HTML, `/coach`+`/coach.json`, `/analytics`, `/dashboard`, `/assess`, `/assess.json`, `/plan.json` and `renderHomeHtml`/`renderCatalog*`/`renderStatusBadge`/`renderNotes*`/`renderAnalyticsHtml`/`renderProficiencySvg`/`renderStatusBreakdownSvg`/`renderAssessment*`/`renderPlan*`/`renderCoach*`/`renderInterviewStep`/`renderNoTopicsState`/`renderChat`/`renderProviderRequired`/`computeProficiencyBars` + dead types; deleted their tests (`catalog`/`coach`/`notes` test files). **Kept**: all `/api/*` (catalog/notes/progress/config/chat), SPA bundle+assets, and the **`/setup` create-database flow** server-rendered (GET form + POST create-dir + persistent `ibai_data_dir` cookie, now links back to `/`). Survivors in `render.ts`: `escapeHtml`, `getCommonStyles`, wordmark-only `renderNav`, `computeStatusCounts`/`StatusCounts` (used by `api.ts`), `renderSetupHtml`/`renderSetupSuccessHtml`/`renderSetupErrorHtml`, `render404Html`. `spa.ts` → `isSpaRequest`/`handleSpaRequest`. No new deps; core/storage/providers/curriculum interfaces UNCHANGED. Verified from CLEAN `npm ci` → `npm run verify` GREEN (typecheck incl. .tsx + `eslint .` + `prettier --check .` + build + `build:ui` + tests: node 22 files/290 + web-ui 11 files/70) + live curl: `/` 200 SPA (local `/assets/*`, 0 external CDN), `/api/catalog|progress|config` 200 JSON, `POST /setup` creates dir + sets `Max-Age=31536000` cookie → `GET /api/config` w/ cookie `dbConfigured:true`, retired `/coach` & `/catalog` serve the SPA shell (not old HTML), asset 200 / missing-asset 404. |

## Milestone: UI/UX Revamp

| Item | Status | Notes |
|---|---|---|
| B1 — Status field data model (`NoteStatus` + `IntuitionNote.status`) | 🟡 PR open | `feature/status-tags` — additive `export type NoteStatus = 'none' \| 'done' \| 'to_revisit' \| 'did_not_understand'`; `status?` on IntuitionNote; `completed` kept for back-compat and kept consistent (`'done'` ⇔ `completed:true`); `resolveNoteStatus`/`isNoteStatus` helpers exported. LocalFileStorageAdapter persists/parses `status` in frontmatter (tolerant: missing→undefined, unknown→ignored, legacy `completed:true`→`done`, no throw). |
| B2 — Notes editor status selector (`/notes/<id>`) | 🟡 PR open | `feature/status-tags` — checkbox replaced by a `<select>` (None / Done / To revisit / Did not understand), pre-filled from saved `status` (falls back to `completed`); POST parses status, saves it, keeps `completed` consistent. Catalog ✓ marker + dashboard count still driven by `completed` (Done keeps it true). Scope limited to data model + notes editor (Milestone A/C own home/catalog/dashboard). |
| A1 — De-clutter header (wordmark in nav) | 🟡 PR open | `feature/home-revamp` — removed the big body `<h1>`/tagline; `InterviewBudAI` is now a left-side wordmark in the shared `renderNav` (every page). Tagline dropped. |
| A2 — Actions (top button; Interview nav-only) | 🟡 PR open | `feature/home-revamp` — "Continue practicing" is a top action-bar button; "Interview with AI" body button removed (reachable via nav "Interview" only); both big action cards removed. |
| A3 — Home = catalog | 🟡 PR open | `feature/home-revamp` — GET `/` renders the grouped-by-topic catalog table directly when a DB is configured; create-database CTA when not. Shared `renderCatalogTable` reused by home + standalone `/catalog`; Catalog dropped from nav. |
| A4 — Per-row status badges | 🟡 PR open | `feature/home-revamp` — each home row shows a status badge via `resolveNoteStatus` (Done green / To revisit amber / Did not understand red / none). Read-only, safe with no DB. Verified live (seeded `to_revisit` → badge appears). |
| C1 — Rename Dashboard → Analytics | 🟡 PR open | `feature/analytics` — route `/dashboard`→`/analytics` (handler `isAnalytics`, knownPaths, 404/405 coherent); `GET /dashboard` now **302-redirects** to `/analytics` for back-compat. Nav label + all internal link text/hrefs ('Go to Dashboard', '← Back to Dashboard', etc.) → Analytics. `renderDashboardHtml`→`renderAnalyticsHtml` (title + heading say Analytics). Imports/callers/tests updated. Verified live (curl `/dashboard`→302 `/analytics`; `/`→200). |
| C2 — Real charts/tables | 🟡 PR open | `feature/analytics` — replaced the plain 'Completed (N)' list with real, hand-built **inline-SVG** charts (no external lib/CDN/network): (a) proficiency horizontal bar chart from AssessmentView, (b) status-breakdown bar chart + table (Done/To revisit/Did not understand/Not started) aggregated across the catalog via `resolveNoteStatus`. Safe empty state when no data. Pure helpers (`computeProficiencyBars`, `computeStatusCounts`, `renderProficiencySvg`, `renderStatusBreakdownSvg`) unit-tested; all labels HTML-escaped incl. SVG text. Verified live (seeded 2 done + 1 to_revisit → `/analytics` 200 with `<svg>`, table Done=2/To revisit=1/Total=175). |

## Milestone: Foundation

| Item | Status | Notes |
|---|---|---|
| Project context + architecture docs | ✅ | `context-files/00`, `01` |
| Team charter (RFC 2119) | ✅ | two-tier model, §9A layered review |
| Architect orchestrator agent | ✅ | `team/architect.md` |
| Skill contract + 6 skills | ✅ | `skills/*.md` |
| ADR 0001 foundational decisions | ✅ | `context-files/decisions/0001-*` |
| CI workflow + PR template | ✅ | `.github/` |
| Branch-protection setup guide | ✅ | `.github/BRANCH_PROTECTION.md` |
| Retired 4 agent files → skills | ✅ | engine/integrations/interface/qa removed |

## Milestone: Scaffold

| Item | Status | Notes |
|---|---|---|
| npm workspaces monorepo skeleton | ✅ merged | `architect/scaffold-monorepo` → PR #2 merged. `packages/{core,providers,storage,cli,web}` |
| Root tooling + `npm run verify` | ✅ merged | TS project refs, ESLint, Prettier, Vitest; `verify` green locally |
| Two-tier team model restructure | ✅ merged | `architect/two-tier-restructure` → PR #3 merged |

## Milestone: Interfaces

| Item | Status | Notes |
|---|---|---|
| Storage + LLM provider interface contracts (types-only) | ✅ merged | `architect/interface-skeletons` → PR #4 merged. ADR 0002; `packages/storage`, `packages/providers` |

## Milestone: Engine Jobs

| Item | Status | Notes |
|---|---|---|
| Assess engine job | ✅ merged | `implement/assess` → PR merged. Pure read-and-derive from StorageAdapter. |
| Plan engine job | ✅ merged | `implement/plan` → PR #12 merged. Pure sync derivation from AssessmentView. |
| Coach engine job | ✅ merged | `implement/coach` → PR merged. Closes the growth loop: read progress → session → structured summary → competency/weakness updates. |

## Milestone: Adapters

| Item | Status | Notes |
|---|---|---|
| LocalFileStorageAdapter | ✅ merged | `integrate/storage-git` → PR merged. Git/local file storage adapter. |
| OllamaProvider | ✅ merged | `integrate/provider-ollama` → PR #13 merged. First concrete LLM provider. |
| AnthropicProvider | 🟡 PR open | `integrate/provider-anthropic` — Reusable HTTP core + Claude adapter; ADR 0005 step 5. |
| Demo provider (zero-config) | ✅ REMOVED | EchoDemoProvider removed per ADR 0005 D6; provider now REQUIRED. |

## Milestone: Front-ends (current)

| Item | Status | Notes |
|---|---|---|
| CLI assess command | ✅ merged | `frontend/cli-assess` → PR #9 merged. |
| CLI plan command | ✅ merged | `frontend/cli-plan` → PR merged. |
| CLI coach command | 🟡 PR open | `frontend/cli-coach` — wires coach into CLI as thin composition root; OllamaProvider config; --outcome flag. |
| Web assess slice | 🟡 PR open | `frontend/web-assess` → PR #10 open. localhost HTTP server, HTML/JSON render. |
| Interactive interview UI (Step 5b) | ✅ complete | `feature/ai-interview-ui` — turn-by-turn AI interview; self-assess Pass/Fail removed (model evaluates); POST /coach + /coach.json ungated; provider-required friendly state; fail-closed error handling. Last deferred: bulk-import of founder's Notion intuitions. |

## Milestone: Curriculum

| Item | Status | Notes |
|---|---|---|
| ADR 0003 curriculum layer | 🟡 PR open | `architect/curriculum-adr` — decides @ibai/curriculum location, Problem schema (links+difficulty only), read-only CurriculumSource contract. Types-only skeleton; real catalog + loader is follow-up. |
| ADR 0005 onboarding + intuition | ✅ | `architect/onboarding-adr` — catalog-first onboarding, intuition capture (IntuitionNote type + optional StorageAdapter methods), AI-evaluation interview model. Supersedes ADR 0004 demo-provider path; extends ADR 0003 curriculum usage. 6-step roadmap: (1) ADR → (2) seed catalog → (3) web catalog landing → (4) notes/intuition impl → (5) Anthropic provider → (6) remove demo + AI-eval interview. |
| Web catalog landing + create-database | ✅ merged | `feature/web-catalog-landing` — ADR 0005 D1/D2 impl. Catalog-first onboarding, /catalog route, /notes/<id> placeholder, /setup + create-database + cookie persistence. Roadmap step 3. |
| Notes/intuition capture | 🟡 PR open | `feature/notes-capture` — ADR 0005 D3/D4 impl. IntuitionNote type, StorageAdapter.saveNote/listNotes/getNote, /notes routes with save/edit. Roadmap remaining: Anthropic provider, AI-eval interview, demo removal, bulk-import. |

## Next up (Architect dispatches these skills)

1. 🟡 `frontend` — **CLI coach command** (`@ibai/cli`) coach() wiring + formatCoach + tests.
   **PR open** on `frontend/cli-coach`. → `code-review`.
2. 🟡 `frontend` — **web ASSESS slice** (`@ibai/web`) localhost HTTP server,
   HTML/JSON render of AssessmentView. **PR #10 open** on `frontend/web-assess`. → `code-review`.

## Decision Log

| Label | Date | Summary |
|-------|------|--------|
| m4-analytics | 2026-09-24 | ADR 0006 M4: built the Analytics page in React at `/app/analytics`, consuming the M1 JSON API. Real, **hand-built inline-SVG** charts (no external chart lib/CDN/network): a status-breakdown vertical bar chart of `GET /api/progress` `byStatus` in the design-system status colors (done=emerald/to_revisit=amber/did_not_understand=red/none=slate); per-topic completion horizontal emerald bars (done/total) from `GET /api/catalog`; and a summary (overall completed/total + % + per-status count/share table). Safe empty state ("No data yet — start practicing", links catalog/`/setup`) when no DB or nothing tracked; friendly loading + API-error states. Added an Analytics SPA nav link (client-side nav, active state) and an `analytics` route to the existing History-API router (no routing lib). Pure chart-geometry helpers in `src/lib/analytics.ts` (`statusSlices`/`barLength`/`topicCompletionBars`/`completionPercent`/`hasTrackedData`), unit-tested; SVG components map geometry→shapes. All values via JSX (auto-escaped); no `dangerouslySetInnerHTML`. Old server-rendered `/analytics` untouched (M6 retires it). No new deps; M1 API + core/storage/providers/curriculum interfaces unchanged. Verified CLEAN `npm ci`→`npm run verify` GREEN (typecheck+`eslint .`+`prettier --check .`+build+test; node 25/430 + web-ui 10/57) + `build:ui` succeeds; built `dist-ui/index.html` references only local `/app/assets/*` (no CDN). PR open on `feature/m4-analytics`. |
| m2-home | 2026-09-24 | ADR 0006 M2: built the Home page in React at the SPA root of `/app`, consuming the M1 JSON API. Global progress banner (`GET /api/progress`) with emerald linear bar + status breakdown; categorized accordion list (`GET /api/catalog`) with per-topic chevron + `done/total` badge; spreadsheet table with an interactive 4-state Status control (optimistic row+badge+bar update, `POST /api/notes/:id`, revert+subtle error on failure), title→LeetCode (new tab noopener), difficulty badge, Notes→`/notes/<id>` (M3 replaces). No Solution/Video/Code (§6.2). No-DB→create-database CTA (`/setup`); friendly loading/error states. Client-side React state only (no router/redux). Reused M0 tokens. Added pinned dev deps for the React test setup (RTL 14.3.1, jest-dom 6.4.8, user-event 14.5.2, jsdom 24.1.3) + a jsdom `vitest.config.ts` wired into root `test`. Server contracts UNCHANGED (M1 consumed as-is). Verified CLEAN `npm ci`→`npm run verify` GREEN (node 25/430 + web-ui 5/18, incl. lint+prettier+build:ui) + live curl (no-CDN `/app`; seed done→progress/catalog reflect). PR open on `feature/m2-home`. |
| m1-json-api | 2026-09-24 | ADR 0006 M1: added same-origin, localhost-only JSON API under `/api` for the SPA (server stays storage owner). `packages/web` only; interfaces unchanged; no new deps. `GET /api/catalog` (grouped-by-topic + per-problem status/completed + totals), `GET/POST /api/notes/:id` (catalog-validated, untrusted-body validation, `completed`⇔`done`), `GET /api/progress`, `GET /api/config`. All JSON (404 unknown `/api`, 405 wrong method); cookie>env>default data dir; no-DB safe state. New `src/api.ts` router intercepted early in `handler.ts`; existing pages + `/app` untouched. Verified CLEAN `npm ci`+`verify` GREEN (25 files/430 tests incl. lint+format) + live curl per endpoint. PR open on `feature/m1-json-api`. |
| m0-react-scaffold | 2026-09-24 | ADR 0006 accepted: adopt React + Vite + Tailwind + lucide-react for the web front-end (widely-used stable lines, pinned exact). M0 = toolchain scaffold + styled shell (nav + wordmark) served by the existing Node server at a new `/app` route; existing server-rendered pages untouched. UI in `packages/web/web-ui/` (Vite → `dist-ui/`), kept separate from the server tsc build. Root `build`/`verify` integrate `build:ui` and `.tsx` typecheck; added project `.npmrc` (public npm) so `npm ci`/CI resolve deps. Local-first: Tailwind→static CSS, lucide bundled, no runtime CDN. Verified CLEAN `npm ci`+`verify` green + live curl `/app` 200 (local assets, no CDN), `/` 200. M1–M6 migration roadmap recorded. |
| onboarding-adr | 2026-09-13 | ADR 0005 accepted: catalog-first onboarding, intuition capture (IntuitionNote + optional StorageAdapter methods), AI-evaluation interview. Supersedes ADR 0004 demo-provider fallback; extends ADR 0003 curriculum usage. 6-step impl roadmap recorded. |
| web-catalog-landing | 2026-09-14 | Catalog-first landing + create-database + cookie dataDir; Notes placeholder, intuition capture next PR. |
| app-shell-nav | 2026-09-14 | Added shared nav bar on all pages (Home, Catalog, Dashboard, Interview). Home landing at `/` with action buttons and progress summary. Dashboard moved to `/dashboard`. Nav includes active state and aria-current for a11y. |
| notes-capture | 2026-09-14 | IntuitionNote type + StorageAdapter methods (saveNote/listNotes/getNote) + web /notes routes with save/edit UI. Local-first note storage at dataDir/notes/<id>.json. No external deps added. |
| anthropic-provider | 2026-09-20 | Reusable HTTP provider core (http-provider.ts) + AnthropicProvider adapter. System messages → top-level field, max_tokens required (default 1024), content blocks mapping. Bring-your-own-key, no hardcoded model. |
| ui-hardening | 2026-09-15 | IntuitionNote extended with completed/timeComplexity/spaceComplexity (additive, ADR 0005 amendment). Notes editor UI with checkbox + complexity inputs. Dashboard shows completed list. Catalog shows ✓ done marker. Home bug fixed: boot now injects createStorage factory + defaultDataDir so per-request cookie>env>default resolution works. |
| home-three-state | 2026-09-20 | Root cause: empty AssessmentView (topicsTracked=0) conflated with no-db state. Fix: renderHomeHtml now takes dbExists boolean to distinguish three states: (1) no-db → create prompt, (2) empty-db → ready message, (3) has-data → progress summary. |
| ai-eval-engine | 2026-09-20 | ADR 0005 D6 impl (Step 5a): AI-evaluation coach() contract (model evaluates candidate answers, structured verdicts, fail-closed); EchoDemoProvider removed (supersedes ADR 0004); provider REQUIRED (Anthropic/Ollama). Web/CLI wiring minimal; conversational interview UI is PR 5b. |

## Backlog / future

- 🟡 **Web UI/UX rework** — rework the minimal `web` front-end into a polished UX with Plan engine wiring. **PR open** on `frontend/web-plan-ux`. Adds /plan.json endpoint, redesigned HTML with 'Where You Stand' + 'Your Next Session' sections, warmup→focus→twist cards with role badges and proficiency bars. (Tracked via #11.)

## Blocked / needs founder action

- ⛔ **Branch protection on `main`** must be enabled in GitHub settings by the
  founder (cannot be set from committed files). See `.github/BRANCH_PROTECTION.md`.
  Until then, the "never push to main / green-CI-required" guarantee is not
  enforced by the platform.

## Open questions / decisions pending

- _Foundational decisions recorded in ADR 0001._
- **Deferred (follow-up):** dev-only audit warnings from `eslint@8.57.0`
  transitive deps (`glob@7`). Upgrading to ESLint 9 (flat config) is a separate
  scoped change, not pulled into the scaffold PR. Not shipped (devDependency).


## 2026-09-20: Cookie Persistence Fix

- **Issue**: `ibai_data_dir` cookie was a session cookie, lost on browser restart
- **Fix**: Added `Max-Age=31536000` (~1 year) to make cookie persistent
- **Status**: PR open on `fix/cookie-persistence` branch
- **Tests**: Added regression tests for cookie persistence and round-trip verification

## 2026-09-20: Home Three-State Fix

- **Issue**: Home page conflated 'no database' with 'empty database' — existing but empty db showed "Create your database" forever
- **Root cause**: renderHomeHtml only checked `view !== null && view.topicsTracked > 0` without knowing if the directory actually exists
- **Fix**: Added `dbExists` boolean parameter to renderHomeHtml; three states: (1) !dbExists → create prompt, (2) dbExists && empty → ready message, (3) has data → progress summary
- **Status**: PR open on `fix/home-empty-vs-nodb` branch
- **Tests**: Added three-state regression tests including STATE 2 (existing empty dir via cookie)
