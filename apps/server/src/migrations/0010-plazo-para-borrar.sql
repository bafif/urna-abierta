-- The day the party decided to erase the names by: the app says how much is left, and warns a week before and after.
-- It never erases by itself, since there may be a challenge still open.
ALTER TABLE elections ADD COLUMN IF NOT EXISTS purge_by date;
-- When the names went: the backups from before still have them, and go with the next backup.
ALTER TABLE elections ADD COLUMN IF NOT EXISTS purged_at timestamptz;
