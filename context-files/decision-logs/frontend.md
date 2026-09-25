# Decision log — frontend

Format: `YYYY-MM-DD  <branch/PR>  — decision — rejected alternative — why`

2026-09-25  feature/w3-catalog-filter  — Catalog search is instant (useMemo over `filterCatalog`) — rejected debouncing — ~175 problems filter in well under a frame; a debounce only adds lag and timer complexity to tests.
2026-09-25  feature/w3-catalog-filter  — Filter state lives in the URL query (`q`, `difficulty`, `status`) via `history.replaceState`, with small `currentSearch`/`replaceSearch` helpers added to the in-repo router — rejected component-only state and `pushState` per keystroke — reload/back-from-notes must keep the filter, and pushing per keystroke would flood the back stack; the router matches pathname only, so the query doesn't disturb routing.
2026-09-25  feature/w3-catalog-filter  — Filtering is pure and client-side over the existing `GET /api/catalog` data (lib/home.ts) — rejected a server-side filter endpoint — no API change needed, and it keeps product logic out of the component and unit-testable.
2026-09-25  feature/w3-catalog-filter  — Matching topics auto-expand by remounting each accordion (key includes filter active/inactive) with `defaultOpen` — rejected a fully controlled `open` prop — keeps CategoryAccordion's API small and lets a user's manual collapse stick while they keep typing; clearing collapses back to the default.
2026-09-25  feature/w3-catalog-filter  — Status chips reuse the existing `STATUS_LABELS` ("Not started", "Didn't understand") — rejected new "None"/"Did not understand" labels — one vocabulary with the per-row Status control.
2026-09-25  feature/w3-catalog-filter  — "N of M" counts distinct problem ids (M = API `totals.total`) — rejected summing per-topic matches — a problem listed under two topics would be double-counted.
2026-09-25  feature/w3-catalog-filter  — With a status filter on, changing a row's status re-filters immediately (the row may drop out) — rejected freezing the visible set until the filter changes — simplest consistent model; the "N of M" count and banner still show the change.
