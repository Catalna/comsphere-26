CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 180),
  type TEXT NOT NULL CHECK (type IN ('NGO', 'COMPANY', 'GOVERNMENT', 'COMMUNITY', 'OTHER')),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'ORGANIZER', 'FUNDER', 'VERIFIER', 'BENEFICIARY')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK ((role = 'ADMIN' AND organization_id IS NULL) OR (role <> 'ADMIN' AND organization_id IS NOT NULL))
);

CREATE UNIQUE INDEX users_single_admin_idx ON users (role) WHERE role = 'ADMIN';

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX user_sessions_user_id_idx ON user_sessions(user_id);
CREATE INDEX user_sessions_expiry_idx ON user_sessions(expires_at);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
