-- The model a chat runs on, chosen in the composer; each message may switch it
-- and the chat keeps the last choice. NULL (or a model no longer offered) means
-- the default AGENT_MODEL. Receipt-photo turns always use the default.
ALTER TABLE agent_chats ADD COLUMN IF NOT EXISTS model TEXT;
