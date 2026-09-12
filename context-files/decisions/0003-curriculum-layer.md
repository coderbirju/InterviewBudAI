# ADR 0003 — Curriculum Layer: Location, Schema, and Read-Only Access Contract

- **Status:** Accepted
- **Date:** 2026-09-12
- **Deciders:** Founder + Architect (design session)
- **Supersedes:** —

## Context

InterviewBudAI ships a catalog of interview-prep problems. The catalog contains
links to external problem sources plus difficulty ratings and topic tags — it
NEVER contains answers, solutions, hints, walkthroughs, or intuitions (charter
§6.2). Users contribute their own solutions and notes via the PROGRESS layer,
which lives in their private storage target.

We need to decide:
1. Where the shipped catalog lives in the codebase.
2. What schema defines a catalog entry.
3. How consumers (front-ends, and optionally the engine) access the catalog
   without coupling to a concrete dataset or loader.

## Decisions

### D1 — Curriculum lives in a new leaf package `@ibai/curriculum`

The shipped catalog and its read-only access contract live in a NEW workspace
package `packages/curriculum` (`@ibai/curriculum`). This package is a
zero-dependency leaf: it exports types, an interface, and the placeholder
dataset, but imports nothing from other workspace packages.

**Rationale:**
- Mirrors the storage/provider pattern from ADR 0002: the interface lives in
  the owning package; consumers depend on the interface type only.
- A dedicated package boundary enforces the curriculum-vs-progress separation
  "in code, not just docs" — a firm line between shipped/generic data and
  personal/private data.
- Keeps `@ibai/core` decoupled: core depends on interfaces only (per ADR 0001).

**Rejected alternatives:**

**(a) A data directory read via `@ibai/storage`** (e.g. `packages/core/data/` or
repo-root `/curriculum/`).
- Rejected: overloads @ibai/storage (which is about user progress adapters),
  blurs the shipped-vs-personal boundary, provides no clean type boundary, and
  would couple core to a concrete data path.

**(b) Put the catalog inside `@ibai/core`.**
- Rejected: core must stay a decoupled engine depending on interfaces only;
  bundling data violates that and the dependency graph in ADR 0001.

**(c) Fetch curriculum from a remote service.**
- Rejected: the vision ships the catalog in-repo, offline-first, improved via
  community PRs; a service adds infra + runtime dependency out of scope.

### D2 — Catalog schema: links + difficulty + minimal tags ONLY

A `Problem` entry has EXACTLY these fields:

| Field       | Type                          | Description |
|-------------|-------------------------------|-------------|
| `id`        | `string`                      | Stable, unique identifier (slug or opaque). Stable across releases so progress can reference it. |
| `title`     | `string`                      | Human-readable problem name. |
| `url`       | `string`                      | External canonical link to the problem. Curriculum never hosts problem content itself. |
| `difficulty`| `Difficulty`                  | Coarse ordinal: `'easy' \| 'medium' \| 'hard'`. Ordering: easy < medium < hard. |
| `topics`    | `readonly CurriculumTopicId[]`| Minimal topic tags for categorization/filtering. |

**Difficulty is a coarse ordinal scale** (`'easy' | 'medium' | 'hard'`) rather
than a fine numeric ranking because:
- Portable across problem sources (LeetCode, Neetcode, etc.).
- Avoids false precision — difficulty is subjective.
- Community-PR friendly — contributors don't need to calibrate exact numbers.

**`CurriculumTopicId`** is a string alias that aligns by CONVENTION with
`@ibai/storage`'s `TopicId` (also `string`) so progress competency data can
cross-reference curriculum topics. Curriculum stays a zero-dependency leaf and
does NOT import from @ibai/storage (avoids dependency cycle).

**Invariant:** The schema has NO fields for answers, solutions, hints,
walkthroughs, editorials, or intuitions. Links + difficulty (+ minimal topic
tags) ONLY. Users add their own problems/links/notes in the PROGRESS layer,
never here.

### D3 — Read-only access contract (`CurriculumSource` interface)

Consumers access the catalog via a `CurriculumSource` interface:

```typescript
export interface CurriculumSource {
  list(): readonly Problem[];
  getById(id: string): Problem | undefined;
  filterByDifficulty(difficulty: Difficulty): readonly Problem[];
  filterByTopic(topic: CurriculumTopicId): readonly Problem[];
}
```

**All methods are READ-ONLY** — no create/update/delete. Curriculum is improved
only via community PRs to the shipped data, never mutated at runtime.

This mirrors the storage/provider pattern (ADR 0002):
- Front-ends (and optionally `@ibai/core` if/when needed) depend on the
  `CurriculumSource` TYPE, never on a concrete dataset or loader.
- At startup, consumers inject a concrete `CurriculumSource` implementation
  (dependency injection).

**No dependency cycle:** `@ibai/curriculum` is a leaf (zero deps). `@ibai/core`
MAY additively depend on the curriculum TYPES in the future via DI without a
new ADR (it is additive, type-only, consistent with ADR 0002's DI pattern). For
this skeleton PR, core is NOT modified — front-ends can consume curriculum
directly.

The package also exports a placeholder dataset:
```typescript
export const CATALOG: readonly Problem[] = [];
```
Real catalog entries arrive in a follow-up implement PR.

### D4 — Invariants and community-PR path

Explicit invariants enforced by schema, package boundary, and code review:

1. **The curriculum layer NEVER contains personal data, answers, solutions,
   hints, or intuitions** (charter §6.2). The schema has no such fields.
2. **Curriculum is improved via community PRs** to the shipped catalog data; it
   is read-only at runtime.
3. **Progress (personal) data is never bundled into this repo;** it lives in
   the user's storage target.
4. **`@ibai/curriculum` stays a zero-dependency leaf;** core stays decoupled
   from any concrete curriculum implementation.

## Consequences

- **Positive:** Clear separation between shipped catalog (curriculum) and
  personal data (progress). Package boundary enforces the invariant. Type-safe
  read-only contract enables front-ends and (future) core to consume catalog
  without coupling to a concrete dataset.
- **Addition:** New `packages/curriculum` added to the workspace layout (extends
  ADR 0001's package list; this ADR documents the extension).
- **Follow-up work:** A separate implement/integrate PR ships real catalog
  entries and a concrete `CurriculumSource` implementation/loader.
- **No existing public interface changed:** Core is untouched in this skeleton
  PR; verify stays green.
- Any change to these decisions requires a new ADR.
