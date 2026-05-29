-- Add nullable user_id to existing tables; FKs cascade on user delete.
-- The categories.name UNIQUE is dropped here and replaced with a per-user UNIQUE in 006
-- after backfill, so any pre-existing rows can be claimed by the owner without conflict.

ALTER TABLE categories   ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE plans        ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_user_id_fkey,
  ADD  CONSTRAINT categories_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_user_id_fkey,
  ADD  CONSTRAINT plans_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_user_id_fkey,
  ADD  CONSTRAINT transactions_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES "user"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_categories_user_id   ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_user_id        ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
