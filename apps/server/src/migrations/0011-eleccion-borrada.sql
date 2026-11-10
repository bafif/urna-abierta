-- Whoever had a table in an election that got deleted is told so on their phone for a week, instead of that they have
-- no table yet. The phone also learns that what it still held for that table has nowhere to go.
CREATE TABLE IF NOT EXISTS deleted_tables (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  table_id text NOT NULL,
  election text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, table_id)
);
