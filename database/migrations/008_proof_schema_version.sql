ALTER TABLE proofs ADD COLUMN package_schema_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE proofs ADD CONSTRAINT proofs_package_schema_version_check
  CHECK (package_schema_version IN (1, 2));
