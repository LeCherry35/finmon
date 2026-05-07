@AGENTS.md

## Stack
Next.js 16 (App Router), React 19, PostgreSQL via `pg`, Tailwind v4, TypeScript. No auth — single-user tool. Path alias `@/` → `src/`.

## Database
- Migrations run automatically on startup via `src/instrumentation.ts`. Add numbered `.sql` files to `src/db/migrations/` (e.g. `003_add_col.sql`) — the runner applies any not yet recorded in the `_migrations` table, each in its own transaction. Never edit existing migration files.
- `npm run db:init` (uses `src/db/schema.sql`) is for fresh local DBs only — it is not part of the deployment flow.
- `npm run db:init` loads `.env` automatically (requires Node ≥ 20.6).
- Env vars: `SQL_DB_HOST`, `SQL_DB_PORT`, `SQL_DB_NAME`, `SQL_DB_USER`, `SQL_DB_PASSWORD`. SSL is on by default (`rejectUnauthorized: false` — encrypts but does not verify the server cert, which is what RDS needs without a bundled CA). Set `SQL_DB_SSL=false` to disable TLS for local Postgres.
- Date columns are `TEXT` in ISO form: `transactions.date` = `YYYY-MM-DD`, `plans.month` = `YYYY-MM`. Filter by month with `LEFT(t.date, 7) = $month`.

## Deployment
- AWS, Docker container, RDS PostgreSQL. 
- Details in DEPLOY.md

## Conventions
- **Reads**: async server components call `src/db/queries.ts`. No API routes.
- **Writes**: server actions in `src/actions/*.ts` (`"use server"`) — read `FormData`, validate, `pool.query(...)`, `revalidatePath(...)`.
- Entity types are exported from their action file and re-imported by `queries.ts`.
