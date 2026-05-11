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
Migrations, seed scripts, env vars, date-column shapes → `src/db/CLAUDE.md` (auto-loaded when working in `src/db/`).

## Deployment
- AWS, Docker container, RDS PostgreSQL. 
- Details in DEPLOY.md

## Conventions
- **Reads**: async server components call `src/db/queries.ts`. No API routes.
- **Writes**: server actions in `src/actions/*.ts` (`"use server"`) — read `FormData`, validate, `pool.query(...)`, `revalidatePath(...)`.
- Entity types are exported from their action file and re-imported by `queries.ts`.
- **Filters**: shared `FilterPanel` + URL-param state across list pages — details in `src/lib/CLAUDE.md`.
- **Charts**: server-fetched/pivoted data → client Recharts components — details in `src/components/charts/CLAUDE.md`.

## Responsive design
Mobile/desktop split is Tailwind v4's `md:` (≥768px) — the only breakpoint used. App-shell rules (nav, body padding, safe-area, page headers) live in `src/app/CLAUDE.md`; component-level rules (tables vs cards, mobile FAB+sheet, FilterPanel dropdown, chart container sizing) live in `src/components/CLAUDE.md`.
