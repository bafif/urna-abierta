-- What arrived after the close counts for nothing until a person looks at it: added to the results, or discarded.
-- Each decision is kept, and who made it. What nobody reviewed goes with the purge.
CREATE TABLE IF NOT EXISTS late_reviews (
  operation_id uuid PRIMARY KEY REFERENCES operations (id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('sumado', 'descartado')),
  decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
