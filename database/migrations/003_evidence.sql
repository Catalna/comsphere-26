CREATE TABLE evidence (
  id UUID PRIMARY KEY,
  milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE RESTRICT,
  uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('RECEIPT', 'PHOTO', 'REPORT', 'INVOICE', 'CONTRACT', 'OTHER')),
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 240),
  content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  raw_hash TEXT NOT NULL CHECK (length(raw_hash) = 64),
  version_group_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  previous_evidence_id UUID UNIQUE REFERENCES evidence(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'PROCESSING', 'READY_FOR_REVIEW', 'PROCESSING_FAILED', 'SUPERSEDED')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (version_group_id, version),
  CHECK ((version = 1 AND previous_evidence_id IS NULL) OR (version > 1 AND previous_evidence_id IS NOT NULL))
);

CREATE INDEX evidence_milestone_id_idx ON evidence(milestone_id);
CREATE INDEX evidence_uploader_id_idx ON evidence(uploader_id);
CREATE INDEX evidence_version_group_id_idx ON evidence(version_group_id);
