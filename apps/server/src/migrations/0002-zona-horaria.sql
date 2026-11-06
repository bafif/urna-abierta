-- Which day it is depends on where the election happens, not on the server's clock.
ALTER TABLE elections ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';
