-- The chat a proposal came from, so it can be decided outside that chat (the
-- Suggestions page) and the agent still gets the decision note. Best effort:
-- set when the proposal is made (the user's one busy chat) and corrected when
-- the chat is loaded; NULL just means no note is posted.
ALTER TABLE agent_proposals
  ADD COLUMN IF NOT EXISTS chat_id INT REFERENCES agent_chats(id) ON DELETE SET NULL;
