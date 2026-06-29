-- Add a workflow status to transactions. Default 'unverified'; logic around
-- transitions (processing / ready_to_verify / verified) comes later.
-- NOT NULL + DEFAULT backfills every existing row with 'unverified'.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('processing', 'unverified', 'ready_to_verify', 'verified'));
