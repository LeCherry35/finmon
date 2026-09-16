## Filters

`/transactions`, `/expenditures`, `/plan`, `/charts` share the `FilterPanel` widget (`src/components/FilterPanel.tsx`) and the `parseFilters`/`resolveFilters` helpers in `src/lib/filters.ts`. Filter state lives in URL search params (`?months=…&categories=…`); pages read `await props.searchParams` and push the resolved filter into SQL via `= ANY($n::text[])`.

`/transactions` additionally carries a `?sort=` param, driven by the `SortToggle` pill (`src/components/SortToggle.tsx`) next to the FilterPanel. It flips between the transaction's own `date` (default — param omitted) and `added` (insertion order); the page maps it to `getTransactions`' `TransactionSort` arg, which is `t.id DESC` for `added` (id is SERIAL, so it doubles as an "added" timestamp) and `t.date DESC, t.id DESC` for the default. `SortToggle` preserves the other params on toggle, mirroring `FilterPanel`'s `router.replace`.

`/transactions` also has a free-text `?q=` search, driven by `TransactionSearch` (`src/components/TransactionSearch.tsx`) after the SortToggle. The page trims it and caps it at 100 chars, then passes it as `getTransactions`' 4th arg. There it becomes one `%term%` ILIKE param (wildcards escaped via `escapeLike`) matched against `t.store`, `t.note`, the category name, and — through `EXISTS` on `products` — product name/brand/type/description/tags. It isn't kept in filter memory, the same as `sort`.

### Filter memory

Filters carry across page switches. `FilterMemoryRecorder` (mounted in `NavLinks`, inside `<Suspense>`) saves the `months`/`categories` query of any `FILTER_PAGES` URL (`src/lib/nav.ts`) to `src/lib/filter-memory.ts` — a `sessionStorage` store read via `useFilterQuery()` (server snapshot `""`). `NavLinks` and `MobileBottomNav` append it to `FILTER_PAGES` hrefs. Defaults save `""`; `sort` isn't kept.

`/expenditures` category cells link to `/transactions${buildFilterQuery(filters.months, [id])}`; Uncategorized (id 0) can't be filtered, so it isn't linked.
