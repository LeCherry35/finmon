# Versions

Release log for finmon — newest first. Each entry records the **shipped feature and behaviour changes** for a version, at the level someone needs to decide whether to pull and redeploy (and what to do on the server when they do).

This is distinct from issue tracking: `TO_FIX.md` / `FIXED.md` track audit findings, while this file is the changelog of intentional changes. When you complete a meaningful update — a feature, a behaviour change, a migration — add an entry here and bump `version` in `package.json`.

Entry shape: `## <version> — <YYYY-MM-DD> — <headline>`, then **Added / Changed / Fixed** as needed, plus **Migrations** and **Deploy notes** when they apply.

---

## 0.7.0 — 2026-08-04 — Bug reports from the header

### Added
- **"Report a bug" button** in the header (right of the user menu, all screen sizes, signed-in only). It opens a small modal with a free-text description; submitting saves the report to the new `bug_reports` table along with the reporter's `user_id`, email and a `created_at` timestamp. The modal auto-closes on success; blank or >5000-character messages are rejected inline. There is no in-app admin view yet — reports are read straight from the DB.

### Migrations
- **`015_bug_reports.sql`** — creates `bug_reports` (`user_id` FK → `"user"` with cascade, denormalized `email`, `message`, `created_at`). Additive only.

### Deploy notes
- `git pull` + `docker compose up -d --build`; the runner applies `015` on the first request. No new env vars.

---

## 0.6.0 — 2026-08-03 — Sort transactions by date added; stop dropping unplanned & uncategorized spend

A sort control on `/transactions`, plus two related fixes so spend stops silently disappearing from the plan/expenditure/chart aggregates: unset plans now count as a 0 budget, and category-less spend gets an "Uncategorized" bucket.

### Added
- **Sort toggle on `/transactions`** (`src/components/SortToggle.tsx`) — a pill next to the filters flips the list between the transaction's own **date** (default) and **date added** (insertion order). Driven by a `?sort=` URL param (default omitted); it composes with the existing month/category filters rather than clearing them. Backed by a `TransactionSort` arg on `getTransactions` — `"added"` orders by `t.id DESC` (the SERIAL `id` doubles as an insertion timestamp, so no new column/migration was needed).
- **Zero-value plans** — a plan amount of `0` ("budget nothing here") can now be saved.

### Changed / Fixed
- **Plan page counts spend against unplanned categories.** Previously, spend in a category with no plan for the month was silently dropped from the month's total and shown as an em-dash. Now a missing (or explicit `0`) plan is treated as a 0 budget: the spend counts toward the total and shows as a negative "left". Applies to both the single-month and multi-month (summary) views.
- **`upsertPlan`** accepts `0` (blank and negative are still rejected: "Amount is required" / "Amount must be zero or more").
- **Uncategorized spend no longer vanishes from aggregates.** A spend transaction with no category (possible since 0.4.0's optional category) was invisible on `/plan`, `/expenditures` and `/charts` because every aggregation inner-joined categories. All four now bucket it under an "Uncategorized" sentinel: the expenditure/series queries `LEFT JOIN` + coalesce it (so `/expenditures` shows an "Uncategorized" row and `/charts` an "Uncategorized" series/slice), and the plan views append a synthetic, read-only "Uncategorized" row (no plan can be attached) whenever such spend exists and no category filter is active. No migration. Chart series are now keyed by **category id** rather than name (`seriesKey` in `src/lib/chartData.ts`), so the sentinel can't merge with a real category a user happened to name "Uncategorized"; `/expenditures` rows key off the id for the same reason.

### Migrations
- **`014_plan_amount_allow_zero.sql`** — relaxes the `plans_amount_check` constraint from `amount > 0` to `amount >= 0`. Applies automatically on startup; no backfill, no data change.

### Deploy notes
- Migration is additive and non-destructive — `git pull` + `docker compose up -d --build`; the runner applies `014` on the first request. No new env vars.

---

## 0.5.2 — 2026-07-09 — Lock the mobile viewport: no zoom on input focus

The mobile UI no longer zooms in when tapping a form field (or via pinch/double-tap) — the page stays pinned to the screen width.

### Changed
- **Viewport** (`src/app/layout.tsx`) — `maximumScale: 1, userScalable: false` added to the `viewport` export. Blocks pinch zoom on Android and iOS's automatic zoom-in on input focus (iOS still allows deliberate pinch zoom as an accessibility override).
- **Form controls** (`globals.css`) — `input`/`select`/`textarea` are forced to 16px below the `md:` breakpoint, removing the trigger for iOS focus-zoom (any focused control under 16px) even where viewport hints are ignored. Mobile field text renders slightly larger than the surrounding `text-sm` labels as a result.

### Deploy notes
- No migration, no new env vars — `git pull` + `docker compose up -d --build`.

---

## 0.5.1 — 2026-07-09 — Drop the check-wide discount: the scanned total is final

0.5.0's check-wide discount double-counted in practice: receipts print a **final** grand total with every discount already reflected (and final line costs), so netting `receipts.discount` off the product-cost sum broke the `ready_to_verify` match on exactly the receipts it was meant to help. Discounts are now **per-product only**; the scanned total is treated as the final amount paid, with nothing subtracted from it.

### Changed
- **Scan** no longer extracts a check-wide discount — the top-level `discount` is gone from the response schema, prompt rules, and few-shot examples (a stray one from the model is ignored). The prompt now stresses that `total` is the final paid figure.
- **Status recompute** compares the plain product-cost sum against the effective amount — no discount netting on either side.
- **Modal** — the "Receipt discount" detail row and the `Total: X − Y discount = Z` netting in the products total line are gone; per-product discounts still show under their line's cost.
- **`receipts.discount`** is now **dormant**: nothing writes or reads it. The column is deliberately kept in the schema (no drop migration) in case a check-wide discount comes back later; values written by 0.5.0 scans linger but are ignored.

### Deploy notes
- No migration, no new env vars — `git pull` + `docker compose up -d --build`. Transactions knocked out of `ready_to_verify` by a 0.5.0-scanned check-wide discount fix themselves on the next product edit or re-scan (the recompute runs then).

---

## 0.5.0 — 2026-07-09 — Receipt discounts: per-product and check-wide

The receipt scan now reads **discounts**: each line item can carry its own discount, and the check as a whole can carry a general one (loyalty card, coupon). Semantics: a product's `cost` is always the **final amount paid** for that line (its discount is informational, already baked in), while a check-wide discount is money the line items *don't* account for — so `sum(costs) − general discount ≈ total`, and the status recompute subtracts it.

### Added
- **`products.discount`** (migration 013) — the money taken off that specific line, scanned or entered manually (new Discount field in the product editor; shown under the cost in the products list).
- **`receipts.discount`** (migration 013) — the check-wide discount as read by the scan. Reset to `NULL` with `total` when a new image is stored, filled on a successful scan. Exposed as `Transaction.scanned_discount` and shown as a "Receipt discount" detail row and in the modal's total line (`Total: X − Y discount = Z`).
- **Scan schema** — `discount` added per product and at the receipt level (strict response schema, zod parse, prompt rules, and few-shot examples demonstrating both kinds).

### Changed
- **Status recompute** nets the check-wide `receipts.discount` off the product-cost sum before comparing against the effective amount (the modal's total line mirrors the same maths).

### Migrations
- **013** — add `products.discount` and `receipts.discount`.

### Deploy notes
- No new env vars — `git pull` + `docker compose up -d --build` applies migration 013 on startup. Receipts scanned before 0.5.0 have no discounts until re-scanned.

---

## 0.4.0 — 2026-07-09 — Scan-first transactions: optional amount & category, scanned receipt total

A transaction can now be created from a **receipt photo alone** — amount and category are optional, and the scan fills in what the user left blank. The receipt's printed grand total is stored and used as the fallback amount everywhere until a manual amount exists.

### Added
- **`receipts.total`** (migration 012) — the grand total as read by the scan. Reset to `NULL` whenever a new image is stored, filled on a successful scan. Exposed as `Transaction.scanned_total` (`getTransactions`).
- **Scan fills blank fields** — the vision call now also returns a purchase `date` and a best-fit `category` (constrained to the user's own category names — rendered into the prompt *and* enforced as a response-schema enum — with a lazily-created `other` fallback). After a scan, a blank category/store is filled in, and a still-default (today) date is replaced by the receipt's date. A manually entered amount is **never** overwritten.
- **Verification mismatch guard** — a manual amount that disagrees with the scanned total (≥ ±1) blocks `ready_to_verify`; the modal shows an amber explanation. Verifying a transaction with no manual amount adopts the scanned total, so a verified row always has an amount.
- **Tests** — optional amount/category rules in `createTransaction`/`updateTransaction`, and direct `recomputeTransactionStatus` coverage (effective-amount fallback, mismatch, nothing-to-match) — suite now 252 tests + 1 todo.

### Changed
- **`transactions.amount` and `transactions.category_id` are nullable** (migration 012). App-enforced rule on create and edit: at least one of {amount, category, receipt}. The create form/sheet dropped the `required` attributes in favour of a shared client-side guard mirroring the server error.
- **Status recompute** matches product costs against the *effective* amount — the manual amount, else the scanned total.
- **Spend aggregations** (`/plan`, `/expenditures`, `/charts`) count a scan-only transaction at `COALESCE(t.amount, r.total)`; the transactions list shows the scanned total as the amount fallback, an amber "No amount" pill with neither, and "Uncategorized" for a missing category.

### Migrations
- **012** — drop `NOT NULL` on `transactions.amount` / `transactions.category_id`; add `receipts.total`.

### Deploy notes
- No new env vars or compose changes — `git pull` + `docker compose up -d --build` applies migration 012 on startup. Receipts scanned before 0.4.0 have no stored `total` until re-scanned.

---

## 0.3.0 — 2026-07-08 — Receipt photo storage

Uploaded receipt photos are now **kept**, not just scanned and discarded. Each scanned transaction stores its (client-downscaled, ~100–300 KB) receipt image and can show it again later.

### Added
- **`receipts` table** (migration 011) — one stored image per transaction (`BYTEA` + content type), written by the scan action via upsert *before* the vision call, so the photo survives a failed scan and a re-scan replaces it. Stored in Postgres deliberately: images ride along in the existing DB backup/snapshot workflow instead of needing a separate file-storage backup.
- **`/api/receipts/[id]` route handler** — streams the stored image, session-checked (401) and tenant-scoped (404 for missing/foreign ids), `Cache-Control: private, no-store`.
- **"View receipt" link** in the products modal's scanner box whenever the transaction has a stored receipt (`Transaction.receipt_id`, LEFT JOINed by `getTransactions`).
- **Tests** — receipt persistence in the scan action, the new query, the route handler's auth/404/streaming branches, and the modal link (suite now 232 tests + 1 todo).

### Migrations
- **011** — `receipts` table.

### Deploy notes
- No new env vars or compose changes — `git pull` + `docker compose up -d --build` applies migration 011 on startup. Expect the DB (and its backups) to grow by roughly the size of the stored receipt JPEGs.

---

## 0.2.0 — 2026-06-30 — AI receipt scanning & product line items

Transactions are now made up of **product line items**, and a receipt photo can fill them in automatically with a single OpenAI vision call. Status moves through a `processing → unverified → ready_to_verify → verified` workflow driven by whether the line items add up.

### Added
- **Products** — each transaction can hold one or more line items (`name` mandatory; optional `brand`, `cost`, `product_type`, `tags`, `description`, `price`, `amount`, `unit`). Cost lives on the line item, not a shared catalog. Managed through a new `ProductsModal` (add/edit/delete) and exposed via `src/actions/products.ts` + `src/db/queries.ts`. `transaction.amount` stays authoritative — products are an optional breakdown.
- **AI receipt scanning** — upload a receipt photo on the create form (or hit Scan in the products modal) and an OpenAI vision call parses its line items into products under the hood (`src/lib/receipt-scan.ts` → `src/actions/receipt.ts`). The HTTP call is bounded by a 60 s timeout so a hung request can't strand a row in `processing`. Full design in `AI_SCAN.md`.
- **Status workflow** — `processing` | `unverified` | `ready_to_verify` | `verified`. Status is recomputed automatically: when product costs sum to `amount` the row becomes `ready_to_verify`, otherwise `unverified`. The `ready_to_verify → verified` step is user-driven — the row's `StatusBadge` is itself the verify control (no separate Verify button). Rows self-heal out of a stuck `processing` state by polling `router.refresh()`.
- **Tunable scan prompt** — the vision system prompt is composed at runtime from checked-in config (`src/lib/receipt-prompt.md`, `receipt-units.json`, `receipt-examples.json`), so it can be tuned without code changes.
- **Seed data** — `scripts/seed.mjs` now seeds stores, product line items, and status.
- **Tests** — full coverage for products, receipt actions, the scan library, and the products modal (suite now ~219 tests).

### Changed
- Transaction row and create/edit UI reworked around products and the status tag.
- Status is now recomputed when a transaction's `amount` is edited manually, not just when products change.
- Cost-matching for the `ready_to_verify` transition loosened to tolerate rounding.

### Migrations
- **007** — `products` table (backfilled existing rows with a single `other` product; new transactions start empty).
- **008** — product `price`, `amount`, `unit` columns.
- **009** — transaction `status` column.
- **010** — transaction `store` column.

Migrations run automatically on boot (`migrate()` in `src/instrumentation-node.ts`).

### Deploy notes
- Set **`OPENAI_API_KEY`** in the server `.env` to enable scanning (`OPENAI_MODEL` optional, default `gpt-4o-mini`). Without it, scanning returns a friendly error and everything else works unchanged. See `DEPLOY.md` and `.env.production.example`.
- No other server changes required — `git pull` + `docker compose up -d --build` applies migrations 007–010 on startup.

---

## 0.1.0 — initial

Baseline finmon: categories, transactions, monthly plans, expenditures and charts pages, email/password auth with per-user multi-tenancy, and the initial DigitalOcean / Docker Compose deployment. Predates this changelog; see git history for detail.
