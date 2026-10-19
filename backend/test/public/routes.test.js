import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { newDb } from "pg-mem";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { createCampaignRepository } from "../../src/repositories/campaignRepository.js";
import { createSessionToken } from "../../src/auth/sessionTokens.js";
import { createAuthRepository } from "../../src/repositories/authRepository.js";
import { runMigrations } from "../../src/db/migrate.js";

const WEB_ORIGIN = "http://localhost:3000";
const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const FUNDER_ORG_ID = "77777777-7777-4777-8777-777777777777";
const MILESTONE_ONE_ID = "88888888-8888-4888-8888-888888888888";
const MILESTONE_TWO_ID = "99999999-9999-4999-8999-999999999999";
const RAW_HASH = "a".repeat(64);
const FUNDER_ID = "44444444-4444-4444-8444-444444444444";
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const ORGANIZER_ID = "66666666-6666-4666-8666-666666666666";

async function createFixture() {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  memoryDb.public.registerFunction({ name: "lower", args: ["text"], returns: "text", implementation: (value) => String(value).toLowerCase() });
  memoryDb.public.registerFunction({ name: "upper", args: ["text"], returns: "text", implementation: (value) => String(value).toUpperCase() });
  memoryDb.public.registerFunction({ name: "gen_random_uuid", args: [], returns: "uuid", implementation: () => randomUUID() });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);

  await pool.query(
    `INSERT INTO organizations (id, name, type, verified, created_at, updated_at)
     VALUES ($1, 'Lembaga Demo', 'NGO', TRUE, NOW(), NOW()),
            ($2, 'Yayasan Pendana', 'COMPANY', TRUE, NOW(), NOW())`,
    [ORG_ID, FUNDER_ORG_ID],
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, status, created_at, updated_at)
     VALUES ($1, NULL, 'Admin Demo', 'admin@example.test', 'x', 'ADMIN', 'ACTIVE', NOW(), NOW())`,
    [ADMIN_ID],
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, status, created_at, updated_at)
     VALUES ($1, $2, 'Organizer Demo', 'organizer@example.test', 'x', 'ORGANIZER', 'ACTIVE', NOW(), NOW())`,
    [ORGANIZER_ID, ORG_ID],
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, status, created_at, updated_at)
     VALUES ($1, $2, 'Funder Demo', 'funder@example.test', 'x', 'FUNDER', 'ACTIVE', NOW(), NOW())`,
    [FUNDER_ID, FUNDER_ORG_ID],
  );
  const campaigns = [
    { id: CAMPAIGN_ID, title: "Renovasi SD Harapan", milestoneId: MILESTONE_ONE_ID, orderIndex: 0 },
    { id: OTHER_CAMPAIGN_ID, title: "Program Kedua", milestoneId: MILESTONE_TWO_ID, orderIndex: 1 },
  ];
  for (const campaign of campaigns) {
    await pool.query(
      `INSERT INTO campaigns (id, organization_id, funder_id, title, description, total_budget, currency, funding_mode, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Deskripsi program', 100000000.00, 'IDR', 'EXTERNAL_TRACKING', 'ACTIVE', NOW(), NOW())`,
      [campaign.id, ORG_ID, FUNDER_ID, campaign.title],
    );
    await pool.query(
      `INSERT INTO milestones (id, campaign_id, title, description, budget_amount, currency, order_index, status, created_at, updated_at)
       VALUES ($1, $2, 'Pembelian material', 'Material utama', 60000000.00, 'IDR', $3, 'COMPLETED', NOW(), NOW())`,
      [campaign.milestoneId, campaign.id, campaign.orderIndex],
    );
  }
  return { pool, campaignRepository: createCampaignRepository(pool) };
}

async function createAuthedApp(pool, campaignRepository, { userId = ADMIN_ID, role = "ADMIN" } = {}) {
  const authRepository = createAuthRepository(pool);
  const { token } = createSessionToken();
  await authRepository.createSession({ userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) });
  return {
    app: createApp({
      authRepository,
      campaignRepository,
      authService: { async loadSessionUser(value) { return value === token ? { id: userId, role, status: "ACTIVE" } : null; } },
      webOrigin: WEB_ORIGIN,
    }),
    cookie: `dt_session=${token}`,
  };
}

test("campaign publication is Admin-only and defaults to private", async () => {
  const { pool, campaignRepository } = await createFixture();
  try {
    const admin = await createAuthedApp(pool, campaignRepository);
    const app = admin.app;
    const adminCookie = admin.cookie;

    const listedBefore = await request(app).get("/api/public/campaigns");
    assert.equal(listedBefore.status, 200);
    assert.deepEqual(listedBefore.body.campaigns, []);

    const adminCampaigns = await request(app)
      .get("/api/admin/campaigns")
      .set("Cookie", adminCookie);
    assert.equal(adminCampaigns.status, 200);
    assert.equal(adminCampaigns.body.campaigns.length, 2);
    assert.deepEqual(adminCampaigns.body.campaigns.map(({ title, published }) => ({ title, published })), [
      { title: "Program Kedua", published: false },
      { title: "Renovasi SD Harapan", published: false },
    ]);
    const anonymousAdminList = await request(app).get("/api/admin/campaigns");
    assert.equal(anonymousAdminList.status, 401);

    const anonymousWithoutOrigin = await request(app)
      .patch(`/api/admin/campaigns/${CAMPAIGN_ID}/publication`)
      .send({ published: true });
    assert.equal(anonymousWithoutOrigin.status, 403);

    const anonymousWithoutSession = await request(app)
      .patch(`/api/admin/campaigns/${CAMPAIGN_ID}/publication`)
      .set("Origin", WEB_ORIGIN)
      .send({ published: true });
    assert.equal(anonymousWithoutSession.status, 401);

    const invalidPublication = await request(app)
      .patch(`/api/admin/campaigns/${CAMPAIGN_ID}/publication`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ published: "yes" });
    assert.equal(invalidPublication.status, 400);

    const missingCampaign = await request(app)
      .patch(`/api/admin/campaigns/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/publication`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ published: true });
    assert.equal(missingCampaign.status, 404);

    const organizer = await createAuthedApp(pool, campaignRepository, { userId: ORGANIZER_ID, role: "ORGANIZER" });
    const forbidden = await request(organizer.app)
      .patch(`/api/admin/campaigns/${CAMPAIGN_ID}/publication`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", organizer.cookie)
      .send({ published: true });
    assert.equal(forbidden.status, 403);
    assert.equal((await request(app).get("/api/public/campaigns")).body.campaigns.length, 0);

    const published = await request(app)
      .patch(`/api/admin/campaigns/${CAMPAIGN_ID}/publication`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ published: true });
    assert.equal(published.status, 200);
    assert.equal(published.body.campaign.published, true);

    const listedAfter = await request(app).get("/api/public/campaigns");
    assert.equal(listedAfter.status, 200);
    assert.equal(listedAfter.body.campaigns.length, 1);
    const [publishedCampaign] = listedAfter.body.campaigns;
    assert.equal(publishedCampaign.title, "Renovasi SD Harapan");
    assert.equal(publishedCampaign.milestones.length, 1);
    assert.equal(JSON.stringify(publishedCampaign).includes("funder@example.test"), false);
    assert.equal(JSON.stringify(publishedCampaign).includes("funderId"), false);
    assert.equal(JSON.stringify(publishedCampaign).includes("organizationId"), false);

    const hiddenByDirectId = await request(app).get(`/api/public/campaigns/${OTHER_CAMPAIGN_ID}`);
    assert.equal(hiddenByDirectId.status, 404);

    const visibleByDirectId = await request(app).get(`/api/public/campaigns/${CAMPAIGN_ID}`);
    assert.equal(visibleByDirectId.status, 200);

    const unpublished = await request(app)
      .patch(`/api/admin/campaigns/${CAMPAIGN_ID}/publication`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ published: false });
    assert.equal(unpublished.status, 200);
    assert.equal(unpublished.body.campaign.published, false);
    assert.deepEqual((await request(app).get("/api/public/campaigns")).body.campaigns, []);
  } finally {
    await pool.end();
  }
});

test("public campaign projection never exposes evidence, payment, or account fields", async () => {
  const { pool, campaignRepository } = await createFixture();
  try {
    const admin = await createAuthedApp(pool, campaignRepository);
    await request(admin.app)
      .patch(`/api/admin/campaigns/${CAMPAIGN_ID}/publication`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", admin.cookie)
      .send({ published: true });
    await pool.query(
      `INSERT INTO evidence (id, milestone_id, uploader_id, evidence_type, storage_key, file_name, content_type, file_size, raw_hash, version_group_id, version, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'RECEIPT', gen_random_uuid(), 'rahasia-receipt.pdf', 'application/pdf', 1024, $3, gen_random_uuid(), 1, 'READY_FOR_REVIEW', NOW(), NOW())`,
      [MILESTONE_ONE_ID, ORGANIZER_ID, RAW_HASH],
    );
    const response = await request(admin.app).get("/api/public/campaigns");
    const serialized = JSON.stringify(response.body);
    for (const forbidden of ["rahasia-receipt.pdf", "rawHash", "storageKey", "revisionInstructions", "internalNotes", "funder@example.test", "organizer@example.test", "email_normalized"]) {
      assert.equal(serialized.includes(forbidden), false, `public payload leaked ${forbidden}`);
    }
    const campaign = response.body.campaigns[0];
    assert.deepEqual(Object.keys(campaign).sort(), ["campaignId", "currency", "evidenceTotal", "milestones", "proofs", "status", "title", "totalBudget", "verifiedEvidenceCount"]);
    assert.deepEqual(Object.keys(campaign.milestones[0]).sort(), ["budgetAmount", "milestoneId", "status", "title", "verification"]);
    assert.deepEqual(campaign.milestones[0].verification, { total: 1, verified: 0, needsRevision: 0, rejected: 0, pending: 1 });
  } finally {
    await pool.end();
  }
});
