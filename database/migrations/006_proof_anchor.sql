CREATE TABLE proofs (
  id UUID PRIMARY KEY,
  evidence_id UUID NOT NULL UNIQUE REFERENCES evidence(id) ON DELETE RESTRICT,
  review_round_id UUID NOT NULL REFERENCES review_rounds(id) ON DELETE RESTRICT,
  proof_version INTEGER NOT NULL DEFAULT 1 CHECK (proof_version >= 1),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE RESTRICT,
  package JSONB NOT NULL,
  package_hash TEXT NOT NULL CHECK (length(package_hash) = 64),
  proof_id TEXT NOT NULL UNIQUE CHECK (length(proof_id) = 66),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ANCHORING', 'ANCHORED', 'FAILED')),
  contract_address TEXT CHECK (contract_address IS NULL OR (length(contract_address) = 42 AND contract_address = lower(contract_address))),
  transaction_hash TEXT CHECK (transaction_hash IS NULL OR length(transaction_hash) = 66),
  block_number BIGINT CHECK (block_number IS NULL OR block_number >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  anchored_at TIMESTAMPTZ,
  CHECK ((status = 'ANCHORED' AND transaction_hash IS NOT NULL AND block_number IS NOT NULL AND anchored_at IS NOT NULL)
    OR status <> 'ANCHORED')
);

CREATE INDEX proofs_status_created_idx ON proofs(status, created_at);
CREATE INDEX proofs_review_round_id_idx ON proofs(review_round_id);
