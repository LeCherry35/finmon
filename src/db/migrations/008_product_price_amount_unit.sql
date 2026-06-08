-- Add optional price / amount (quantity) / unit fields to product line items.
-- These are independent of `cost` for now (no enforced price * amount = cost
-- relationship). A `verified` field is planned later, gated on a future
-- feature/subcategories concept — not introduced here.

ALTER TABLE products ADD COLUMN IF NOT EXISTS price  DOUBLE PRECISION CHECK (price  IS NULL OR price  > 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS amount DOUBLE PRECISION CHECK (amount IS NULL OR amount > 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit   TEXT;
