-- What phones know a person by. The id comes from the roll and can carry the whole document; this one is
-- random, its own in each election, and importing the roll again never changes it.

-- 96 random bits, written in 16 letters and digits.
CREATE OR REPLACE FUNCTION new_public_id() RETURNS text AS $$
  SELECT translate(encode(substr(uuid_send(gen_random_uuid()), 1, 6) || substr(uuid_send(gen_random_uuid()), 11, 6), 'base64'), '+/', '-_')
$$ LANGUAGE sql VOLATILE;

-- Each person gets one, and the marks already sent name them by it. A database that already has the column
-- already did both.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'electors' AND column_name = 'public_id') THEN
    ALTER TABLE electors ADD COLUMN public_id text NOT NULL DEFAULT new_public_id();
    UPDATE operations o SET payload = jsonb_set(o.payload, '{elector}', to_jsonb(x.public_id))
      FROM polling_tables t JOIN electors x ON x.election_id = t.election_id
      WHERE o.table_id = t.id AND o.type IN ('voter.marked', 'voter.unmarked') AND x.id = o.payload->>'elector';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS electors_public ON electors (election_id, public_id);
