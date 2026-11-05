CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  phone text,
  totp_sealed text,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

CREATE TABLE IF NOT EXISTS elections (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  days date[] NOT NULL DEFAULT '{}',
  categories jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'preparacion',
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS units (
  id text PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS polling_tables (
  id text PRIMARY KEY,
  election_id uuid REFERENCES elections (id) ON DELETE CASCADE,
  unit_id text REFERENCES units (id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  place text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  last_seq bigint NOT NULL DEFAULT 0,
  last_contact timestamptz
);
CREATE INDEX IF NOT EXISTS polling_tables_election ON polling_tables (election_id, position);

CREATE TABLE IF NOT EXISTS role_assignments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL,
  election_id uuid REFERENCES elections (id) ON DELETE CASCADE,
  unit_id text REFERENCES units (id) ON DELETE CASCADE,
  table_id text REFERENCES polling_tables (id) ON DELETE CASCADE,
  -- The voting days of a shift. Without days, it covers all of them.
  days date[],
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS role_assignments_user ON role_assignments (user_id);
CREATE INDEX IF NOT EXISTS role_assignments_table ON role_assignments (table_id);

CREATE TABLE IF NOT EXISTS invitations (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  second_factor_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS electors (
  election_id uuid NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  id text NOT NULL,
  table_id text REFERENCES polling_tables (id) ON DELETE SET NULL,
  order_number integer,
  full_name text NOT NULL,
  search text NOT NULL DEFAULT '',
  document text,
  file_number text,
  address text,
  extra jsonb NOT NULL DEFAULT '{}',
  needs_review boolean NOT NULL DEFAULT false,
  review jsonb,
  consent jsonb,
  PRIMARY KEY (election_id, id)
);
CREATE INDEX IF NOT EXISTS electors_table ON electors (table_id, order_number);
CREATE INDEX IF NOT EXISTS electors_document ON electors (document);

CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY,
  table_id text NOT NULL REFERENCES polling_tables (id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  type text NOT NULL,
  device text NOT NULL,
  device_seq bigint NOT NULL,
  device_time timestamptz NOT NULL,
  payload jsonb NOT NULL,
  author uuid,
  quarantined boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_id, seq)
);
CREATE INDEX IF NOT EXISTS operations_type ON operations (table_id, type);

CREATE TABLE IF NOT EXISTS incident_states (
  operation_id uuid PRIMARY KEY REFERENCES operations (id) ON DELETE CASCADE,
  status text NOT NULL,
  resolved_by uuid,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tally_decisions (
  table_id text NOT NULL REFERENCES polling_tables (id) ON DELETE CASCADE,
  category text NOT NULL,
  operation_id uuid NOT NULL REFERENCES operations (id) ON DELETE CASCADE,
  decided_by uuid,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, category)
);

CREATE TABLE IF NOT EXISTS photos (
  sha256 text PRIMARY KEY,
  table_id text NOT NULL REFERENCES polling_tables (id) ON DELETE CASCADE,
  bytes integer NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS semaphore_categories (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  color text NOT NULL,
  sensitive boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS semaphore_marks (
  election_id uuid NOT NULL,
  elector_id text NOT NULL,
  category_id uuid,
  sealed text,
  noted_by uuid,
  noted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (election_id, elector_id),
  FOREIGN KEY (election_id, elector_id) REFERENCES electors (election_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  action text NOT NULL,
  target text,
  detail jsonb NOT NULL DEFAULT '{}'
);

-- The audit log can only grow.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log cannot be changed';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_changes ON audit_log;
CREATE TRIGGER audit_log_no_changes BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
