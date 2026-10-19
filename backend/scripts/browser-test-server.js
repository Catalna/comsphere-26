import { mkdtemp, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newDb } from "pg-mem";
import { Wallet, getAddress, verifyTypedData } from "ethers";

import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/passwords.js";
import { createSessionToken } from "../src/auth/sessionTokens.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPeerReviewService } from "../src/review/peerReviewService.js";
import { REVIEW_DOMAIN_NAME, REVIEW_DOMAIN_VERSION, VOTE_TYPES } from "../src/review/eip712.js";
import { createAuthRepository } from "../src/repositories/authRepository.js";
import { createCampaignRepository } from "../src/repositories/campaignRepository.js";
import { createEvidenceRepository } from "../src/repositories/evidenceRepository.js";
import { createOcrRepository } from "../src/repositories/ocrRepository.js";
import { createReviewRepository } from "../src/repositories/reviewRepository.js";
import { createOcrWorker } from "../src/ocr/ocrWorker.js";
import { createLocalFileStorage } from "../src/storage/localFileStorage.js";

const TEST_CONTRACT_ADDRESS = `0x${"c".repeat(40)}`;
const TEST_CHAIN_ID = 31337;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

function organizationCommitment(organizationId) {
  return `0x${createHash("sha256").update(`danaterang:organization:v1:${organizationId}`).digest("hex")}`;
}

function createBrowserReviewContract(roster) {
  const reviews = new Map();
  const receipts = new Map();
  let transactionNumber = 1;
  let blockNumber = 100;
  const domain = {
    name: REVIEW_DOMAIN_NAME,
    version: REVIEW_DOMAIN_VERSION,
    chainId: TEST_CHAIN_ID,
    verifyingContract: TEST_CONTRACT_ADDRESS,
  };
  const keyFor = (reviewId, round) => `${reviewId.toLowerCase()}:${Number(round)}`;
  function transaction(logs = []) {
    const hash = `0x${String(transactionNumber++).padStart(64, "0")}`;
    const receipt = { status: 1, blockNumber: blockNumber++, hash, logs: logs.map((parsed) => ({ address: TEST_CONTRACT_ADDRESS, parsed })) };
    receipts.set(hash, receipt);
    return { hash, async wait() { return receipt; } };
  }

  return {
    address: TEST_CONTRACT_ADDRESS,
    target: TEST_CONTRACT_ADDRESS,
    domain,
    interface: { parseLog(log) { return log.parsed ?? null; } },
    runner: { provider: { async getTransactionReceipt(hash) { return receipts.get(hash.toLowerCase()) ?? null; } } },
    async rosterVersion() { return 1n; },
    async verifierAt(index) {
      const verifier = roster[index];
      return [verifier.wallet.address, verifier.organizationCommitment];
    },
    async isVerifier(address) {
      return roster.some((verifier) => verifier.wallet.address.toLowerCase() === address.toLowerCase());
    },
    async getReview(reviewId, round) {
      const current = reviews.get(keyFor(reviewId, round));
      if (!current) return [ZERO_BYTES32, 0, 0, 0, 0, [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]];
      return [current.evidenceCommitment, current.status, current.decision, current.votes.length, 1, roster.map((verifier) => verifier.wallet.address)];
    },
    async openReview(reviewId, evidenceCommitment, round, organizerCommitment, funderCommitment) {
      const key = keyFor(reviewId, round);
      if (reviews.has(key)) throw Object.assign(new Error("REVIEW_ALREADY_OPEN"), { code: "REVIEW_ALREADY_OPEN" });
      const current = { reviewId, evidenceCommitment, round: Number(round), organizerCommitment, funderCommitment, status: 1, decision: 0, votes: [], voters: new Set() };
      reviews.set(key, current);
      return transaction([{
        name: "ReviewOpened",
        args: { reviewId, evidenceCommitment, round: Number(round), rosterVersion: 1, panel: roster.map((verifier) => verifier.wallet.address) },
      }]);
    },
    async submitVote(vote, signature) {
      const key = keyFor(vote.reviewId, vote.round);
      const current = reviews.get(key);
      if (!current || current.status !== 1) throw Object.assign(new Error("REVIEW_NOT_OPEN"), { code: "REVIEW_NOT_OPEN" });
      const signer = getAddress(verifyTypedData(domain, VOTE_TYPES, vote, signature));
      if (!roster.some((verifier) => verifier.wallet.address.toLowerCase() === signer.toLowerCase())) {
        throw Object.assign(new Error("SIGNER_NOT_IN_PANEL"), { code: "SIGNER_NOT_IN_PANEL" });
      }
      if (current.voters.has(signer.toLowerCase())) throw Object.assign(new Error("DUPLICATE_VOTE"), { code: "DUPLICATE_VOTE" });
      current.voters.add(signer.toLowerCase());
      current.votes.push({ decision: Number(vote.decision), instructionCommitment: vote.instructionCommitment });
      const matchingVotes = current.votes.filter((item) => item.decision === Number(vote.decision));
      let logs = [];
      if (matchingVotes.length >= 2) {
        current.status = 2;
        current.decision = Number(vote.decision);
        logs = [{
          name: "ReviewFinalized",
          args: {
            reviewId: vote.reviewId,
            evidenceCommitment: vote.evidenceCommitment,
            round: Number(vote.round),
            decision: Number(vote.decision),
            instructionCommitment: vote.instructionCommitment,
          },
        }];
      } else if (current.votes.length === 3) {
        current.status = 3;
        logs = [{ name: "ReviewNoQuorum", args: { reviewId: vote.reviewId, evidenceCommitment: vote.evidenceCommitment, round: Number(vote.round) } }];
      }
      return transaction(logs);
    },
  };
}

async function startTestApi() {
  const port = Number(process.env.PORT ?? 4400);
  const host = process.env.HOST ?? "127.0.0.1";
  const webOrigin = process.env.WEB_ORIGIN;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !webOrigin) {
    throw new Error("Browser-test API requires PORT and WEB_ORIGIN");
  }

  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  const storageRoot = await mkdtemp(join(tmpdir(), "dana-terang-browser-evidence-"));
  await runMigrations(pool);

  const authRepository = createAuthRepository(pool);
  const adminEmail = process.env.DANATERANG_TEST_ADMIN_EMAIL ?? "admin@example.test";
  const adminPassword = process.env.DANATERANG_TEST_ADMIN_PASSWORD;
  const funderEmail = process.env.DANATERANG_TEST_FUNDER_EMAIL ?? "funder@example.test";
  const funderPassword = process.env.DANATERANG_TEST_FUNDER_PASSWORD;
  const verifierPassword = process.env.DANATERANG_TEST_VERIFIER_PASSWORD;
  if (!adminPassword || !funderPassword || !verifierPassword) throw new Error("Browser-test credentials are missing");

  const admin = await authRepository.createFirstAdmin({
    name: "Browser Test Admin",
    email: adminEmail,
    passwordHash: await hashPassword(adminPassword),
  });
  const verifierWallets = Array.from({ length: 3 }, (_, index) => new Wallet(`0x${String(index + 1).padStart(64, "0")}`));
  const verifierAccounts = [];
  for (let index = 0; index < verifierWallets.length; index += 1) {
    const email = `verifier-${index + 1}@example.test`;
    const registrationSession = createSessionToken();
    await authRepository.registerOrganizer({
      name: `Browser Test Verifier ${index + 1}`,
      email,
      passwordHash: await hashPassword(verifierPassword),
      organizationName: `Browser Test Verifier Organization ${index + 1}`,
      organizationType: "NGO",
      sessionTokenHash: registrationSession.tokenHash,
      sessionExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });
    const candidate = await authRepository.findUserByEmail(email);
    await authRepository.assignRoleAndAudit({ actorUserId: admin.user.id, targetUserId: candidate.id, role: "VERIFIER" });
    const verifier = await authRepository.findUserByEmail(email);
    const wallet = verifierWallets[index];
    const orgCommitment = organizationCommitment(verifier.organizationId);
    if (index > 0) {
      await pool.query(
        `INSERT INTO verifier_wallets (
           verifier_user_id, wallet_address, organization_id, roster_version, status, verified_at, created_at
         ) VALUES ($1, $2, $3, 1, 'ACTIVE', NOW(), NOW())`,
        [verifier.id, wallet.address.toLowerCase(), verifier.organizationId],
      );
    }
    verifierAccounts.push({ user: verifier, wallet, organizationCommitment: orgCommitment });
  }
  const session = createSessionToken();
  await authRepository.registerOrganizer({
    name: "Browser Test Funder",
    email: funderEmail,
    passwordHash: await hashPassword(funderPassword),
    organizationName: "Browser Test Foundation",
    organizationType: "COMPANY",
    sessionTokenHash: session.tokenHash,
    sessionExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
  });
  const funderCandidate = await authRepository.findUserByEmail(funderEmail);

  // A separate funder account backs the published public-audit campaign so the
  // visible Browser Test Funder account still exercises the Admin role change.
  const publicFunderSession = createSessionToken();
  await authRepository.registerOrganizer({
    name: "Browser Test Public Funder",
    email: "funder-public@example.test",
    passwordHash: await hashPassword(verifierPassword),
    organizationName: "Yayasan Pendana Publik",
    organizationType: "COMPANY",
    sessionTokenHash: publicFunderSession.tokenHash,
    sessionExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
  });
  const publicFunderCandidate = await authRepository.findUserByEmail("funder-public@example.test");
  await authRepository.assignRoleAndAudit({ actorUserId: admin.user.id, targetUserId: publicFunderCandidate.id, role: "FUNDER" });
  const funder = await authRepository.findUserByEmail("funder-public@example.test");

  // A published campaign, milestone, verified evidence version, and pending proof
  // give the public audit page deterministic data without exposing any private field.
  const publishedOrganizerSession = createSessionToken();
  await authRepository.registerOrganizer({
    name: "Browser Test Organizer",
    email: "organizer-public@example.test",
    passwordHash: await hashPassword(verifierPassword),
    organizationName: "Komunitas Demo",
    organizationType: "COMMUNITY",
    sessionTokenHash: publishedOrganizerSession.tokenHash,
    sessionExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
  });
  const organizer = await authRepository.findUserByEmail("organizer-public@example.test");
  const campaignRepository = createCampaignRepository(pool);
  const publishedCampaign = await campaignRepository.createCampaign({
    actor: organizer,
    funderId: funder.id,
    title: "Renovasi SD Harapan",
    description: "Renovasi ruang belajar",
    totalBudget: "100000000.00",
    currency: "IDR",
  });
  const milestone = await campaignRepository.createMilestone({
    actor: organizer,
    campaignId: publishedCampaign.id,
    title: "Pembelian material",
    description: "Material utama renovasi",
    budgetAmount: "60000000.00",
    currency: "IDR",
    orderIndex: 0,
  });
  const evidenceId = randomUUID();
  const reviewRoundId = randomUUID();
  const contractAddress = TEST_CONTRACT_ADDRESS;
  await pool.query(
    `INSERT INTO evidence (id, milestone_id, uploader_id, evidence_type, storage_key, file_name, content_type, file_size, raw_hash, version_group_id, version, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'RECEIPT', $4, 'receipt.pdf', 'application/pdf', 2048, $5, $6, 1, 'READY_FOR_REVIEW', NOW(), NOW())`,
    [evidenceId, milestone.id, organizer.id, randomUUID(), `${"a".repeat(64)}`, randomUUID()],
  );
  await pool.query(
    `INSERT INTO review_rounds (id, evidence_id, round_number, review_id, evidence_commitment,
        organizer_organization_commitment, funder_organization_commitment, status, decision,
        roster_version, contract_address, quorum_transaction_hash, block_number, created_at, updated_at, completed_at)
     VALUES ($1, $2, 1, $3, $4, $5, $6, 'QUORUM_REACHED', 'VERIFIED', 1, $7, $8, 4321, NOW(), NOW(), NOW())`,
    [reviewRoundId, evidenceId, `0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`,
      `0x${"4".repeat(64)}`, contractAddress, `0x${"5".repeat(64)}`],
  );
  await pool.query(
    `INSERT INTO verifications (id, evidence_id, review_round_id, status, contract_address, transaction_hash, block_number, created_at, updated_at, reviewed_at)
     VALUES ($1, $2, $3, 'VERIFIED', $4, $5, 4321, NOW(), NOW(), NOW())`,
    [randomUUID(), evidenceId, reviewRoundId, contractAddress, `0x${"5".repeat(64)}`],
  );
  await pool.query(
    `INSERT INTO proofs (id, evidence_id, review_round_id, proof_version, campaign_id, milestone_id, package, package_hash, proof_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, 1, $4, $5, '{}'::jsonb, $6, $7, 'PENDING', NOW(), NOW())`,
    [randomUUID(), evidenceId, reviewRoundId, publishedCampaign.id, milestone.id, `${"b".repeat(64)}`, `0x${"b".repeat(64)}`],
  );
  await campaignRepository.setCampaignPublication({
    actor: admin.user,
    campaignId: publishedCampaign.id,
    published: true,
  });
  const storage = createLocalFileStorage({ root: storageRoot });
  const reviewRepository = createReviewRepository(pool, { contractAddress: TEST_CONTRACT_ADDRESS });
  const peerReviewContract = createBrowserReviewContract(verifierAccounts);
  const peerReviewService = createPeerReviewService({
    repository: reviewRepository,
    contract: peerReviewContract,
    chainId: TEST_CHAIN_ID,
    contractAddress: TEST_CONTRACT_ADDRESS,
  });
  const ocrRepository = createOcrRepository(pool, { reviewRepository });
  const verifierWalletsByUserId = new Map(verifierAccounts.map((verifier) => [verifier.user.id, verifier.wallet]));
  const app = createApp({
    authRepository,
    campaignRepository,
    evidenceRepository: createEvidenceRepository(pool, { reviewRepository }),
    reviewRepository,
    peerReviewService,
    testWalletSigner: async ({ actor, address, typedData }) => {
      const wallet = verifierWalletsByUserId.get(actor.id);
      if (!wallet || wallet.address.toLowerCase() !== address.toLowerCase()) throw Object.assign(new Error("Unknown browser-test wallet"), { code: "FORBIDDEN" });
      return wallet.signTypedData(typedData.domain, typedData.types, typedData.message);
    },
    objectStorage: storage,
    webOrigin,
    nodeEnv: "test",
  });
  let retryFailureIssued = false;
  const ocrWorker = createOcrWorker({
    repository: ocrRepository,
    storage,
    renderer: {
      async *renderEvidencePages({ bytes }) { yield { pageNumber: 1, bytes, width: 72, height: 72 }; },
    },
    engine: {
      async initialize() {},
      async recognize(bytes) {
        const marker = bytes.toString("utf8");
        if (marker.includes("OCR-RETRY-FIXTURE") && !retryFailureIssued) {
          retryFailureIssued = true;
          throw Object.assign(new Error("fixture processor failure"), { code: "OCR_RECOGNITION_FAILED" });
        }
        const amount = marker.includes("OCR-OVER-BUDGET") ? "70000000" : "50000";
        return {
          text: `TOKO MAJU\nINTERNAL-OCR-TEST-CONTENT\nInvoice Date: 01 Oct 2026\nInvoice No: INV-${marker.includes("OCR-RETRY-FIXTURE") ? "RETRY" : "0001"}\nTotal: Rp ${amount}`,
          words: [
            { text: "TOKO", confidence: 95 }, { text: "MAJU", confidence: 95 },
            { text: "01", confidence: 95 }, { text: "Oct", confidence: 95 }, { text: "2026", confidence: 95 },
            { text: `INV-${marker.includes("OCR-RETRY-FIXTURE") ? "RETRY" : "0001"}`, confidence: 95 },
            { text: amount, confidence: 95 },
          ],
        };
      },
      async close() {},
    },
    pollIntervalMs: 1000,
    leaseMs: 30000,
    maxAttempts: 3,
  });
  const server = app.listen(port, host);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  ocrWorker.start().catch(() => {
    console.error("Browser-test OCR worker stopped unexpectedly.");
    process.exitCode = 1;
  });
  let reviewTasksRunning = false;
  const runReviewTasks = async () => {
    if (reviewTasksRunning) return;
    reviewTasksRunning = true;
    try {
      const registrations = await peerReviewService.registerWaitingRounds();
      for (const result of registrations) {
        if (result.status === "CHAIN_FAILED") {
          console.error(`Browser-test review registration failed for ${result.reviewRoundId}: ${result.errorCode}`);
          if (result.diagnostics) {
            console.error(`  diagnostics: ${JSON.stringify(result.diagnostics)}`);
          }
        }
      }
      await peerReviewService.reconcilePendingVoteSubmissions();
    } catch {
      console.error("Browser-test peer-review worker stopped unexpectedly.");
    } finally {
      reviewTasksRunning = false;
    }
  };
  void runReviewTasks();
  const reviewTimer = setInterval(runReviewTasks, 250);
  reviewTimer.unref?.();

  let closing = false;
  const close = (signal) => {
    if (closing) return;
    closing = true;
    clearInterval(reviewTimer);
    server.close(async () => {
      await ocrWorker.stop();
      await pool.end();
      await rm(storageRoot, { recursive: true, force: true });
      if (signal) process.exitCode = 0;
    });
  };
  process.once("SIGINT", () => close("SIGINT"));
  process.once("SIGTERM", () => close("SIGTERM"));
  console.log(`Browser-test API ready on ${host}:${port}`);
}

startTestApi().catch(() => {
  console.error("Browser-test API failed to start.");
  process.exitCode = 1;
});
