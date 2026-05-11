## Charts

Server component (`src/app/charts/page.tsx`) fetches `getExpenditureSeries` (long rows) and pivots to wide rows via `pivotForRecharts` in `src/lib/chartData.ts`; passes them to a `"use client"` chart component (e.g. `src/components/charts/ExpendituresOverTime.tsx`) that wraps Recharts. Bucket granularity (`day` for ≤180 visible days, `month` otherwise) and the trim-current-month-tail rule live in `src/lib/charts.ts`.

To add a new chart type: register it in `src/components/charts/registry.ts` and render the new component conditionally in `src/app/charts/page.tsx`.
