import { randomUUID } from "node:crypto";
import { transitionStatus } from "@dana-terang/domain";

const FLAG_CODES = new Set([
  "MISSING_FIELD", "LOW_CONFIDENCE_FIELD", "AMOUNT_MISMATCH", "CURRENCY_MISMATCH",
  "CURRENCY_UNCERTAIN", "SUSPICIOUS_DATE", "POSSIBLE_DUPLICATE",
]);
const FLAG_FIELDS = new Set(["vendor", "documentDate", "amount", "invoiceNumber", "currency"]);
const LANGUAGES = new Set(["id", "en", "mixed", "unknown"]);
const FAILURE_CODES = new Set([
  "OCR_LANGUAGE_DATA_MISSING", "OCR_ENGINE_UNAVAILABLE", "OCR_RECOGNITION_FAILED",
  "INVALID_PDF", "ENCRYPTED_PDF", "INVALID_IMAGE", "IMAGE_PIXEL_LIMIT_EXCEEDED",
  "PDF_PAGE_LIMIT_EXCEEDED", "INVALID_PDF_PAGE", "UNSUPPORTED_DOCUMENT_TYPE",
  "INVALID_OCR_CONFIGURATION", "FILE_TOO_LARGE", "OCR_PROCESSING_FAILED", "OCR_EMPTY_DOCUMENT",
  "STORED_OBJECT_UNAVAILABLE", "STORED_OBJECT_HASH_MISMATCH", "OCR_RETRY_LIMIT_EXCEEDED",
]);

function repositoryError(code) {
  return Object.assign(new Error(code), { code });
}

async function inTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Keep the original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

function dateString(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function validateResult(result) {
  if (!result || !result.parsed || !Array.isArray(result.flags) || !["CLEAR", "FLAGGED"].includes(result.screeningStatus)) {
    throw repositoryError("INVALID_OCR_RESULT");
  }
  const parsed = result.parsed;
  if (!LANGUAGES.has(parsed.detectedLanguage)
      || !parsed.fieldConfidence
      || ["vendor", "documentDate", "amount", "invoiceNumber"].some((field) => !Number.isSafeInteger(parsed.fieldConfidence[field]) || parsed.fieldConfidence[field] < 0 || parsed.fieldConfidence[field] > 100)
      || typeof parsed.extractedText !== "string" || parsed.extractedText.length > 1_000_000) {
    throw repositoryError("INVALID_OCR_RESULT");
  }
  validateAiEnrichment(result.ai);
  for (const flag of result.flags) {
    if (!FLAG_CODES.has(flag?.code) || (flag.field !== null && !FLAG_FIELDS.has(flag.field))
        || !["LOW", "MEDIUM", "HIGH"].includes(flag.severity)
        || typeof flag.message !== "string" || flag.message.length < 1 || flag.message.length > 240) {
      throw repositoryError("INVALID_OCR_RESULT");
    }
  }
  return parsed;
}

const AI_ENRICHMENT_STATUSES = new Set(["APPLIED", "UNAVAILABLE", "DISABLED"]);

function validateAiEnrichment(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw repositoryError("INVALID_OCR_RESULT");
  if (!AI_ENRICHMENT_STATUSES.has(value.status)) throw repositoryError("INVALID_OCR_RESULT");
  if (value.model !== null && typeof value.model !== "string") throw repositoryError("INVALID_OCR_RESULT");
  if (typeof value.model === "string" && (value.model.length < 1 || value.model.length > 128)) {
    throw repositoryError("INVALID_OCR_RESULT");
  }
  if (value.reason !== null && typeof value.reason !== "string") throw repositoryError("INVALID_OCR_RESULT");
  if (typeof value.reason === "string" && value.reason.length > 64) throw repositoryError("INVALID_OCR_RESULT");
  return value;
}

async function readFullOcrHistory(pool, evidenceId) {
  const evidence = await pool.query("SELECT id FROM evidence WHERE id = $1 LIMIT 1", [evidenceId]);
  if (evidence.rowCount === 0) return null;
  const result = await pool.query(
    `SELECT id, run_number, screening_status, vendor, document_date, amount, currency,
            invoice_number, detected_language, field_confidence, extracted_text,
            failure_code, created_at, completed_at
     FROM ocr_runs WHERE evidence_id = $1 ORDER BY run_number DESC`,
    [evidenceId],
  );
  const runIds = result.rows.map((row) => row.id);
  const flagsByRun = new Map(runIds.map((runId) => [runId, []]));
  if (runIds.length > 0) {
    const placeholders = runIds.map((_, index) => `$${index + 1}`).join(", ");
    const flags = await pool.query(
      `SELECT ocr_run_id, code, field, severity, message, created_at
       FROM ai_flags WHERE ocr_run_id IN (${placeholders}) ORDER BY created_at, id`,
      runIds,
    );
    for (const flag of flags.rows) {
      flagsByRun.get(flag.ocr_run_id)?.push({ code: flag.code, field: flag.field, severity: flag.severity, message: flag.message, createdAt: flag.created_at });
    }
  }
  return {
    evidenceId,
    runs: result.rows.map((row) => ({
      runNumber: Number(row.run_number),
      screeningStatus: row.screening_status,
      vendor: row.vendor,
      documentDate: dateString(row.document_date),
      amount: row.amount,
      currency: row.currency,
      invoiceNumber: row.invoice_number,
      detectedLanguage: row.detected_language,
      fieldConfidence: row.field_confidence,
      extractedText: row.extracted_text,
      failureCode: row.failure_code,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      flags: flagsByRun.get(row.id) ?? [],
    })),
  };
}

export function createOcrRepository(pool, { reviewRepository } = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL-compatible pool is required");
  }

  return Object.freeze({
    async enqueueInitialRun(client, { evidenceId, actorUserId, now = new Date() }) {
      if (!client || typeof client.query !== "function") throw new TypeError("A transaction client is required");
      if (typeof evidenceId !== "string" || typeof actorUserId !== "string") throw repositoryError("INVALID_EVIDENCE_ID");
      const runId = randomUUID();
      await client.query(
        `INSERT INTO ocr_runs (
           id, evidence_id, run_number, screening_status, detected_language, field_confidence, extracted_text, created_at
         ) VALUES ($1, $2, 1, 'PROCESSING', 'unknown', $3, '', $4)`,
        [runId, evidenceId, { vendor: 0, documentDate: 0, amount: 0, invoiceNumber: 0 }, now],
      );
      await client.query(
        `INSERT INTO ocr_jobs (id, ocr_run_id, state, attempt_count, created_at, updated_at)
         VALUES ($1, $2, 'QUEUED', 0, $3, $3)`,
        [randomUUID(), runId, now],
      );
      await client.query(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
         VALUES ($1, $2, 'OCR_JOB_QUEUED', 'OCR_RUN', $3, $4, $5)`,
        [randomUUID(), actorUserId, runId, { evidenceId, runNumber: 1 }, now],
      );
      return { runId, runNumber: 1, screeningStatus: "PROCESSING" };
    },

    async claimNextJob({ leaseOwner, leaseMs, maxAttempts, now = new Date() }) {
      if (typeof leaseOwner !== "string" || leaseOwner.trim().length === 0
          || !Number.isSafeInteger(leaseMs) || leaseMs < 1
          || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1
          || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw repositoryError("INVALID_OCR_JOB_CONFIG");
      }
      return inTransaction(pool, async (client) => {
        const leaseExpiresAt = new Date(now.getTime() + leaseMs);
        const exhausted = await client.query(
          `UPDATE ocr_jobs
           SET state = 'FAILED', lease_owner = NULL, lease_expires_at = NULL,
               last_error_code = 'OCR_RETRY_LIMIT_EXCEEDED', updated_at = $1
           WHERE state = 'RUNNING' AND lease_expires_at <= $1 AND attempt_count >= $2
           RETURNING id, ocr_run_id`,
          [now, maxAttempts],
        );
        for (const job of exhausted.rows) {
          const current = await client.query(
            `SELECT r.evidence_id, r.run_number, r.screening_status, e.status AS evidence_status
             FROM ocr_runs r JOIN evidence e ON e.id = r.evidence_id WHERE r.id = $1`,
            [job.ocr_run_id],
          );
          if (current.rowCount === 0) throw repositoryError("OCR_JOB_CONTEXT_MISSING");
          const row = current.rows[0];
          if (row.screening_status === "PROCESSING") {
            const failedStatus = transitionStatus("screening", "PROCESSING", "FAILED");
            await client.query(
              `UPDATE ocr_runs SET screening_status = $2, failure_code = 'OCR_RETRY_LIMIT_EXCEEDED', completed_at = $3
               WHERE id = $1`,
              [job.ocr_run_id, failedStatus, now],
            );
          }
          if (row.evidence_status === "PROCESSING") {
            const evidenceStatus = transitionStatus("evidence", "PROCESSING", "PROCESSING_FAILED");
            await client.query("UPDATE evidence SET status = $2, updated_at = $3 WHERE id = $1", [row.evidence_id, evidenceStatus, now]);
          }
          await client.query(
            `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
             VALUES ($1, NULL, 'OCR_FAILED', 'OCR_RUN', $2, $3, $4)`,
            [randomUUID(), job.ocr_run_id, { evidenceId: row.evidence_id, runNumber: Number(row.run_number), failureCode: "OCR_RETRY_LIMIT_EXCEEDED" }, now],
          );
        }
        const claimed = await client.query(
          `UPDATE ocr_jobs
           SET state = 'RUNNING', attempt_count = attempt_count + 1,
               lease_owner = $3, lease_expires_at = $4, updated_at = $5
           WHERE id = (
             SELECT id FROM ocr_jobs
             WHERE (state = 'QUEUED' OR (state = 'RUNNING' AND lease_expires_at <= $1))
               AND attempt_count < $2
             ORDER BY created_at, id
             LIMIT 1
           )
             AND (state = 'QUEUED' OR (state = 'RUNNING' AND lease_expires_at <= $1))
           RETURNING id AS job_id, ocr_run_id, attempt_count`,
          [now, maxAttempts, leaseOwner, leaseExpiresAt, now],
        );
        if (claimed.rowCount === 0) return null;
        const row = claimed.rows[0];
        const details = await client.query(
          `SELECT r.evidence_id, r.run_number, e.storage_key, e.raw_hash, e.content_type, e.file_size,
                  m.id AS milestone_id, m.budget_amount AS milestone_budget, m.currency AS milestone_currency,
                  c.id AS campaign_id,
                  c.start_date AS campaign_start_date, c.end_date AS campaign_end_date
           FROM ocr_runs r
           JOIN evidence e ON e.id = r.evidence_id
           JOIN milestones m ON m.id = e.milestone_id
           JOIN campaigns c ON c.id = m.campaign_id
           WHERE r.id = $1`,
          [row.ocr_run_id],
        );
        if (details.rowCount === 0) throw repositoryError("OCR_JOB_CONTEXT_MISSING");
        const detail = details.rows[0];
        return {
          jobId: row.job_id,
          runId: row.ocr_run_id,
          runNumber: Number(detail.run_number),
          evidenceId: detail.evidence_id,
          storageKey: detail.storage_key,
          rawHash: detail.raw_hash,
          contentType: detail.content_type,
          fileSize: Number(detail.file_size),
          milestoneId: detail.milestone_id,
          milestoneBudget: String(detail.milestone_budget),
          milestoneCurrency: detail.milestone_currency,
          campaignId: detail.campaign_id,
          campaignStartDate: dateString(detail.campaign_start_date),
          campaignEndDate: dateString(detail.campaign_end_date),
          attemptCount: Number(row.attempt_count),
          leaseExpiresAt,
        };
      });
    },

    async renewLease({ jobId, leaseOwner, leaseMs, now = new Date() }) {
      if (typeof jobId !== "string" || typeof leaseOwner !== "string" || !Number.isSafeInteger(leaseMs) || leaseMs < 1) {
        throw repositoryError("INVALID_OCR_JOB_CONFIG");
      }
      const result = await pool.query(
        `UPDATE ocr_jobs
         SET lease_expires_at = $3, updated_at = $4
         WHERE id = $1 AND state = 'RUNNING' AND lease_owner = $2
         RETURNING id`,
        [jobId, leaseOwner, new Date(now.getTime() + leaseMs), now],
      );
      return result.rowCount === 1;
    },

    async completeRun({ jobId, runId, leaseOwner, result, now = new Date() }) {
      const parsed = validateResult(result);
      const screeningStatus = transitionStatus("screening", "PROCESSING", result.screeningStatus, {
        flagCodes: result.flags.map((flag) => flag.code),
      });
      return inTransaction(pool, async (client) => {
        const current = await client.query(
          `SELECT j.state AS job_state, j.lease_owner, r.screening_status, r.run_number,
                  r.evidence_id, e.status AS evidence_status
           FROM ocr_jobs j
           JOIN ocr_runs r ON r.id = j.ocr_run_id
           JOIN evidence e ON e.id = r.evidence_id
           WHERE j.id = $1 AND r.id = $2 LIMIT 1`,
          [jobId, runId],
        );
        if (current.rowCount === 0 || current.rows[0].job_state !== "RUNNING"
            || current.rows[0].lease_owner !== leaseOwner || current.rows[0].screening_status !== "PROCESSING") {
          throw repositoryError("OCR_JOB_LEASE_LOST");
        }
        const row = current.rows[0];
        const completedJob = await client.query(
          `UPDATE ocr_jobs SET state = 'COMPLETED', lease_owner = NULL, lease_expires_at = NULL,
             last_error_code = NULL, updated_at = $3
           WHERE id = $1 AND state = 'RUNNING' AND lease_owner = $2 RETURNING id`,
          [jobId, leaseOwner, now],
        );
        if (completedJob.rowCount !== 1) throw repositoryError("OCR_JOB_LEASE_LOST");
        const completedRun = await client.query(
          `UPDATE ocr_runs SET screening_status = $2, vendor = $3, document_date = $4, amount = $5,
             currency = $6, invoice_number = $7, detected_language = $8, field_confidence = $9,
             extracted_text = $10, failure_code = NULL, completed_at = $11,
             ai_model = $12, ai_enrichment_status = $13, ai_enrichment = $14
           WHERE id = $1 AND screening_status = 'PROCESSING' RETURNING id`,
          [runId, screeningStatus, parsed.vendor, parsed.documentDate, parsed.amount, parsed.currency,
            parsed.invoiceNumber, parsed.detectedLanguage, parsed.fieldConfidence, parsed.extractedText, now,
            result.ai?.model ?? null, result.ai?.status ?? null, result.ai ?? null],
        );
        if (completedRun.rowCount !== 1) throw repositoryError("OCR_RUN_NOT_PROCESSING");
        await client.query("DELETE FROM ai_flags WHERE ocr_run_id = $1", [runId]);
        for (const flag of result.flags) {
          await client.query(
            `INSERT INTO ai_flags (id, ocr_run_id, code, field, severity, message, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomUUID(), runId, flag.code, flag.field, flag.severity, flag.message, now],
          );
        }
        let evidenceStatus = row.evidence_status;
        if (evidenceStatus === "PROCESSING") {
          evidenceStatus = transitionStatus("evidence", evidenceStatus, "READY_FOR_REVIEW");
          await client.query("UPDATE evidence SET status = $2, updated_at = $3 WHERE id = $1", [row.evidence_id, evidenceStatus, now]);
        } else if (evidenceStatus !== "READY_FOR_REVIEW") {
          throw repositoryError("INVALID_EVIDENCE_STATE");
        }
        const reviewRound = await reviewRepository?.createRound(client, { evidenceId: row.evidence_id, now }) ?? null;
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, NULL, 'OCR_COMPLETED', 'OCR_RUN', $2, $3, $4)`,
          [randomUUID(), runId, {
            evidenceId: row.evidence_id,
            runNumber: Number(row.run_number),
            screeningStatus,
            flagCount: result.flags.length,
            reviewRoundId: reviewRound?.id ?? null,
          }, now],
        );
        return { runId, screeningStatus, evidenceStatus, flagCount: result.flags.length, reviewRound };
      });
    },

    async failRun({ jobId, runId, leaseOwner, failureCode, now = new Date() }) {
      const safeFailureCode = FAILURE_CODES.has(failureCode) ? failureCode : "OCR_PROCESSING_FAILED";
      const failedStatus = transitionStatus("screening", "PROCESSING", "FAILED");
      return inTransaction(pool, async (client) => {
        const current = await client.query(
          `SELECT j.state AS job_state, j.lease_owner, r.screening_status, r.run_number,
                  r.evidence_id, e.status AS evidence_status
           FROM ocr_jobs j
           JOIN ocr_runs r ON r.id = j.ocr_run_id
           JOIN evidence e ON e.id = r.evidence_id
           WHERE j.id = $1 AND r.id = $2 LIMIT 1`,
          [jobId, runId],
        );
        if (current.rowCount === 0 || current.rows[0].job_state !== "RUNNING"
            || current.rows[0].lease_owner !== leaseOwner || current.rows[0].screening_status !== "PROCESSING") {
          throw repositoryError("OCR_JOB_LEASE_LOST");
        }
        const row = current.rows[0];
        const failedJob = await client.query(
          `UPDATE ocr_jobs SET state = 'FAILED', lease_owner = NULL, lease_expires_at = NULL,
             last_error_code = $3, updated_at = $4
           WHERE id = $1 AND state = 'RUNNING' AND lease_owner = $2 RETURNING id`,
          [jobId, leaseOwner, safeFailureCode, now],
        );
        if (failedJob.rowCount !== 1) throw repositoryError("OCR_JOB_LEASE_LOST");
        await client.query(
          `UPDATE ocr_runs SET screening_status = $2, failure_code = $3, completed_at = $4
           WHERE id = $1 AND screening_status = 'PROCESSING'`,
          [runId, failedStatus, safeFailureCode, now],
        );
        let evidenceStatus = row.evidence_status;
        if (evidenceStatus === "PROCESSING") {
          evidenceStatus = transitionStatus("evidence", evidenceStatus, "PROCESSING_FAILED");
          await client.query("UPDATE evidence SET status = $2, updated_at = $3 WHERE id = $1", [row.evidence_id, evidenceStatus, now]);
        } else if (evidenceStatus !== "READY_FOR_REVIEW") {
          throw repositoryError("INVALID_EVIDENCE_STATE");
        }
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, NULL, 'OCR_FAILED', 'OCR_RUN', $2, $3, $4)`,
          [randomUUID(), runId, { evidenceId: row.evidence_id, runNumber: Number(row.run_number), failureCode: safeFailureCode }, now],
        );
        return { runId, screeningStatus: failedStatus, evidenceStatus, failureCode: safeFailureCode };
      });
    },

    async findDuplicateCandidates({ campaignId, evidenceId }) {
      if (typeof campaignId !== "string" || typeof evidenceId !== "string") throw repositoryError("INVALID_EVIDENCE_ID");
      const result = await pool.query(
        `SELECT e.id AS evidence_id, e.raw_hash, r.vendor, r.invoice_number, r.document_date, r.run_number
         FROM evidence e
         JOIN milestones m ON m.id = e.milestone_id
         JOIN campaigns c ON c.id = m.campaign_id
         JOIN ocr_runs r ON r.evidence_id = e.id
         WHERE c.id = $1 AND e.id <> $2 AND r.screening_status IN ('CLEAR', 'FLAGGED')
         ORDER BY e.id, r.run_number DESC`,
        [campaignId, evidenceId],
      );
      const candidates = new Map();
      for (const row of result.rows) {
        if (!candidates.has(row.evidence_id)) {
          candidates.set(row.evidence_id, {
            rawHash: row.raw_hash,
            vendor: row.vendor,
            invoiceNumber: row.invoice_number,
            documentDate: dateString(row.document_date),
          });
        }
      }
      return [...candidates.values()];
    },

    async getLatestSummaries(evidenceIds) {
      if (!Array.isArray(evidenceIds)) throw repositoryError("INVALID_EVIDENCE_ID");
      const ids = [...new Set(evidenceIds.filter((id) => typeof id === "string"))];
      if (ids.length === 0) return {};
      const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
      const result = await pool.query(
        `SELECT id, evidence_id, run_number, screening_status
         FROM ocr_runs WHERE evidence_id IN (${placeholders})
         ORDER BY evidence_id, run_number DESC`,
        ids,
      );
      const latest = new Map();
      for (const row of result.rows) {
        if (!latest.has(row.evidence_id)) latest.set(row.evidence_id, row);
      }
      const runIds = [...latest.values()].map((row) => row.id);
      const summaries = new Map(runIds.map((runId) => [runId, []]));
      if (runIds.length > 0) {
        const flagPlaceholders = runIds.map((_, index) => `$${index + 1}`).join(", ");
        const flags = await pool.query(
          `SELECT ocr_run_id, code, field, severity, message
           FROM ai_flags WHERE ocr_run_id IN (${flagPlaceholders}) ORDER BY created_at, id`,
          runIds,
        );
        for (const flag of flags.rows) {
          summaries.get(flag.ocr_run_id)?.push({ code: flag.code, field: flag.field, severity: flag.severity, message: flag.message });
        }
      }
      return Object.fromEntries([...latest].map(([evidenceId, row]) => [evidenceId, {
        runNumber: Number(row.run_number),
        screeningStatus: row.screening_status,
        flags: summaries.get(row.id) ?? [],
      }]));
    },

    async getVerifierOcrDetails(actor, evidenceId) {
      if (actor?.role !== "VERIFIER" || typeof evidenceId !== "string") throw repositoryError("FORBIDDEN");
      const assignment = await pool.query(
        `SELECT e.id
         FROM evidence e
         JOIN review_rounds rr ON rr.evidence_id = e.id
         JOIN review_assignments ra ON ra.review_round_id = rr.id
         WHERE e.id = $1 AND ra.verifier_user_id = $2
           AND rr.status IN ('OPEN', 'QUORUM_REACHED', 'NO_QUORUM')
         LIMIT 1`,
        [evidenceId, actor.id],
      );
      if (assignment.rowCount === 0) return null;
      return readFullOcrHistory(pool, evidenceId);
    },

    async createAdminRetry({ actor, evidenceId, now = new Date() }) {
      if (actor?.role !== "ADMIN") throw repositoryError("FORBIDDEN");
      if (typeof evidenceId !== "string") throw repositoryError("INVALID_EVIDENCE_ID");
      return inTransaction(pool, async (client) => {
        const evidence = await client.query("SELECT id, status FROM evidence WHERE id = $1 LIMIT 1", [evidenceId]);
        if (evidence.rowCount === 0) throw repositoryError("EVIDENCE_NOT_FOUND");
        const evidenceStatus = evidence.rows[0].status;
        const active = await client.query(
          `SELECT j.id FROM ocr_jobs j JOIN ocr_runs r ON r.id = j.ocr_run_id
           WHERE r.evidence_id = $1 AND j.state IN ('QUEUED', 'RUNNING') LIMIT 1`,
          [evidenceId],
        );
        if (active.rowCount > 0) throw repositoryError("OCR_ALREADY_PROCESSING");
        if (evidenceStatus !== "PROCESSING_FAILED") {
          throw repositoryError("OCR_NOT_RETRYABLE");
        }
        const previous = await client.query(
          "SELECT run_number FROM ocr_runs WHERE evidence_id = $1 ORDER BY run_number DESC LIMIT 1",
          [evidenceId],
        );
        if (previous.rowCount === 0) throw repositoryError("OCR_NOT_RETRYABLE");
        const runNumber = Number(previous.rows[0].run_number) + 1;
        let nextEvidenceStatus = evidenceStatus;
        if (evidenceStatus === "PROCESSING_FAILED") {
          nextEvidenceStatus = transitionStatus("evidence", "PROCESSING_FAILED", "PROCESSING");
          await client.query("UPDATE evidence SET status = $2, updated_at = $3 WHERE id = $1", [evidenceId, nextEvidenceStatus, now]);
        }
        const runId = randomUUID();
        await client.query(
          `INSERT INTO ocr_runs (
             id, evidence_id, run_number, screening_status, detected_language,
             field_confidence, extracted_text, created_at
           ) VALUES ($1, $2, $3, 'PROCESSING', 'unknown', $4, '', $5)`,
          [runId, evidenceId, runNumber, { vendor: 0, documentDate: 0, amount: 0, invoiceNumber: 0 }, now],
        );
        await client.query(
          `INSERT INTO ocr_jobs (id, ocr_run_id, state, attempt_count, created_at, updated_at)
           VALUES ($1, $2, 'QUEUED', 0, $3, $3)`,
          [randomUUID(), runId, now],
        );
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, $2, 'OCR_RETRY_REQUESTED', 'EVIDENCE', $3, $4, $5)`,
          [randomUUID(), actor.id, evidenceId, { runNumber }, now],
        );
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, $2, 'OCR_JOB_QUEUED', 'OCR_RUN', $3, $4, $5)`,
          [randomUUID(), actor.id, runId, { evidenceId, runNumber }, now],
        );
        return { runId, runNumber, screeningStatus: "PROCESSING", evidenceStatus: nextEvidenceStatus };
      });
    },
  });
}
