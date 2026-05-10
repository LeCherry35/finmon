# TO_FIX

Audit findings, ordered by severity.

---

## Critical — silent corruption or security exposure

### 4. Date / month columns accept arbitrary strings — partially fixed
Server actions now validate format with regex (no DB change). The schema-level `CHECK` constraints were reverted — adding them to an existing DB requires `ALTER TABLE`.

### 5. Category deletion has undefined behavior
Deleting a category leads to undefined app behavior — transactions and plans reference `category_id`, so the result is some mix of raw FK errors, orphaned rows, or broken pages depending on the path. Likely fix: remove the delete affordance entirely (decision pending). See also item 12 for the user-facing FK-error symptom.

---

## High — functional bugs in normal use

_(all resolved)_

---

## Medium — UX / robustness

### 11. `PlanRow` key includes mutable state
`src/app/plan/page.tsx:35` — ``key={`${row.category_id}-${row.amount}`}``. When `amount` changes after save, React unmounts/remounts the row and editing state is lost. Use `row.category_id` only.

### 12. `deleteCategory` surfaces raw Postgres FK error
Categories are `ON DELETE RESTRICT` against transactions. Deleting a category in use throws a raw PG error and the UI shows nothing actionable. Pre-check transaction count and return a friendly message, or move to soft-delete.

### 13. Destructive actions have no confirmation
Trash icon on `CategoryRow` and `TransactionRow` deletes on a single click. Add a confirm step or undo.

### 14. Server actions throw raw `Error("...")`
Throws bubble into Next.js error overlay in dev and uncaught rejections in prod. Return `{ ok, error }` from actions and render inline form errors in the client rows.

### 15. No auth, no rate limit
Documented as intentional for single-user use, but if ever exposed past `localhost`, every server action is unauthenticated. Worth a guard if deployment is on the table.

---

## Low / cosmetic

### 19. Brand link `/` has no active style
`src/app/layout.tsx` brand link doesn't participate in `NavLinks` active state, even though `/` redirects to `/transactions`.
