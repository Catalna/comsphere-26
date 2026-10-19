import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

import { createProofRouter } from "../../src/routes/proofs.js";

const WEB_ORIGIN = "http://localhost:3000";
const EVIDENCE_ID = "1b6f8e20-9c1a-4c1e-8e2b-3f5a6b7c8d90";
const PROOF_ID = `0x${"12".repeat(32)}`;
const ORGANIZER_ORG = "3b6f8e20-9c1a-4c1e-8e2b-3f5a6b7c8d90";
const FUNDER_ID = "4b6f8e20-9c1a-4c1e-8e2b-3f5a6b7c8d90";

const users = {
  admin: { id: "admin-1", role: "ADMIN", status: "ACTIVE" },
  organizer: { id: "org-user-1", role: "ORGANIZER", status: "ACTIVE", organizationId: ORGANIZER_ORG },
  otherOrganizer: { id: "org-user-2", role: "ORGANIZER", status: "ACTIVE", organizationId: "999f8e20-9c1a-4c1e-8e2b-3f5a6b7c8d90" },
  funder: { id: FUNDER_ID, role: "FUNDER", status: "ACTIVE" },
  verifier: { id: "verifier-1", role: "VERIFIER", status: "ACTIVE" },
};

const PROOF = {
  proofId: PROOF_ID,
  proofVersion: 1,
  evidenceId: EVIDENCE_ID,
  campaignId: "5b6f8e20-9c1a-4c1e-8e2b-3f5a6b7c8d90",
  milestoneId: "6b6f8e20-9c1a-4c1e-8e2b-3f5a6b7c8d90",
  packageHash: `${"12".repeat(32)}`,
  status: "ANCHORED",
  contractAddress: `0x${"c".repeat(40)}`,
  transactionHash: `0x${"ab".repeat(32)}`,
  blockNumber: 42,
  attempts: 1,
  lastErrorCode: null,
  createdAt: "2026-10-06T12:00:00.000Z",
  updatedAt: "2026-10-06T12:00:00.000Z",
  anchoredAt: "2026-10-06T12:00:00.000Z",
};

function createTestApp({ repository = {}, service = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", createProofRouter({
    proofRepository: {
      listProofs: async () => [PROOF],
      getProofAccessContext: async () => ({ evidenceId: EVIDENCE_ID, organizerOrganizationId: ORGANIZER_ORG, funderId: FUNDER_ID }),
      findProofByEvidenceId: async () => PROOF,
      ...repository,
    },
    proofService: {
      projectProof: (proof, viewer) => ({ proofId: proof.proofId, viewer }),
      anchorProof: async (proofId) => ({ status: "ANCHORED", attempted: true, proofId }),
      ...service,
    },
    authService: { async loadSessionUser(token) { return users[token] ?? null; } },
    webOrigin: WEB_ORIGIN,
  }));
  return app;
}

test("admin proof list is Admin-only and returns metadata without the package", async () => {
  const app = createTestApp();
  assert.equal((await request(app).get("/api/admin/proofs").set("Cookie", "dt_session=organizer")).status, 403);
  const response = await request(app).get("/api/admin/proofs").set("Cookie", "dt_session=admin");
  assert.equal(response.status, 200);
  assert.equal(response.body.proofs.length, 1);
  assert.equal(response.body.proofs[0].viewer, "ADMIN");
});

test("admin retry calls the anchor service and maps disabled anchors to 503", async () => {
  const app = createTestApp();
  const ok = await request(app).post(`/api/admin/proofs/${PROOF_ID}/retry`).set("Cookie", "dt_session=admin");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "ANCHORED");

  const disabled = createTestApp({
    service: { anchorProof: async () => { throw Object.assign(new Error("x"), { code: "PROOF_ANCHOR_DISABLED" }); } },
  });
  const response = await request(disabled).post(`/api/admin/proofs/${PROOF_ID}/retry`).set("Cookie", "dt_session=admin");
  assert.equal(response.status, 503);
  assert.equal(response.body.error, "proof_anchor_disabled");
  assert.equal((await request(app).post(`/api/admin/proofs/not-a-hash/retry`).set("Cookie", "dt_session=admin")).status, 400);
});

test("evidence proof endpoint is organization-scoped and Funders see status only", async () => {
  const app = createTestApp();
  assert.equal((await request(app).get(`/api/evidence/${EVIDENCE_ID}/proof`).set("Cookie", "dt_session=otherOrganizer")).status, 403);
  assert.equal((await request(app).get(`/api/evidence/${EVIDENCE_ID}/proof`).set("Cookie", "dt_session=verifier")).status, 403);
  assert.equal((await request(app).get(`/api/evidence/${EVIDENCE_ID}/proof`).set("Cookie", "dt_session=funder")).status, 200);
  assert.equal((await request(app).get(`/api/evidence/${EVIDENCE_ID}/proof`).set("Cookie", "dt_session=funder")).body.proof.viewer, "FUNDER");
  const organizer = await request(app).get(`/api/evidence/${EVIDENCE_ID}/proof`).set("Cookie", "dt_session=organizer");
  assert.equal(organizer.status, 200);
  assert.equal(organizer.body.proof.viewer, "ORGANIZER");
  const admin = await request(app).get(`/api/evidence/${EVIDENCE_ID}/proof`).set("Cookie", "dt_session=admin");
  assert.equal(admin.body.proof.viewer, "ADMIN");

  const missing = createTestApp({
    repository: { findProofByEvidenceId: async () => null },
  });
  assert.equal((await request(missing).get(`/api/evidence/${EVIDENCE_ID}/proof`).set("Cookie", "dt_session=admin")).status, 404);
});
