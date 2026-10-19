DROP TABLE IF EXISTS terms_acceptances;
ALTER TABLE organizations DROP COLUMN IF EXISTS verified_by;
ALTER TABLE organizations DROP COLUMN IF EXISTS verified_at;
