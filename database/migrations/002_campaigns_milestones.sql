CREATE TABLE campaigns (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  funder_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  total_budget NUMERIC(20, 2) NOT NULL CHECK (total_budget > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  funding_mode TEXT NOT NULL DEFAULT 'EXTERNAL_TRACKING' CHECK (funding_mode = 'EXTERNAL_TRACKING'),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX campaigns_organization_id_idx ON campaigns(organization_id);
CREATE INDEX campaigns_funder_id_idx ON campaigns(funder_id);
CREATE INDEX campaigns_status_idx ON campaigns(status);

CREATE TABLE milestones (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  budget_amount NUMERIC(20, 2) NOT NULL CHECK (budget_amount > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  start_date DATE,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (campaign_id, order_index),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);

CREATE INDEX milestones_campaign_id_idx ON milestones(campaign_id);
CREATE INDEX milestones_status_idx ON milestones(status);
