-- Discounts read off scanned receipts (also editable manually on products).
--
-- products.discount: the money taken off that specific line item. `cost` stays
-- the FINAL amount paid for the line (after its discount), so product costs
-- keep summing toward the receipt total — the discount is informational.
--
-- receipts.discount: a general discount applied to the whole check (loyalty
-- card, coupon) that is not attributable to any single line item. `total` stays
-- the final amount paid, so sum(product costs) - receipts.discount ≈ total;
-- the status recompute subtracts it. Reset to NULL alongside `total` when a
-- new image is stored, filled after a successful scan.

ALTER TABLE products ADD COLUMN IF NOT EXISTS discount DOUBLE PRECISION CHECK (discount IS NULL OR discount > 0);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) CHECK (discount > 0);
