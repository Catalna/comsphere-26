import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { newDb } from "pg-mem";

import { runMigrations } from "../../src/db/migrate.js";
import { createOcrRepository } from "../../src/repositories/ocrRepository.js";

const NOW = new Date("2026-10-05T12:00:00.000Z");

async function makeContext() {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);

  const organizationId = randomUUID();
  const organizerId = randomUUID();
  const funderId = randomUUID();
  const adminId = randomUUID();
  const campaignId = randomUUID();
  const milestoneId = randomUUID();
  const evidenceId = randomUUID();
  await pool.query(
    "INSERT INTO organizations (id, name, type, created_at, updated_at) VALUES ($1, 'Community Test', 'COMMUNITY', $2, $2)",
    [organizationId, NOW],
  );
  for (const [id, name, role] of [[organizerId, "Organizer", "ORGANIZER"], [funderId, "Funder", "FUNDER"]]) {
    await pool.query(
      "INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, 'hash', $5, $6, $6)",
      [id, organizationId, name, `${role.toLowerCase()}@example.test`, role, NOW],
    );
  }
  await pool.query(
    "INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, created_at, updated_at) VALUES ($1, NULL, 'Admin', 'admin@example.test', 'hash', 'ADMIN', $2, $2)",
    [adminId, NOW],
  );
  await pool.query(
    "INSERT INTO campaigns (id, organization_id, funder_id, title, total_budget, currency, status, created_at, updated_at) VALUES ($1, $2, $3, 'Test Campaign', 100000, 'IDR', 'ACTIVE', $4, $4)",
    [campaignId, organizationId, funderId, NOW],
  );
  await pool.query(
    "INSERT INTO milestones (id, campaign_id, title, budget_amount, currency, order_index, status, created_at, updated_at) VALUES ($1, $2, 'Test Milestone', 100000, 'IDR', 0, 'IN_PROGRESS', $3, $3)",
    [milestoneId, campaignId, NOW],
  );
  await insertEvidence(pool, { id: evidenceId, milestoneId, uploaderId: organizerId });
  return { pool, evidence: createOcrRepository(pool), organizationId, organizerId, funderId, adminId, campaignId, milestoneId, evidenceId };
}

async function insertEvidence(pool, { id = randomUUID(), milestoneId, uploaderId, rawHash = "a".repeat(64), storageKey = randomUUID() }) {
  await pool.query(
    `INSERT INTO evidence (
       id, milestone_id, uploader_id, evidence_type, storage_key, file_name, content_type,
       file_size, raw_hash, version_group_id, version, previous_evidence_id, status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'RECEIPT', $4, 'receipt.pdf', 'application/pdf', 10, $5, $6, 1, NULL, 'PROCESSING', $7, $7)`,
    [id, milestoneId, uploaderId, storageKey, rawHash, randomUUID(), NOW],
  );
  return id;
}

async function insertRun(pool, { id = randomUUID(), evidenceId, runNumber = 1, status = "PROCESSING", language = "unknown", vendor = null, documentDate = null, amount = null, currency = null, invoiceNumber = null, extractedText = "", failureCode = null }) {
  await pool.query(
    `INSERT INTO ocr_runs (
       id, evidence_id, run_number, screening_status, vendor, document_date, amount, currency,
       invoice_number, detected_language, field_confidence, extracted_text, failure_code, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [id, evidenceId, runNumber, status, vendor, documentDate, amount, currency, invoiceNumber, language, { vendor: 0, documentDate: 0, amount: 0, invoiceNumber: 0 }, extractedText, failureCode, NOW],
  );
  return id;
}

async function insertJob(pool, { id = randomUUID(), runId, state = "QUEUED", attemptCount = 0, leaseOwner = null, leaseExpiresAt = null }) {
  await pool.query(
    `INSERT INTO ocr_jobs (
       id, ocr_run_id, state, attempt_count, lease_owner, lease_expires_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [id, runId, state, attemptCount, leaseOwner, leaseExpiresAt, NOW],
  );
  return id;
}

async function insertFlag(pool, { id = randomUUID(), runId, code = "MISSING_FIELD", field = "vendor" }) {
  await pool.query(
    `INSERT INTO ai_flags (id, ocr_run_id, code, field, severity, message, created_at)
     VALUES ($1, $2, $3, $4, 'MEDIUM', 'Safe test message', $5)`,
    [id, runId, code, field, NOW],
  );
  return id;
}

async function enqueueAndClaim(context) {
  const client = await context.pool.connect();
  try {
    await client.query("BEGIN");
    await context.evidence.enqueueInitialRun(client, { evidenceId: context.evidenceId, actorUserId: context.organizerId, now: NOW });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  return context.evidence.claimNextJob({ leaseOwner: "worker-one", leaseMs: 60000, maxAttempts: 3, now: NOW });
}

test("OCR migration constrains statuses, run versions, and run/job/flag relationships", async () => {
  const context = await makeContext();
  try {
    const validRun = await insertRun(context.pool, { evidenceId: context.evidenceId });
    await insertFlag(context.pool, { runId: validRun });
    await insertJob(context.pool, { runId: validRun });

    await assert.rejects(insertRun(context.pool, { evidenceId: context.evidenceId, runNumber: 0 }));
    await assert.rejects(insertRun(context.pool, { evidenceId: context.evidenceId, status: "APPROVED" }));
    await assert.rejects(insertRun(context.pool, { evidenceId: randomUUID() }));
    await assert.rejects(insertRun(context.pool, { evidenceId: context.evidenceId }));
    await assert.rejects(insertJob(context.pool, { runId: randomUUID() }));
    await assert.rejects(insertJob(context.pool, { runId: validRun }));
    await assert.rejects(insertJob(context.pool, { runId: randomUUID(), state: "WAITING" }));
    await assert.rejects(insertFlag(context.pool, { runId: randomUUID() }));
    await assert.rejects(insertFlag(context.pool, { runId: validRun, code: "FRAUD_DETECTED" }));
  } finally {
    await context.pool.end();
  }
});

test("initial OCR enqueue is transactional and claim leases are recoverable", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      const initial = await context.evidence.enqueueInitialRun(client, { evidenceId: context.evidenceId, actorUserId: context.organizerId, now: NOW });
      await client.query("COMMIT");
      assert.equal(initial.runNumber, 1);
      assert.equal(initial.screeningStatus, "PROCESSING");
    } finally {
      client.release();
    }

    const claim = await context.evidence.claimNextJob({ leaseOwner: "worker-one", leaseMs: 60000, maxAttempts: 3, now: NOW });
    assert.equal(claim.evidenceId, context.evidenceId);
    assert.equal(claim.runNumber, 1);
    assert.equal(claim.attemptCount, 1);
    assert.equal(await context.evidence.claimNextJob({ leaseOwner: "worker-two", leaseMs: 60000, maxAttempts: 3, now: NOW }), null);

    const recovered = await context.evidence.claimNextJob({
      leaseOwner: "worker-two",
      leaseMs: 60000,
      maxAttempts: 3,
      now: new Date(NOW.getTime() + 60001),
    });
    assert.equal(recovered.runNumber, 1);
    assert.equal(recovered.attemptCount, 2);
    const job = await context.pool.query("SELECT state, lease_owner, attempt_count FROM ocr_jobs WHERE ocr_run_id = $1", [claim.runId]);
    assert.deepEqual(job.rows[0], { state: "RUNNING", lease_owner: "worker-two", attempt_count: 2 });
  } finally {
    await context.pool.end();
  }
});

test("duplicate candidates are limited to other evidence in the same Campaign", async () => {
  const context = await makeContext();
  try {
    const sameCampaignEvidenceId = await insertEvidence(context.pool, {
      milestoneId: context.milestoneId,
      uploaderId: context.organizerId,
      rawHash: "b".repeat(64),
    });
    await insertRun(context.pool, {
      evidenceId: sameCampaignEvidenceId,
      status: "FLAGGED",
      vendor: "LAPAK MAKMUR",
      documentDate: "2026-10-25",
      amount: "1250000.5",
      currency: "IDR",
      invoiceNumber: "INV-8821",
    });

    const otherOrganizationId = randomUUID();
    const otherOrganizerId = randomUUID();
    const otherCampaignId = randomUUID();
    const otherMilestoneId = randomUUID();
    await context.pool.query(
      "INSERT INTO organizations (id, name, type, created_at, updated_at) VALUES ($1, 'Other Community', 'COMMUNITY', $2, $2)",
      [otherOrganizationId, NOW],
    );
    await context.pool.query(
      "INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, created_at, updated_at) VALUES ($1, $2, 'Other Organizer', 'other@example.test', 'hash', 'ORGANIZER', $3, $3)",
      [otherOrganizerId, otherOrganizationId, NOW],
    );
    await context.pool.query(
      "INSERT INTO campaigns (id, organization_id, funder_id, title, total_budget, currency, status, created_at, updated_at) VALUES ($1, $2, $3, 'Other Campaign', 100000, 'IDR', 'ACTIVE', $4, $4)",
      [otherCampaignId, otherOrganizationId, context.funderId, NOW],
    );
    await context.pool.query(
      "INSERT INTO milestones (id, campaign_id, title, budget_amount, currency, order_index, status, created_at, updated_at) VALUES ($1, $2, 'Other Milestone', 100000, 'IDR', 0, 'IN_PROGRESS', $3, $3)",
      [otherMilestoneId, otherCampaignId, NOW],
    );
    const crossCampaignEvidenceId = await insertEvidence(context.pool, {
      milestoneId: otherMilestoneId,
      uploaderId: otherOrganizerId,
      rawHash: "c".repeat(64),
    });
    await insertRun(context.pool, {
      evidenceId: crossCampaignEvidenceId,
      status: "CLEAR",
      vendor: "LAPAK MAKMUR",
      documentDate: "2026-10-25",
      amount: "1250000.5",
      currency: "IDR",
      invoiceNumber: "INV-8821",
    });

    const candidates = await context.evidence.findDuplicateCandidates({ campaignId: context.campaignId, evidenceId: context.evidenceId });
    assert.deepEqual(candidates, [{
      rawHash: "b".repeat(64),
      vendor: "LAPAK MAKMUR",
      invoiceNumber: "INV-8821",
      documentDate: "2026-10-25",
    }]);
  } finally {
    await context.pool.end();
  }
});

test("lease renewal, OCR completion, flags, evidence state, and audit commit together", async () => {
  const context = await makeContext();
  try {
    const claim = await enqueueAndClaim(context);
    const renewalTime = new Date(NOW.getTime() + 10000);
    assert.equal(await context.evidence.renewLease({ jobId: claim.jobId, leaseOwner: "worker-one", leaseMs: 60000, now: renewalTime }), true);
    assert.equal(await context.evidence.renewLease({ jobId: claim.jobId, leaseOwner: "worker-two", leaseMs: 60000, now: renewalTime }), false);

    const result = {
      parsed: {
        vendor: "LAPAK MAKMUR", documentDate: "2026-10-25", amount: "1250.5", currency: "IDR",
        invoiceNumber: "INV-1", detectedLanguage: "id",
        fieldConfidence: { vendor: 90, documentDate: 90, amount: 95, invoiceNumber: 80 },
        extractedText: "private OCR text",
      },
      screeningStatus: "FLAGGED",
      flags: [{ code: "AMOUNT_MISMATCH", field: "amount", severity: "HIGH", message: "Jumlah melebihi anggaran." }],
    };
    await context.evidence.completeRun({ jobId: claim.jobId, runId: claim.runId, leaseOwner: "worker-one", result, now: renewalTime });

    const run = await context.pool.query("SELECT screening_status, vendor, amount, extracted_text FROM ocr_runs WHERE id = $1", [claim.runId]);
    assert.deepEqual(run.rows[0], { screening_status: "FLAGGED", vendor: "LAPAK MAKMUR", amount: "1250.5", extracted_text: "private OCR text" });
    const job = await context.pool.query("SELECT state, lease_owner, lease_expires_at FROM ocr_jobs WHERE id = $1", [claim.jobId]);
    assert.deepEqual(job.rows[0], { state: "COMPLETED", lease_owner: null, lease_expires_at: null });
    const evidence = await context.pool.query("SELECT status FROM evidence WHERE id = $1", [context.evidenceId]);
    assert.equal(evidence.rows[0].status, "READY_FOR_REVIEW");
    const flag = await context.pool.query("SELECT code, field, severity FROM ai_flags WHERE ocr_run_id = $1", [claim.runId]);
    assert.deepEqual(flag.rows, [{ code: "AMOUNT_MISMATCH", field: "amount", severity: "HIGH" }]);
    const audit = await context.pool.query("SELECT action, details FROM audit_logs WHERE entity_id = $1 AND action = 'OCR_COMPLETED'", [claim.runId]);
    assert.deepEqual(audit.rows[0].details, { evidenceId: context.evidenceId, runNumber: 1, screeningStatus: "FLAGGED", flagCount: 1, reviewRoundId: null });
  } finally {
    await context.pool.end();
  }
});

test("completeRun records AI enrichment provenance when present", async () => {
  const context = await makeContext();
  try {
    const claim = await enqueueAndClaim(context);
    const ai = {
      status: "APPLIED",
      reason: null,
      model: "gemini-2.5-flash",
      promptHash: "a".repeat(64),
      pagesSent: 2,
      durationMs: 500,
      attempts: 1,
      responseSnippet: "model json snippet",
      fields: { vendor: { source: "tesseract", diverged: false } },
    };
    const result = {
      parsed: {
        vendor: "LAPAK MAKMUR", documentDate: "2026-10-25", amount: "1250.5", currency: "IDR",
        invoiceNumber: "INV-1", detectedLanguage: "id",
        fieldConfidence: { vendor: 90, documentDate: 90, amount: 95, invoiceNumber: 80 },
        extractedText: "private OCR text",
      },
      screeningStatus: "FLAGGED",
      flags: [{ code: "AMOUNT_MISMATCH", field: "amount", severity: "HIGH", message: "Jumlah melebihi anggaran." }],
      ai,
    };
    await context.evidence.completeRun({ jobId: claim.jobId, runId: claim.runId, leaseOwner: "worker-one", result, now: NOW });
    const run = await context.pool.query("SELECT ai_model, ai_enrichment_status, ai_enrichment FROM ocr_runs WHERE id = $1", [claim.runId]);
    assert.deepEqual(run.rows[0], { ai_model: "gemini-2.5-flash", ai_enrichment_status: "APPLIED", ai_enrichment: ai });
  } finally {
    await context.pool.end();
  }
});

test("completeRun leaves AI columns empty when no enrichment ran", async () => {
  const context = await makeContext();
  try {
    const claim = await enqueueAndClaim(context);
    const result = {
      parsed: {
        vendor: "LAPAK MAKMUR", documentDate: "2026-10-25", amount: "1250.5", currency: "IDR",
        invoiceNumber: "INV-1", detectedLanguage: "id",
        fieldConfidence: { vendor: 90, documentDate: 90, amount: 95, invoiceNumber: 80 },
        extractedText: "private OCR text",
      },
      screeningStatus: "FLAGGED",
      flags: [{ code: "AMOUNT_MISMATCH", field: "amount", severity: "HIGH", message: "Jumlah melebihi anggaran." }],
    };
    await context.evidence.completeRun({ jobId: claim.jobId, runId: claim.runId, leaseOwner: "worker-one", result, now: NOW });
    const run = await context.pool.query("SELECT ai_model, ai_enrichment_status, ai_enrichment FROM ocr_runs WHERE id = $1", [claim.runId]);
    assert.deepEqual(run.rows[0], { ai_model: null, ai_enrichment_status: null, ai_enrichment: null });
  } finally {
    await context.pool.end();
  }
});

test("completeRun reports a disabled enricher without storing model details", async () => {
  const context = await makeContext();
  try {
    const claim = await enqueueAndClaim(context);
    const result = {
      parsed: {
        vendor: "LAPAK MAKMUR", documentDate: "2026-10-25", amount: "1250.5", currency: "IDR",
        invoiceNumber: "INV-1", detectedLanguage: "id",
        fieldConfidence: { vendor: 90, documentDate: 90, amount: 95, invoiceNumber: 80 },
        extractedText: "private OCR text",
      },
      screeningStatus: "FLAGGED",
      flags: [{ code: "AMOUNT_MISMATCH", field: "amount", severity: "HIGH", message: "Jumlah melebihi anggaran." }],
      ai: { status: "DISABLED", reason: "GEMINI_DISABLED", model: null, promptHash: null, pagesSent: 0, durationMs: 0, attempts: 0, responseSnippet: null, fields: null },
    };
    await context.evidence.completeRun({ jobId: claim.jobId, runId: claim.runId, leaseOwner: "worker-one", result, now: NOW });
    const run = await context.pool.query("SELECT ai_model, ai_enrichment_status, ai_enrichment FROM ocr_runs WHERE id = $1", [claim.runId]);
    assert.deepEqual(run.rows[0], { ai_model: null, ai_enrichment_status: "DISABLED", ai_enrichment: { status: "DISABLED", reason: "GEMINI_DISABLED", model: null, promptHash: null, pagesSent: 0, durationMs: 0, attempts: 0, responseSnippet: null, fields: null } });
  } finally {
    await context.pool.end();
  }
});

test("completeRun rejects an enrichment record outside the allowed statuses", async () => {
  const context = await makeContext();
  try {
    const claim = await enqueueAndClaim(context);
    const result = {
      parsed: {
        vendor: "LAPAK MAKMUR", documentDate: "2026-10-25", amount: "1250.5", currency: "IDR",
        invoiceNumber: "INV-1", detectedLanguage: "id",
        fieldConfidence: { vendor: 90, documentDate: 90, amount: 95, invoiceNumber: 80 },
        extractedText: "private OCR text",
      },
      screeningStatus: "FLAGGED",
      flags: [{ code: "AMOUNT_MISMATCH", field: "amount", severity: "HIGH", message: "Jumlah melebihi anggaran." }],
      ai: { status: "WAT", reason: null, model: "gemini-2.5-flash", promptHash: null, pagesSent: 0, durationMs: 0, attempts: 0, responseSnippet: null, fields: null },
    };
    await assert.rejects(
      context.evidence.completeRun({ jobId: claim.jobId, runId: claim.runId, leaseOwner: "worker-one", result, now: NOW }),
      { code: "INVALID_OCR_RESULT" },
    );
  } finally {
    await context.pool.end();
  }
});

test("processing failure closes the lease and makes evidence retryable without auditing OCR text", async () => {
  const context = await makeContext();
  try {
    const claim = await enqueueAndClaim(context);
    await context.evidence.failRun({ jobId: claim.jobId, runId: claim.runId, leaseOwner: "worker-one", failureCode: "OCR_LANGUAGE_DATA_MISSING", now: NOW });
    const run = await context.pool.query("SELECT screening_status, failure_code, extracted_text FROM ocr_runs WHERE id = $1", [claim.runId]);
    assert.deepEqual(run.rows[0], { screening_status: "FAILED", failure_code: "OCR_LANGUAGE_DATA_MISSING", extracted_text: "" });
    const job = await context.pool.query("SELECT state, lease_owner, lease_expires_at, last_error_code FROM ocr_jobs WHERE id = $1", [claim.jobId]);
    assert.deepEqual(job.rows[0], { state: "FAILED", lease_owner: null, lease_expires_at: null, last_error_code: "OCR_LANGUAGE_DATA_MISSING" });
    const evidence = await context.pool.query("SELECT status FROM evidence WHERE id = $1", [context.evidenceId]);
    assert.equal(evidence.rows[0].status, "PROCESSING_FAILED");
    const audit = await context.pool.query("SELECT action, details FROM audit_logs WHERE entity_id = $1 AND action = 'OCR_FAILED'", [claim.runId]);
    assert.deepEqual(audit.rows[0].details, { evidenceId: context.evidenceId, runNumber: 1, failureCode: "OCR_LANGUAGE_DATA_MISSING" });
  } finally {
    await context.pool.end();
  }
});

test("expired OCR jobs stop retrying after the configured attempt limit", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      await context.evidence.enqueueInitialRun(client, { evidenceId: context.evidenceId, actorUserId: context.organizerId, now: NOW });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await context.evidence.claimNextJob({ leaseOwner: "worker-one", leaseMs: 1000, maxAttempts: 3, now: NOW });
    await context.evidence.claimNextJob({ leaseOwner: "worker-two", leaseMs: 1000, maxAttempts: 3, now: new Date(NOW.getTime() + 1001) });
    const finalClaim = await context.evidence.claimNextJob({ leaseOwner: "worker-three", leaseMs: 1000, maxAttempts: 3, now: new Date(NOW.getTime() + 2002) });
    assert.equal(finalClaim.attemptCount, 3);
    assert.equal(await context.evidence.claimNextJob({ leaseOwner: "worker-four", leaseMs: 1000, maxAttempts: 3, now: new Date(NOW.getTime() + 3003) }), null);

    const job = await context.pool.query("SELECT state, last_error_code FROM ocr_jobs");
    assert.deepEqual(job.rows, [{ state: "FAILED", last_error_code: "OCR_RETRY_LIMIT_EXCEEDED" }]);
    const run = await context.pool.query("SELECT screening_status, failure_code FROM ocr_runs");
    assert.deepEqual(run.rows, [{ screening_status: "FAILED", failure_code: "OCR_RETRY_LIMIT_EXCEEDED" }]);
    const evidence = await context.pool.query("SELECT status FROM evidence WHERE id = $1", [context.evidenceId]);
    assert.equal(evidence.rows[0].status, "PROCESSING_FAILED");
  } finally {
    await context.pool.end();
  }
});

test("latest summaries return only safe fields and flags for the newest screening run", async () => {
  const context = await makeContext();
  try {
    await insertRun(context.pool, { evidenceId: context.evidenceId, runNumber: 1, status: "CLEAR", extractedText: "older private text" });
    const latestRunId = await insertRun(context.pool, {
      evidenceId: context.evidenceId,
      runNumber: 2,
      status: "FLAGGED",
      vendor: "LAPAK MAKMUR",
      documentDate: "2026-10-25",
      amount: "1250.5",
      currency: "IDR",
      invoiceNumber: "INV-1",
      extractedText: "latest private text",
    });
    await insertFlag(context.pool, { runId: latestRunId, code: "AMOUNT_MISMATCH", field: "amount" });

    const summaries = await context.evidence.getLatestSummaries([context.evidenceId, randomUUID()]);
    assert.deepEqual(summaries[context.evidenceId], {
      runNumber: 2,
      screeningStatus: "FLAGGED",
      flags: [{ code: "AMOUNT_MISMATCH", field: "amount", severity: "MEDIUM", message: "Safe test message" }],
    });
    assert.equal("extractedText" in summaries[context.evidenceId], false);
  } finally {
    await context.pool.end();
  }
});

test("full OCR history is unavailable to Admin and unassigned Verifiers", async () => {
  const context = await makeContext();
  try {
    await insertRun(context.pool, { evidenceId: context.evidenceId, runNumber: 1, status: "FAILED", failureCode: "OCR_LANGUAGE_DATA_MISSING", extractedText: "" });
    await insertRun(context.pool, { evidenceId: context.evidenceId, runNumber: 2, status: "CLEAR", extractedText: "private receipt text" });
    await assert.rejects(
      context.evidence.getVerifierOcrDetails({ id: context.adminId, role: "ADMIN" }, context.evidenceId),
      { code: "FORBIDDEN" },
    );
    assert.equal(await context.evidence.getVerifierOcrDetails({ id: randomUUID(), role: "VERIFIER" }, context.evidenceId), null);
  } finally {
    await context.pool.end();
  }
});

test("Admin retry creates a new OCR run without replacing the failed run", async () => {
  const context = await makeContext();
  try {
    const firstJob = await enqueueAndClaim(context);
    await context.evidence.failRun({
      jobId: firstJob.jobId,
      runId: firstJob.runId,
      leaseOwner: "worker-one",
      failureCode: "OCR_LANGUAGE_DATA_MISSING",
      now: NOW,
    });
    const retry = await context.evidence.createAdminRetry({
      actor: { id: context.adminId, role: "ADMIN" },
      evidenceId: context.evidenceId,
      now: new Date(NOW.getTime() + 1),
    });
    assert.equal(retry.runNumber, 2);
    assert.equal(retry.screeningStatus, "PROCESSING");
    assert.equal(retry.evidenceStatus, "PROCESSING");
    assert.equal(typeof retry.runId, "string");
    const prior = await context.pool.query("SELECT screening_status, failure_code FROM ocr_runs WHERE id = $1", [firstJob.runId]);
    assert.deepEqual(prior.rows[0], { screening_status: "FAILED", failure_code: "OCR_LANGUAGE_DATA_MISSING" });
    const count = await context.pool.query("SELECT COUNT(*)::int AS count FROM ocr_runs WHERE evidence_id = $1", [context.evidenceId]);
    assert.equal(Number(count.rows[0].count), 2);
    await assert.rejects(context.evidence.createAdminRetry({ actor: { id: context.organizerId, role: "ORGANIZER" }, evidenceId: context.evidenceId }), { code: "FORBIDDEN" });
    await assert.rejects(context.evidence.createAdminRetry({ actor: { id: context.adminId, role: "ADMIN" }, evidenceId: context.evidenceId }), { code: "OCR_ALREADY_PROCESSING" });
  } finally {
    await context.pool.end();
  }
});
