-- Bug reports: free-text issues users file from the "Report a bug" button in
-- the header. The reporter's email is denormalized alongside user_id so a
-- report can be read without joining Better Auth's "user" table.

CREATE TABLE IF NOT EXISTS bug_reports (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  email      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_user_id ON bug_reports(user_id);
