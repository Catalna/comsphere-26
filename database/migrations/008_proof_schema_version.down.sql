ALTER TABLE proofs DROP CONSTRAINT IF EXISTS proofs_package_schema_version_check;
ALTER TABLE proofs DROP COLUMN IF EXISTS package_schema_version;
