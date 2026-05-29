-- Idempotent and tolerant of missing OWNER_* env vars:
--  * If OWNER_USER_ID is set (via instrumentation.ts → set_config), the owner user
--    + credential row are upserted and any orphan rows in categories/plans/transactions
--    are claimed by them.
--  * If OWNER_USER_ID is unset, all of the above is a no-op. On a blank DB this is fine —
--    the NOT NULL + UNIQUE locks at the end still apply. On a DB with existing rows,
--    the NOT NULL lock will fail loudly, which is the desired safety net for prod.

INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
SELECT
  current_setting('app.owner_user_id', true),
  current_setting('app.owner_name', true),
  current_setting('app.owner_email', true),
  TRUE, NOW(), NOW()
WHERE current_setting('app.owner_user_id', true) IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "account" (
  "id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt"
)
SELECT
  'cred_' || current_setting('app.owner_user_id', true),
  current_setting('app.owner_user_id', true),
  'credential',
  current_setting('app.owner_user_id', true),
  current_setting('app.owner_password_hash', true),
  NOW(), NOW()
WHERE current_setting('app.owner_user_id', true) IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE categories   SET user_id = current_setting('app.owner_user_id', true)
  WHERE user_id IS NULL AND current_setting('app.owner_user_id', true) IS NOT NULL;
UPDATE plans        SET user_id = current_setting('app.owner_user_id', true)
  WHERE user_id IS NULL AND current_setting('app.owner_user_id', true) IS NOT NULL;
UPDATE transactions SET user_id = current_setting('app.owner_user_id', true)
  WHERE user_id IS NULL AND current_setting('app.owner_user_id', true) IS NOT NULL;

ALTER TABLE categories   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE plans        ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_user_id_name_key,
  ADD  CONSTRAINT categories_user_id_name_key UNIQUE (user_id, name);
