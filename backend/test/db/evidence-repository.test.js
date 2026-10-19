import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { newDb } from "pg-mem";

import { runMigrations } from "../../src/db/migrate.js";
import { createAuthRepository } from "../../src/repositories/authRepository.js";
import { createCampaignRepository } from "../../src/repositories/campaignRepository.js";
import { createEvidenceRepository } from "../../src/repositories/evidenceRepository.js";

async function makeContext() {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const auth = createAuthRepository(pool);
  const campaigns = createCampaignRepository(pool);
  const evidence = createEvidenceRepository(pool);
  const admin = await auth.createFirstAdmin({ name: "System Admin", email: "admin@example.com", passwordHash: "hash" });
  const organizer = await auth.registerOrganizer({
    name: "Organizer One", email: "organizer@example.com", passwordHash: "hash",
    organizationName: "Community One", organizationType: "COMMUNITY",
    sessionTokenHash: "a".repeat(64), sessionExpiresAt: new Date("2030-01-01T00:00:00Z"),
  });
  const otherOrganizer = await auth.registerOrganizer({
    name: "Organizer Two", email: "other@example.com", passwordHash: "hash",
    organizationName: "Community Two", organizationType: "COMMUNITY",
    sessionTokenHash: "b".repeat(64), sessionExpiresAt: new Date("2030-01-01T00:00:00Z"),
  });
  const funderCandidate = await auth.registerOrganizer({
    name: "Funder One", email: "funder@example.com", passwordHash: "hash",
    organizationName: "Foundation One", organizationType: "COMPANY",
    sessionTokenHash: "c".repeat(64), sessionExpiresAt: new Date("2030-01-01T00:00:00Z"),
  });
  await auth.assignRoleAndAudit({ actorUserId: admin.user.id, targetUserId: funderCandidate.user.id, role: "FUNDER" });
  const funder = await auth.findUserByEmail("funder@example.com");
  const campaign = await campaigns.createCampaign({
    actor: organizer.user, funderId: funder.id, title: "School Renovation", description: "Evidence test",
    totalBudget: "100000.00", currency: "IDR",
  });
  const milestone = await campaigns.createMilestone({
    actor: organizer.user, campaignId: campaign.id, title: "Buy materials", description: "Receipts",
    budgetAmount: "100000.00", currency: "IDR", orderIndex: 0,
  });
  return { pool, auth, campaigns, evidence, admin: admin.user, organizer: organizer.user, otherOrganizer: otherOrganizer.user, funder, campaign, milestone };
}

function uploadInput(actor, context, overrides = {}) {
  const bytes = Buffer.from("%PDF-1.7\nprivate receipt fixture");
  return {
    actor,
    milestoneId: context.milestone.id,
    evidenceType: "RECEIPT",
    storageKey: "3f920481-d870-40dc-8b33-0fa34b00d799",
    fileName: "receipt.pdf",
    contentType: "application/pdf",
    fileSize: bytes.length,
    rawHash: createHash("sha256").update(bytes).digest("hex"),
    ...overrides,
  };
}

test("Organizer upload creates an immutable private Evidence version and audit row", async () => {
  const context = await makeContext();
  try {
    await context.campaigns.activateCampaign({ actor: context.funder, campaignId: context.campaign.id });
    await context.campaigns.updateMilestoneStatus({ actor: context.organizer, milestoneId: context.milestone.id, status: "IN_PROGRESS" });
    const created = await context.evidence.createEvidence(uploadInput(context.organizer, context));

    assert.equal(created.milestoneId, context.milestone.id);
    assert.equal(created.uploaderId, context.organizer.id);
    assert.equal(created.version, 1);
    assert.equal(created.previousEvidenceId, null);
    assert.equal(created.status, "PROCESSING");
    assert.equal(created.evidenceStatus, "PROCESSING");
    assert.equal(created.screeningStatus, "PROCESSING");
    assert.equal("storageKey" in created, false);
    const audit = await context.pool.query("SELECT action FROM audit_logs WHERE entity_id = $1", [created.id]);
    assert.equal(audit.rows[0].action, "EVIDENCE_UPLOADED");
    const runs = await context.pool.query("SELECT id, run_number, screening_status FROM ocr_runs WHERE evidence_id = $1", [created.id]);
    assert.deepEqual(runs.rows.map(({ run_number, screening_status }) => ({ run_number, screening_status })), [{ run_number: 1, screening_status: "PROCESSING" }]);
    const jobs = await context.pool.query("SELECT state, attempt_count FROM ocr_jobs WHERE ocr_run_id = $1", [runs.rows[0].id]);
    assert.deepEqual(jobs.rows, [{ state: "QUEUED", attempt_count: 0 }]);
    const queueAudit = await context.pool.query("SELECT action FROM audit_logs WHERE entity_type = 'OCR_RUN' AND entity_id = $1", [runs.rows[0].id]);
    assert.deepEqual(queueAudit.rows, [{ action: "OCR_JOB_QUEUED" }]);
  } finally {
    await context.pool.end();
  }
});

test("Evidence summaries are scoped to Campaign participants while source objects require Verifier assignment", async () => {
  const context = await makeContext();
  try {
    await context.campaigns.activateCampaign({ actor: context.funder, campaignId: context.campaign.id });
    await context.campaigns.updateMilestoneStatus({ actor: context.organizer, milestoneId: context.milestone.id, status: "IN_PROGRESS" });
    const evidence = await context.evidence.createEvidence(uploadInput(context.organizer, context));

    assert.equal((await context.evidence.listForMilestone(context.organizer, context.milestone.id)).length, 1);
    assert.equal((await context.evidence.listForMilestone(context.funder, context.milestone.id)).length, 1);
    assert.equal(await context.evidence.listForMilestone(context.otherOrganizer, context.milestone.id), null);
    assert.equal("storageKey" in await context.evidence.findEvidenceForUser(context.funder, evidence.id), false);
    await assert.rejects(context.evidence.findStoredObjectForAssignedVerifier(context.funder, evidence.id), { code: "FORBIDDEN" });
    assert.equal(await context.evidence.findStoredObjectForAssignedVerifier({ id: randomUUID(), role: "VERIFIER" }, evidence.id), null);
    assert.equal(await context.evidence.findEvidenceForUser(context.otherOrganizer, evidence.id), null);
  } finally {
    await context.pool.end();
  }
});

test("Evidence cannot be uploaded before Campaign activation and Milestone progress", async () => {
  const context = await makeContext();
  try {
    await assert.rejects(context.evidence.createEvidence(uploadInput(context.organizer, context)), { code: "MILESTONE_NOT_IN_PROGRESS" });
    await context.campaigns.activateCampaign({ actor: context.funder, campaignId: context.campaign.id });
    await assert.rejects(context.evidence.createEvidence(uploadInput(context.organizer, context)), { code: "MILESTONE_NOT_IN_PROGRESS" });
  } finally {
    await context.pool.end();
  }
});

test("evidence repository rejects non-hex SHA-256 values", async () => {
  const context = await makeContext();
  try {
    await assert.rejects(
      context.evidence.createEvidence(uploadInput(context.organizer, context, { rawHash: "g".repeat(64) })),
      { code: "INVALID_EVIDENCE" },
    );
  } finally {
    await context.pool.end();
  }
});
