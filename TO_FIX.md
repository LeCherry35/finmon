# TO_FIX

Audit findings, ordered by severity.

---

## Critical — silent corruption or security exposure

_(none)_

---

## High — functional bugs in normal use

_(none)_

---

## Medium — UX / robustness

### Expeditures over time chart allows to select month that are not adjacent.
We need to handle only adjacent months selection.

### No auth, no rate limit
Documented as intentional for single-user use, but if ever exposed past `localhost`, every server action is unauthenticated. Worth a guard if deployment is on the table.

### `deleteTransaction` skips id validation and returns nothing
`src/actions/transactions.ts:85-89` reads `id = Number(formData.get("id"))` and runs `DELETE … WHERE id = $1` without checking `!Number.isFinite(id) || id <= 0`. Compare to `updateTransaction:69` which validates. Also returns implicit `void` while sibling actions return `ActionResult`. Today the form always sends a valid id, so it's latent — but inconsistent with the rest of the file.

### `updateCategory` skips id validation
`src/actions/categories.ts:52-75` parses `id` but never validates it as a positive integer before `UPDATE … WHERE id = $3`. Same shape as the `deleteTransaction` issue. Add `!Number.isFinite(id) || id <= 0` check.

### `category_id` truthiness check is inconsistent
`src/actions/transactions.ts:72` and `src/actions/plans.ts:13` use `if (!category_id)`. After `Number()`, this catches `NaN` and `0` but lets any other value through, including negatives. Safe in practice but should be `!Number.isFinite(category_id) || category_id <= 0` to match the rest of the file.

---

## Low / cosmetic

### Date / month columns accept arbitrary strings — DB has no CHECK
Server actions validate `YYYY-MM-DD` / `YYYY-MM` with regex, so today the only writers are guarded. No DB-level constraint as defense-in-depth — a future code path that bypasses validation could silently insert garbage that falls out of `LEFT(date,7) = $month` filters. Fix would be a migration adding `CHECK (date ~ '^\d{4}-\d{2}-\d{2}$')` (and equivalent for `plans.month`).

### `length >= 0` in `queries.ts` is dead code
`src/db/queries.ts:60, 93, 127, 131, 159, 188, 192` use `if (arr && arr.length >= 0)`. The `length >= 0` is always true when the array is non-null, so it reads like a typo for `> 0`. Current behavior is intentional (empty array means "user deselected everything → show nothing", matching the "No categories" UI summary) — Postgres `= ANY('{}'::int[])` correctly returns zero rows. Simplify each site to `if (arr)` to make intent clear without changing behavior.

### `getPlansForMonth` groups by `c.priority` without selecting it
`src/db/queries.ts:72` lists `c.priority` in `GROUP BY` but not in the `SELECT`. PostgreSQL allows it because `c.id` is the PK (functional dependency), so `c.priority` in the GROUP BY is redundant. Drop it from the GROUP BY or add it to the SELECT — either makes the intent explicit.

