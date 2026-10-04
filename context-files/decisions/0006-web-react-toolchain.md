# ADR 0006 — Adopt React + Vite + Tailwind + Lucide for the web front-end

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Founder, Architect
- **Supersedes:** — (extends `01-architecture.md` front-end approach; supersedes nothing)

## Context

The `@ibai/web` front-end is currently a plain Node `http` server that
hand-writes HTML as template strings (`render.ts`), routed by `handler.ts` and
booted by `server.ts` / `server-bin.ts`. It has zero front-end dependencies.

As the product grows toward a NeetCode-style UI (catalog tables, per-problem
status, analytics charts, an interview chat), hand-written HTML strings are
becoming hard to compose, style consistently, and reuse. The founder wants a
consistent design system and a modern component model.

`01-architecture.md` locks the stack as TypeScript end-to-end on Node.js with an
npm-workspaces monorepo, and declares the web front-end a **thin** front-end
over the same engine. It does not pick a front-end rendering library. Adopting a
front-end framework is a **tech-choice change** (charter §5.2) and therefore
requires this ADR before implementation.

Two hard product rules constrain the choice (charter §6.4, `00-project-context.md`):

- **Local-first:** no mandatory network at runtime — no CDN, no remote fonts, no
  telemetry. The app must run fully offline once built.
- **Front-end parity:** capabilities live in `@ibai/core`; the web front-end
  only exposes them. This ADR changes only how the web front-end is *rendered*,
  not where capabilities live.

## Decisions

### D1 — Why: a component model with a consistent design system

Adopt a component-based front-end so the web UI can grow a **consistent design
system** (shared tokens: slate/emerald palette, status colors, difficulty
colors) and a NeetCode-style UI, per founder direction. Hand-written HTML
strings do not scale to that; a component model + utility CSS does.

### D2 — The stack (pinned, widely-used, local-first)

- **React + TypeScript** — component model, same language as the rest of the
  monorepo (charter §5 / ADR 0001 D6). React 18 (the widely-used stable line).
- **Vite** — build tool; compiles the React/TypeScript SPA to a **static
  bundle** (JS + CSS + `index.html`) with no runtime framework server.
- **Tailwind CSS** — utility CSS **compiled at build time** into a single static
  CSS file. Tailwind 3.x (classic `tailwind.config.js` + `theme.extend`) so the
  design tokens live as theme extensions later pages reuse.
- **lucide-react** — icon set, **bundled into the JS** at build time (no icon
  CDN, no icon font).

Exact pinned versions (charter §7.1 — pinned exact, widely used):

| Package | Version | Kind |
|---|---|---|
| react | 18.3.1 | runtime |
| react-dom | 18.3.1 | runtime |
| lucide-react | 0.462.0 | runtime |
| vite | 5.4.21 | dev |
| @vitejs/plugin-react | 4.7.0 | dev |
| tailwindcss | 3.4.19 | dev |
| postcss | 8.5.28 | dev |
| autoprefixer | 10.4.27 | dev |
| @types/react | 18.3.31 | dev |
| @types/react-dom | 18.3.7 | dev |
| eslint-plugin-react | 7.37.5 | dev |
| eslint-plugin-react-hooks | 4.6.2 | dev |
| @codemirror/state | 6.7.6 | runtime (bundled, lazy Notes chunk; ADR 0014 D2) |
| @codemirror/view | 6.43.13 | runtime (bundled, lazy Notes chunk; ADR 0014 D2) |
| @codemirror/commands | 6.11.1 | runtime (bundled, lazy Notes chunk; ADR 0014 D2) |
| @codemirror/language | 6.12.4 | runtime (bundled, lazy Notes chunk; ADR 0014 D2) |
| @codemirror/lang-python | 6.2.1 | runtime (bundled, lazy Notes chunk; ADR 0014 D2) |
| @codemirror/lang-go | 6.0.1 | runtime (bundled, lazy Notes chunk; ADR 0014 D2) |
| @lezer/markdown | 1.7.2 | runtime (bundled, lazy Notes chunk; ADR 0014 D2) |
| @lezer/highlight | 1.2.5 | runtime (bundled, lazy Notes chunk; ADR 0014 D2) |
| htmlparser2 | 10.1.0 | runtime, **server only** (`packages/web` `dependencies`; `statement-sanitize.ts`, never in the SPA bundle; ADR 0015 D2). 10.1.0 because 11/12 need Node ≥ 20.19. Transitive, pinned by the lockfile: `domhandler` 5.0.3, `domutils` 3.2.2, `domelementtype` 2.3.0, `entities` 7.0.1 (BSD-2-Clause), `dom-serializer` 2.0.0 (MIT) with its own `entities` 4.5.0 (BSD-2-Clause) |

**Rejected alternatives:** Tailwind 4.x (CSS-first config, less established, no
classic `theme.extend`) and Vite 8 / React 19 (newest majors, less
battle-tested) were rejected in favor of the widely-used stable lines for a
de-risking scaffold. Next.js / a meta-framework was rejected: it implies a
Node render server and heavier footprint, conflicting with the "thin front-end
+ existing local server owns storage" model.

### D3 — Local-first guarantee (no runtime network)

- Tailwind is compiled to a **static CSS file at build time**; no Tailwind
  runtime, no CDN `<link>`.
- lucide-react icons are **bundled into the JS** at build time; no icon CDN, no
  web font.
- `index.html` contains **no external `http(s)` `<link>`/`<script>`/font URLs** —
  only local, same-origin bundle assets.
- The built SPA is served by the **existing local Node server** (`@ibai/web`),
  which already binds to `127.0.0.1` only. There is **no** dev server or
  external origin at runtime.

This satisfies charter §6.4 / ADR 0001 D1: no mandatory network except the
user-configured LLM.

### D4 — Client/server split plan

- The React app is a **static SPA** built by Vite and **served as static files**
  (`index.html` + hashed JS/CSS assets) by the existing Node server.
- **M1** adds JSON API endpoints on the same server; the SPA fetches them (same
  origin, local). Until then the SPA is shell-only.
- The **server remains the storage owner** (ADR 0005 D2: browser = UI + cookie;
  server = filesystem authority). The SPA never touches the filesystem directly.
- Front-end parity holds: capabilities stay in `@ibai/core`; the SPA is a thin
  view that will call the engine via the server's JSON API.

### D5 — Migration plan (small serial milestones)

| Milestone | Scope |
|---|---|
| **M0** | Toolchain scaffold + a styled shell (nav + wordmark). No product features. Served at a **new** `/app` route so existing pages are untouched. (this PR) |
| **M1** | JSON API endpoints on the server; SPA fetches them. |
| **M2** | Home → React (move `/` catalog into the SPA). |
| **M3** | Notes → React. |
| **M4** | Analytics → React. |
| **M5** | Interview chat → React. |
| **M6** | Retire the server-rendered HTML strings once parity is reached. |

### D6 — Existing server-rendered pages keep working during the transition

The Vite build and the server's existing `tsc` build are kept **separate** so
both work. In M0 the SPA is served only at the **new `GET /app`** route (plus its
local static assets); `/`, `/catalog`, `/analytics`, `/notes/*`, `/coach`, etc.
continue to serve their current server-rendered HTML **unchanged**. Each later
milestone moves one surface over; nothing is removed until M6.

If the built SPA bundle is absent (UI not built), `/app` **degrades gracefully**
with a clear message and does not crash any other route.

## Consequences

- **Positive:** a real component model + design tokens; consistent NeetCode-style
  UI; incremental, low-risk migration; existing pages keep working throughout.
- **Positive:** local-first preserved — everything compiled/bundled at build
  time, served by the existing local server; no runtime CDN/network.
- **Tradeoff:** adds a front-end build step (`build:ui` = `vite build`) and a set
  of pinned front-end dependencies to `@ibai/web`. The server `tsc` build and the
  Vite build are separate pipelines in one package.
- **Scope:** this ADR changes only the web front-end rendering approach; it does
  not touch `core`, the engine's three jobs, the storage/provider interfaces, or
  the curriculum/progress separation.
- Any change to these decisions requires a new ADR.
