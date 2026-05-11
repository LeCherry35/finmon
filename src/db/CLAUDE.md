## Database

- Migrations run automatically on startup via `src/instrumentation.ts`. Add numbered `.sql` files to `src/db/migrations/` (e.g. `003_add_col.sql`) — the runner applies any not yet recorded in the `_migrations` table, each in its own transaction. Never edit existing migration files.
- `npm run db:init` (uses `src/db/schema.sql`) is for fresh local DBs only — it is not part of the deployment flow.
- `npm run db:init` loads `.env` automatically (requires Node ≥ 20.6).
- `npm run db:seed:init` wipes the three tables and seeds a deterministic 3-month dataset (8 categories, transactions across the last 90 days, plans for the current and 2 prior months). Idempotent — re-running yields byte-identical data.
- `npm run db:seed:month -- <1-12>` appends 0–5 transactions per day for the given month of the current year. Additive; re-running duplicates rows by design.
- Env vars: `SQL_DB_HOST`, `SQL_DB_PORT`, `SQL_DB_NAME`, `SQL_DB_USER`, `SQL_DB_PASSWORD`. SSL is on by default (`rejectUnauthorized: false` — encrypts but does not verify the server cert, which is what RDS needs without a bundled CA). Set `SQL_DB_SSL=false` to disable TLS for local Postgres.
- Date columns are `TEXT` in ISO form: `transactions.date` = `YYYY-MM-DD`, `plans.month` = `YYYY-MM`. Filter by month with `LEFT(t.date, 7) = $month`.
