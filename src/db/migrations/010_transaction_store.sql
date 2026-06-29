-- Add an optional store / merchant name to transactions. Free text, nullable —
-- a transaction need not record where it happened.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS store TEXT;
