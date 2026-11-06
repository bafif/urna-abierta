-- Whether a device may set up the second step of a person who never set it up. One that came from the link of someone
-- who does not manage people, as a chief's link for a poll watcher, may not: if that person later gets a role that asks
-- for the second step, whoever made the link would set it up as them. A code for an installed app passes on what the
-- device that made it had. Rows from before stay as they worked.
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS may_enroll boolean NOT NULL DEFAULT true;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS may_enroll boolean NOT NULL DEFAULT true;
