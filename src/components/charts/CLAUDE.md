## Charts

Server component (`src/app/charts/page.tsx`) fetches `getExpenditureSeries` (long rows) and pivots to wide rows via `pivotForRecharts` in `src/lib/chartData.ts`; passes them to a `"use client"` chart component that wraps Recharts. Bucket granularity (`day` for ≤180 visible days, `month` otherwise) and the trim-current-month-tail rule live in `src/lib/charts.ts`.

Two chart types are registered today:
- `ExpendituresOverTime` — stacked area, one series per category.
- `CategoryShare` — donut pie with percentage labels and a custom tooltip; reads the same series and aggregates per-category totals client-side.

Tabs at the top of `/charts` switch between them; the active id is held in the `chart` URL param (`?chart=…`).

### Adding a new chart type

1. Build a `"use client"` component under `src/components/charts/`.
2. Register it in `src/components/charts/registry.ts` (`CHARTS`, `ChartId`, optionally `DEFAULT_CHART`).
3. Render it conditionally in `src/app/charts/page.tsx`.

### Category colors

`categoryColor(id)` in `src/lib/charts.ts:109-115` derives `{ fill, stroke }` from an HSL hue via a golden-ratio hash: `hue = (id * 137.508) % 360`. Stable across renders and well-separated for any small number of categories — use it for any new chart that needs per-category colors.
