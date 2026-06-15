@AGENTS.md

## What this is
Personal finance tracker. Each user signs in and gets their own isolated data — logs income/spend, groups them by category, and compares actual spend against monthly plans.

Entities:
- **Category** — name + priority (0–10). Used to classify transactions and to set monthly plans against.
- **Transaction** — `amount`, `type` (`income` | `spend`), `category_id`, `date` (`YYYY-MM-DD`), optional `note`.
- **Plan** — `(category_id, month)` budget; one amount per category per `YYYY-MM`. Upsert on conflict.

Pages: `/transactions` (default landing — list/CRUD), `/categories` (CRUD), `/plan` (current month: planned vs spent vs left, per category), `/expenditures` (spend totals by category, all-time), `/charts` (visualizations — currently a stacked-area expenditures-over-time chart, switchable via tabs as more chart types are added).

## Stack
Next.js 16 (App Router), React 19, PostgreSQL via `pg`, Tailwind v4, TypeScript, Recharts (for `/charts` only). Email/password auth via Better Auth, with per-user multi-tenancy (every row scoped by `user_id`). Path alias `@/` → `src/`.

## Database
Migrations, seed scripts, env vars, date-column shapes → `src/db/CLAUDE.md` (auto-loaded when working in `src/db/`).

## Deployment
- Hetzner Cloud VPS, Docker Compose: app + self-hosted PostgreSQL containers on a private network (Postgres data on the `pgdata` volume). Built from the repo on the server; deploys are `git pull` + `docker compose up -d --build`.
- Details in DEPLOY.md — including a **"Known Limitations & Deferred Work"** section that consolidates the current prod trade-offs (no HTTPS/TLS, non-secure cookies, disabled email auth). Check it before changing auth, cookies, or SSL config.

## Issue tracking
Audit findings live in `TO_FIX.md`, grouped by severity (Critical / High / Medium / Low). When an issue is fixed, remove it from `TO_FIX.md` and move it to `FIXED.md` under the current date with a short **Fix:** note. The workflow is documented at the top of `TO_FIX.md`.

## Conventions
- **Reads**: async server components call `src/db/queries.ts`. No API routes.
- **Writes**: server actions in `src/actions/*.ts` (`"use server"`) — read `FormData`, validate, `pool.query(...)`, `revalidatePath(...)`.
- Entity types are exported from their action file and re-imported by `queries.ts`.
- **Filters**: shared `FilterPanel` + URL-param state across list pages — details in `src/lib/CLAUDE.md`.
- **Charts**: server-fetched/pivoted data → client Recharts components — details in `src/components/charts/CLAUDE.md`.

## Testing
Vitest, co-located as `*.test.ts(x)`. `npm test` runs everything; `npm run test:cov` for coverage. Unit tests mock at the module boundary (`@/db`, `@/lib/dal`, `next/*`) — never hit the real DB, network, or auth. **Read `TESTS.md` before writing tests** — it documents the stack, mocking seams, fixtures, and gotchas (pinning the clock, the `server-only` stub, the mobile+desktop double-render). `TESTS_COVERAGE.md` tracks what's covered and what's still planned.

## Responsive design
Mobile/desktop split is Tailwind v4's `md:` (≥768px) — the only breakpoint used. App-shell rules (nav, body padding, safe-area, page headers) live in `src/app/CLAUDE.md`; component-level rules (tables vs cards, mobile FAB+sheet, FilterPanel dropdown, chart container sizing) live in `src/components/CLAUDE.md`.
