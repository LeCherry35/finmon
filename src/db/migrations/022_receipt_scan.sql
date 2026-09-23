-- The latest scan of a transaction's stored receipt photo, cached between the
-- agent's scan_receipt call and the user's Accept of apply_receipt_scan — the
-- transaction-side mirror of agent_attachments.scan (migration 018). A replaced
-- image clears it: the old scan described the old photo.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS scan JSONB;
