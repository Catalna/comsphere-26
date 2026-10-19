CREATE TABLE ocr_runs (
  id UUID PRIMARY KEY,
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  run_number INTEGER NOT NULL CHECK (run_number >= 1),
  screening_status TEXT NOT NULL CHECK (screening_status IN ('PROCESSING', 'CLEAR', 'FLAGGED', 'FAILED')),
  vendor TEXT CHECK (vendor IS NULL OR length(vendor) <= 240),
  document_date DATE,
  amount TEXT CHECK (amount IS NULL OR length(amount) BETWEEN 1 AND 32),
  currency TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency = upper(currency))),
  invoice_number TEXT CHECK (invoice_number IS NULL OR length(invoice_number) <= 80),
  detected_language TEXT NOT NULL CHECK (detected_language IN ('id', 'en', 'mixed', 'unknown')),
  field_confidence JSONB NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (evidence_id, run_number),
  CHECK (screening_status <> 'FAILED' OR failure_code IS NOT NULL)
);

CREATE INDEX ocr_runs_evidence_id_idx ON ocr_runs(evidence_id, run_number DESC);
CREATE INDEX ocr_runs_screening_status_idx ON ocr_runs(screening_status);

CREATE TABLE ai_flags (
  id UUID PRIMARY KEY,
  ocr_run_id UUID NOT NULL REFERENCES ocr_runs(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK (code IN (
    'MISSING_FIELD', 'LOW_CONFIDENCE_FIELD', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH',
    'CURRENCY_UNCERTAIN', 'SUSPICIOUS_DATE', 'POSSIBLE_DUPLICATE'
  )),
  field TEXT CHECK (field IS NULL OR field IN ('vendor', 'documentDate', 'amount', 'invoiceNumber', 'currency')),
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 240),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ai_flags_ocr_run_id_idx ON ai_flags(ocr_run_id);

CREATE TABLE ocr_jobs (
  id UUID PRIMARY KEY,
  ocr_run_id UUID NOT NULL UNIQUE REFERENCES ocr_runs(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (state = 'RUNNING' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'RUNNING' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (state <> 'FAILED' OR last_error_code IS NOT NULL)
);

CREATE INDEX ocr_jobs_state_created_idx ON ocr_jobs(state, created_at, id);
CREATE INDEX ocr_jobs_lease_expires_at_idx ON ocr_jobs(lease_expires_at);
