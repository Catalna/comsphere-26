CREATE TABLE verifier_wallets (
  verifier_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  wallet_address TEXT NOT NULL UNIQUE CHECK (length(wallet_address) = 42 AND wallet_address = lower(wallet_address)),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  roster_version INTEGER NOT NULL CHECK (roster_version >= 1),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE verifier_wallet_challenges (
  id UUID PRIMARY KEY,
  verifier_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL CHECK (length(wallet_address) = 42 AND wallet_address = lower(wallet_address)),
  nonce TEXT NOT NULL UNIQUE CHECK (length(nonce) BETWEEN 32 AND 128),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX verifier_wallet_challenges_user_id_idx ON verifier_wallet_challenges(verifier_user_id, expires_at);

CREATE TABLE review_rounds (
  id UUID PRIMARY KEY,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  review_id TEXT NOT NULL UNIQUE CHECK (length(review_id) = 66),
  evidence_commitment TEXT NOT NULL CHECK (length(evidence_commitment) = 66),
  organizer_organization_commitment TEXT NOT NULL CHECK (length(organizer_organization_commitment) = 66),
  funder_organization_commitment TEXT NOT NULL CHECK (length(funder_organization_commitment) = 66),
  status TEXT NOT NULL CHECK (status IN ('WAITING_FOR_CHAIN', 'OPEN', 'QUORUM_REACHED', 'NO_QUORUM', 'CHAIN_FAILED')),
  decision TEXT CHECK (decision IS NULL OR decision IN ('VERIFIED', 'NEEDS_REVISION', 'REJECTED')),
  roster_version INTEGER NOT NULL CHECK (roster_version >= 1),
  contract_address TEXT CHECK (contract_address IS NULL OR (length(contract_address) = 42 AND contract_address = lower(contract_address))),
  open_transaction_hash TEXT,
  open_block_number BIGINT CHECK (open_block_number IS NULL OR open_block_number >= 0),
  quorum_transaction_hash TEXT,
  block_number BIGINT CHECK (block_number IS NULL OR block_number >= 0),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (evidence_id, round_number),
  CHECK ((status = 'QUORUM_REACHED' AND decision IS NOT NULL) OR status <> 'QUORUM_REACHED'),
  CHECK ((status = 'NO_QUORUM' AND decision IS NULL) OR status <> 'NO_QUORUM')
);

CREATE INDEX review_rounds_evidence_id_idx ON review_rounds(evidence_id, round_number DESC);
CREATE INDEX review_rounds_status_created_idx ON review_rounds(status, created_at);

CREATE TABLE review_assignments (
  review_round_id UUID NOT NULL REFERENCES review_rounds(id) ON DELETE RESTRICT,
  verifier_user_id UUID NOT NULL REFERENCES verifier_wallets(verifier_user_id) ON DELETE RESTRICT,
  wallet_address TEXT NOT NULL CHECK (length(wallet_address) = 42 AND wallet_address = lower(wallet_address)),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  conflict_attested_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (review_round_id, verifier_user_id),
  UNIQUE (review_round_id, wallet_address),
  UNIQUE (review_round_id, organization_id)
);

CREATE INDEX review_assignments_verifier_user_id_idx ON review_assignments(verifier_user_id, assigned_at);

CREATE TABLE review_votes (
  id UUID PRIMARY KEY,
  review_round_id UUID NOT NULL,
  verifier_user_id UUID NOT NULL,
  wallet_address TEXT NOT NULL CHECK (length(wallet_address) = 42 AND wallet_address = lower(wallet_address)),
  decision TEXT NOT NULL CHECK (decision IN ('VERIFIED', 'NEEDS_REVISION', 'REJECTED')),
  eip712_signature TEXT NOT NULL CHECK (length(eip712_signature) = 132),
  no_conflict_attested BOOLEAN NOT NULL CHECK (no_conflict_attested = TRUE),
  organizer_instruction_commitment TEXT,
  organizer_instruction_salt TEXT,
  internal_notes TEXT NOT NULL DEFAULT '',
  organizer_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (review_round_id, verifier_user_id),
  FOREIGN KEY (review_round_id, verifier_user_id)
    REFERENCES review_assignments(review_round_id, verifier_user_id) ON DELETE RESTRICT,
  CHECK (organizer_instruction_commitment IS NULL OR length(organizer_instruction_commitment) = 66),
  CHECK (organizer_instruction_salt IS NULL OR length(organizer_instruction_salt) = 64),
  CHECK ((decision = 'NEEDS_REVISION' AND organizer_instruction_commitment IS NOT NULL AND organizer_instruction_salt IS NOT NULL AND organizer_instructions IS NOT NULL)
      OR (decision <> 'NEEDS_REVISION' AND organizer_instruction_commitment IS NULL AND organizer_instruction_salt IS NULL AND organizer_instructions IS NULL))
);

CREATE INDEX review_votes_round_id_idx ON review_votes(review_round_id, created_at);

CREATE TABLE review_vote_submissions (
  id UUID PRIMARY KEY,
  vote_id UUID NOT NULL UNIQUE REFERENCES review_votes(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  transaction_hash TEXT,
  block_number BIGINT CHECK (block_number IS NULL OR block_number >= 0),
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX review_vote_submissions_status_idx ON review_vote_submissions(status, created_at);

CREATE TABLE verifications (
  id UUID PRIMARY KEY,
  evidence_id UUID NOT NULL UNIQUE REFERENCES evidence(id) ON DELETE RESTRICT,
  review_round_id UUID NOT NULL UNIQUE REFERENCES review_rounds(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'NEEDS_REVISION', 'REJECTED')),
  instruction_commitment TEXT CHECK (instruction_commitment IS NULL OR length(instruction_commitment) = 66),
  contract_address TEXT NOT NULL CHECK (length(contract_address) = 42 AND contract_address = lower(contract_address)),
  transaction_hash TEXT,
  block_number BIGINT CHECK (block_number IS NULL OR block_number >= 0),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX verifications_status_idx ON verifications(status, created_at);
