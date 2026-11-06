-- The first versions named each person in the audit log by their roll id, often the DNI, and it stayed there after an
-- erasure or a purge. Each of those ids becomes a random reference, the same in all the entries about that person,
-- that leads to no row: what an erasure leaves now. The log says it was done. Nothing else in it changes.
ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_changes;

WITH named AS MATERIALIZED (
  SELECT target, gen_random_uuid()::text AS ref FROM (
    SELECT DISTINCT target FROM audit_log
    WHERE action IN ('elector.corrected', 'person.consent', 'person.erased', 'person.exported', 'semaphore.cleared', 'semaphore.noted')
      AND target !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) old
), replaced AS (
  UPDATE audit_log a SET target = named.ref FROM named
  WHERE a.target = named.target
    AND a.action IN ('elector.corrected', 'person.consent', 'person.erased', 'person.exported', 'semaphore.cleared', 'semaphore.noted')
  RETURNING 1
)
INSERT INTO audit_log (action, detail)
  SELECT 'audit.ids_replaced', jsonb_build_object('entries', count(*)) FROM replaced HAVING count(*) > 0;

ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_changes;
