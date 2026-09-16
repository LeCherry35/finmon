-- In-app AI agent. The agent itself (opencode) stores the conversation; finmon
-- only records which opencode session belongs to which user, and the write
-- proposals the agent made that are waiting on the user's explicit approval.

CREATE TABLE IF NOT EXISTS agent_chats (
  id                  SERIAL PRIMARY KEY,
  user_id             TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  opencode_session_id TEXT        NOT NULL UNIQUE,
  title               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_chats_user_id ON agent_chats(user_id);

-- A write tool call from the agent never touches the target tables: it lands
-- here as `pending`, and only the user's Accept (src/actions/agent.ts) applies
-- it. `args` is the tool input as validated at proposal time; it is validated
-- again when applied. Not tied to a chat: the MCP token identifies the user,
-- not the conversation; the chat UI finds proposals through the tool results.
CREATE TABLE IF NOT EXISTS agent_proposals (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  tool       TEXT        NOT NULL,
  args       JSONB       NOT NULL,
  summary    TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'accepted', 'rejected', 'failed')),
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_user_status ON agent_proposals(user_id, status);
