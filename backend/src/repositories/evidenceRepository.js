import { randomUUID } from "node:crypto";
import { transitionStatus } from "@dana-terang/domain";

import { createOcrRepository } from "./ocrRepository.js";

const EVIDENCE_COLUMNS = `id, milestone_id, uploader_id, evidence_type, storage_key, file_name,
  content_type, file_size, raw_hash, version_group_id, version, previous_evidence_id, status, created_at, updated_at`;
const PUBLIC_EVIDENCE_COLUMNS = `e.id, e.milestone_id, e.uploader_id, e.evidence_type, e.storage_key, e.file_name,
  e.content_type, e.file_size, e.raw_hash, e.version_group_id, e.version, e.previous_evidence_id, e.status, e.created_at, e.updated_at,
  v.status AS verification_status, v.review_round_id, v.instruction_commitment`;
const EVIDENCE_TYPES = new Set(["RECEIPT", "PHOTO", "REPORT", "INVOICE", "CONTRACT", "OTHER"]);
const CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function repositoryError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function inScope(actor, row) {
  if (actor?.role === "ADMIN") return true;
  if (actor?.role === "ORGANIZER") return actor.organizationId === row.organization_id;
  if (actor?.role === "FUNDER") return actor.id === row.funder_id;
  return false;
}

function publicEvidence(row, summary = null, revisionInstructions = null) {
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    uploaderId: row.uploader_id,
    evidenceType: row.evidence_type,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSize: Number(row.file_size),
    rawHash: row.raw_hash,
    version: row.version,
    previousEvidenceId: row.previous_evidence_id,
    status: row.status,
    evidenceStatus: row.status,
    screeningStatus: summary?.screeningStatus ?? row.screening_status ?? null,
    flags: summary?.flags ?? [],
    verificationStatus: row.verification_status ?? null,
    ...(revisionInstructions ? { revisionInstructions } : {}),
    createdAt: row.created_at,
  };
}

function publicAdminEvidence(row) {
  return {
    id: row.id,
    evidenceId: row.id,
    milestoneId: row.milestone_id,
    status: row.status,
    evidenceStatus: row.status,
    verificationStatus: row.verification_status ?? null,
    createdAt: row.created_at,
  };
}

function publicFunderEvidence(row) {
  return {
    id: row.id,
    evidenceId: row.id,
    milestoneId: row.milestone_id,
    status: row.status,
    evidenceStatus: row.status,
    verificationStatus: row.verification_status ?? null,
    createdAt: row.created_at,
  };
}

async function organizerRevisionInstructions(pool, actor, row) {
  if (actor?.role !== "ORGANIZER" || row.verification_status !== "NEEDS_REVISION"
      || typeof row.review_round_id !== "string" || typeof row.instruction_commitment !== "string") return null;
  const result = await pool.query(
    `SELECT organizer_instructions FROM review_votes
     WHERE review_round_id = $1 AND decision = 'NEEDS_REVISION'
       AND organizer_instruction_commitment = $2
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [row.review_round_id, row.instruction_commitment],
  );
  return result.rows[0]?.organizer_instructions ?? null;
}

async function inTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

async function audit(client, { actorUserId, entityId, details, now }) {
  await client.query(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
     VALUES ($1, $2, 'EVIDENCE_UPLOADED', 'EVIDENCE', $3, $4, $5)`,
    [randomUUID(), actorUserId, entityId, details, now],
  );
}

export function createEvidenceRepository(pool, { reviewRepository } = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL-compatible pool is required");
  }
  const ocrRepository = createOcrRepository(pool, { reviewRepository });

  return Object.freeze({
    async assertUploadAllowed(actor, milestoneId) {
      if (actor?.role !== "ORGANIZER" || !actor.organizationId) throw repositoryError("FORBIDDEN");
      const result = await pool.query(
        `SELECT m.status AS milestone_status, c.status AS campaign_status
         FROM milestones m JOIN campaigns c ON c.id = m.campaign_id
         WHERE m.id = $1 AND c.organization_id = $2 LIMIT 1`,
        [milestoneId, actor.organizationId],
      );
      if (result.rowCount === 0) throw repositoryError("MILESTONE_NOT_FOUND");
      if (result.rows[0].campaign_status !== "ACTIVE" || result.rows[0].milestone_status !== "IN_PROGRESS") {
        throw repositoryError("MILESTONE_NOT_IN_PROGRESS");
      }
      return true;
    },

    async getRevisionContext(actor, evidenceId) {
      if (actor?.role !== "ORGANIZER" || !actor.organizationId) throw repositoryError("FORBIDDEN");
      if (typeof evidenceId !== "string") throw repositoryError("INVALID_EVIDENCE_ID");
      const result = await pool.query(
        `SELECT e.id, e.milestone_id, e.evidence_type, e.version, e.version_group_id, e.status,
                c.organization_id, v.status AS verification_status, rr.status AS review_round_status,
                rr.decision AS review_decision
         FROM evidence e
         JOIN milestones m ON m.id = e.milestone_id
         JOIN campaigns c ON c.id = m.campaign_id
         LEFT JOIN verifications v ON v.evidence_id = e.id
         LEFT JOIN review_rounds rr ON rr.id = v.review_round_id
         WHERE e.id = $1 AND c.organization_id = $2 LIMIT 1`,
        [evidenceId, actor.organizationId],
      );
      if (result.rowCount === 0) throw repositoryError("EVIDENCE_NOT_FOUND");
      const row = result.rows[0];
      if (row.status !== "READY_FOR_REVIEW" || row.verification_status !== "NEEDS_REVISION"
          || row.review_round_status !== "QUORUM_REACHED" || row.review_decision !== "NEEDS_REVISION") {
        throw repositoryError("REVISION_NOT_ALLOWED");
      }
      return {
        evidenceId: row.id,
        milestoneId: row.milestone_id,
        evidenceType: row.evidence_type,
        version: Number(row.version),
        versionGroupId: row.version_group_id,
      };
    },

    async createRevisionEvidence({ actor, evidenceId, storageKey, fileName, contentType, fileSize, rawHash, now = new Date() }) {
      if (actor?.role !== "ORGANIZER" || !actor.organizationId) throw repositoryError("FORBIDDEN");
      if (typeof evidenceId !== "string" || typeof storageKey !== "string" || !/^[0-9a-f-]{36}$/i.test(storageKey)
          || typeof fileName !== "string" || fileName.length < 1 || fileName.length > 240
          || !CONTENT_TYPES.has(contentType) || !Number.isSafeInteger(fileSize) || fileSize < 1
          || typeof rawHash !== "string" || !/^[0-9a-f]{64}$/.test(rawHash)) {
        throw repositoryError("INVALID_EVIDENCE");
      }
      return inTransaction(pool, async (client) => {
        const parentResult = await client.query(
          `SELECT e.id, e.milestone_id, e.uploader_id, e.evidence_type, e.version_group_id,
                  e.version, e.status, c.organization_id, v.status AS verification_status,
                  rr.status AS review_round_status, rr.decision AS review_decision
           FROM evidence e
           JOIN milestones m ON m.id = e.milestone_id
           JOIN campaigns c ON c.id = m.campaign_id
           LEFT JOIN verifications v ON v.evidence_id = e.id
           LEFT JOIN review_rounds rr ON rr.id = v.review_round_id
           WHERE e.id = $1 AND c.organization_id = $2 LIMIT 1`,
          [evidenceId, actor.organizationId],
        );
        if (parentResult.rowCount === 0) throw repositoryError("EVIDENCE_NOT_FOUND");
        const parent = parentResult.rows[0];
        if (parent.status !== "READY_FOR_REVIEW" || parent.verification_status !== "NEEDS_REVISION"
            || parent.review_round_status !== "QUORUM_REACHED" || parent.review_decision !== "NEEDS_REVISION") {
          throw repositoryError("REVISION_NOT_ALLOWED");
        }

        const revisionId = randomUUID();
        const version = Number(parent.version) + 1;
        const processingStatus = transitionStatus("evidence", "UPLOADED", "PROCESSING");
        const inserted = await client.query(
          `INSERT INTO evidence (${EVIDENCE_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
           RETURNING ${EVIDENCE_COLUMNS}`,
          [revisionId, parent.milestone_id, actor.id, parent.evidence_type, storageKey, fileName, contentType,
            fileSize, rawHash, parent.version_group_id, version, evidenceId, processingStatus, now],
        );
        const superseded = await client.query(
          "UPDATE evidence SET status = 'SUPERSEDED', updated_at = $2 WHERE id = $1 AND status = 'READY_FOR_REVIEW' RETURNING id",
          [evidenceId, now],
        );
        if (superseded.rowCount !== 1) throw repositoryError("REVISION_NOT_ALLOWED");
        const initialRun = await ocrRepository.enqueueInitialRun(client, { evidenceId: revisionId, actorUserId: actor.id, now });
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, $2, 'EVIDENCE_REVISED', 'EVIDENCE', $3, $4, $5)`,
          [randomUUID(), actor.id, revisionId, { previousEvidenceId: evidenceId, version, rawHash }, now],
        );
        const evidence = publicEvidence(inserted.rows[0], { screeningStatus: initialRun.screeningStatus, flags: [] });
        return evidence;
      });
    },

    async createEvidence({ actor, milestoneId, evidenceType, storageKey, fileName, contentType, fileSize, rawHash, now = new Date() }) {
      if (actor?.role !== "ORGANIZER" || !actor.organizationId) throw repositoryError("FORBIDDEN");
      if (!EVIDENCE_TYPES.has(evidenceType) || !CONTENT_TYPES.has(contentType)) throw repositoryError("INVALID_EVIDENCE");
      if (typeof fileName !== "string" || fileName.length < 1 || fileName.length > 240) throw repositoryError("INVALID_EVIDENCE");
      if (!Number.isSafeInteger(fileSize) || fileSize < 1) throw repositoryError("INVALID_EVIDENCE");
      if (typeof rawHash !== "string" || !/^[0-9a-f]{64}$/.test(rawHash)) throw repositoryError("INVALID_EVIDENCE");
      if (typeof storageKey !== "string" || !/^[0-9a-f-]{36}$/i.test(storageKey)) throw repositoryError("INVALID_OBJECT_KEY");

      return inTransaction(pool, async (client) => {
        const milestone = await client.query(
          `SELECT m.id, m.status AS milestone_status, c.id AS campaign_id,
                  c.organization_id, c.funder_id, c.status AS campaign_status
           FROM milestones m JOIN campaigns c ON c.id = m.campaign_id
           WHERE m.id = $1 AND c.organization_id = $2 LIMIT 1`,
          [milestoneId, actor.organizationId],
        );
        if (milestone.rowCount === 0) throw repositoryError("MILESTONE_NOT_FOUND");
        if (milestone.rows[0].campaign_status !== "ACTIVE" || milestone.rows[0].milestone_status !== "IN_PROGRESS") {
          throw repositoryError("MILESTONE_NOT_IN_PROGRESS");
        }

        const evidenceId = randomUUID();
        const versionGroupId = randomUUID();
        const evidenceStatus = transitionStatus("evidence", "UPLOADED", "PROCESSING");
        const result = await client.query(
          `INSERT INTO evidence (${EVIDENCE_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, NULL, $11, $12, $12)
           RETURNING ${EVIDENCE_COLUMNS}`,
          [evidenceId, milestoneId, actor.id, evidenceType, storageKey, fileName, contentType, fileSize, rawHash, versionGroupId, evidenceStatus, now],
        );
        const initialRun = await ocrRepository.enqueueInitialRun(client, { evidenceId, actorUserId: actor.id, now });
        const evidence = publicEvidence(result.rows[0], { screeningStatus: initialRun.screeningStatus, flags: [] });
        await audit(client, {
          actorUserId: actor.id,
          entityId: evidence.id,
          details: { milestoneId, evidenceType, version: 1, rawHash },
          now,
        });
        return evidence;
      });
    },

    async listForMilestone(actor, milestoneId) {
      if (!["ADMIN", "ORGANIZER", "FUNDER"].includes(actor?.role)) throw repositoryError("FORBIDDEN");
      const milestone = await pool.query(
        `SELECT m.id, c.organization_id, c.funder_id
         FROM milestones m JOIN campaigns c ON c.id = m.campaign_id
         WHERE m.id = $1 LIMIT 1`,
        [milestoneId],
      );
      if (milestone.rowCount === 0 || !inScope(actor, milestone.rows[0])) return null;
      const result = await pool.query(
        `SELECT ${PUBLIC_EVIDENCE_COLUMNS}
         FROM evidence e LEFT JOIN verifications v ON v.evidence_id = e.id
         WHERE e.milestone_id = $1 ORDER BY e.created_at ASC, e.id ASC`,
        [milestoneId],
      );
      if (actor.role === "ADMIN") return result.rows.map(publicAdminEvidence);
      if (actor.role === "FUNDER") return result.rows.map(publicFunderEvidence);
      const summaries = await ocrRepository.getLatestSummaries(result.rows.map((row) => row.id));
      const evidence = [];
      for (const row of result.rows) {
        evidence.push(publicEvidence(row, summaries[row.id], await organizerRevisionInstructions(pool, actor, row)));
      }
      return evidence;
    },

    async findEvidenceForUser(actor, evidenceId) {
      if (!["ADMIN", "ORGANIZER", "FUNDER"].includes(actor?.role)) throw repositoryError("FORBIDDEN");
      const result = await pool.query(
        `SELECT e.*, c.organization_id, c.funder_id,
                v.status AS verification_status, v.review_round_id, v.instruction_commitment
         FROM evidence e
         JOIN milestones m ON m.id = e.milestone_id
         JOIN campaigns c ON c.id = m.campaign_id
         LEFT JOIN verifications v ON v.evidence_id = e.id
         WHERE e.id = $1 LIMIT 1`,
        [evidenceId],
      );
      if (result.rowCount === 0 || !inScope(actor, result.rows[0])) return null;
      if (actor.role === "ADMIN") return publicAdminEvidence(result.rows[0]);
      if (actor.role === "FUNDER") return publicFunderEvidence(result.rows[0]);
      const summaries = await ocrRepository.getLatestSummaries([result.rows[0].id]);
      const revisionInstructions = await organizerRevisionInstructions(pool, actor, result.rows[0]);
      return publicEvidence(result.rows[0], summaries[result.rows[0].id], revisionInstructions);
    },

    async findStoredObjectForAssignedVerifier(actor, evidenceId) {
      if (actor?.role !== "VERIFIER") throw repositoryError("FORBIDDEN");
      const result = await pool.query(
        `SELECT e.storage_key, e.file_name, e.content_type
         FROM evidence e
         JOIN review_rounds rr ON rr.evidence_id = e.id
         JOIN review_assignments ra ON ra.review_round_id = rr.id
         WHERE e.id = $1 AND ra.verifier_user_id = $2
           AND rr.status IN ('OPEN', 'QUORUM_REACHED', 'NO_QUORUM')
         LIMIT 1`,
        [evidenceId, actor.id],
      );
      if (result.rowCount === 0) return null;
      return {
        storageKey: result.rows[0].storage_key,
        fileName: result.rows[0].file_name,
        contentType: result.rows[0].content_type,
      };
    },

    getVerifierOcrDetails(actor, evidenceId) {
      return ocrRepository.getVerifierOcrDetails(actor, evidenceId);
    },

    createAdminRetry(input) {
      return ocrRepository.createAdminRetry(input);
    },
  });
}
