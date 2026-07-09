-- Amount and category become optional on transactions: a receipt scan can fill
-- them in after creation. The app layer enforces "at least one of {amount,
-- category, receipt}" (the receipt lives in another table, so a CHECK cannot
-- express it). The existing CHECK (amount > 0) already tolerates NULL.
ALTER TABLE transactions ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE transactions ALTER COLUMN category_id DROP NOT NULL;

-- The receipt's printed grand total as read by the scan. transactions.amount
-- stays the manual, authoritative figure; this is what the receipt said.
-- Reset to NULL when a new image is stored, filled after a successful scan.
ALTER TABLE receipts ADD COLUMN total NUMERIC(12,2) CHECK (total > 0);
