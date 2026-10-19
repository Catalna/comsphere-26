import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import request from "supertest";
import { newDb } from "pg-mem";

import { createSessionToken } from "../../src/auth/sessionTokens.js";
import { createApp } from "../../src/app.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createAuthRepository } from "../../src/repositories/authRepository.js";
import { createCampaignRepository } from "../../src/repositories/campaignRepository.js";
import { createEvidenceRepository } from "../../src/repositories/evidenceRepository.js";
import { createOcrRepository } from "../../src/repositories/ocrRepository.js";
import { createReviewRepository } from "../../src/repositories/reviewRepository.js";
import { computeOrganizerInstructionCommitment } from "../../src/review/eip712.js";
import { createLocalFileStorage } from "../../src/storage/localFileStorage.js";

const WEB_ORIGIN = "http://localhost:3000";
const PDF_BYTES = Buffer.from("%PDF-1.7\nprivate receipt fixture");
const REVISION_PDF_BYTES = Buffer.from("%PDF-1.7\ncomplete revised receipt");
const SESSION_EXPIRES_AT = new Date("2030-01-01T00:00:00.000Z");

async function createUser(auth, { name, email, organizationName, organizationType }) {
  return (await auth.registerOrganizer({
    name, email, passwordHash: "test-only-password-hash", organizationName, organizationType,
    sessionTokenHash: createHash("sha256").update(email).digest("hex"),
    sessionExpiresAt: SESSION_EXPIRES_AT,
  })).user;
}

async function cookieFor(auth, user) {
  const { token, tokenHash } = createSessionToken();
  await auth.createSession({ userId: user.id, tokenHash, expiresAt: SESSION_EXPIRES_AT });
  return `dt_session=${token}`;
}

async function createTestContext({ maxEvidenceBytes } = {}) {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const auth = createAuthRepository(pool);
  const campaigns = createCampaignRepository(pool);
  const evidence = createEvidenceRepository(pool);
  const storageRoot = await mkdtemp(join(tmpdir(), "dana-terang-evidence-"));
  const storage = createLocalFileStorage({ root: storageRoot });
  const admin = await auth.createFirstAdmin({ name: "System Admin", email: "admin@example.com", passwordHash: "hash" });
  const organizer = await createUser(auth, {
    name: "Organizer One", email: "organizer@example.com", organizationName: "Community One", organizationType: "COMMUNITY",
  });
  const otherOrganizer = await createUser(auth, {
    name: "Organizer Two", email: "other@example.com", organizationName: "Community Two", organizationType: "COMMUNITY",
  });
  const funderCandidate = await createUser(auth, {
    name: "Funder One", email: "funder@example.com", organizationName: "Foundation One", organizationType: "COMPANY",
  });
  await auth.assignRoleAndAudit({ actorUserId: admin.user.id, targetUserId: funderCandidate.id, role: "FUNDER" });
  const funder = await auth.findUserByEmail("funder@example.com");
  const campaign = await campaigns.createCampaign({
    actor: organizer,
    funderId: funder.id,
    title: "School Renovation",
    description: "Evidence upload test",
    totalBudget: "100000.00",
    currency: "IDR",
  });
  const milestone = await campaigns.createMilestone({
    actor: organizer,
    campaignId: campaign.id,
    title: "Buy materials",
    description: "Upload receipts",
    budgetAmount: "100000.00",
    currency: "IDR",
    orderIndex: 0,
  });
  await campaigns.activateCampaign({ actor: funder, campaignId: campaign.id });
  await campaigns.updateMilestoneStatus({ actor: organizer, milestoneId: milestone.id, status: "IN_PROGRESS" });
  const app = createApp({
    authRepository: auth,
    campaignRepository: campaigns,
    evidenceRepository: evidence,
    objectStorage: storage,
    maxEvidenceBytes,
    webOrigin: WEB_ORIGIN,
    nodeEnv: "test",
  });
  return {
    app, pool, auth, storageRoot, campaign, milestone, admin: admin.user, organizer, otherOrganizer, funder,
    adminCookie: await cookieFor(auth, admin.user),
    organizerCookie: await cookieFor(auth, organizer),
    otherOrganizerCookie: await cookieFor(auth, otherOrganizer),
    funderCookie: await cookieFor(auth, funder),
    cleanup: async () => { await pool.end(); await rm(storageRoot, { recursive: true, force: true }); },
  };
}

async function uploadEvidence(context) {
  return request(context.app)
    .post(`/api/milestones/${context.milestone.id}/evidence`)
    .set("Origin", WEB_ORIGIN)
    .set("Cookie", context.organizerCookie)
    .field("evidenceType", "RECEIPT")
    .attach("file", PDF_BYTES, { filename: "receipt.pdf", contentType: "application/pdf" });
}

async function completeQueuedOcr(context, evidenceId, screeningStatus = "FLAGGED") {
  const repository = createOcrRepository(context.pool);
  const now = new Date();
  const job = await repository.claimNextJob({ leaseOwner: "route-test-worker", leaseMs: 60000, maxAttempts: 3, now });
  assert.equal(job.evidenceId, evidenceId);
  await repository.completeRun({
    jobId: job.jobId,
    runId: job.runId,
    leaseOwner: "route-test-worker",
    now,
    result: {
      parsed: {
        vendor: "TOKO MAJU",
        documentDate: "2026-10-01",
        amount: "150000",
        currency: "IDR",
        invoiceNumber: "INV-1",
        detectedLanguage: "id",
        fieldConfidence: { vendor: 90, documentDate: 90, amount: 95, invoiceNumber: 90 },
        extractedText: "private full OCR result",
      },
      screeningStatus,
      flags: screeningStatus === "FLAGGED"
        ? [{ code: "AMOUNT_MISMATCH", field: "amount", severity: "HIGH", message: "Amount requires review." }]
        : [],
    },
  });
  return job;
}

async function failQueuedOcr(context, evidenceId, failureCode = "OCR_LANGUAGE_DATA_MISSING") {
  const repository = createOcrRepository(context.pool);
  const job = await repository.claimNextJob({ leaseOwner: "route-test-worker", leaseMs: 60000, maxAttempts: 3, now: new Date() });
  assert.equal(job.evidenceId, evidenceId);
  await repository.failRun({
    jobId: job.jobId,
    runId: job.runId,
    leaseOwner: "route-test-worker",
    failureCode,
    now: new Date(),
  });
}

async function createVerifierPanel(context, { addUnassignedVerifier = false } = {}) {
  const verifierUsers = [];
  for (let index = 0; index < 3 + Number(addUnassignedVerifier); index += 1) {
    const user = await createUser(context.auth, {
      name: `Verifier ${index + 1}`,
      email: `verifier-${index + 1}@example.com`,
      organizationName: `Verifier Organization ${index + 1}`,
      organizationType: "NGO",
    });
    await context.auth.assignRoleAndAudit({ actorUserId: context.admin.id, targetUserId: user.id, role: "VERIFIER" });
    const verifier = await context.auth.findUserByEmail(`verifier-${index + 1}@example.com`);
    verifierUsers.push(verifier);
    if (index < 3) {
      await context.pool.query(
        `INSERT INTO verifier_wallets (
           verifier_user_id, wallet_address, organization_id, roster_version, status, verified_at, created_at
         ) VALUES ($1, $2, $3, 1, 'ACTIVE', $4, $4)`,
        [verifier.id, `0x${String(index + 1).repeat(40)}`, verifier.organizationId, new Date()],
      );
    }
  }
  return { verifierUsers, cookies: await Promise.all(verifierUsers.map((user) => cookieFor(context.auth, user))) };
}

async function openReviewRound(context, evidenceId) {
  const reviewRepository = createReviewRepository(context.pool, { contractAddress: `0x${"c".repeat(40)}` });
  const client = await context.pool.connect();
  try {
    await client.query("BEGIN");
    const round = await reviewRepository.createRound(client, { evidenceId });
    assert.ok(round);
    await client.query("UPDATE review_rounds SET status = 'OPEN' WHERE id = $1", [round.id]);
    await client.query("COMMIT");
    return round;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Keep the test failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

test("Organizer uploads private evidence bytes and receives only safe metadata", async () => {
  const context = await createTestContext();
  try {
    const response = await request(context.app)
      .post(`/api/milestones/${context.milestone.id}/evidence`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .field("evidenceType", "RECEIPT")
      .attach("file", PDF_BYTES, { filename: "receipt.pdf", contentType: "application/pdf" });

    assert.equal(response.status, 201);
    assert.equal(response.body.evidence.status, "PROCESSING");
    assert.equal(response.body.evidence.evidenceStatus, "PROCESSING");
    assert.equal(response.body.evidence.screeningStatus, "PROCESSING");
    assert.equal(response.body.evidence.version, 1);
    assert.equal(response.body.evidence.rawHash, createHash("sha256").update(PDF_BYTES).digest("hex"));
    assert.equal(response.body.evidence.fileName, "receipt.pdf");
    assert.equal("storageKey" in response.body.evidence, false);
    assert.equal("downloadUrl" in response.body.evidence, false);
  } finally {
    await context.cleanup();
  }
});

test("only the owning Organizer can upload evidence to a Milestone", async () => {
  const context = await createTestContext();
  try {
    const response = await request(context.app)
      .post(`/api/milestones/${context.milestone.id}/evidence`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.otherOrganizerCookie)
      .field("evidenceType", "RECEIPT")
      .attach("file", PDF_BYTES, { filename: "receipt.pdf", contentType: "application/pdf" });
    assert.equal(response.status, 404);
    assert.equal((await context.pool.query("SELECT id FROM evidence")).rowCount, 0);
  } finally {
    await context.cleanup();
  }
});

test("Campaign access is checked before the multipart body is buffered", async () => {
  const context = await createTestContext({ maxEvidenceBytes: 64 });
  try {
    const oversizedBytes = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(128)]);
    const response = await request(context.app)
      .post(`/api/milestones/${context.milestone.id}/evidence`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.otherOrganizerCookie)
      .field("evidenceType", "RECEIPT")
      .attach("file", oversizedBytes, { filename: "receipt.pdf", contentType: "application/pdf" });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "not_found" });
    assert.equal((await context.pool.query("SELECT id FROM evidence")).rowCount, 0);
  } finally {
    await context.cleanup();
  }
});

test("source download is unavailable to participants and Admin before Verifier assignment", async () => {
  const context = await createTestContext();
  try {
    const created = await request(context.app)
      .post(`/api/milestones/${context.milestone.id}/evidence`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .field("evidenceType", "RECEIPT")
      .attach("file", PDF_BYTES, { filename: "receipt.pdf", contentType: "application/pdf" });
    assert.equal(created.status, 201);

    for (const cookie of [context.adminCookie, context.organizerCookie, context.funderCookie]) {
      const denied = await request(context.app)
        .get(`/api/evidence/${created.body.evidence.id}/file`)
        .set("Cookie", cookie);
      assert.equal(denied.status, 403);
    }
  } finally {
    await context.cleanup();
  }
});

test("only Verifiers assigned to an opened evidence round can read source bytes or full OCR", async () => {
  const context = await createTestContext();
  try {
    const upload = await uploadEvidence(context);
    const evidenceId = upload.body.evidence.id;
    await completeQueuedOcr(context, evidenceId, "CLEAR");
    const panel = await createVerifierPanel(context, { addUnassignedVerifier: true });
    const round = await openReviewRound(context, evidenceId);
    const assignedIndex = round.panel.findIndex((member) => member.verifierUserId === panel.verifierUsers[0].id);
    assert.notEqual(assignedIndex, -1);
    const assignedCookie = panel.cookies[0];

    const source = await request(context.app)
      .get(`/api/evidence/${evidenceId}/file`)
      .set("Cookie", assignedCookie);
    assert.equal(source.status, 200);
    assert.deepEqual(source.body, PDF_BYTES);
    assert.equal(source.headers["cache-control"], "private, no-store");

    const fullOcr = await request(context.app)
      .get(`/api/evidence/${evidenceId}/ocr`)
      .set("Cookie", assignedCookie);
    assert.equal(fullOcr.status, 200);
    assert.equal(fullOcr.body.runs[0].extractedText, "private full OCR result");

    for (const cookie of [context.adminCookie, context.organizerCookie, context.funderCookie]) {
      assert.equal((await request(context.app).get(`/api/evidence/${evidenceId}/file`).set("Cookie", cookie)).status, 403);
      assert.equal((await request(context.app).get(`/api/evidence/${evidenceId}/ocr`).set("Cookie", cookie)).status, 403);
    }
    assert.equal((await request(context.app).get(`/api/evidence/${evidenceId}/file`).set("Cookie", panel.cookies[3])).status, 404);
    assert.equal((await request(context.app).get(`/api/evidence/${evidenceId}/ocr`).set("Cookie", panel.cookies[3])).status, 404);
    const retryAfterReviewOpened = await request(context.app)
      .post(`/api/admin/evidence/${evidenceId}/ocr-retry`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.adminCookie);
    assert.equal(retryAfterReviewOpened.status, 409);
    assert.deepEqual(retryAfterReviewOpened.body, { error: "ocr_not_retryable" });
  } finally {
    await context.cleanup();
  }
});

test("only the owning Organizer sees the final quorum's revision instructions", async () => {
  const context = await createTestContext();
  try {
    const upload = await uploadEvidence(context);
    const evidenceId = upload.body.evidence.id;
    await completeQueuedOcr(context, evidenceId, "FLAGGED");
    const panel = await createVerifierPanel(context);
    const round = await openReviewRound(context, evidenceId);
    const reviewRepository = createReviewRepository(context.pool, { contractAddress: `0x${"c".repeat(40)}` });
    const proposalA = "Please add the receipt date.";
    const proposalB = "Please upload the complete receipt with vendor name.";
    const saltA = "a".repeat(64);
    const saltB = "b".repeat(64);
    const commitmentA = computeOrganizerInstructionCommitment({ instructions: proposalA, salt: saltA });
    const commitmentB = computeOrganizerInstructionCommitment({ instructions: proposalB, salt: saltB });
    for (const [index, proposal, salt, commitment] of [
      [0, proposalA, saltA, commitmentA],
      [1, proposalB, saltB, commitmentB],
    ]) {
      const member = round.panel[index];
      await reviewRepository.persistSignedVote({
        reviewRoundId: round.id,
        verifierUserId: member.verifierUserId,
        walletAddress: member.walletAddress,
        decision: "NEEDS_REVISION",
        eip712Signature: `0x${String(index + 1).repeat(130)}`,
        noConflictAttested: true,
        organizerInstructionCommitment: commitment,
        organizerInstructionSalt: salt,
        organizerInstructions: proposal,
        internalNotes: `Reviewer ${index + 1} note.`,
        now: new Date(),
      });
    }
    await reviewRepository.reconcileConfirmedOutcome({
      reviewRoundId: round.id,
      event: {
        kind: "QUORUM_REACHED",
        reviewId: round.reviewId,
        evidenceCommitment: round.evidenceCommitment,
        roundNumber: round.roundNumber,
        decision: "NEEDS_REVISION",
        instructionCommitment: commitmentB,
        transactionHash: `0x${"a".repeat(64)}`,
        blockNumber: 555,
      },
      now: new Date(),
    });

    const organizer = await request(context.app).get(`/api/evidence/${evidenceId}`).set("Cookie", context.organizerCookie);
    assert.equal(organizer.status, 200);
    assert.equal(organizer.body.evidence.verificationStatus, "NEEDS_REVISION");
    assert.equal(organizer.body.evidence.revisionInstructions, proposalB);

    const funder = await request(context.app).get(`/api/evidence/${evidenceId}`).set("Cookie", context.funderCookie);
    assert.equal(funder.body.evidence.verificationStatus, "NEEDS_REVISION");
    assert.equal("revisionInstructions" in funder.body.evidence, false);
    assert.equal(JSON.stringify(funder.body).includes(proposalB), false);

    const admin = await request(context.app).get(`/api/evidence/${evidenceId}`).set("Cookie", context.adminCookie);
    assert.deepEqual(Object.keys(admin.body.evidence).sort(), ["createdAt", "evidenceId", "evidenceStatus", "id", "milestoneId", "status", "verificationStatus"].sort());
    assert.equal(JSON.stringify(admin.body).includes("receipt.pdf"), false);
    assert.equal(JSON.stringify(admin.body).includes(proposalB), false);
  } finally {
    await context.cleanup();
  }
});

test("Organizer revision upload creates the next immutable evidence version without reopening the Milestone", async () => {
  const context = await createTestContext();
  try {
    const upload = await uploadEvidence(context);
    const evidenceId = upload.body.evidence.id;
    await completeQueuedOcr(context, evidenceId, "FLAGGED");
    const panel = await createVerifierPanel(context);
    const round = await openReviewRound(context, evidenceId);
    const reviewRepository = createReviewRepository(context.pool, { contractAddress: `0x${"c".repeat(40)}` });
    const instructions = "Please upload the full receipt with the transaction date.";
    const salt = "c".repeat(64);
    const instructionCommitment = computeOrganizerInstructionCommitment({ instructions, salt });
    for (const index of [0, 1]) {
      const member = round.panel[index];
      await reviewRepository.persistSignedVote({
        reviewRoundId: round.id,
        verifierUserId: member.verifierUserId,
        walletAddress: member.walletAddress,
        decision: "NEEDS_REVISION",
        eip712Signature: `0x${String(index + 3).repeat(130)}`,
        noConflictAttested: true,
        organizerInstructionCommitment: instructionCommitment,
        organizerInstructionSalt: salt,
        organizerInstructions: instructions,
        internalNotes: "Private review note.",
        now: new Date(),
      });
    }
    await reviewRepository.reconcileConfirmedOutcome({
      reviewRoundId: round.id,
      event: {
        kind: "QUORUM_REACHED",
        reviewId: round.reviewId,
        evidenceCommitment: round.evidenceCommitment,
        roundNumber: round.roundNumber,
        decision: "NEEDS_REVISION",
        instructionCommitment,
        transactionHash: `0x${"b".repeat(64)}`,
        blockNumber: 600,
      },
      now: new Date(),
    });

    const rejectedRevision = await request(context.app)
      .post(`/api/evidence/${evidenceId}/revisions`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.funderCookie)
      .attach("file", REVISION_PDF_BYTES, { filename: "revision.pdf", contentType: "application/pdf" });
    assert.equal(rejectedRevision.status, 403);

    const revision = await request(context.app)
      .post(`/api/evidence/${evidenceId}/revisions`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .attach("file", REVISION_PDF_BYTES, { filename: "revision.pdf", contentType: "application/pdf" });
    assert.equal(revision.status, 201);
    assert.equal(revision.body.evidence.version, 2);
    assert.equal(revision.body.evidence.previousEvidenceId, evidenceId);
    assert.equal(revision.body.evidence.evidenceStatus, "PROCESSING");
    assert.equal(revision.body.evidence.rawHash, createHash("sha256").update(REVISION_PDF_BYTES).digest("hex"));

    const parent = (await context.pool.query("SELECT status, version, raw_hash FROM evidence WHERE id = $1", [evidenceId])).rows[0];
    assert.equal(parent.status, "SUPERSEDED");
    assert.equal(parent.version, 1);
    assert.equal(parent.raw_hash, createHash("sha256").update(PDF_BYTES).digest("hex"));
    assert.equal((await context.pool.query("SELECT id FROM review_votes WHERE review_round_id = $1", [round.id])).rowCount, 2);
    assert.equal((await context.pool.query("SELECT status FROM milestones WHERE id = $1", [context.milestone.id])).rows[0].status, "IN_PROGRESS");
    assert.equal((await context.pool.query("SELECT status FROM campaigns WHERE id = $1", [context.campaign.id])).rows[0].status, "ACTIVE");

    const missingOrigin = await request(context.app)
      .post(`/api/evidence/${evidenceId}/revisions`)
      .set("Cookie", context.organizerCookie)
      .attach("file", REVISION_PDF_BYTES, { filename: "retry.pdf", contentType: "application/pdf" });
    assert.equal(missingOrigin.status, 403);
  } finally {
    await context.cleanup();
  }
});

test("upload rejects a file whose declared MIME type does not match its signature", async () => {
  const context = await createTestContext();
  try {
    const response = await request(context.app)
      .post(`/api/milestones/${context.milestone.id}/evidence`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .field("evidenceType", "RECEIPT")
      .attach("file", Buffer.from("not really a PDF"), { filename: "receipt.pdf", contentType: "application/pdf" });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "invalid_upload" });
    assert.equal((await context.pool.query("SELECT id FROM evidence")).rowCount, 0);
  } finally {
    await context.cleanup();
  }
});

test("Organizer sees safe screening details while Funder sees status only", async () => {
  const context = await createTestContext();
  try {
    const upload = await uploadEvidence(context);
    assert.equal(upload.status, 201);
    const evidenceId = upload.body.evidence.id;

    const processing = await request(context.app)
      .get(`/api/milestones/${context.milestone.id}/evidence`)
      .set("Cookie", context.organizerCookie);
    assert.equal(processing.status, 200);
    assert.equal(processing.body.evidence[0].evidenceStatus, "PROCESSING");
    assert.equal(processing.body.evidence[0].screeningStatus, "PROCESSING");
    assert.deepEqual(processing.body.evidence[0].flags, []);

    await completeQueuedOcr(context, evidenceId);
    const summary = await request(context.app)
      .get(`/api/evidence/${evidenceId}`)
      .set("Cookie", context.organizerCookie);
    assert.equal(summary.status, 200);
    assert.equal(summary.body.evidence.evidenceStatus, "READY_FOR_REVIEW");
    assert.equal(summary.body.evidence.screeningStatus, "FLAGGED");
    assert.equal(summary.body.evidence.flags[0].code, "AMOUNT_MISMATCH");
    assert.equal("extractedText" in summary.body.evidence, false);
    assert.equal("storageKey" in summary.body.evidence, false);
    assert.equal(JSON.stringify(summary.body).includes("private full OCR result"), false);
    const funderSummary = await request(context.app)
      .get(`/api/evidence/${evidenceId}`)
      .set("Cookie", context.funderCookie);
    assert.equal(funderSummary.status, 200);
    assert.equal(funderSummary.body.evidence.evidenceStatus, "READY_FOR_REVIEW");
    assert.equal("screeningStatus" in funderSummary.body.evidence, false);
    assert.equal("flags" in funderSummary.body.evidence, false);
    assert.equal("fileName" in funderSummary.body.evidence, false);
    assert.equal("rawHash" in funderSummary.body.evidence, false);
    const unrelated = await request(context.app)
      .get(`/api/evidence/${evidenceId}`)
      .set("Cookie", context.otherOrganizerCookie);
    assert.equal(unrelated.status, 404);
  } finally {
    await context.cleanup();
  }
});

test("Admin can retry failed OCR only before review opens and cannot read full OCR", async () => {
  const context = await createTestContext();
  try {
    const upload = await uploadEvidence(context);
    assert.equal(upload.status, 201);
    const evidenceId = upload.body.evidence.id;
    await failQueuedOcr(context, evidenceId);

    const adminDetail = await request(context.app)
      .get(`/api/evidence/${evidenceId}/ocr`)
      .set("Cookie", context.adminCookie);
    assert.equal(adminDetail.status, 403);

    const missingOrigin = await request(context.app)
      .post(`/api/admin/evidence/${evidenceId}/ocr-retry`)
      .set("Cookie", context.adminCookie);
    assert.equal(missingOrigin.status, 403);

    const organizerRetry = await request(context.app)
      .post(`/api/admin/evidence/${evidenceId}/ocr-retry`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie);
    assert.equal(organizerRetry.status, 403);

    const retry = await request(context.app)
      .post(`/api/admin/evidence/${evidenceId}/ocr-retry`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.adminCookie);
    assert.equal(retry.status, 202);
    assert.equal(retry.body.runNumber, 2);
    assert.equal(retry.body.screeningStatus, "PROCESSING");

    const stillDenied = await request(context.app)
      .get(`/api/evidence/${evidenceId}/ocr`)
      .set("Cookie", context.adminCookie);
    assert.equal(stillDenied.status, 403);

    const duplicateRetry = await request(context.app)
      .post(`/api/admin/evidence/${evidenceId}/ocr-retry`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.adminCookie);
    assert.equal(duplicateRetry.status, 409);
    assert.deepEqual(duplicateRetry.body, { error: "ocr_already_processing" });
  } finally {
    await context.cleanup();
  }
});
