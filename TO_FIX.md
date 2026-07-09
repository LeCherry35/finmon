# TO_FIX

Audit findings, ordered by severity.

## How issues are documented

1. **When an issue is found**, add it here under the matching severity level
   (Critical / High / Medium / Low) as a `### Title` followed by a description.
2. **When an issue is fixed**, remove it from this file and move it to
   [`FIXED.md`](FIXED.md) under the current date (`DD.MM.YYYY` heading), adding a
   short **Fix:** note describing what changed.

---

## Critical — silent corruption or security exposure

---

## High — functional bugs in normal use

### Process discounts
the discount may be tied to product or to transaction

### Store name and total are parsed from check but dont affect anything
---

## Medium — UX / robustness

### `requireUser` redirects to `/login` with no return-to
`src/lib/dal.ts:14` does `redirect("/login?stale=1")` and the login page always pushes to `/transactions` afterward. Users trying to reach `/plan` or `/charts` get re-anchored to transactions. Pass a `?next=` param (validated against an allowlist of known routes before redirecting back).

### Fresh-account empty state has no guidance
A new user lands on `/transactions` with zero categories. Creating transactions works (both create forms take a free-text `category_name`, and since 0.4.0 the category is optional entirely), but `/plan` only offers a "No categories yet — add one first" link. Either auto-redirect zero-category users to `/categories`, or seed a starter category set in a Better Auth `after-create` hook.

### Email HTML escapes `name` but not `url`
`src/lib/email.ts:23,33` interpolates `${url}` into both an `href` attribute and a paragraph without escaping. Better Auth currently builds safe URLs, but a future change introducing a `"` in the callback path would break the anchor. Run `url` through `escapeHtml` (and ensure callers pre-encode via `encodeURI`).

### Migration 006 won't update an existing owner password on re-run
`src/db/migrations/006_backfill_owner_and_lock.sql` inserts the `account` row with `ON CONFLICT ("id") DO NOTHING`. Rotating `OWNER_PASSWORD_HASH` and re-running migrations is a silent no-op — the new hash is ignored. Probably intentional (one-time backfill; rotate via the forgot-password flow) but worth a comment in the migration.

### `deleteTransaction` skips id validation and returns nothing
`src/actions/transactions.ts:158` (`deleteTransaction`) reads `id = Number(formData.get("id"))` and runs `DELETE … WHERE id = $1 AND user_id = $2` without checking `!Number.isFinite(id) || id <= 0`. Compare to `updateTransaction` which validates. Also returns implicit `void` while sibling actions return `ActionResult`. Today the form always sends a valid id, so it's latent — but inconsistent with the rest of the file.

### Migration runner has no advisory lock — concurrent startup can race
`src/instrumentation-node.ts` (`migrate()`, invoked from `src/instrumentation.ts`'s `register()`) checks `_migrations`, then applies each pending file. If more than one container/task boots concurrently against the same database (rolling deploy or scaling to >1 task), two runners can both see a migration as not-done and race to apply it. Most statements are `IF NOT EXISTS`-safe, but `ALTER … ADD CONSTRAINT` (e.g. migration 006) and the `INSERT INTO _migrations (name)` PK are not — the loser's transaction rolls back and that task crashes at startup. Latent today because prod runs a single ephemeral task (see `DEPLOY.md`), but it becomes real the moment the deploy fans out. Fix: take a `pg_advisory_xact_lock(<const>)` (or session-level `pg_advisory_lock`) before the apply loop so runners serialize.

### `deleteProduct` can leave a transaction with zero products
`src/actions/products.ts` `deleteProduct` removes any product the user owns with no guard against deleting the last one, so a transaction can end up with `products = []`. This does not crash — the empty state is handled (`ProductsModal.tsx:104`, `?? []`) and `transactions.amount` stays authoritative (Reading A: products are an optional breakdown) — so it may be intended. Decision needed: either accept zero-product transactions as valid, or block deleting the final product (and/or fall back to recreating a default `other`). Document whichever is chosen.

---

## Low / cosmetic

### Date / month columns accept arbitrary strings — DB has no CHECK
Server actions validate `YYYY-MM-DD` / `YYYY-MM` with regex, so today the only writers are guarded. No DB-level constraint as defense-in-depth — a future code path that bypasses validation could silently insert garbage that falls out of `LEFT(date,7) = $month` filters. Fix would be a migration adding `CHECK (date ~ '^\d{4}-\d{2}-\d{2}$')` (and equivalent for `plans.month`).

### `getPlansForMonth` groups by `c.priority` without selecting it
`src/db/queries.ts:119` lists `c.priority` in `GROUP BY` but not in the `SELECT`. PostgreSQL allows it because `c.id` is the PK (functional dependency), so `c.priority` in the GROUP BY is redundant. Drop it from the GROUP BY or add it to the SELECT — either makes the intent explicit.

### Proxy is a cookie-presence check, not session validation
`src/proxy.ts:23` uses `getSessionCookie(request)` which only checks the cookie exists, not that the session is valid. Revoked or expired sessions still pass the proxy and only fail at `requireUser()` on the page. By design (no DB calls in proxy) and `dal.ts` does the real check, but worth a comment so future readers don't mistake proxy for the security boundary.

### `.env example` filename has a literal space
Should be `.env.example`. Trivial.

### Products attach uses `SELECT *`
`src/db/queries.ts` `getTransactions` fetches each row's products with `SELECT * FROM products …`. The list view only needs name/brand/cost/product_type, yet `tags` and `description` are pulled on every load, and a future wide column (e.g. a receipt blob) would silently bloat every transactions-list response. Enumerate the columns actually used.

