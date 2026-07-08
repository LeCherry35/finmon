# Versions

Release log for finmon — newest first. Each entry records the **shipped feature and behaviour changes** for a version, at the level someone needs to decide whether to pull and redeploy (and what to do on the server when they do).

This is distinct from issue tracking: `TO_FIX.md` / `FIXED.md` track audit findings, while this file is the changelog of intentional changes. When you complete a meaningful update — a feature, a behaviour change, a migration — add an entry here and bump `version` in `package.json`.

Entry shape: `## <version> — <YYYY-MM-DD> — <headline>`, then **Added / Changed / Fixed** as needed, plus **Migrations** and **Deploy notes** when they apply.

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
