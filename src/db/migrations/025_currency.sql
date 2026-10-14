-- Currency: UAH is the base — every stored amount, cost, receipt total and plan
-- stays UAH. A transaction (or receipt) entered in USD/EUR keeps what was
-- actually entered next to its converted UAH figure. Existing rows are UAH.

-- NBU official rates, UAH per 1 unit, cached once per currency and day.
CREATE TABLE IF NOT EXISTS exchange_rates (
  currency   TEXT NOT NULL,
  date       TEXT NOT NULL,
  rate       NUMERIC(14,6) NOT NULL CHECK (rate > 0),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, date)
);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UAH',
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6);
ALTER TABLE transactions
  ADD CONSTRAINT transactions_currency_check CHECK (currency IN ('UAH', 'USD', 'EUR')),
  ADD CONSTRAINT transactions_original_check CHECK (
    (currency = 'UAH' AND original_amount IS NULL AND exchange_rate IS NULL)
    OR (currency <> 'UAH' AND original_amount > 0 AND exchange_rate > 0)
  );

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UAH',
  ADD COLUMN IF NOT EXISTS original_total NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6);
ALTER TABLE receipts
  ADD CONSTRAINT receipts_currency_check CHECK (currency IN ('UAH', 'USD', 'EUR')),
  ADD CONSTRAINT receipts_original_check CHECK (
    (currency = 'UAH' AND original_total IS NULL AND exchange_rate IS NULL)
    OR (currency <> 'UAH' AND exchange_rate > 0)
  );
