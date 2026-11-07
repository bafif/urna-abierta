-- At what time each day is voted, «08:00» to «18:00» by day: the plan of the poll watcher says when it closes, and a
-- chief sees a silent table as such only while it is open.
ALTER TABLE elections ADD COLUMN IF NOT EXISTS hours jsonb NOT NULL DEFAULT '{}';
-- A poll watcher's own times: a shift inside the day, when to arrive and where to meet.
ALTER TABLE role_assignments ADD COLUMN IF NOT EXISTS schedule jsonb;
