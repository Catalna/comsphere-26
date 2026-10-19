CREATE TABLE terms_acceptances (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 64),
  accepted_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, terms_version)
);

ALTER TABLE organizations ADD COLUMN verified_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN verified_by UUID REFERENCES users(id) ON DELETE SET NULL;
