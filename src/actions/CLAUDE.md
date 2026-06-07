## Server actions

All DB writes live here. Each file is `"use server"` at the top, reads `FormData`, validates, calls `pool.query(...)`, and ends with `revalidatePath(...)` for every list page the mutation can affect.

### Two return shapes (pick by hook)

- **`TransactionFormState` / `CategoryFormState`** — `{ error?: string; successCount: number }`. Used with `useActionState` on create forms. `successCount` increments on success; the client compares the new count against a stored `lastSeenSuccess` to detect "a submit just succeeded" and trigger side effects (form reset, close the mobile sheet) without an effect.
- **`ActionResult`** — `{ ok: true } | { ok: false; error: string }`. Used with `useTransition` for row-level edit/delete and one-off mutations like `upsertPlan`. The client branches on `result.ok` after `startTransition`.

`ActionResult` is exported from `src/actions/transactions.ts` and imported by the other action files.

### Validation conventions

- Numbers via `Number(formData.get(...))`, then `!Number.isFinite(n) || n <= 0` for positive amounts/ids; `Number.isInteger(n) && 0 <= n <= 10` for `priority`.
- Strings: `((formData.get(k) as string | null) ?? "").trim()`; empty string → null for nullable fields like `note`.
- Whitelisted enums: `["income", "spend"].includes(type)` for transaction `type`.
- Date format: `DATE_RE = /^\d{4}-\d{2}-\d{2}$/` in `transactions.ts`, `MONTH_RE` for `YYYY-MM` is exported from `src/lib/filters.ts` and reused by `plans.ts`.
- Unique-violation handling: `INSERT` paths that can hit a `UNIQUE` constraint wrap the query in `try/catch` and check `err.code === "23505"` via the local `isUniqueViolation` helper, returning a friendly error instead of throwing.

### Plans use upsert

`upsertPlan` uses `INSERT … ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount`. One amount per `(category_id, month)` pair — see `src/db/migrations/` for the unique constraint.

### Categories are created on-the-fly from transactions

`createTransaction` accepts `category_name` (not `category_id`) and runs `INSERT … ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id` to either create or look up the category in a single round-trip. (The conflict target is `(user_id, name)` — the per-user unique constraint added in migration 006, not the original global `name` unique.) `updateTransaction` takes a `category_id` directly because the edit UI is a select against existing categories.

### Transactions carry products

Every transaction is made up of `products` line items (`src/actions/products.ts`). `createTransaction` inserts the transaction and a single default product named `'other'` (cost = amount) **atomically via a pooled client** (`pool.connect()` + `BEGIN`/`COMMIT`) — not two bare `pool.query` calls — so a transaction is never left without its default product. `transactions.amount` stays authoritative; product costs are an optional breakdown and aren't forced to sum to it. `addProduct`/`updateProduct`/`deleteProduct` return `ActionResult`; `addProduct` validates transaction ownership via `userOwnsTransaction` (mirrors `userOwnsCategory`). Only `name` is required; `cost` is optional but must be positive when present; `tags` come in as one comma-separated field and are split/trimmed into a `TEXT[]`.
