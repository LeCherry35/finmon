-- Receipts: the uploaded receipt photo behind a scanned transaction. One per
-- transaction (UNIQUE transaction_id) — a re-scan replaces the stored image via
-- upsert. The image is the client-downscaled JPEG the scan action receives
-- (~100-300 KB), stored as BYTEA so it rides along in DB backups; it is served
-- by the authed route handler at /api/receipts/[id].

CREATE TABLE IF NOT EXISTS receipts (
  id             SERIAL PRIMARY KEY,
  transaction_id INTEGER     NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  user_id        TEXT        NOT NULL REFERENCES "user"("id")            ON DELETE CASCADE,
  image          BYTEA       NOT NULL,
  content_type   TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
