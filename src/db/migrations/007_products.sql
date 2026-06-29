-- Products: each transaction is made up of one or more product line items.
-- Only `name` is mandatory; brand/cost/product_type/tags/description are optional.
-- `cost` lives on the line item (not a shared catalog), so the same product type
-- or brand can recur at different costs across transactions.
--
-- transactions.amount stays authoritative (Reading A): products are a breakdown,
-- nothing forces their costs to sum to amount. Every existing transaction is
-- backfilled with a single product named 'other' whose cost mirrors the amount,
-- and createTransaction applies the same default when no products are specified.

CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  transaction_id INTEGER          NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id        TEXT             NOT NULL REFERENCES "user"("id")     ON DELETE CASCADE,
  name           TEXT             NOT NULL,
  brand          TEXT,
  cost           DOUBLE PRECISION CHECK (cost IS NULL OR cost > 0),
  product_type   TEXT,
  tags           TEXT[]           NOT NULL DEFAULT '{}',
  description    TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_transaction_id ON products(transaction_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id        ON products(user_id);

-- Backfill: give every pre-existing transaction a default 'other' product.
-- Guarded with NOT EXISTS so it is safe regardless of re-runs.
INSERT INTO products (transaction_id, user_id, name, cost)
SELECT t.id, t.user_id, 'other', t.amount
FROM transactions t
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.transaction_id = t.id);
