import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import request from "supertest";
import { newDb } from "pg-mem";

import { createSessionToken } from "../../src/auth/sessionTokens.js";
import { createApp } from "../../src/app.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createAuthRepository } from "../../src/repositories/authRepository.js";
import { createCampaignRepository } from "../../src/repositories/campaignRepository.js";

const WEB_ORIGIN = "http://localhost:3000";
const SESSION_EXPIRES_AT = new Date("2030-01-01T00:00:00.000Z");

async function createUser(auth, { name, email, organizationName, organizationType }) {
  return (await auth.registerOrganizer({
    name,
    email,
    passwordHash: "test-only-password-hash",
    organizationName,
    organizationType,
    sessionTokenHash: createHash("sha256").update(email).digest("hex"),
    sessionExpiresAt: SESSION_EXPIRES_AT,
  })).user;
}

async function cookieFor(auth, user) {
  const { token, tokenHash } = createSessionToken();
  await auth.createSession({ userId: user.id, tokenHash, expiresAt: SESSION_EXPIRES_AT });
  return `dt_session=${token}`;
}

async function createTestContext() {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);
  const auth = createAuthRepository(pool);
  const campaigns = createCampaignRepository(pool);
  const adminAccount = await auth.createFirstAdmin({ name: "System Admin", email: "admin@example.com", passwordHash: "test-only-hash" });
  const organizer = await createUser(auth, {
    name: "Organizer One", email: "organizer@example.com", organizationName: "Community One", organizationType: "COMMUNITY",
  });
  const otherOrganizer = await createUser(auth, {
    name: "Organizer Two", email: "other@example.com", organizationName: "Community Two", organizationType: "COMMUNITY",
  });
  const funderCandidate = await createUser(auth, {
    name: "Funder One", email: "funder@example.com", organizationName: "Foundation One", organizationType: "COMPANY",
  });
  await auth.assignRoleAndAudit({ actorUserId: adminAccount.user.id, targetUserId: funderCandidate.id, role: "FUNDER" });
  const funder = await auth.findUserByEmail("funder@example.com");
  const adminCookie = await cookieFor(auth, adminAccount.user);
  const organizerCookie = await cookieFor(auth, organizer);
  const otherOrganizerCookie = await cookieFor(auth, otherOrganizer);
  const funderCookie = await cookieFor(auth, funder);
  return {
    app: createApp({ authRepository: auth, campaignRepository: campaigns, webOrigin: WEB_ORIGIN, nodeEnv: "test" }),
    pool, organizer, otherOrganizer, funder, adminCookie, organizerCookie, otherOrganizerCookie, funderCookie,
  };
}

const campaignInput = {
  funderId: "",
  title: "Renovasi SD Harapan",
  description: "Perbaikan ruang belajar",
  totalBudget: "100000000.00",
  currency: "IDR",
  fundingMode: "EXTERNAL_TRACKING",
};

test("Organizer creates a draft Campaign and only related roles can read it", async () => {
  const context = await createTestContext();
  try {
    const created = await request(context.app)
      .post("/api/campaigns")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ ...campaignInput, funderId: context.funder.id });
    assert.equal(created.status, 201);
    assert.equal(created.body.campaign.status, "DRAFT");
    assert.equal(created.body.campaign.organizationId, context.organizer.organizationId);

    const ownerList = await request(context.app).get("/api/campaigns").set("Cookie", context.organizerCookie);
    const unrelatedList = await request(context.app).get("/api/campaigns").set("Cookie", context.otherOrganizerCookie);
    const funderList = await request(context.app).get("/api/campaigns").set("Cookie", context.funderCookie);
    const unrelatedDetail = await request(context.app)
      .get(`/api/campaigns/${created.body.campaign.id}`)
      .set("Cookie", context.otherOrganizerCookie);
    assert.equal(ownerList.body.campaigns.length, 1);
    assert.equal(unrelatedList.body.campaigns.length, 0);
    assert.equal(funderList.body.campaigns.length, 1);
    assert.equal(unrelatedDetail.status, 404);
  } finally {
    await context.pool.end();
  }
});

test("Organizer can select an active Funder without receiving other user secrets", async () => {
  const context = await createTestContext();
  try {
    const response = await request(context.app)
      .get("/api/funders")
      .set("Cookie", context.organizerCookie);
    assert.equal(response.status, 200);
    assert.equal(response.body.funders.length, 1);
    assert.deepEqual(Object.keys(response.body.funders[0]).sort(), ["id", "name", "organization", "organizationId"]);
    assert.equal(response.body.funders[0].id, context.funder.id);
    assert.equal("email" in response.body.funders[0], false);
    assert.equal("passwordHash" in response.body.funders[0], false);

    const unauthenticated = await request(context.app).get("/api/funders");
    assert.equal(unauthenticated.status, 401);
  } finally {
    await context.pool.end();
  }
});

test("Funder activates only after milestones exist; Organizer progresses an active milestone", async () => {
  const context = await createTestContext();
  try {
    const created = await request(context.app)
      .post("/api/campaigns")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ ...campaignInput, funderId: context.funder.id });
    assert.equal(created.status, 201);
    const campaignId = created.body.campaign.id;

    const prematureActivation = await request(context.app)
      .post(`/api/campaigns/${campaignId}/activate`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.funderCookie);
    assert.equal(prematureActivation.status, 409);
    assert.deepEqual(prematureActivation.body, { error: "milestones_required" });

    const milestone = await request(context.app)
      .post(`/api/campaigns/${campaignId}/milestones`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ title: "Pembelian material", description: "Material utama", budgetAmount: "60000000.00", currency: "IDR", orderIndex: 0 });
    assert.equal(milestone.status, 201);
    assert.equal(milestone.body.milestone.status, "PLANNED");

    const organizerActivation = await request(context.app)
      .post(`/api/campaigns/${campaignId}/activate`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie);
    assert.equal(organizerActivation.status, 403);

    const activation = await request(context.app)
      .post(`/api/campaigns/${campaignId}/activate`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.funderCookie);
    assert.equal(activation.status, 200);
    assert.equal(activation.body.campaign.status, "ACTIVE");

    const progress = await request(context.app)
      .patch(`/api/milestones/${milestone.body.milestone.id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ status: "IN_PROGRESS" });
    assert.equal(progress.status, 200);
    assert.equal(progress.body.milestone.status, "IN_PROGRESS");

    const completed = await request(context.app)
      .patch(`/api/milestones/${milestone.body.milestone.id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ status: "COMPLETED" });
    assert.equal(completed.status, 200);
    const auditBefore = await context.pool.query("SELECT id FROM audit_logs WHERE entity_id = $1", [milestone.body.milestone.id]);

    const invalidReverse = await request(context.app)
      .patch(`/api/milestones/${milestone.body.milestone.id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ status: "IN_PROGRESS" });
    assert.equal(invalidReverse.status, 400);
    assert.deepEqual(invalidReverse.body, { error: "invalid_transition" });

    const milestoneList = await request(context.app)
      .get(`/api/campaigns/${campaignId}/milestones`)
      .set("Cookie", context.organizerCookie);
    assert.equal(milestoneList.body.milestones[0].status, "COMPLETED");
    const auditAfter = await context.pool.query("SELECT id FROM audit_logs WHERE entity_id = $1", [milestone.body.milestone.id]);
    assert.equal(auditAfter.rowCount, auditBefore.rowCount);
  } finally {
    await context.pool.end();
  }
});

test("Campaign creation rejects client-selected organizations and invalid budget assignments", async () => {
  const context = await createTestContext();
  try {
    const roleInjection = await request(context.app)
      .post("/api/campaigns")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ ...campaignInput, funderId: context.funder.id, organizationId: context.otherOrganizer.organizationId });
    assert.equal(roleInjection.status, 400);
    assert.deepEqual(roleInjection.body, { error: "invalid_request" });

    const nonFunder = await request(context.app)
      .post("/api/campaigns")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ ...campaignInput, funderId: context.otherOrganizer.id });
    assert.equal(nonFunder.status, 400);

    const malformedBudget = await request(context.app)
      .post("/api/campaigns")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ ...campaignInput, funderId: context.funder.id, totalBudget: "0.00" });
    assert.equal(malformedBudget.status, 400);

    const unauthenticated = await request(context.app)
      .post("/api/campaigns")
      .set("Origin", WEB_ORIGIN)
      .send({ ...campaignInput, funderId: context.funder.id });
    assert.equal(unauthenticated.status, 401);
  } finally {
    await context.pool.end();
  }
});

test("Organizer can update only their own draft Campaign with exact allowed fields", async () => {
  const context = await createTestContext();
  try {
    const created = await request(context.app)
      .post("/api/campaigns")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ ...campaignInput, funderId: context.funder.id });
    assert.equal(created.status, 201);

    const updated = await request(context.app)
      .patch(`/api/campaigns/${created.body.campaign.id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ title: "Renovasi SD Harapan Tahap Satu" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.campaign.title, "Renovasi SD Harapan Tahap Satu");

    const crossOrganization = await request(context.app)
      .patch(`/api/campaigns/${created.body.campaign.id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.otherOrganizerCookie)
      .send({ title: "Hijack" });
    assert.equal(crossOrganization.status, 404);

    const roleInjection = await request(context.app)
      .patch(`/api/campaigns/${created.body.campaign.id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ organizationId: context.otherOrganizer.organizationId });
    assert.equal(roleInjection.status, 400);
  } finally {
    await context.pool.end();
  }
});

test("Campaign date updates cannot create an end date before its start date", async () => {
  const context = await createTestContext();
  try {
    const created = await request(context.app)
      .post("/api/campaigns")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ ...campaignInput, funderId: context.funder.id, startDate: "2026-10-10", endDate: "2026-11-10" });
    assert.equal(created.status, 201);

    const invalidUpdate = await request(context.app)
      .patch(`/api/campaigns/${created.body.campaign.id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ endDate: "2026-10-01" });
    assert.equal(invalidUpdate.status, 400);
    assert.deepEqual(invalidUpdate.body, { error: "invalid_request" });

    const unchanged = await request(context.app)
      .get(`/api/campaigns/${created.body.campaign.id}`)
      .set("Cookie", context.organizerCookie);
    assert.equal(unchanged.body.campaign.endDate, "2026-11-10");
  } finally {
    await context.pool.end();
  }
});

test("Milestone budgets cannot exceed the Campaign total through the API", async () => {
  const context = await createTestContext();
  try {
    const created = await request(context.app)
      .post("/api/campaigns")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ ...campaignInput, funderId: context.funder.id, totalBudget: "100000000.00" });
    assert.equal(created.status, 201);

    const first = await request(context.app)
      .post(`/api/campaigns/${created.body.campaign.id}/milestones`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ title: "Material", budgetAmount: "60000000.00", currency: "IDR", orderIndex: 0 });
    assert.equal(first.status, 201);

    const overBudget = await request(context.app)
      .post(`/api/campaigns/${created.body.campaign.id}/milestones`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", context.organizerCookie)
      .send({ title: "Construction", budgetAmount: "50000000.00", currency: "IDR", orderIndex: 1 });
    assert.equal(overBudget.status, 400);
    assert.deepEqual(overBudget.body, { error: "invalid_request" });
  } finally {
    await context.pool.end();
  }
});
