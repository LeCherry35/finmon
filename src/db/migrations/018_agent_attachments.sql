-- Receipt photos attached to assistant chat messages. The agent never sees the
-- image: the message only carries an "[Image attached: receipt #<id>]" marker,
-- and the agent's scan_receipt tool reads the row by (id, user_id). `scan` holds
-- the latest scan result (a rescan overwrites it); an accepted create_transaction
-- with receipt_id copies the image into `receipts` and the scanned line items
-- into `products`.

CREATE TABLE IF NOT EXISTS agent_attachments (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT        NOT NULL REFERENCES "user"("id")      ON DELETE CASCADE,
  chat_id      INTEGER     NOT NULL REFERENCES agent_chats(id)   ON DELETE CASCADE,
  image        BYTEA       NOT NULL,
  content_type TEXT        NOT NULL,
  scan         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_attachments_user_id ON agent_attachments(user_id);
