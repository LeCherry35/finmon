-- Deleting a chat in the assistant UI only hides it: the row (and the opencode
-- session holding its messages) is kept for the record.
ALTER TABLE agent_chats ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_chats_user_active
  ON agent_chats(user_id) WHERE deleted_at IS NULL;
