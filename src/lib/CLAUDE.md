## Filters

`/transactions`, `/expenditures`, `/plan`, `/charts` share the `FilterPanel` widget (`src/components/FilterPanel.tsx`) and the `parseFilters`/`resolveFilters` helpers in `src/lib/filters.ts`. Filter state lives in URL search params (`?months=…&categories=…`); pages read `await props.searchParams` and push the resolved filter into SQL via `= ANY($n::text[])`.
