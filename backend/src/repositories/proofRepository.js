import { randomUUID } from "node:crypto";

function repositoryError(code) {
  return Object.assign(new Error(code), { code });
}

function rowToProof(row, { includePackage = false } = {}) {
  if (!row) return null;
  const proof = {
    id: row.id,
    evidenceId: row.evidence_id,
    reviewRoundId: row.review_round_id,
    proofVersion: row.proof_version,
    packageSchemaVersion: row.package_schema_version === null || row.package_schema_version === undefined
      ? 1
      : Number(row.package_schema_version),
    campaignId: row.campaign_id,
    milestoneId: row.milestone_id,
    packageHash: row.package_hash,
    proofId: row.proof_id,
    status: row.status,
    contractAddress: row.contract_address,
    transactionHash: row.transaction_hash,
    blockNumber: row.block_number === null || row.block_number === undefined ? null : Number(row.block_number),
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    anchoredAt: row.anchored_at,
  };
  if (includePackage) proof.package = row.package;
  return proof;
}

export function createProofRepository(pool) {
  if (!pool) throw new TypeError("Proof repository requires a database pool");

  return {
    async createProofForRound({ evidenceId, reviewRoundId, proofVersion, campaignId, milestoneId, canonicalPackage, packageHash, packageSchemaVersion = 1, now }) {
      if (typeof evidenceId !== "string" || typeof reviewRoundId !== "string"
          || !Number.isSafeInteger(proofVersion) || proofVersion < 1
          || typeof campaignId !== "string" || typeof milestoneId !== "string"
          || !Number.isSafeInteger(packageSchemaVersion) || ![1, 2].includes(packageSchemaVersion)
          || !/^[0-9a-f]{64}$/.test(packageHash)) {
        throw repositoryError("INVALID_PROOF_INPUT");
      }
      const id = randomUUID();
      const proofId = `0x${packageHash}`;
      const result = await pool.query(
        `INSERT INTO proofs (id, evidence_id, review_round_id, proof_version, campaign_id, milestone_id,
           package, package_hash, proof_id, package_schema_version, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'PENDING', $11, $11)
         ON CONFLICT (evidence_id) DO NOTHING
         RETURNING *`,
        [id, evidenceId, reviewRoundId, proofVersion, campaignId, milestoneId,
          JSON.stringify(canonicalPackage), packageHash, proofId, packageSchemaVersion, now],
      );
      if (result.rowCount === 0) {
        const existing = await pool.query("SELECT * FROM proofs WHERE evidence_id = $1", [evidenceId]);
        return { created: false, proof: rowToProof(existing.rows[0], { includePackage: true }) };
      }
      return { created: true, proof: rowToProof(result.rows[0], { includePackage: true }) };
    },

    async getProofSourceData(reviewRoundId) {
      const result = await pool.query(
        `SELECT rr.id AS review_round_id, rr.review_id, rr.round_number, rr.decision, rr.completed_at,
                 rr.contract_address, rr.quorum_transaction_hash, rr.block_number,
                e.id AS evidence_id, e.milestone_id, e.evidence_type, e.raw_hash, e.version AS evidence_version,
                m.campaign_id,
                latest.id AS ocr_run_id, latest.detected_language, latest.vendor, latest.document_date,
                latest.amount, latest.currency, latest.invoice_number, latest.screening_status,
                latest.field_confidence,
                COALESCE(
                  (SELECT json_agg(af.code ORDER BY af.code) FROM ai_flags af WHERE af.ocr_run_id = latest.id),
                  '[]'::json) AS flag_codes
         FROM review_rounds rr
         JOIN evidence e ON e.id = rr.evidence_id
         JOIN milestones m ON m.id = e.milestone_id
         LEFT JOIN LATERAL (
           SELECT o.* FROM ocr_runs o WHERE o.evidence_id = e.id
           ORDER BY o.run_number DESC LIMIT 1
         ) latest ON TRUE
         WHERE rr.id = $1`,
        [reviewRoundId],
      );
      if (result.rowCount === 0) throw repositoryError("PROOF_SOURCE_NOT_FOUND");
      const row = result.rows[0];
      return {
        reviewRoundId: row.review_round_id,
        reviewId: row.review_id,
        roundNumber: Number(row.round_number),
        decision: row.decision,
        completedAt: row.completed_at,
        contractAddress: row.contract_address,
        quorumTransactionHash: row.quorum_transaction_hash,
        blockNumber: row.block_number === null || row.block_number === undefined ? null : Number(row.block_number),
        evidenceId: row.evidence_id,
        milestoneId: row.milestone_id,
        campaignId: row.campaign_id,
        evidenceType: row.evidence_type,
        rawHash: row.raw_hash,
        evidenceVersion: Number(row.evidence_version),
        ocr: row.ocr_run_id === null ? null : {
          detectedLanguage: row.detected_language,
          vendor: row.vendor,
          documentDate: row.document_date,
          amount: row.amount,
          currency: row.currency,
          invoiceNumber: row.invoice_number,
          screeningStatus: row.screening_status,
          fieldConfidence: row.field_confidence ?? {},
          flagCodes: Array.isArray(row.flag_codes) ? row.flag_codes : [],
        },
      };
    },

    async getProofAccessContext(evidenceId) {
      const result = await pool.query(
        `SELECT e.id AS evidence_id, c.organization_id AS organizer_organization_id, c.funder_id
         FROM evidence e
         JOIN milestones m ON m.id = e.milestone_id
         JOIN campaigns c ON c.id = m.campaign_id
         WHERE e.id = $1`,
        [evidenceId],
      );
      if (result.rowCount === 0) throw repositoryError("PROOF_SOURCE_NOT_FOUND");
      const row = result.rows[0];
      return {
        evidenceId: row.evidence_id,
        organizerOrganizationId: row.organizer_organization_id,
        funderId: row.funder_id,
      };
    },

    async findProofByProofId(proofId) {
      const result = await pool.query("SELECT * FROM proofs WHERE proof_id = $1", [proofId]);
      return rowToProof(result.rows[0], { includePackage: true });
    },

    async findProofByEvidenceId(evidenceId) {
      const result = await pool.query("SELECT * FROM proofs WHERE evidence_id = $1", [evidenceId]);
      return rowToProof(result.rows[0], { includePackage: true });
    },

    async listProofs({ limit = 100 } = {}) {
      const result = await pool.query(
        "SELECT * FROM proofs ORDER BY created_at DESC LIMIT $1",
        [Math.min(Math.max(1, limit), 500)],
      );
      return result.rows.map((row) => rowToProof(row));
    },

    async listAnchorableProofs({ limit = 50 } = {}) {
      const result = await pool.query(
        "SELECT * FROM proofs WHERE status IN ('PENDING', 'FAILED') ORDER BY created_at ASC LIMIT $1",
        [Math.min(Math.max(1, limit), 200)],
      );
      return result.rows.map((row) => rowToProof(row, { includePackage: true }));
    },

    async markAnchoring({ proofId, now }) {
      const result = await pool.query(
        `UPDATE proofs SET status = 'ANCHORING', attempts = attempts + 1, updated_at = $2
         WHERE proof_id = $1 AND status IN ('PENDING', 'FAILED')
         RETURNING *`,
        [proofId, now],
      );
      if (result.rowCount === 0) throw repositoryError("PROOF_NOT_ANCHORABLE");
      return rowToProof(result.rows[0], { includePackage: true });
    },

    async markAnchorSubmitted({ proofId, contractAddress, transactionHash, now }) {
      const result = await pool.query(
        `UPDATE proofs SET contract_address = $2, transaction_hash = $3, updated_at = $4
         WHERE proof_id = $1 AND status = 'ANCHORING'
         RETURNING *`,
        [proofId, contractAddress, transactionHash, now],
      );
      if (result.rowCount === 0) throw repositoryError("PROOF_SUBMISSION_STATE_INVALID");
      return rowToProof(result.rows[0], { includePackage: true });
    },

    async markAnchored({ proofId, blockNumber, anchoredAt }) {
      const result = await pool.query(
        `UPDATE proofs SET status = 'ANCHORED', block_number = $2, anchored_at = $3, last_error_code = NULL,
           updated_at = $3
         WHERE proof_id = $1 AND status = 'ANCHORING' AND transaction_hash IS NOT NULL
         RETURNING *`,
        [proofId, blockNumber, anchoredAt],
      );
      if (result.rowCount === 0) throw repositoryError("PROOF_SUBMISSION_STATE_INVALID");
      return rowToProof(result.rows[0], { includePackage: true });
    },

    async markFailed({ proofId, errorCode, now }) {
      const result = await pool.query(
        `UPDATE proofs SET status = 'FAILED', last_error_code = $2, updated_at = $3
         WHERE proof_id = $1 AND status = 'ANCHORING'
         RETURNING *`,
        [proofId, errorCode, now],
      );
      if (result.rowCount === 0) throw repositoryError("PROOF_SUBMISSION_STATE_INVALID");
      return rowToProof(result.rows[0], { includePackage: true });
    },
  };
}
