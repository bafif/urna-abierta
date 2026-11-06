-- What the audit log names a person by: never the roll id, which is often their DNI and outlives an erasure.
ALTER TABLE electors ADD COLUMN IF NOT EXISTS ref uuid NOT NULL DEFAULT gen_random_uuid();
-- A name or document someone corrected: uploading the roll again does not undo it.
ALTER TABLE electors ADD COLUMN IF NOT EXISTS corrected_at timestamptz;
-- Someone who asked to be erased: the row stays, with nothing of them, so that the totals of the table still add up.
ALTER TABLE electors ADD COLUMN IF NOT EXISTS erased_at timestamptz;
-- Who the person was in the file, keyed with the field key: a roll without DNI or legajo names people by their row.
ALTER TABLE electors ADD COLUMN IF NOT EXISTS source_key text;

-- Erasures made when the roll id already went, before they were marked as such.
UPDATE electors SET erased_at = now() WHERE erased_at IS NULL AND id LIKE 'x-%' AND full_name = 'Borrado a pedido' AND search = '';
-- Elections purged before the roll ids went too still have them, and those are often the DNI. The reference,
-- the random id, the order and the keyed fingerprint go as well, as a purge does now.
UPDATE electors SET id = 'x-' || replace(gen_random_uuid()::text, '-', ''), ref = gen_random_uuid(), public_id = new_public_id(), order_number = NULL, source_key = NULL
  WHERE id NOT LIKE 'x-%' AND election_id IN (SELECT id FROM elections WHERE status = 'purgada');

-- Erasures made before this still have the roll id. Renaming it takes the field key, which SQL does not have:
-- the server does it right after this file, in the same transaction (STEPS, in app.ts).
