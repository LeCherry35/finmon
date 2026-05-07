@AGENTS.md

## Stack

- **Framework**: Next.js 16 (App Router) — see `node_modules/next/dist/docs/` for this version's API
- **Database**: PostgreSQL via `pg` (node-postgres) — connection pool in `src/db/index.ts`, schema in `src/db/schema.sql`
- **Queries**: All DB functions in `src/db/queries.ts` are async; server actions in `src/actions/` use `await pool.query()`
- **Styling**: Tailwind CSS v4
- **Auth**: None

## Env

Variables defined in `.env` (see `.env example` for the template):
`SQL_DB_HOST`, `SQL_DB_PORT`, `SQL_DB_NAME`, `SQL_DB_USER`, `SQL_DB_PASSWORD`

