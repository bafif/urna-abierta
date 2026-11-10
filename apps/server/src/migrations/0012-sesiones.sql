-- The last time step of the second step that got someone in: the same six digits do not get anyone in again, not even
-- within the same half minute, and neither does an earlier code.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint;
