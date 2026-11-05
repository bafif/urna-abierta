CREATE TABLE IF NOT EXISTS polling_tables (
  id text PRIMARY KEY,
  last_seq bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS electors (
  table_id text NOT NULL REFERENCES polling_tables (id),
  id text NOT NULL,
  order_number integer NOT NULL,
  full_name text NOT NULL,
  document_suffix text NOT NULL,
  PRIMARY KEY (table_id, id)
);

CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY,
  table_id text NOT NULL REFERENCES polling_tables (id),
  seq bigint NOT NULL,
  type text NOT NULL,
  device text NOT NULL,
  device_seq bigint NOT NULL,
  device_time timestamptz NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_id, seq)
);
