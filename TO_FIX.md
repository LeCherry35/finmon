# TO_FIX

Audit findings, ordered by severity.

## How issues are documented

1. **When an issue is found**, add it here under the matching severity level
   (Critical / High / Medium / Low) as a `### Title` followed by a description.
2. **When an issue is fixed**, remove it from this file and move it to
   [`FIXED.md`](FIXED.md) under the current date (`DD.MM.YYYY` heading), adding a
   short **Fix:** note describing what changed.

---

## High — functional bugs in normal use

### Logged-in users can't reach the password-reset form
`src/proxy.ts:36-37` redirects any signed-in user away from `/reset-password` (it's in `AUTH_PATHS`). The forgot-password flow sends the user to `/reset-password?token=…`; if they still have a session cookie on the device they requested the reset from, the proxy bounces them to `/transactions` and they never see the form. Either allow `/reset-password` through unconditionally, or only when `?token=` is present.

> Note: the email flows that trigger this (forgot-password / reset emails) are currently **disabled** — the Better Auth hooks in `src/lib/auth.ts` are commented out (see DEPLOY.md → "Email auth flows disabled"). So this only bites a user who navigates to `/reset-password` manually today; it becomes live again once email is re-enabled.

### No rate limiting on auth endpoints
`src/lib/auth.ts` does not configure Better Auth's `rateLimit` block, so `/sign-in/email`, `/forgot-password`, and `/send-verification-email` are unbounded. At minimum:
```ts
rateLimit: { enabled: true, window: 60, max: 10 }
```
with stricter custom rules on sign-in and password-reset endpoints.

---

## Medium — UX / robustness

### Expeditures over time chart allows to select month that are not adjacent.
We need to handle only adjacent months selection.

### `requireUser` redirects to `/login` with no return-to
`src/lib/dal.ts:14` does `redirect("/login?stale=1")` and the login page always pushes to `/transactions` afterward. Users trying to reach `/plan` or `/charts` get re-anchored to transactions. Pass a `?next=` param (validated against an allowlist of known routes before redirecting back).

### Fresh-account empty state has no guidance
A new user lands on `/transactions` with zero categories. The desktop inline form accepts a free-text `category_name` so it works, but the mobile create sheet and `/plan` show "add a category first" with no further nudge. Either auto-redirect zero-category users to `/categories`, or seed a starter category set in a Better Auth `after-create` hook.

### Email HTML escapes `name` but not `url`
`src/lib/email.ts:23,33` interpolates `${url}` into both an `href` attribute and a paragraph without escaping. Better Auth currently builds safe URLs, but a future change introducing a `"` in the callback path would break the anchor. Run `url` through `escapeHtml` (and ensure callers pre-encode via `encodeURI`).

### Migration 006 won't update an existing owner password on re-run
`src/db/migrations/006_backfill_owner_and_lock.sql` inserts the `account` row with `ON CONFLICT ("id") DO NOTHING`. Rotating `OWNER_PASSWORD_HASH` and re-running migrations is a silent no-op — the new hash is ignored. Probably intentional (one-time backfill; rotate via the forgot-password flow) but worth a comment in the migration.

### `deleteTransaction` skips id validation and returns nothing
`src/actions/transactions.ts:96-101` reads `id = Number(formData.get("id"))` and runs `DELETE … WHERE id = $1 AND user_id = $2` without checking `!Number.isFinite(id) || id <= 0`. Compare to `updateTransaction:74` which validates. Also returns implicit `void` while sibling actions return `ActionResult`. Today the form always sends a valid id, so it's latent — but inconsistent with the rest of the file.

---

## Low / cosmetic

### Date / month columns accept arbitrary strings — DB has no CHECK
Server actions validate `YYYY-MM-DD` / `YYYY-MM` with regex, so today the only writers are guarded. No DB-level constraint as defense-in-depth — a future code path that bypasses validation could silently insert garbage that falls out of `LEFT(date,7) = $month` filters. Fix would be a migration adding `CHECK (date ~ '^\d{4}-\d{2}-\d{2}$')` (and equivalent for `plans.month`).

### `length >= 0` in `queries.ts` is dead code
`src/db/queries.ts:63, 99, 134, 138, 167, 198, 202` use `if (arr && arr.length >= 0)`. The `length >= 0` is always true when the array is non-null, so it reads like a typo for `> 0`. Current behavior is intentional (empty array means "user deselected everything → show nothing", matching the "No categories" UI summary) — Postgres `= ANY('{}'::int[])` correctly returns zero rows. Simplify each site to `if (arr)` to make intent clear without changing behavior.

### `getPlansForMonth` groups by `c.priority` without selecting it
`src/db/queries.ts:77` lists `c.priority` in `GROUP BY` but not in the `SELECT`. PostgreSQL allows it because `c.id` is the PK (functional dependency), so `c.priority` in the GROUP BY is redundant. Drop it from the GROUP BY or add it to the SELECT — either makes the intent explicit.

### Proxy is a cookie-presence check, not session validation
`src/proxy.ts:23` uses `getSessionCookie(request)` which only checks the cookie exists, not that the session is valid. Revoked or expired sessions still pass the proxy and only fail at `requireUser()` on the page. By design (no DB calls in proxy) and `dal.ts` does the real check, but worth a comment so future readers don't mistake proxy for the security boundary.

### `.env example` filename has a literal space
Should be `.env.example`. Trivial.

