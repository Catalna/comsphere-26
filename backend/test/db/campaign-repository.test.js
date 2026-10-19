import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";

import { runMigrations } from "../../src/db/migrate.js";
import { createAuthRepository } from "../../src/repositories/authRepository.js";
import { createCampaignRepository } from "../../src/repositories/campaignRepository.js";

async function makeContext() {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const auth = createAuthRepository(pool);
  const campaigns = createCampaignRepository(pool);
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
  assert.equal(funder.role, "FUNDER");
  assert.equal(funder.status, "ACTIVE");
  return { pool, campaigns, admin: admin.user, organizer: organizer.user, otherOrganizer: otherOrganizer.user, funder };
}

test("Organizer creates a draft Campaign scoped to their Organization and assigned Funder", async () => {
  const context = await makeContext();
  try {
    const campaign = await context.campaigns.createCampaign({
      actor: context.organizer,
      funderId: context.funder.id,
      title: "School Renovation",
      description: "Renovation milestones",
      totalBudget: "100000.00",
      currency: "IDR",
      fundingMode: "EXTERNAL_TRACKING",
    });

    assert.equal(campaign.organizationId, context.organizer.organizationId);
    assert.equal(campaign.funderId, context.funder.id);
    assert.equal(campaign.status, "DRAFT");
    assert.equal(campaign.title, "School Renovation");
  } finally {
    await context.pool.end();
  }
});

test("Campaign listing is scoped to the Organizer Organization and assigned Funder", async () => {
  const context = await makeContext();
  try {
    const campaign = await context.campaigns.createCampaign({
      actor: context.organizer,
      funderId: context.funder.id,
      title: "School Renovation",
      description: "Renovation milestones",
      totalBudget: "100000.00",
      currency: "IDR",
      fundingMode: "EXTERNAL_TRACKING",
    });

    assert.deepEqual((await context.campaigns.listCampaignsForUser(context.organizer)).map(({ id }) => id), [campaign.id]);
    assert.deepEqual((await context.campaigns.listCampaignsForUser(context.funder)).map(({ id }) => id), [campaign.id]);
    assert.deepEqual(await context.campaigns.listCampaignsForUser(context.otherOrganizer), []);
    assert.deepEqual((await context.campaigns.listCampaignsForUser(context.admin)).map(({ id }) => id), [campaign.id]);
  } finally {
    await context.pool.end();
  }
});

test("Funder activates a Campaign and Organizer progresses Milestones within its budget", async () => {
  const context = await makeContext();
  try {
    const campaign = await context.campaigns.createCampaign({
      actor: context.organizer,
      funderId: context.funder.id,
      title: "School Renovation",
      description: "Renovation milestones",
      totalBudget: "100000.00",
      currency: "IDR",
      fundingMode: "EXTERNAL_TRACKING",
    });
    const milestone = await context.campaigns.createMilestone({
      actor: context.organizer,
      campaignId: campaign.id,
      title: "Buy materials",
      description: "Purchase construction materials",
      budgetAmount: "60000.00",
      currency: "IDR",
      orderIndex: 0,
    });
    assert.equal(milestone.status, "PLANNED");
    await assert.rejects(context.campaigns.createMilestone({
      actor: context.organizer,
      campaignId: campaign.id,
      title: "Construction",
      description: "Build classrooms",
      budgetAmount: "50000.00",
      currency: "IDR",
      orderIndex: 1,
    }));

    const activated = await context.campaigns.activateCampaign({ actor: context.funder, campaignId: campaign.id });
    assert.equal(activated.status, "ACTIVE");
    const inProgress = await context.campaigns.updateMilestoneStatus({
      actor: context.organizer,
      milestoneId: milestone.id,
      status: "IN_PROGRESS",
    });
    assert.equal(inProgress.status, "IN_PROGRESS");
    const completed = await context.campaigns.updateMilestoneStatus({
      actor: context.organizer,
      milestoneId: milestone.id,
      status: "COMPLETED",
    });
    assert.equal(completed.status, "COMPLETED");
  } finally {
    await context.pool.end();
  }
});

test("Campaign detail is hidden from unrelated Organizations", async () => {
  const context = await makeContext();
  try {
    const campaign = await context.campaigns.createCampaign({
      actor: context.organizer,
      funderId: context.funder.id,
      title: "School Renovation",
      description: "Renovation milestones",
      totalBudget: "100000.00",
      currency: "IDR",
    });

    assert.equal((await context.campaigns.getCampaignForUser(context.organizer, campaign.id)).id, campaign.id);
    assert.equal((await context.campaigns.getCampaignForUser(context.funder, campaign.id)).id, campaign.id);
    assert.equal(await context.campaigns.getCampaignForUser(context.otherOrganizer, campaign.id), null);
    assert.equal((await context.campaigns.getCampaignForUser(context.admin, campaign.id)).id, campaign.id);
  } finally {
    await context.pool.end();
  }
});

test("only the owning Organizer can update a Campaign while it is DRAFT", async () => {
  const context = await makeContext();
  try {
    const campaign = await context.campaigns.createCampaign({
      actor: context.organizer,
      funderId: context.funder.id,
      title: "School Renovation",
      description: "Renovation milestones",
      totalBudget: "100000.00",
      currency: "IDR",
    });

    const updated = await context.campaigns.updateCampaignDraft({
      actor: context.organizer,
      campaignId: campaign.id,
      patch: { title: "School Renovation Phase One", totalBudget: "90000.00" },
    });
    assert.equal(updated.title, "School Renovation Phase One");
    assert.equal(updated.totalBudget, "90000.00");
    await assert.rejects(
      context.campaigns.updateCampaignDraft({ actor: context.otherOrganizer, campaignId: campaign.id, patch: { title: "Hijack" } }),
      { code: "CAMPAIGN_NOT_FOUND" },
    );
  } finally {
    await context.pool.end();
  }
});

test("Milestone listing checks Campaign access before returning private records", async () => {
  const context = await makeContext();
  try {
    const campaign = await context.campaigns.createCampaign({
      actor: context.organizer,
      funderId: context.funder.id,
      title: "School Renovation",
      description: "Renovation milestones",
      totalBudget: "100000.00",
      currency: "IDR",
    });
    const milestone = await context.campaigns.createMilestone({
      actor: context.organizer,
      campaignId: campaign.id,
      title: "Buy materials",
      description: "Purchase construction materials",
      budgetAmount: "60000.00",
      currency: "IDR",
      orderIndex: 0,
    });

    assert.deepEqual((await context.campaigns.listMilestonesForCampaign(context.organizer, campaign.id)).map(({ id }) => id), [milestone.id]);
    assert.equal(await context.campaigns.listMilestonesForCampaign(context.otherOrganizer, campaign.id), null);
  } finally {
    await context.pool.end();
  }
});

test("Milestone currency must match the Campaign currency", async () => {
  const context = await makeContext();
  try {
    const campaign = await context.campaigns.createCampaign({
      actor: context.organizer,
      funderId: context.funder.id,
      title: "School Renovation",
      description: "Renovation milestones",
      totalBudget: "100000.00",
      currency: "IDR",
    });

    await assert.rejects(context.campaigns.createMilestone({
      actor: context.organizer,
      campaignId: campaign.id,
      title: "Buy materials",
      description: "Purchase construction materials",
      budgetAmount: "100.00",
      currency: "USD",
      orderIndex: 0,
    }), { code: "CURRENCY_MISMATCH" });
  } finally {
    await context.pool.end();
  }
});
