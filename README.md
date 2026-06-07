# finmon

A personal finance tracker. Each user signs in and gets their own isolated data —
logs income/spend, groups transactions by category, breaks each transaction into
product line items, and compares actual spend against monthly plans.

**Pages:** `/transactions` (default landing — list/CRUD), `/categories` (CRUD),
`/plan` (current month: planned vs spent vs left), `/expenditures` (spend totals
by category, all-time), `/charts` (visualizations).

## Stack

Next.js 16 (App Router), React 19, PostgreSQL via `pg`, Tailwind v4, TypeScript,
Recharts (on `/charts` only). Email/password auth via Better Auth with per-user
multi-tenancy (every row scoped by `user_id`). Path alias `@/` → `src/`.

## Local development

1. Create a database: `createdb finmon`.
2. Copy `.env example` to `.env` and fill in the connection details
   (`SQL_DB_HOST`, `SQL_DB_PORT`, `SQL_DB_NAME`, `SQL_DB_USER`, `SQL_DB_PASSWORD`).
   For a local Postgres set `SQL_DB_SSL=false`. Set `BETTER_AUTH_SECRET`
   (`openssl rand -base64 32`) and `BETTER_AUTH_URL=http://localhost:3000`.
3. `npm install`
4. `npm run dev` — migrations in `src/db/migrations/` run automatically on the
   first request (via `src/instrumentation.ts`).
5. Open [http://localhost:3000](http://localhost:3000) and register an account.

See `src/db/CLAUDE.md` for the migration/seed details, the `OWNER_*` env vars,
and the date-column shapes.

### Useful scripts

```bash
npm run dev              # dev server
npm run build            # production build
npm test                 # run the Vitest suite
npm run test:cov         # tests with a coverage report
npm run lint             # eslint
npm run db:seed:init     # wipe + seed a deterministic 3-month dataset (needs OWNER_USER_ID)
npm run db:seed:month -- <1-12>   # append transactions for one month
npm run db:hash-password '<password>'   # print a Better Auth password hash
```

## Running with Docker

Make sure `.env` is populated, then:

```bash
docker build -t finmon .
docker run -d --name finmon-app --env-file .env -p 3000:3000 finmon
```

> If `SQL_DB_HOST` in your `.env` is `localhost`, the container can't reach
> Postgres on your host machine — override it:
>
> ```bash
> docker run -d --name finmon-app --env-file .env -e SQL_DB_HOST=host.docker.internal -p 3000:3000 finmon
> ```

Open [http://localhost:3000](http://localhost:3000).

## Deployment

Deployed on AWS (ECS Fargate + RDS PostgreSQL, image in ECR). Full redeploy
steps, environment variables, and current production trade-offs are in
[`DEPLOY.md`](./DEPLOY.md).

## Documentation map

- [`CLAUDE.md`](./CLAUDE.md) — project overview, entities, conventions.
- [`DEPLOY.md`](./DEPLOY.md) — AWS deploy + "Known Limitations & Deferred Work".
- [`TESTS.md`](./TESTS.md) / [`TESTS_COVERAGE.md`](./TESTS_COVERAGE.md) — how
  testing works and what's covered.
- [`TO_FIX.md`](./TO_FIX.md) / [`FIXED.md`](./FIXED.md) — audit findings, open
  and resolved.
- Per-directory `CLAUDE.md` files under `src/` document each layer (db, actions,
  components, charts, app shell).
