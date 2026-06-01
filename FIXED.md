
01.06.2026
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
