import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { createSessionToken } from "../../src/auth/sessionTokens.js";
import { createReviewRouter } from "../../src/routes/reviews.js";

const WEB_ORIGIN = "http://localhost:3000";
const REVIEW_ROUND_ID = "fca2aa20-71bb-48cb-b6dd-258f36a9b94a";
const verifier = { id: "verifier-1", role: "VERIFIER", status: "ACTIVE" };
const admin = { id: "admin-1", role: "ADMIN", status: "ACTIVE" };

function createTestApp({ repository = {}, service = {}, evidenceRepository = {}, users = { verifier: verifier, admin } } = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", createReviewRouter({
    reviewRepository: {
      listAssignedOpenRounds: async () => [],
      listAdminReviewMetadata: async () => [],
      getVerifierWallet: async () => null,
      getAssignedReviewDetails: async () => null,
      ...repository,
    },
    evidenceRepository: { async getVerifierOcrDetails() { return null; }, ...evidenceRepository },
    peerReviewService: {
      createWalletChallenge: async () => ({ challengeId: "challenge-1", typedData: { message: "fixture" } }),
      bindVerifierWallet: async () => ({ walletAddress: `0x${"1".repeat(40)}` }),
      prepareVote: async () => ({ typedData: { message: "fixture" }, instructionSalt: null }),
      submitVote: async () => ({ status: "PENDING", transactionHash: null }),
      ...service,
    },
    authService: { async loadSessionUser(token) { return users[token] ?? null; } },
    webOrigin: WEB_ORIGIN,
  }));
  return app;
}

test("wallet challenge requires exact Origin and Verifier role and is never cached", async () => {
  const calls = [];
  const app = createTestApp({ service: { createWalletChallenge: async (input) => { calls.push(input); return { challengeId: "challenge-1", typedData: { domain: "expected" } }; } } });
  const deniedOrigin = await request(app)
    .post("/api/verifier/wallet/challenge")
    .set("Cookie", "dt_session=verifier")
    .send({ walletAddress: `0x${"1".repeat(40)}` });
  assert.equal(deniedOrigin.status, 403);
  assert.equal(calls.length, 0);

  const deniedRole = await request(app)
    .post("/api/verifier/wallet/challenge")
    .set("Origin", WEB_ORIGIN)
    .set("Cookie", "dt_session=admin")
    .send({ walletAddress: `0x${"1".repeat(40)}` });
  assert.equal(deniedRole.status, 403);
  assert.equal(calls.length, 0);

  const response = await request(app)
    .post("/api/verifier/wallet/challenge")
    .set("Origin", WEB_ORIGIN)
    .set("Cookie", "dt_session=verifier")
    .send({ walletAddress: `0x${"1".repeat(40)}` });
  assert.equal(response.status, 201);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(calls[0].actor.id, verifier.id);
  assert.equal(calls[0].walletAddress, `0x${"1".repeat(40)}`);
});

test("Verifier wallet status returns only the current account's public binding", async () => {
  const wallet = { walletAddress: `0x${"1".repeat(40)}`, rosterVersion: 1, status: "ACTIVE", verifiedAt: "2026-10-06T12:00:00.000Z" };
  const app = createTestApp({ repository: { getVerifierWallet: async (userId) => userId === verifier.id ? wallet : null } });
  const response = await request(app).get("/api/verifier/wallet").set("Cookie", "dt_session=verifier");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { wallet });
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal((await request(app).get("/api/verifier/wallet").set("Cookie", "dt_session=admin")).status, 403);
});

test("vote preparation and submission accept only the assigned Verifier's explicit fields", async () => {
  const calls = [];
  const app = createTestApp({
    repository: { listAssignedOpenRounds: async (verifierUserId) => [{ reviewRoundId: REVIEW_ROUND_ID, verifierUserId }] },
    service: {
      prepareVote: async (input) => {
        calls.push({ action: "prepare", input });
        return { typedData: { message: { decision: "VERIFIED" } }, instructionSalt: null };
      },
      submitVote: async (input) => {
        calls.push({ action: "submit", input });
        return { status: "PENDING", transactionHash: `0x${"a".repeat(64)}` };
      },
    },
  });

  const queue = await request(app).get("/api/verifier/reviews").set("Cookie", "dt_session=verifier");
  assert.equal(queue.status, 200);
  assert.equal(queue.headers["cache-control"], "private, no-store");
  assert.equal(queue.body.reviews[0].reviewRoundId, REVIEW_ROUND_ID);

  const prepared = await request(app)
    .post(`/api/verifier/reviews/${REVIEW_ROUND_ID}/votes/prepare`)
    .set("Origin", WEB_ORIGIN)
    .set("Cookie", "dt_session=verifier")
    .send({ decision: "VERIFIED", noConflictAttested: true });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.typedData.message.decision, "VERIFIED");

  const submitted = await request(app)
    .post(`/api/verifier/reviews/${REVIEW_ROUND_ID}/votes`)
    .set("Origin", WEB_ORIGIN)
    .set("Cookie", "dt_session=verifier")
    .send({ decision: "VERIFIED", noConflictAttested: true, signature: `0x${"a".repeat(130)}` });
  assert.equal(submitted.status, 202);
  assert.equal(submitted.body.transactionHash, `0x${"a".repeat(64)}`);
  assert.equal(calls[0].action, "prepare");
  assert.equal(calls[1].input.actor.id, verifier.id);
  assert.equal(calls[1].input.signature, `0x${"a".repeat(130)}`);

  const extraInput = await request(app)
    .post(`/api/verifier/reviews/${REVIEW_ROUND_ID}/votes`)
    .set("Origin", WEB_ORIGIN)
    .set("Cookie", "dt_session=verifier")
    .send({ decision: "VERIFIED", noConflictAttested: true, signature: `0x${"a".repeat(130)}`, adminOverride: true });
  assert.equal(extraInput.status, 400);
});

test("review routes do not reveal Verifier services to other roles or anonymous requests", async () => {
  const app = createTestApp();
  const anonymous = await request(app).get("/api/verifier/reviews");
  assert.equal(anonymous.status, 401);
  const adminResponse = await request(app).get("/api/verifier/reviews").set("Cookie", "dt_session=admin");
  assert.equal(adminResponse.status, 403);
});

test("application mounts peer-review routes only when configured", async () => {
  const { token } = createSessionToken();
  const app = createApp({
    authRepository: { async findSessionUser() { return verifier; } },
    reviewRepository: { async listAssignedOpenRounds() { return []; } },
    peerReviewService: {},
    webOrigin: WEB_ORIGIN,
    nodeEnv: "test",
  });
  const response = await request(app).get("/api/verifier/reviews").set("Cookie", `dt_session=${token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { reviews: [] });

  const unconfigured = await request(createApp()).get("/api/verifier/reviews");
  assert.equal(unconfigured.status, 404);
});

test("test-wallet signer endpoint exists only in test mode and requires a Verifier session and Origin", async () => {
  const { token } = createSessionToken();
  const signerCalls = [];
  const app = createApp({
    authRepository: { async findSessionUser() { return verifier; } },
    webOrigin: WEB_ORIGIN,
    nodeEnv: "test",
    testWalletSigner: async (input) => { signerCalls.push(input); return `0x${"a".repeat(130)}`; },
  });
  const missingOrigin = await request(app).post("/api/test/wallet/sign").set("Cookie", `dt_session=${token}`).send({ address: `0x${"1".repeat(40)}`, typedData: {} });
  assert.equal(missingOrigin.status, 403);
  const signed = await request(app)
    .post("/api/test/wallet/sign")
    .set("Origin", WEB_ORIGIN)
    .set("Cookie", `dt_session=${token}`)
    .send({ address: `0x${"1".repeat(40)}`, typedData: { primaryType: "Vote" } });
  assert.equal(signed.status, 200);
  assert.equal(signerCalls[0].actor.id, verifier.id);

  const unavailableInProduction = createApp({ authRepository: { async findSessionUser() { return verifier; } }, nodeEnv: "production", webOrigin: WEB_ORIGIN, testWalletSigner: async () => `0x${"a".repeat(130)}` });
  assert.equal((await request(unavailableInProduction).post("/api/test/wallet/sign").set("Origin", WEB_ORIGIN).set("Cookie", `dt_session=${token}`).send({ address: `0x${"1".repeat(40)}`, typedData: {} })).status, 404);
});

test("Admin review operations expose metadata only and provide no review decision action", async () => {
  const metadata = [{ reviewRoundId: REVIEW_ROUND_ID, evidenceId: "evidence-id", status: "OPEN", voteCount: 1, assignedVerifierCount: 3 }];
  const app = createTestApp({ repository: { listAdminReviewMetadata: async () => metadata } });
  const adminResponse = await request(app).get("/api/admin/reviews").set("Cookie", "dt_session=admin");
  assert.equal(adminResponse.status, 200);
  assert.deepEqual(adminResponse.body, { reviews: metadata });
  assert.equal(adminResponse.headers["cache-control"], "private, no-store");

  const verifierResponse = await request(app).get("/api/admin/reviews").set("Cookie", "dt_session=verifier");
  assert.equal(verifierResponse.status, 403);
  assert.equal((await request(app).post(`/api/admin/reviews/${REVIEW_ROUND_ID}/decision`).set("Cookie", "dt_session=admin")).status, 404);
});

test("Verifier review detail is assignment-scoped and includes only that Verifier's note", async () => {
  const app = createTestApp({
    repository: {
      getAssignedReviewDetails: async ({ verifierUserId }) => verifierUserId === verifier.id
        ? { reviewRoundId: REVIEW_ROUND_ID, evidenceId: "evidence-1", ownVote: { decision: "VERIFIED", internalNotes: "own note" } }
        : null,
    },
    evidenceRepository: {
      getVerifierOcrDetails: async () => ({ evidenceId: "evidence-1", runs: [{ extractedText: "assigned OCR" }] }),
    },
  });
  const response = await request(app)
    .get(`/api/verifier/reviews/${REVIEW_ROUND_ID}`)
    .set("Cookie", "dt_session=verifier");
  assert.equal(response.status, 200);
  assert.equal(response.body.review.ownVote.internalNotes, "own note");
  assert.equal(response.body.ocr.runs[0].extractedText, "assigned OCR");

  const unassigned = createTestApp({ repository: { getAssignedReviewDetails: async () => null } });
  assert.equal((await request(unassigned).get(`/api/verifier/reviews/${REVIEW_ROUND_ID}`).set("Cookie", "dt_session=verifier")).status, 404);
});
