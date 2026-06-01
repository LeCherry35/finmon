
01.06.2026
### ✅ FIXED — `scripts/reset-local-db.mjs` has no host guard
Drops `transactions`, `plans`, `categories`, `user`, `session`, `account`, `verification`, `_migrations` — all auth + app tables, cascaded. There is no check that `SQL_DB_HOST` is local; running this with prod env vars loaded would wipe RDS. Refuse unless host is `localhost`/`127.0.0.1`, or require an explicit `--yes-i-mean-it` flag.

**Fix:** Added a host guard at the top of the script — exits with code 1 (before any DB connection is opened) unless `SQL_DB_HOST` is local (`localhost`/`127.0.0.1`/`::1`/empty) or `--yes-i-mean-it` is passed.

### ✅ FIXED — Seed wipe uses multi-statement parameterized query (will throw at runtime)
`scripts/seed.mjs` previously ran `client.query("DELETE FROM transactions WHERE user_id = $1; DELETE FROM plans WHERE user_id = $1; DELETE FROM categories WHERE user_id = $1", [ownerUserId])`. node-postgres's extended-query path (anything with `$n` placeholders) does not accept multiple statements — this would throw "cannot insert multiple commands into a prepared statement" the first time `db:seed:init` runs.

**Fix:** The wipe is already split into three separate `client.query` calls (`scripts/seed.mjs:151-153`), each in the shared `BEGIN` transaction. No multi-statement prepared query remains. Verified in current code.

### ✅ FIXED — Silent `BETTER_AUTH_SECRET` fallback in production
`src/lib/auth.ts` passed `process.env.BETTER_AUTH_SECRET` to `betterAuth(...)` with no guard. If unset in production, Better Auth signs sessions with a default development value, making session tokens forgeable.

**Fix:** Added a fail-loud guard at module load in `src/lib/auth.ts` — throws if `BETTER_AUTH_SECRET` is unset while `NODE_ENV=production`. The secret is already set on the prod ECS task. `BETTER_AUTH_URL` was **intentionally not** guarded: the task's public IP changes every deploy, so `baseURL` is left unset and Better Auth infers the origin from the request. This and the other HTTP/no-ALB trade-offs are now documented in `DEPLOY.md` ("Known Limitations & Deferred Work").
