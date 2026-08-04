## Charts

Server component (`src/app/charts/page.tsx`) fetches `getExpenditureSeries` (long rows) and pivots to wide rows via `pivotForRecharts` in `src/lib/chartData.ts`; passes them to a `"use client"` chart component that wraps Recharts. Bucket granularity (`day` for ≤180 visible days, `month` otherwise) and the trim-current-month-tail rule live in `src/lib/charts.ts`.

Two chart types are registered today:
- `ExpendituresOverTime` — stacked area, one series per category.
- `CategoryShare` — donut pie with percentage labels and a custom tooltip; reads the same series and aggregates per-category totals client-side.

**Series are keyed by category id, never by name.** `pivotForRecharts` writes each category's value under `seriesKey(c.id)` (the id as a string, exported from `src/lib/chartData.ts`), and `ExpendituresOverTime` passes that as the Recharts `dataKey` with the display name in `name`. Category names are unique only among a user's *real* categories — the synthetic "Uncategorized" bucket below can collide with a real category of that name, and a name-keyed point would silently merge the two series into one. Any new chart reading `SeriesPoint`s must resolve its key through `seriesKey`.

**Uncategorized spend** (`category_id IS NULL`) comes back from the queries under the sentinel `UNCATEGORIZED_ID = 0` / name "Uncategorized" (defined in `src/lib/categories.ts` — client-safe by design; see `src/db/CLAUDE.md`). The page defines a synthetic `Category { id: 0, name: "Uncategorized", priority: -1 }` and appends it to `orderedCategories` **only when the fetched rows actually contain an id-0 row** — so `pivotForRecharts`, `categoryColor(0)` and the legend treat it like any other series. It's in scope only when no explicit category filter is active (the FilterPanel can't select it); the panels fetch when there are real categories **or** uncategorized is in scope, so a user whose only spend is uncategorized still gets a chart. `CategoryShare` builds slices straight from `rows`, so its Uncategorized slice appears automatically — the synthetic category is passed only to satisfy its empty-state guard.

Tabs at the top of `/charts` switch between them; the active id is held in the `chart` URL param (`?chart=…`).

### Adding a new chart type

1. Build a `"use client"` component under `src/components/charts/`.
2. Register it in `src/components/charts/registry.ts` (`CHARTS`, `ChartId`, optionally `DEFAULT_CHART`).
3. Render it conditionally in `src/app/charts/page.tsx`.

### Category colors

`categoryColor(id)` in `src/lib/charts.ts:109-115` derives `{ fill, stroke }` from an HSL hue via a golden-ratio hash: `hue = (id * 137.508) % 360`. Stable across renders and well-separated for any small number of categories — use it for any new chart that needs per-category colors.
