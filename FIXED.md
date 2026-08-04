
03.08.2026
### ✅ FIXED — Uncategorized spend vanishes from every aggregate
Since migration 012 made `transactions.category_id` nullable, every spend aggregation reached categories through `t.category_id = c.id` — `getPlansForMonth` / `getPlansSummary` join from `categories` outward, `getExpendituresByCategory` / `getExpenditureSeries` used an inner `JOIN categories` — so a transaction with no category contributed to *nothing*: not `/plan`, not `/expenditures`, not `/charts`. Mostly masked because a receipt scan assigns a category, but a manually created amount-only transaction was permanently invisible in every total.

**Fix:** All four aggregations now bucket category-less spend under a shared sentinel — `category_id = 0`, name `"Uncategorized"` (`UNCATEGORIZED_ID` / `UNCATEGORIZED_NAME` in `src/db/queries.ts`; real ids are SERIAL ≥ 1). The two expenditure queries switched from inner `JOIN categories` to `LEFT JOIN … + COALESCE(c.id,0)/COALESCE(c.name,'Uncategorized')` (the series query also `COALESCE(c.priority,-1)` so it sorts last), so `/expenditures` gets an "Uncategorized" row and `/charts` an "Uncategorized" series/slice automatically. The category-anchored plan queries can't reach category-less rows, so they append a synthetic, non-editable "Uncategorized" row via a new `uncategorizedSpent(userId, months)` helper — only when no explicit category filter is active (the FilterPanel can't select it) and there is actually such spend; `PlanRow` renders that row read-only (negative "left", no plan input). The charts page injects a synthetic `Category {id:0, priority:-1}` so the pivot/colors/legend treat it like any other series. Tests cover the LEFT-JOIN/coalesce SQL, the appended plan/summary rows (and their suppression under a category filter or with zero uncategorized spend), and the read-only `PlanRow`. *(SQL validated via the mocked query tests + typecheck; not yet exercised against a live DB.)*

09.07.2026
### ✅ FIXED — Process discounts
The receipt scan ignored discounts entirely: a discounted line item's saving was invisible, and a check-wide discount (loyalty card, coupon) made the product costs sum above the receipt total, permanently blocking `ready_to_verify`.

**Fix:** Discounts are read at both levels (0.5.0, migration 013). Per-product: `products.discount` — the money off that line, with `cost` staying the final paid figure (scan schema/prompt/examples instruct this; also manually editable in the product editor). Check-wide: `receipts.discount`, stored next to `total` and reset with it on a new image; since line costs sum pre-that-discount, `recomputeTransactionStatus` (and the modal's total line, rendered as `Total: sum − discount = net`) nets it off before matching the effective amount. Tests cover the scan mapping/schema, receipt-row persistence/reset, and the recompute netting.

> **Partially reverted in 0.5.1** (see `VERSIONS.md`): the check-wide half double-counted in practice — receipts print a final total with every discount already reflected, so the netting broke the `ready_to_verify` match. The scan no longer extracts a check-wide discount and nothing nets anything off; `receipts.discount` stays in the schema as a dormant column. The per-product half stands.

### ✅ FIXED — Store name and total are parsed from check but dont affect anything
The scan read the merchant name and grand total off the receipt but discarded them — neither reached the transaction or influenced anything downstream.

**Fix:** Resolved by the 0.4.0 scan-first work. The scanned `store` now fills a blank `transactions.store` (a manually entered one is never overwritten), and the scanned grand total is persisted in `receipts.total` (migration 012), where it acts as the fallback amount everywhere: shown in the transactions list and modal (`scanned_total`), counted in spend aggregations via `COALESCE(t.amount, r.total)`, matched against product costs by `recomputeTransactionStatus`, guarded against a disagreeing manual amount (blocks `ready_to_verify`), and adopted as the real `amount` on verify.

09.06.2026
### ✅ FIXED — Status didn't change when a transaction's amount was manually edited
`updateTransaction` (`src/actions/transactions.ts`) wrote a new `amount` but never re-derived `status` from the product line items. So editing the total left the row's status stale: a transaction whose products still summed to the *old* amount stayed `ready_to_verify`/`verified` after the amount moved away from that sum, and conversely editing the amount to match existing product costs never promoted the row to `ready_to_verify`.

**Fix:** `updateTransaction` now captures the previous amount in the same round-trip (a `WITH prev AS (…)` CTE returning `prev.amount`) and calls `recomputeTransactionStatus(userId, id)` — but only when the amount actually changed, so editing an unrelated field (note/date/category) never downgrades a `verified` row. The recompute reuses the existing helper exported from `products.ts`. New tests in `transactions.test.ts` cover the recompute-on-amount-change and no-recompute-when-unchanged paths.

08.06.2026
### ✅ FIXED — Receipt scan could leave a transaction stuck on `processing` forever
A transaction added with a receipt is created `processing`; the only thing that clears it is `scanReceiptForTransaction`'s `finally` (recompute status + `revalidatePath`). Three holes meant a row could sit on `processing` indefinitely: (1) the image-format and ownership checks `return`ed **before** the `try`, so a bad/missing image skipped the `finally` recompute entirely; (2) `scanReceipt`'s OpenAI `fetch` had **no timeout**, so a hung request never reached the `finally`; (3) the scan is fired as a bare fire-and-forget action from a `useEffect`, so its `revalidatePath` could be orphaned/swallowed and never refresh the client even after the DB recovered.

**Fix:** (1) `scanReceiptForTransaction` now runs the image check **inside** the `try`, so every post-ownership failure path hits the `finally` and the row leaves `processing` (`src/actions/receipt.ts`). (2) `scanReceipt` wraps the call in a 60 s `AbortController` timeout, mapped to a friendly "timed out" error (`src/lib/receipt-scan.ts`). (3) `TransactionRow` self-heals: while `status === "processing"` it polls `router.refresh()` every 4 s, torn down the moment the status changes, so the UI catches up to the recovered DB regardless of the fire-and-forget revalidation. New tests cover the bad-image-still-recomputes path, the timeout→error mapping, and the processing poll (start/stop).

### ✅ FIXED — `createTransaction` no longer creates a default `'other'` product
New transactions started with a single default product named `'other'` (cost = amount), inserted alongside the transaction inside a `BEGIN`/`COMMIT` block via a pooled client. Two `TO_FIX` items rode on that block: a `ROLLBACK`-in-`catch` that could mask the original error, and a category upsert that ran outside the client transaction (orphan-category-on-rollback).

**Fix:** Transactions now start with **no products** (the user adds them via the products modal). `createTransaction` is a single `pool.query` insert — no client transaction, no default product — which also dissolves both dependent `TO_FIX` items. The seed script's `backfillOtherProducts` was removed for the same reason, so seeded data matches what the app produces. Legacy `'other'` rows from migration 007's backfill are left in place (harmless; nothing depends on them). Tests in `transactions.test.ts` updated to assert the two-query flow and the absence of a product insert.

### ✅ FIXED — Product edit form showed stale values when re-opened after a save
`src/components/ProductsModal.tsx` `ProductItem` initialized `form` once via `useState(() => toForm(product))`. After a save + `revalidatePath`, the fresh `product` prop updated the read-only view but `form` was never re-synced, so re-opening Edit showed the pre-save text (e.g. a value the server had trimmed).

**Fix:** The Edit button's `onClick` now calls `setForm(toForm(product))` before `setEditing(true)`, so the form is re-seeded from the current prop on every edit. Covered by the existing `ProductsModal.test.tsx` suite.

### ✅ FIXED — `getProductsForTransaction` was dead code
`src/db/queries.ts` exported `getProductsForTransaction`, but nothing called it — `getTransactions` attaches products inline via a batched `transaction_id = ANY(...)` query. The orphan invited a future per-row caller to reintroduce N+1.

**Fix:** Removed the unused function. The `Product` type import stays (still used by `getTransactions`'s attach). No callers existed, so no other change was needed.

### ✅ FIXED — `createTransaction` test dropped its exact call-count assertion
`src/actions/transactions.test.ts` no longer asserted the total number of `query` calls (the pre-rewrite test pinned `toHaveBeenCalledTimes(2)`); it only checked specific call indices, so a dropped `BEGIN`/default-product `INSERT` or a spurious query could pass unnoticed.

**Fix:** Re-added `expect(query).toHaveBeenCalledTimes(5)` to the success path (category upsert + BEGIN + transaction INSERT + product INSERT + COMMIT).

01.06.2026
### ✅ FIXED — Expenditures-over-time chart allowed non-adjacent month selection
The chart's x-axis is built from `generateBuckets(months, …)`, which only emits buckets for the selected months. A non-adjacent selection (e.g. Jan + Mar, Feb deselected) skipped Feb entirely, so the stacked-area "over time" chart stitched Jan straight to Mar and misrepresented the timeline.

**Fix:** Added `contiguousMonthRange(months)` in `src/lib/charts.ts` — expands a selection to the full `[min..max]` span (inclusive, gap-filled, malformed entries ignored, year boundaries handled). `ExpendituresOverTimePanel` (`src/app/charts/page.tsx`) now derives `spanMonths` and uses it for `pickBucket`, `generateBuckets`, **and** `getExpenditureSeries`, so the axis is continuous and the filled-in months show real data. Scoped to the over-time chart only — `category-share` (a non-time aggregate) and the other list pages are untouched, and the FilterPanel selection is left as-is. Six new cases in `charts.test.ts`.

### ✅ FIXED — Logged-in users can't reach the password-reset form
`src/proxy.ts` redirected any signed-in user away from `/reset-password` (it's in `AUTH_PATHS`). The forgot-password flow sends the user to `/reset-password?token=…`; if they still had a session cookie on the device they requested the reset from, the proxy bounced them to `/transactions` and they never saw the form.

**Fix:** Added an `isResetWithToken` check (`path === "/reset-password"` && `?token=` present) and excluded it from the `hasSession && onAuthPage` redirect, so a signed-in user with a valid reset link reaches the form. A bare `/reset-password` (no token) is still treated as an auth page and bounced. Two `proxy.test.ts` cases cover both branches.

### ✅ FIXED — No rate limiting on auth endpoints
`src/lib/auth.ts` did not configure Better Auth's `rateLimit` block, so `/sign-in/email`, `/forget-password`, `/reset-password`, and `/send-verification-email` were unbounded — open to brute-force and account enumeration.

**Fix:** Added a `rateLimit` block with `enabled: true` (on in all envs, not just prod), a global `60 req / 60 s` per-IP ceiling, and stricter `customRules` on the sensitive endpoints (sign-in/sign-up 5/min, forget-password/request-password-reset/send-verification 3/min, reset-password 5/min). Custom-rule keys use Better Auth's API paths (`/forget-password`, not the app route `/forgot-password`). Uses the default in-memory store — adequate for the single prod task; a comment notes switching to `storage: "database"` if the deploy scales out.

### ✅ FIXED — `length >= 0` dead code in `queries.ts` filter builders
`src/db/queries.ts` repeated `if (arr && arr.length >= 0)` at seven sites. The `length >= 0` was always true for a non-null array — it read like a typo for `> 0` while actually meaning "is the filter present at all". The same 4-line param-push + clause-build block was also copy-pasted across five query builders.

**Fix:** Extracted one `anyArrayFilter(column, arr, type, params)` helper that pushes the param and returns the `= ANY($n::type[])` predicate, gated on `if (!arr) return ""`. `getPlansForMonth`, `getPlansSummary`, `getExpendituresByCategory`, `getExpenditureSeries`, and `getTransactions` all call it — the dead `length >= 0` is gone and the empty-array "everything deselected → show nothing" behavior is preserved and documented on the helper. Generated SQL is byte-identical (the mocked `queries.test.ts` SQL/param assertions still pass).

### ✅ FIXED — `scripts/reset-local-db.mjs` has no host guard
Drops `transactions`, `plans`, `categories`, `user`, `session`, `account`, `verification`, `_migrations` — all auth + app tables, cascaded. There is no check that `SQL_DB_HOST` is local; running this with prod env vars loaded would wipe RDS. Refuse unless host is `localhost`/`127.0.0.1`, or require an explicit `--yes-i-mean-it` flag.

**Fix:** Added a host guard at the top of the script — exits with code 1 (before any DB connection is opened) unless `SQL_DB_HOST` is local (`localhost`/`127.0.0.1`/`::1`/empty) or `--yes-i-mean-it` is passed.

### ✅ FIXED — Seed wipe uses multi-statement parameterized query (will throw at runtime)
`scripts/seed.mjs` previously ran `client.query("DELETE FROM transactions WHERE user_id = $1; DELETE FROM plans WHERE user_id = $1; DELETE FROM categories WHERE user_id = $1", [ownerUserId])`. node-postgres's extended-query path (anything with `$n` placeholders) does not accept multiple statements — this would throw "cannot insert multiple commands into a prepared statement" the first time `db:seed:init` runs.

**Fix:** The wipe is already split into three separate `client.query` calls (`scripts/seed.mjs:151-153`), each in the shared `BEGIN` transaction. No multi-statement prepared query remains. Verified in current code.

### ✅ FIXED — Silent `BETTER_AUTH_SECRET` fallback in production
`src/lib/auth.ts` passed `process.env.BETTER_AUTH_SECRET` to `betterAuth(...)` with no guard. If unset in production, Better Auth signs sessions with a default development value, making session tokens forgeable.

**Fix:** Added a fail-loud guard at module load in `src/lib/auth.ts` — throws if `BETTER_AUTH_SECRET` is unset while `NODE_ENV=production`. The secret is already set on the prod ECS task. `BETTER_AUTH_URL` was **intentionally not** guarded: the task's public IP changes every deploy, so `baseURL` is left unset and Better Auth infers the origin from the request. This and the other HTTP/no-ALB trade-offs are now documented in `DEPLOY.md` ("Known Limitations & Deferred Work").
