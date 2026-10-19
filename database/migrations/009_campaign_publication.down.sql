DROP INDEX IF EXISTS campaigns_publicly_published_idx;
ALTER TABLE campaigns DROP COLUMN IF EXISTS published_by;
ALTER TABLE campaigns DROP COLUMN IF EXISTS publicly_published_at;
