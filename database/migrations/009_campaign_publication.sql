ALTER TABLE campaigns ADD COLUMN publicly_published_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN published_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX campaigns_publicly_published_idx ON campaigns(publicly_published_at);
