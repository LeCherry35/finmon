CREATE TABLE IF NOT EXISTS categories (
  id       SERIAL PRIMARY KEY,
  name     TEXT           NOT NULL UNIQUE,
  priority INTEGER        NOT NULL DEFAULT 5 CHECK (priority BETWEEN 0 AND 10)
);

CREATE TABLE IF NOT EXISTS plans (
  id          SERIAL PRIMARY KEY,
  category_id INTEGER        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month       TEXT           NOT NULL,
  amount      NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
  UNIQUE (category_id, month)
);

CREATE TABLE IF NOT EXISTS transactions (
  id          SERIAL PRIMARY KEY,
  amount      NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
  type        TEXT           NOT NULL CHECK (type IN ('income', 'spend')),
  category_id INTEGER        NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  date        TEXT           NOT NULL,
  note        TEXT
);
