import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { newDb } from "pg-mem";
import { getAddress } from "ethers";

import { runMigrations } from "../../src/db/migrate.js";
import { createOcrRepository } from "../../src/repositories/ocrRepository.js";
import { createReviewRepository } from "../../src/repositories/reviewRepository.js";
import { computeOrganizerInstructionCommitment } from "../../src/review/eip712.js";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const CONTRACT_ADDRESS = `0x${"c".repeat(40)}`;

async function makeContext({ conflictAtIndex = -1, evidenceStatus = "READY_FOR_REVIEW", registerVerifierWallets = true, contractAddress = CONTRACT_ADDRESS } = {}) {
  const memoryDb = newDb();
  memoryDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memoryDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => value.length });
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await runMigrations(pool);

  const organizerOrgId = randomUUID();
  const funderOrgId = randomUUID();
  const verifierOrgIds = [randomUUID(), randomUUID(), randomUUID()];
  const organizationRows = [
    [organizerOrgId, "Organizer Organization", "COMMUNITY"],
    [funderOrgId, "Funder Organization", "COMPANY"],
    ...verifierOrgIds.map((id, index) => [id, `Verifier Organization ${index + 1}`, "NGO"]),
  ];
  for (const [id, name, type] of organizationRows) {
    await pool.query(
      "INSERT INTO organizations (id, name, type, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
      [id, name, type, NOW],
    );
  }

  const organizerId = randomUUID();
  const funderId = randomUUID();
  const verifierIds = [randomUUID(), randomUUID(), randomUUID()];
  for (const [id, organizationId, role, index] of [
    [organizerId, organizerOrgId, "ORGANIZER", 0],
    [funderId, funderOrgId, "FUNDER", 1],
    ...verifierIds.map((id, index) => [id, verifierOrgIds[index], "VERIFIER", index + 2]),
  ]) {
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'hash', $5, $6, $6)`,
      [id, organizationId, role, `${role.toLowerCase()}-${index}@example.test`, role, NOW],
    );
  }

  const campaignId = randomUUID();
  const milestoneId = randomUUID();
  const evidenceId = randomUUID();
  await pool.query(
    `INSERT INTO campaigns (id, organization_id, funder_id, title, total_budget, currency, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'Peer Review Campaign', 100000, 'IDR', 'ACTIVE', $4, $4)`,
    [campaignId, organizerOrgId, funderId, NOW],
  );
  await pool.query(
    `INSERT INTO milestones (id, campaign_id, title, budget_amount, currency, order_index, status, created_at, updated_at)
     VALUES ($1, $2, 'Peer Review Milestone', 100000, 'IDR', 0, 'COMPLETED', $3, $3)`,
    [milestoneId, campaignId, NOW],
  );
  await pool.query(
    `INSERT INTO evidence (
       id, milestone_id, uploader_id, evidence_type, storage_key, file_name, content_type,
       file_size, raw_hash, version_group_id, version, previous_evidence_id, status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'RECEIPT', $4, 'receipt.pdf', 'application/pdf', 10, $5, $6, 1, NULL, $7, $8, $8)`,
    [evidenceId, milestoneId, organizerId, randomUUID(), "a".repeat(64), randomUUID(), evidenceStatus, NOW],
  );

  const verifierWallets = verifierIds.map((id, index) => ({
    userId: id,
    organizationId: conflictAtIndex === index ? organizerOrgId : verifierOrgIds[index],
    walletAddress: `0x${String(index + 1).repeat(40)}`,
  }));
  if (registerVerifierWallets) {
    for (const verifier of verifierWallets) {
      await pool.query(
        `INSERT INTO verifier_wallets (verifier_user_id, wallet_address, organization_id, roster_version, verified_at, status, created_at)
         VALUES ($1, $2, $3, 1, $4, 'ACTIVE', $4)`,
        [verifier.userId, verifier.walletAddress, verifier.organizationId, NOW],
      );
    }
  }
  return {
    pool,
    repository: createReviewRepository(pool, { contractAddress }),
    organizerId,
    organizerOrgId,
    funderId,
    funderOrgId,
    verifierIds,
    verifierOrgIds,
    verifierWallets,
    campaignId,
    milestoneId,
    evidenceId,
    cleanup: () => pool.end(),
  };
}

test("opens an OCR-ready review round with three distinct, non-conflicted Verifiers", async () => {
  const context = await makeContext({ contractAddress: getAddress(CONTRACT_ADDRESS) });
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    assert.equal(round.status, "WAITING_FOR_CHAIN");
    assert.equal(round.roundNumber, 1);
    assert.equal(round.panel.length, 3);
    assert.equal(new Set(round.panel.map((member) => member.organizationId)).size, 3);
    assert.ok(round.panel.every((member) => member.organizationId !== context.organizerOrgId && member.organizationId !== context.funderOrgId));

    const verification = await context.pool.query("SELECT status, review_round_id FROM verifications WHERE evidence_id = $1", [context.evidenceId]);
    assert.equal(verification.rows[0].status, "PENDING");
    assert.equal(verification.rows[0].review_round_id, round.id);
    assert.equal((await context.repository.listAssignedOpenRounds(context.verifierIds[0])).length, 0);
  } finally {
    await context.cleanup();
  }
});

test("peer-review schema constrains unique assignments, votes, and version-specific decisions", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const assignment = await context.pool.query("SELECT verifier_user_id, wallet_address FROM review_assignments WHERE review_round_id = $1 LIMIT 1", [round.id]);
    const voteId = randomUUID();
    await context.pool.query(
      `INSERT INTO review_votes (
         id, review_round_id, verifier_user_id, wallet_address, decision, eip712_signature,
         no_conflict_attested, created_at
       ) VALUES ($1, $2, $3, $4, 'VERIFIED', $5, TRUE, $6)`,
      [voteId, round.id, assignment.rows[0].verifier_user_id, assignment.rows[0].wallet_address, `0x${"a".repeat(130)}`, NOW],
    );
    await assert.rejects(context.pool.query(
      `INSERT INTO review_votes (
         id, review_round_id, verifier_user_id, wallet_address, decision, eip712_signature,
         no_conflict_attested, created_at
       ) VALUES ($1, $2, $3, $4, 'REJECTED', $5, TRUE, $6)`,
      [randomUUID(), round.id, assignment.rows[0].verifier_user_id, assignment.rows[0].wallet_address, `0x${"b".repeat(130)}`, NOW],
    ));
    await assert.rejects(context.pool.query(
      `INSERT INTO review_votes (
         id, review_round_id, verifier_user_id, wallet_address, decision, eip712_signature,
         no_conflict_attested, organizer_instruction_commitment, created_at
       ) VALUES ($1, $2, $3, $4, 'NEEDS_REVISION', $5, TRUE, $6, $7)`,
      [randomUUID(), round.id, assignment.rows[0].verifier_user_id, assignment.rows[0].wallet_address, `0x${"c".repeat(130)}`, `0x${"d".repeat(64)}`, NOW],
    ));
    await assert.rejects(context.pool.query("UPDATE review_rounds SET status = 'VERIFIED' WHERE id = $1", [round.id]));
    await assert.rejects(context.pool.query(
      `INSERT INTO verifications (id, evidence_id, review_round_id, status, contract_address, created_at, updated_at)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $5)`,
      [randomUUID(), context.evidenceId, round.id, CONTRACT_ADDRESS, NOW],
    ));
  } finally {
    await context.pool.end();
  }
});

test("review vote rows are unique per assigned Verifier and require revision commitments", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const assignment = await context.pool.query("SELECT verifier_user_id, wallet_address FROM review_assignments WHERE review_round_id = $1 LIMIT 1", [round.id]);
    const voteArgs = [randomUUID(), round.id, assignment.rows[0].verifier_user_id, assignment.rows[0].wallet_address, `0x${"a".repeat(130)}`, NOW];
    await context.pool.query(
      `INSERT INTO review_votes (
         id, review_round_id, verifier_user_id, wallet_address, decision, eip712_signature,
         no_conflict_attested, created_at
       ) VALUES ($1, $2, $3, $4, 'VERIFIED', $5, TRUE, $6)`,
      voteArgs,
    );
    await assert.rejects(context.pool.query(
      `INSERT INTO review_votes (
         id, review_round_id, verifier_user_id, wallet_address, decision, eip712_signature,
         no_conflict_attested, created_at
       ) VALUES ($1, $2, $3, $4, 'REJECTED', $5, TRUE, $6)`,
      [randomUUID(), ...voteArgs.slice(1)],
    ));
    await assert.rejects(context.pool.query(
      `INSERT INTO review_votes (
         id, review_round_id, verifier_user_id, wallet_address, decision, eip712_signature,
         no_conflict_attested, created_at
       ) VALUES ($1, $2, $3, $4, 'NEEDS_REVISION', $5, TRUE, $6)`,
      [randomUUID(), round.id, context.verifierIds[1], round.panel[1].walletAddress, `0x${"b".repeat(130)}`, NOW],
    ));
    await assert.rejects(context.pool.query("UPDATE review_rounds SET status = 'VERIFIED' WHERE id = $1", [round.id]));
  } finally {
    await context.cleanup();
  }
});

test("no review round opens without an OCR-ready version or three independent Verifiers", async () => {
  const failedOcr = await makeContext({ evidenceStatus: "PROCESSING_FAILED" });
  const conflict = await makeContext({ conflictAtIndex: 0 });
  try {
    for (const context of [failedOcr, conflict]) {
      const client = await context.pool.connect();
      try {
        await client.query("BEGIN");
        assert.equal(await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW }), null);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      assert.equal((await context.pool.query("SELECT id FROM review_rounds")).rowCount, 0);
    }
  } finally {
    await failedOcr.cleanup();
    await conflict.cleanup();
  }
});

test("does not silently select a subset if the active wallet registry differs from the contract roster", async () => {
  const context = await makeContext();
  try {
    const extraOrganization = randomUUID();
    const extraVerifier = randomUUID();
    await context.pool.query(
      "INSERT INTO organizations (id, name, type, created_at, updated_at) VALUES ($1, 'Unexpected Verifier Org', 'NGO', $2, $2)",
      [extraOrganization, NOW],
    );
    await context.pool.query(
      `INSERT INTO users (id, organization_id, name, email_normalized, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, 'Unexpected Verifier', 'unexpected-verifier@example.test', 'hash', 'VERIFIER', $3, $3)`,
      [extraVerifier, extraOrganization, NOW],
    );
    await context.pool.query(
      `INSERT INTO verifier_wallets (verifier_user_id, wallet_address, organization_id, roster_version, verified_at, status, created_at)
       VALUES ($1, $2, $3, 1, $4, 'ACTIVE', $4)`,
      [extraVerifier, `0x${"4".repeat(40)}`, extraOrganization, NOW],
    );

    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      assert.equal(await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW }), null);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    assert.equal((await context.pool.query("SELECT id FROM review_rounds")).rowCount, 0);
  } finally {
    await context.cleanup();
  }
});

test("only assigned Verifiers see an opened round in their review queue", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("UPDATE review_rounds SET status = 'OPEN' WHERE id = $1", [round.id]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    assert.equal((await context.repository.listAssignedOpenRounds(context.verifierIds[0])).length, 1);
    assert.equal((await context.repository.listAssignedOpenRounds(context.organizerId)).length, 0);
    const assignedRound = await context.repository.findAssignedRoundForVote({ reviewRoundId: round.id, verifierUserId: context.verifierIds[0] });
    assert.equal(assignedRound.reviewId, round.reviewId);
    assert.equal(assignedRound.evidenceCommitment, round.evidenceCommitment);
    assert.equal(assignedRound.walletAddress, round.panel.find((member) => member.verifierUserId === context.verifierIds[0]).walletAddress);
    assert.equal(await context.repository.findAssignedRoundForVote({ reviewRoundId: round.id, verifierUserId: context.organizerId }), null);
  } finally {
    await context.cleanup();
  }
});

test("successful OCR completion transactionally opens a peer review round", async () => {
  const context = await makeContext({ evidenceStatus: "PROCESSING" });
  try {
    const runId = randomUUID();
    const jobId = randomUUID();
    await context.pool.query(
      `INSERT INTO ocr_runs (id, evidence_id, run_number, screening_status, detected_language, field_confidence, extracted_text, created_at)
       VALUES ($1, $2, 1, 'PROCESSING', 'unknown', $3, '', $4)`,
      [runId, context.evidenceId, { vendor: 0, documentDate: 0, amount: 0, invoiceNumber: 0 }, NOW],
    );
    await context.pool.query(
      `INSERT INTO ocr_jobs (id, ocr_run_id, state, attempt_count, lease_owner, lease_expires_at, created_at, updated_at)
       VALUES ($1, $2, 'RUNNING', 1, 'ocr-worker', $3, $4, $4)`,
      [jobId, runId, new Date(NOW.getTime() + 60000), NOW],
    );
    const ocr = createOcrRepository(context.pool, { reviewRepository: context.repository });
    const result = await ocr.completeRun({
      jobId,
      runId,
      leaseOwner: "ocr-worker",
      now: NOW,
      result: {
        parsed: {
          vendor: "TOKO CONTOH", documentDate: "2026-10-01", amount: "50000", currency: "IDR",
          invoiceNumber: "DEMO-1", detectedLanguage: "id",
          fieldConfidence: { vendor: 90, documentDate: 90, amount: 95, invoiceNumber: 80 },
          extractedText: "synthetic text",
        },
        screeningStatus: "CLEAR",
        flags: [],
      },
    });
    assert.equal(result.evidenceStatus, "READY_FOR_REVIEW");
    assert.equal(result.reviewRound.status, "WAITING_FOR_CHAIN");
    const assignments = await context.pool.query("SELECT verifier_user_id FROM review_assignments WHERE review_round_id = $1", [result.reviewRound.id]);
    assert.equal(assignments.rowCount, 3);
  } finally {
    await context.cleanup();
  }
});

test("waiting rounds expose a privacy-safe roster snapshot and enter the queue only after chain confirmation", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const pending = await context.repository.listWaitingForChainRounds({ now: NOW });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].reviewRoundId, round.id);
    assert.equal(pending[0].panel.length, 3);
    assert.ok(pending[0].panel.every((member) => /^0x[0-9a-f]{64}$/.test(member.organizationCommitment)));
    assert.equal((await context.repository.listAssignedOpenRounds(context.verifierIds[0])).length, 0);
    await context.repository.recordRoundOpenSubmitted({
      reviewRoundId: round.id,
      transactionHash: `0x${"e".repeat(64)}`,
      now: NOW,
    });
    assert.equal((await context.repository.listWaitingForChainRounds({ now: NOW }))[0].openTransactionHash, `0x${"e".repeat(64)}`);
    assert.equal((await context.repository.listAssignedOpenRounds(context.verifierIds[0])).length, 0);
    await context.repository.recordRoundRegistrationIssue({
      reviewRoundId: round.id,
      errorCode: "CHAIN_RECEIPT_FAILED",
      clearOpenTransactionHash: true,
      now: NOW,
    });
    assert.equal((await context.repository.listWaitingForChainRounds({ now: NOW }))[0].openTransactionHash, null);
    await context.repository.recordRoundOpenSubmitted({
      reviewRoundId: round.id,
      transactionHash: `0x${"e".repeat(64)}`,
      now: NOW,
    });

    const opened = await context.repository.markRoundOpen({
      reviewRoundId: round.id,
      transactionHash: `0x${"e".repeat(64)}`,
      blockNumber: 321,
      now: NOW,
    });
    assert.equal(opened.status, "OPEN");
    assert.equal((await context.repository.listWaitingForChainRounds({ now: NOW })).length, 0);
    assert.equal((await context.repository.listAssignedOpenRounds(context.verifierIds[0])).length, 1);
  } finally {
    await context.cleanup();
  }
});

test("wallet challenges are address-bound, expire, and can be consumed only once by an active Verifier", async () => {
  const context = await makeContext({ registerVerifierWallets: false });
  try {
    const verifierUserId = context.verifierIds[0];
    const walletAddress = `0x${"9".repeat(40)}`;
    const verifierRow = await context.pool.query("SELECT id, role, status, organization_id FROM users WHERE id = $1", [verifierUserId]);
    assert.equal(verifierRow.rowCount, 1, JSON.stringify(verifierRow.rows));
    assert.equal(verifierRow.rows[0].role, "VERIFIER");
    assert.equal(verifierRow.rows[0].status, "ACTIVE");
    assert.equal(verifierRow.rows[0].organization_id, context.verifierOrgIds[0]);
    const challenge = await context.repository.createWalletChallenge({
      verifierUserId,
      walletAddress,
      nonce: `0x${"a".repeat(64)}`,
      expiresAt: new Date(NOW.getTime() + 5 * 60_000),
      now: NOW,
    });
    assert.equal(challenge.walletAddress, walletAddress);
    const pending = await context.repository.getWalletChallenge({
      challengeId: challenge.challengeId,
      verifierUserId,
      now: NOW,
    });
    assert.equal(pending.nonce, challenge.nonce);

    const binding = await context.repository.consumeAndBindWallet({
      challengeId: challenge.challengeId,
      verifierUserId,
      walletAddress,
      rosterVersion: 1,
      now: NOW,
    });
    assert.equal(binding.walletAddress, walletAddress);
    assert.equal(binding.organizationId, context.verifierOrgIds[0]);
    assert.deepEqual(await context.repository.getVerifierWallet(verifierUserId), {
      verifierUserId,
      walletAddress,
      organizationId: context.verifierOrgIds[0],
      rosterVersion: 1,
      status: "ACTIVE",
      verifiedAt: NOW,
    });
    assert.equal((await context.pool.query("SELECT consumed_at FROM verifier_wallet_challenges WHERE id = $1", [challenge.challengeId])).rows[0].consumed_at.getTime(), NOW.getTime());
    await assert.rejects(context.repository.consumeAndBindWallet({
      challengeId: challenge.challengeId,
      verifierUserId,
      walletAddress,
      rosterVersion: 1,
      now: NOW,
    }), { code: "WALLET_CHALLENGE_INVALID" });
    await assert.rejects(context.repository.createWalletChallenge({
      verifierUserId: context.organizerId,
      walletAddress: `0x${"8".repeat(40)}`,
      nonce: `0x${"b".repeat(64)}`,
      expiresAt: new Date(NOW.getTime() + 5 * 60_000),
      now: NOW,
    }), { code: "FORBIDDEN" });
  } finally {
    await context.cleanup();
  }
});

test("signed votes are append-only and safely idempotent for the assigned Verifier", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("UPDATE review_rounds SET status = 'OPEN' WHERE id = $1", [round.id]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const verifier = round.panel[0];
    const vote = {
      reviewRoundId: round.id,
      verifierUserId: verifier.verifierUserId,
      walletAddress: verifier.walletAddress,
      decision: "VERIFIED",
      eip712Signature: `0x${"a".repeat(130)}`,
      noConflictAttested: true,
      internalNotes: "Private synthetic note",
      now: NOW,
    };
    const first = await context.repository.persistSignedVote(vote);
    assert.equal(first.status, "QUEUED");
    assert.equal(first.idempotent, false);
    assert.equal("eip712Signature" in first, false);

    const retry = await context.repository.persistSignedVote(vote);
    assert.equal(retry.voteId, first.voteId);
    assert.equal(retry.idempotent, true);
    assert.equal((await context.pool.query("SELECT id FROM review_votes WHERE review_round_id = $1", [round.id])).rowCount, 1);
    assert.equal((await context.pool.query("SELECT id FROM review_vote_submissions WHERE vote_id = $1", [first.voteId])).rowCount, 1);
    await context.repository.markVoteSubmitted({ voteId: first.voteId, transactionHash: `0x${"f".repeat(64)}`, now: NOW });
    const pending = await context.repository.listPendingVoteSubmissions();
    assert.deepEqual(pending, [{
      voteId: first.voteId,
      reviewRoundId: round.id,
      transactionHash: `0x${"f".repeat(64)}`,
    }]);
    const submittedRetry = await context.repository.persistSignedVote(vote);
    assert.equal(submittedRetry.status, "SUBMITTED");
    assert.equal(submittedRetry.transactionHash, `0x${"f".repeat(64)}`);
    await context.repository.confirmVoteSubmission({ voteId: first.voteId, blockNumber: 88, now: NOW });
    assert.equal((await context.repository.persistSignedVote(vote)).status, "CONFIRMED");
    assert.equal((await context.repository.listPendingVoteSubmissions()).length, 0);
    await assert.rejects(context.repository.persistSignedVote({ ...vote, decision: "REJECTED" }), { code: "VOTE_ALREADY_SUBMITTED" });
    await assert.rejects(context.repository.persistSignedVote({ ...vote, verifierUserId: context.organizerId }), { code: "REVIEW_NOT_ASSIGNED" });
  } finally {
    await context.cleanup();
  }
});

test("revision votes persist private instructions only with the matching salted commitment", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("UPDATE review_rounds SET status = 'OPEN' WHERE id = $1", [round.id]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const verifier = round.panel[0];
    const instructions = "Please include the full date and vendor name.";
    const salt = "a".repeat(64);
    const instructionCommitment = computeOrganizerInstructionCommitment({ instructions, salt });
    const vote = {
      reviewRoundId: round.id,
      verifierUserId: verifier.verifierUserId,
      walletAddress: verifier.walletAddress,
      decision: "NEEDS_REVISION",
      eip712Signature: `0x${"a".repeat(130)}`,
      noConflictAttested: true,
      organizerInstructionCommitment: instructionCommitment,
      organizerInstructionSalt: salt,
      organizerInstructions: instructions,
      internalNotes: "Private synthetic note",
      now: NOW,
    };
    await assert.rejects(context.repository.persistSignedVote({
      ...vote,
      organizerInstructionCommitment: `0x${"b".repeat(64)}`,
    }), { code: "INVALID_VOTE" });
    const persisted = await context.repository.persistSignedVote(vote);
    const row = (await context.pool.query("SELECT organizer_instruction_commitment, organizer_instruction_salt, organizer_instructions FROM review_votes WHERE id = $1", [persisted.voteId])).rows[0];
    assert.equal(row.organizer_instruction_commitment, instructionCommitment);
    assert.equal(row.organizer_instruction_salt, salt);
    assert.equal(row.organizer_instructions, instructions);
  } finally {
    await context.cleanup();
  }
});

test("only a matching confirmed contract outcome updates the stored verification", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("UPDATE review_rounds SET status = 'OPEN' WHERE id = $1", [round.id]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const event = {
      kind: "QUORUM_REACHED",
      reviewId: round.reviewId,
      evidenceCommitment: round.evidenceCommitment,
      roundNumber: round.roundNumber,
      decision: "VERIFIED",
      instructionCommitment: `0x${"0".repeat(64)}`,
      transactionHash: `0x${"a".repeat(64)}`,
      blockNumber: 123,
    };
    await assert.rejects(context.repository.reconcileConfirmedOutcome({
      reviewRoundId: round.id,
      event: { ...event, evidenceCommitment: `0x${"b".repeat(64)}` },
      now: NOW,
    }), { code: "CHAIN_EVENT_MISMATCH" });
    assert.equal((await context.pool.query("SELECT status FROM verifications WHERE review_round_id = $1", [round.id])).rows[0].status, "PENDING");

    const result = await context.repository.reconcileConfirmedOutcome({ reviewRoundId: round.id, event, now: NOW });
    assert.equal(result.reviewRoundStatus, "QUORUM_REACHED");
    assert.equal(result.verificationStatus, "VERIFIED");
    assert.equal(result.blockNumber, 123);
    assert.equal((await context.pool.query("SELECT status, decision FROM review_rounds WHERE id = $1", [round.id])).rows[0].decision, "VERIFIED");
    assert.equal((await context.pool.query("SELECT status FROM verifications WHERE review_round_id = $1", [round.id])).rows[0].status, "VERIFIED");
    assert.equal((await context.repository.reconcileConfirmedOutcome({ reviewRoundId: round.id, event, now: NOW })).idempotent, true);
    await assert.rejects(context.repository.reconcileConfirmedOutcome({
      reviewRoundId: round.id,
      event: { ...event, decision: "REJECTED", transactionHash: `0x${"c".repeat(64)}` },
      now: NOW,
    }), { code: "REVIEW_OUTCOME_ALREADY_FINALIZED" });
  } finally {
    await context.cleanup();
  }
});

test("confirmed NO_QUORUM keeps verification pending without a database override", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("UPDATE review_rounds SET status = 'OPEN' WHERE id = $1", [round.id]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const result = await context.repository.reconcileConfirmedOutcome({
      reviewRoundId: round.id,
      event: {
        kind: "NO_QUORUM",
        reviewId: round.reviewId,
        evidenceCommitment: round.evidenceCommitment,
        roundNumber: round.roundNumber,
        transactionHash: `0x${"d".repeat(64)}`,
        blockNumber: 456,
      },
      now: NOW,
    });
    assert.equal(result.reviewRoundStatus, "NO_QUORUM");
    assert.equal(result.verificationStatus, "PENDING");
    assert.equal((await context.pool.query("SELECT status FROM verifications WHERE review_round_id = $1", [round.id])).rows[0].status, "PENDING");
  } finally {
    await context.cleanup();
  }
});

test("Admin review metadata contains operational counts but no content, wallet, or vote fields", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("UPDATE review_rounds SET status = 'OPEN' WHERE id = $1", [round.id]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const verifier = round.panel[0];
    await context.repository.persistSignedVote({
      reviewRoundId: round.id,
      verifierUserId: verifier.verifierUserId,
      walletAddress: verifier.walletAddress,
      decision: "VERIFIED",
      eip712Signature: `0x${"a".repeat(130)}`,
      noConflictAttested: true,
      internalNotes: "private verifier note",
      now: NOW,
    });
    const [metadata] = await context.repository.listAdminReviewMetadata();
    assert.deepEqual(metadata, {
      reviewRoundId: round.id,
      evidenceId: context.evidenceId,
      roundNumber: 1,
      status: "OPEN",
      voteCount: 1,
      assignedVerifierCount: 3,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
    });
    assert.equal(JSON.stringify(metadata).includes("private verifier note"), false);
    assert.equal(JSON.stringify(metadata).includes(verifier.walletAddress), false);
  } finally {
    await context.cleanup();
  }
});

test("assigned Verifier detail exposes only that Verifier's private note and review metadata", async () => {
  const context = await makeContext();
  try {
    const client = await context.pool.connect();
    let round;
    try {
      await client.query("BEGIN");
      round = await context.repository.createRound(client, { evidenceId: context.evidenceId, now: NOW });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const ownVerifier = round.panel[0];
    const otherVerifier = round.panel[1];
    assert.equal(await context.repository.getAssignedReviewDetails({ reviewRoundId: round.id, verifierUserId: ownVerifier.verifierUserId }), null);
    const opened = await context.pool.query("UPDATE review_rounds SET status = 'OPEN' WHERE id = $1", [round.id]);
    assert.equal(opened.rowCount, 1);
    await context.repository.persistSignedVote({
      reviewRoundId: round.id,
      verifierUserId: ownVerifier.verifierUserId,
      walletAddress: ownVerifier.walletAddress,
      decision: "VERIFIED",
      eip712Signature: `0x${"a".repeat(130)}`,
      noConflictAttested: true,
      internalNotes: "Only this Verifier can read this note.",
      now: NOW,
    });
    await context.repository.persistSignedVote({
      reviewRoundId: round.id,
      verifierUserId: otherVerifier.verifierUserId,
      walletAddress: otherVerifier.walletAddress,
      decision: "REJECTED",
      eip712Signature: `0x${"b".repeat(130)}`,
      noConflictAttested: true,
      internalNotes: "Another private note.",
      now: NOW,
    });
    const own = await context.repository.getAssignedReviewDetails({ reviewRoundId: round.id, verifierUserId: ownVerifier.verifierUserId });
    assert.equal(own.ownVote.decision, "VERIFIED");
    assert.equal(own.ownVote.internalNotes, "Only this Verifier can read this note.");
    assert.equal("eip712Signature" in own.ownVote, false);
    const other = await context.repository.getAssignedReviewDetails({ reviewRoundId: round.id, verifierUserId: otherVerifier.verifierUserId });
    assert.equal(other.ownVote.decision, "REJECTED");
    assert.equal(other.ownVote.internalNotes, "Another private note.");
    assert.equal(JSON.stringify(other).includes("Only this Verifier can read this note."), false);
  } finally {
    await context.cleanup();
  }
});
