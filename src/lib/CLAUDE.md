## Filters

`/transactions`, `/expenditures`, `/plan`, `/charts` share the `FilterPanel` widget (`src/components/FilterPanel.tsx`) and the `parseFilters`/`resolveFilters` helpers in `src/lib/filters.ts`. Filter state lives in URL search params (`?months=…&categories=…`); pages read `await props.searchParams` and push the resolved filter into SQL via `= ANY($n::text[])`.

`/transactions` additionally carries a `?sort=` param, driven by the `SortToggle` pill (`src/components/SortToggle.tsx`) next to the FilterPanel. It flips between the transaction's own `date` (default — param omitted) and `added` (insertion order); the page maps it to `getTransactions`' `TransactionSort` arg, which is `t.id DESC` for `added` (id is SERIAL, so it doubles as an "added" timestamp) and `t.date DESC, t.id DESC` for the default. `SortToggle` preserves the other params on toggle, mirroring `FilterPanel`'s `router.replace`.

### Filter memory

Filters carry across page switches. `FilterMemoryRecorder` (mounted in `NavLinks`, inside `<Suspense>`) saves the `months`/`categories` query of any `FILTER_PAGES` URL (`src/lib/nav.ts`) to `src/lib/filter-memory.ts` — a `sessionStorage` store read via `useFilterQuery()` (server snapshot `""`). `NavLinks` and `MobileBottomNav` append it to `FILTER_PAGES` hrefs. Defaults save `""`; `sort` isn't kept.

`/expenditures` category cells link to `/transactions${buildFilterQuery(filters.months, [id])}`; Uncategorized (id 0) can't be filtered, so it isn't linked.
