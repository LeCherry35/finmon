@AGENTS.md

## What this is
Personal finance tracker. Each user signs in and gets their own isolated data — logs income/spend, groups them by category, and compares actual spend against monthly plans.

Entities:
- **Category** — name + priority (0–10). Used to classify transactions and to set monthly plans against.
- **Transaction** — `amount`, `type` (`income` | `spend`), `category_id`, `date` (`YYYY-MM-DD`), optional `note`, optional `store` (merchant name, migration 010), `status`. Made up of one or more **Products**. `amount` and `category_id` are both **optional** (migration 012) — a transaction just can't be created (or edited down to) all three of amount/category/receipt missing; a receipt scan can fill the blanks in later. `status` is `processing` | `unverified` | `ready_to_verify` | `verified` (default `unverified`); it's recomputed automatically from the product line items — when their costs sum to the **effective amount** (the manual `amount`, or the scanned receipt total when there's no manual amount) it becomes `ready_to_verify`, otherwise `unverified` (a `verified` transaction can be downgraded); a manual amount that disagrees with the scanned total blocks `ready_to_verify` entirely. `processing` is driven by **receipt scanning**: uploading a receipt photo on the create form starts the row `processing` and an OpenAI vision call (`src/lib/receipt-scan.ts` → `src/actions/receipt.ts`) parses its line items into products under the hood, stores the receipt's printed grand total in `receipts.total`, fills in transaction fields the user left blank (category — matched against the user's own category names or a lazily-created `other` — store, and a still-default date), then recomputes status. A manually entered `amount` is never overwritten by the scan; spend aggregations count a scan-only transaction at `COALESCE(t.amount, r.total)`. The uploaded photo itself is **stored** (`receipts` table, one per transaction, replaced on re-scan) and viewable via the "View receipt" link in the products modal, served by the authed route handler `/api/receipts/[id]`. The `ready_to_verify` → `verified` transition is **user-driven**: the row's status tag is itself the verify control — when a transaction is `ready_to_verify`, clicking its `StatusBadge` calls `verifyTransaction` (there's no separate Verify button anymore); verifying with no manual amount adopts the scanned total, so a verified transaction always has an `amount`.
- **Product** — a line item on a transaction: `name` (only mandatory), optional `brand`, `cost`, `product_type`, `tags` (`TEXT[]`), `description`, plus optional `price`, `amount` (quantity) and `unit` (migration 008, all wired through the type, actions and modal UI; positive-number validation, independent of `cost` — no enforced `price * amount = cost`). Cost lives on the line item (not a shared catalog), so the same type/brand can recur at different costs. `transaction.amount` stays authoritative — products are an optional breakdown, not forced to sum to it. A new transaction starts with no products; the user adds them later. (Migration 007 backfilled existing rows with an `other` product, but new ones no longer get one.)
- **Plan** — `(category_id, month)` budget; one amount per category per `YYYY-MM`. Upsert on conflict.

Pages: `/transactions` (default landing — list/CRUD), `/categories` (CRUD), `/plan` (current month: planned vs spent vs left, per category), `/expenditures` (spend totals by category, all-time), `/charts` (visualizations — a stacked-area expenditures-over-time chart and a category-share donut, switchable via tabs as more chart types are added).

## Stack
Next.js 16 (App Router), React 19, PostgreSQL via `pg`, Tailwind v4, TypeScript, Recharts (for `/charts` only). Email/password auth via Better Auth, with per-user multi-tenancy (every row scoped by `user_id`). Path alias `@/` → `src/`.

## Database
Migrations, seed scripts, env vars, date-column shapes → `src/db/CLAUDE.md` (auto-loaded when working in `src/db/`).

## Local dev
`DEV.md` — running locally (`npm run dev` + local Postgres) and the dev test account for manual testing.

## Deployment
- DigitalOcean Droplet, Docker Compose: app + self-hosted PostgreSQL + nginx reverse proxy on a private network (Postgres data on the `pgdata` volume). nginx terminates TLS on `:443` with Cloudflare in front, so the app is served over HTTPS at its domain; neither the app nor Postgres is published to the host. Built from the repo on the server; deploys are `git pull` + `docker compose up -d --build`.
- Details in DEPLOY.md — including a **"Known Limitations & Deferred Work"** section that consolidates the current prod trade-offs (HTTPS + secure cookies are in place; email-based auth flows remain disabled). Check it before changing auth, cookies, or SSL config.

## Issue tracking
Audit findings live in `TO_FIX.md`, grouped by severity (Critical / High / Medium / Low). When an issue is fixed, remove it from `TO_FIX.md` and move it to `FIXED.md` under the current date with a short **Fix:** note. The workflow is documented at the top of `TO_FIX.md`.

## Versioning
Shipped feature and behaviour changes are logged in `VERSIONS.md` (newest first, one entry per release). When you complete a meaningful update — a feature, a behaviour change, a migration — add an entry there and bump `version` in `package.json`. This is distinct from `TO_FIX.md` / `FIXED.md`, which track audit findings rather than the changelog.

## Conventions
- **Reads**: async server components call `src/db/queries.ts`. No API routes — the sole exceptions are Better Auth's handler and `/api/receipts/[id]`, which streams stored receipt images (binary can't come from a server component).
- **Writes**: server actions in `src/actions/*.ts` (`"use server"`) — read `FormData`, validate, `pool.query(...)`, `revalidatePath(...)`.
- Entity types are exported from their action file and re-imported by `queries.ts`.
- **Filters**: shared `FilterPanel` + URL-param state across list pages — details in `src/lib/CLAUDE.md`.
- **Charts**: server-fetched/pivoted data → client Recharts components — details in `src/components/charts/CLAUDE.md`.

## Testing
Vitest, co-located as `*.test.ts(x)`. `npm test` runs everything; `npm run test:cov` for coverage. Unit tests mock at the module boundary (`@/db`, `@/lib/dal`, `next/*`) — never hit the real DB, network, or auth. **Read `TESTS.md` before writing tests** — it documents the stack, mocking seams, fixtures, and gotchas (pinning the clock, the `server-only` stub, the mobile+desktop double-render). `TESTS_COVERAGE.md` tracks what's covered and what's still planned.

## Responsive design
Mobile/desktop split is Tailwind v4's `md:` (≥768px) — the only breakpoint used. App-shell rules (nav, body padding, safe-area, page headers) live in `src/app/CLAUDE.md`; component-level rules (tables vs cards, mobile FAB+sheet, FilterPanel dropdown, chart container sizing) live in `src/components/CLAUDE.md`.
