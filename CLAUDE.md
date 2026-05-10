@AGENTS.md

## What this is
Personal finance tracker for a single user. Logs income/spend, groups them by category, and compares actual spend against monthly plans.

Entities:
- **Category** — name + priority (0–10). Used to classify transactions and to set monthly plans against.
- **Transaction** — `amount`, `type` (`income` | `spend`), `category_id`, `date` (`YYYY-MM-DD`), optional `note`.
- **Plan** — `(category_id, month)` budget; one amount per category per `YYYY-MM`. Upsert on conflict.

Pages: `/transactions` (default landing — list/CRUD), `/categories` (CRUD), `/plan` (current month: planned vs spent vs left, per category), `/expenditures` (spend totals by category, all-time), `/charts` (visualizations — currently a stacked-area expenditures-over-time chart, switchable via tabs as more chart types are added).

## Stack
Next.js 16 (App Router), React 19, PostgreSQL via `pg`, Tailwind v4, TypeScript, Recharts (for `/charts` only). No auth — single-user tool. Path alias `@/` → `src/`.

## Database
- Migrations run automatically on startup via `src/instrumentation.ts`. Add numbered `.sql` files to `src/db/migrations/` (e.g. `003_add_col.sql`) — the runner applies any not yet recorded in the `_migrations` table, each in its own transaction. Never edit existing migration files.
- `npm run db:init` (uses `src/db/schema.sql`) is for fresh local DBs only — it is not part of the deployment flow.
- `npm run db:init` loads `.env` automatically (requires Node ≥ 20.6).
- `npm run db:seed:init` wipes the three tables and seeds a deterministic 3-month dataset (8 categories, transactions across the last 90 days, plans for the current and 2 prior months). Idempotent — re-running yields byte-identical data.
- `npm run db:seed:month -- <1-12>` appends 0–5 transactions per day for the given month of the current year. Additive; re-running duplicates rows by design.
- Env vars: `SQL_DB_HOST`, `SQL_DB_PORT`, `SQL_DB_NAME`, `SQL_DB_USER`, `SQL_DB_PASSWORD`. SSL is on by default (`rejectUnauthorized: false` — encrypts but does not verify the server cert, which is what RDS needs without a bundled CA). Set `SQL_DB_SSL=false` to disable TLS for local Postgres.
- Date columns are `TEXT` in ISO form: `transactions.date` = `YYYY-MM-DD`, `plans.month` = `YYYY-MM`. Filter by month with `LEFT(t.date, 7) = $month`.

## Deployment
- AWS, Docker container, RDS PostgreSQL. 
- Details in DEPLOY.md

## Conventions
- **Reads**: async server components call `src/db/queries.ts`. No API routes.
- **Writes**: server actions in `src/actions/*.ts` (`"use server"`) — read `FormData`, validate, `pool.query(...)`, `revalidatePath(...)`.
- Entity types are exported from their action file and re-imported by `queries.ts`.
- **Filters**: `/transactions`, `/expenditures`, `/plan`, `/charts` share the `FilterPanel` widget and the `parseFilters`/`resolveFilters` helpers in `src/lib/filters.ts`. Filter state lives in URL search params (`?months=…&categories=…`); pages read `await props.searchParams` and push the resolved filter into SQL via `= ANY($n::text[])`.
- **Charts**: server component fetches `getExpenditureSeries` (long rows) and pivots to wide rows via `pivotForRecharts` in `src/lib/chartData.ts`; passes them to a `"use client"` chart component (`src/components/charts/ExpendituresOverTime.tsx`) that wraps Recharts. Bucket granularity (`day` for ≤180 visible days, `month` otherwise) and the trim-current-month-tail rule live in `src/lib/charts.ts`. To add a new chart type, register it in `src/components/charts/registry.ts` and render the new component conditionally in `src/app/charts/page.tsx`.
