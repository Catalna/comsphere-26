import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, Wallet } from "ethers";

import { createPeerReviewService } from "../../src/review/peerReviewService.js";
import { buildVoteTypedData, buildWalletBindingTypedData, computeOrganizerInstructionCommitment } from "../../src/review/eip712.js";

const CHAIN_ID = 31337;
const CONTRACT_ADDRESS = `0x${"c".repeat(40)}`;
const NOW = new Date("2026-10-06T12:00:00.000Z");
const ACTOR = { id: "verifier-user-1", role: "VERIFIER", status: "ACTIVE" };
const walletFor = (index) => new Wallet(`0x${String(index).padStart(64, "0")}`);
const commitment = (byte) => `0x${byte.repeat(64)}`;
const TRANSACTION_HASH = `0x${"f".repeat(64)}`;

function makeService({ repository = {}, contract = {}, chainId = CHAIN_ID, contractAddress = CONTRACT_ADDRESS } = {}) {
  const storedChallenges = new Map();
  return createPeerReviewService({
    repository: {
      createWalletChallenge: async (input) => {
        const challenge = { challengeId: "fca2aa20-71bb-48cb-b6dd-258f36a9b94a", ...input };
        storedChallenges.set(challenge.challengeId, challenge);
        return challenge;
      },
      getWalletChallenge: async ({ challengeId, verifierUserId }) => {
        const challenge = storedChallenges.get(challengeId);
        return challenge?.verifierUserId === verifierUserId ? challenge : null;
      },
      persistSignedVote: async () => ({ voteId: "vote-1", submissionId: "submission-1", status: "QUEUED", idempotent: false }),
      markVoteSubmitted: async () => {},
      markVoteSubmissionFailed: async () => {},
      confirmVoteSubmission: async () => {},
      consumeAndBindWallet: async (input) => ({
        verifierUserId: input.verifierUserId,
        walletAddress: input.walletAddress,
        rosterVersion: input.rosterVersion,
      }),
      findAssignedRoundForVote: async () => ({
        reviewRoundId: "review-round-1",
        reviewId: commitment("1"),
        evidenceCommitment: commitment("2"),
        organizerOrganizationCommitment: commitment("3"),
        funderOrganizationCommitment: commitment("4"),
        roundNumber: 1,
        status: "OPEN",
        walletAddress: walletFor(1).address,
      }),
      reconcileConfirmedOutcome: async ({ event }) => ({
        reviewRoundStatus: event.kind,
        verificationStatus: event.decision ?? "PENDING",
        decision: event.decision ?? null,
      }),
      ...repository,
    },
    contract: {
      isVerifier: async () => true,
      rosterVersion: async () => 1n,
      ...contract,
    },
    chainId,
    contractAddress,
    challengeTtlMs: 5 * 60_000,
    now: () => NOW,
  });
}

test("active Verifier binds only an on-roster wallet using a one-time contract-scoped challenge", async () => {
  const wallet = walletFor(1);
  const stored = [];
  const service = makeService({
    repository: {
      consumeAndBindWallet: async (input) => {
        stored.push(input);
        return { verifierUserId: input.verifierUserId, walletAddress: input.walletAddress, rosterVersion: input.rosterVersion };
      },
    },
  });

  const challenge = await service.createWalletChallenge({ actor: ACTOR, walletAddress: wallet.address, now: NOW });
  const signature = await wallet.signTypedData(challenge.typedData.domain, challenge.typedData.types, challenge.typedData.message);
  const binding = await service.bindVerifierWallet({
    actor: ACTOR,
    challengeId: challenge.challengeId,
    walletAddress: wallet.address,
    signature,
    now: NOW,
  });

  assert.deepEqual(binding, { verifierUserId: ACTOR.id, walletAddress: wallet.address.toLowerCase(), rosterVersion: 1 });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].challengeId, challenge.challengeId);
});

test("wallet binding rejects a wrong signer, chain, verifying contract, role, or off-roster address", async () => {
  const service = makeService({ contract: { isVerifier: async (address) => address === walletFor(1).address } });
  const challenge = await service.createWalletChallenge({ actor: ACTOR, walletAddress: walletFor(1).address, now: NOW });
  const typed = challenge.typedData;
  const validSignature = await walletFor(1).signTypedData(typed.domain, typed.types, typed.message);
  const wrongSignerSignature = await walletFor(2).signTypedData(typed.domain, typed.types, typed.message);
  const wrongChainSignature = await walletFor(1).signTypedData({ ...typed.domain, chainId: CHAIN_ID + 1 }, typed.types, typed.message);
  const wrongContractSignature = await walletFor(1).signTypedData({ ...typed.domain, verifyingContract: `0x${"d".repeat(40)}` }, typed.types, typed.message);

  for (const signature of [wrongSignerSignature, wrongChainSignature, wrongContractSignature]) {
    await assert.rejects(
      service.bindVerifierWallet({ actor: ACTOR, challengeId: challenge.challengeId, walletAddress: walletFor(1).address, signature, now: NOW }),
      { code: "INVALID_WALLET_SIGNATURE" },
    );
  }
  await assert.rejects(
    service.bindVerifierWallet({ actor: { ...ACTOR, role: "ADMIN" }, challengeId: challenge.challengeId, walletAddress: walletFor(1).address, signature: validSignature, now: NOW }),
    { code: "FORBIDDEN" },
  );
  const offRosterChallenge = await service.createWalletChallenge({ actor: ACTOR, walletAddress: walletFor(2).address, now: NOW });
  await assert.rejects(
    service.bindVerifierWallet({ actor: ACTOR, challengeId: offRosterChallenge.challengeId, walletAddress: walletFor(2).address, signature: await walletFor(2).signTypedData(offRosterChallenge.typedData.domain, offRosterChallenge.typedData.types, offRosterChallenge.typedData.message), now: NOW }),
    { code: "WALLET_NOT_ON_ROSTER" },
  );
});

test("vote signature is recovered against the assigned round and exact contract domain", async () => {
  const wallet = walletFor(1);
  const service = makeService();
  const round = await service.getAssignedRoundForVote({ actor: ACTOR, reviewRoundId: "review-round-1" });
  const expectedVote = {
    reviewId: round.reviewId,
    evidenceCommitment: round.evidenceCommitment,
    organizerOrganizationCommitment: round.organizerOrganizationCommitment,
    funderOrganizationCommitment: round.funderOrganizationCommitment,
    round: 1,
    decision: 1,
    instructionCommitment: `0x${"0".repeat(64)}`,
    noConflictAttested: true,
  };
  const typed = buildVoteTypedData({ name: "DanaTerang Peer Review", version: "1", chainId: CHAIN_ID, verifyingContract: CONTRACT_ADDRESS }, expectedVote);
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);

  const result = await service.verifyAssignedVote({
    actor: ACTOR,
    reviewRoundId: round.reviewRoundId,
    decision: "VERIFIED",
    noConflictAttested: true,
    signature,
  });
  assert.equal(result.signer, wallet.address);
  assert.deepEqual(result.vote, expectedVote);
});

test("vote verification rejects wrong signer, chain, contract, evidence version, and round", async () => {
  const service = makeService();
  const round = await service.getAssignedRoundForVote({ actor: ACTOR, reviewRoundId: "review-round-1" });
  const expectedVote = {
    reviewId: round.reviewId,
    evidenceCommitment: round.evidenceCommitment,
    organizerOrganizationCommitment: round.organizerOrganizationCommitment,
    funderOrganizationCommitment: round.funderOrganizationCommitment,
    round: 1,
    decision: 1,
    instructionCommitment: `0x${"0".repeat(64)}`,
    noConflictAttested: true,
  };
  const domain = { name: "DanaTerang Peer Review", version: "1", chainId: CHAIN_ID, verifyingContract: CONTRACT_ADDRESS };
  const sign = (wallet, vote = expectedVote, signingDomain = domain) => wallet.signTypedData(
    signingDomain,
    buildVoteTypedData(domain, vote).types,
    vote,
  );
  const invalidSignatures = [
    await sign(walletFor(2)),
    await sign(walletFor(1), expectedVote, { ...domain, chainId: CHAIN_ID + 1 }),
    await sign(walletFor(1), expectedVote, { ...domain, verifyingContract: `0x${"d".repeat(40)}` }),
    await sign(walletFor(1), { ...expectedVote, evidenceCommitment: commitment("5") }),
    await sign(walletFor(1), { ...expectedVote, round: 2 }),
  ];

  for (const signature of invalidSignatures) {
    await assert.rejects(
      service.verifyAssignedVote({ actor: ACTOR, reviewRoundId: round.reviewRoundId, decision: "VERIFIED", noConflictAttested: true, signature }),
      { code: "INVALID_VOTE_SIGNATURE" },
    );
  }
});

test("review services refuse incomplete contract configuration", () => {
  assert.throws(() => makeService({ chainId: null }), { code: "REVIEW_SERVICE_NOT_CONFIGURED" });
  assert.throws(() => makeService({ contractAddress: null }), { code: "REVIEW_SERVICE_NOT_CONFIGURED" });
});

test("typed-data builders bind wallet challenges to user, nonce, wallet, expiry, chain and contract", () => {
  const domain = { name: "DanaTerang Peer Review", version: "1", chainId: CHAIN_ID, verifyingContract: CONTRACT_ADDRESS };
  const challenge = buildWalletBindingTypedData(domain, {
    challengeId: "fca2aa20-71bb-48cb-b6dd-258f36a9b94a",
    verifierUserId: ACTOR.id,
    nonce: commitment("a"),
    walletAddress: walletFor(1).address,
    expiresAt: Math.floor((NOW.getTime() + 5 * 60_000) / 1000),
  });
  assert.equal(challenge.domain.verifyingContract, getAddress(CONTRACT_ADDRESS));
  assert.equal(challenge.message.verifierUserId, ACTOR.id);
  assert.equal(challenge.message.walletAddress, walletFor(1).address);
  assert.equal(challenge.message.expiresAt, Math.floor((NOW.getTime() + 5 * 60_000) / 1000));
});

test("Organizer instructions are committed with a private salt before vote signing", () => {
  const salt = "a".repeat(64);
  const first = computeOrganizerInstructionCommitment({ instructions: "Please add the dated receipt.", salt });
  const same = computeOrganizerInstructionCommitment({ instructions: "Please add the dated receipt.", salt });
  const differentSalt = computeOrganizerInstructionCommitment({ instructions: "Please add the dated receipt.", salt: "b".repeat(64) });
  const differentText = computeOrganizerInstructionCommitment({ instructions: "Please add the vendor details.", salt });

  assert.equal(first, same);
  assert.notEqual(first, differentSalt);
  assert.notEqual(first, differentText);
});

test("a signed revision vote is persisted and relayed without exposing private instructions", async () => {
  const calls = { persisted: null, relayed: null, submitted: null, confirmed: null };
  const service = makeService({
    repository: {
      persistSignedVote: async (input) => {
        calls.persisted = input;
        return { voteId: "vote-1", submissionId: "submission-1", status: "QUEUED", idempotent: false };
      },
      markVoteSubmitted: async (input) => { calls.submitted = input; },
      confirmVoteSubmission: async (input) => { calls.confirmed = input; },
    },
    contract: {
      submitVote: async (vote, signature) => {
        calls.relayed = { vote, signature };
        return { hash: TRANSACTION_HASH, wait: async () => ({ status: 1, blockNumber: 42, logs: [] }) };
      },
    },
  });
  const prepared = await service.prepareVote({
    actor: ACTOR,
    reviewRoundId: "review-round-1",
    decision: "NEEDS_REVISION",
    organizerInstructions: "Please attach the dated original receipt.",
    noConflictAttested: true,
  });
  assert.equal(JSON.stringify(prepared.typedData).includes("dated original receipt"), false);
  const signature = await walletFor(1).signTypedData(prepared.typedData.domain, prepared.typedData.types, prepared.typedData.message);
  const result = await service.submitVote({
    actor: ACTOR,
    reviewRoundId: "review-round-1",
    decision: "NEEDS_REVISION",
    organizerInstructions: "Please attach the dated original receipt.",
    instructionSalt: prepared.instructionSalt,
    internalNotes: "Date is absent; avoid relying on the cropped image.",
    noConflictAttested: true,
    signature,
    now: NOW,
  });

  assert.equal(result.status, "PENDING");
  assert.equal(result.transactionHash, TRANSACTION_HASH);
  assert.equal(calls.persisted.organizerInstructionCommitment, prepared.typedData.message.instructionCommitment);
  assert.equal(calls.persisted.organizerInstructions, "Please attach the dated original receipt.");
  assert.equal(calls.persisted.internalNotes, "Date is absent; avoid relying on the cropped image.");
  assert.equal(calls.relayed.vote.instructionCommitment, prepared.typedData.message.instructionCommitment);
  assert.equal(calls.submitted.transactionHash, TRANSACTION_HASH);
  assert.equal(calls.confirmed.blockNumber, 42);
});

test("waiting rounds open on chain only when their stored verifier roster exactly matches", async () => {
  const pendingRound = {
    reviewRoundId: "review-round-1",
    roundNumber: 1,
    reviewId: commitment("1"),
    evidenceCommitment: commitment("2"),
    organizerOrganizationCommitment: commitment("3"),
    funderOrganizationCommitment: commitment("4"),
    rosterVersion: 1,
    contractAddress: CONTRACT_ADDRESS,
    panel: [1, 2, 3].map((index) => ({
      walletAddress: walletFor(index).address.toLowerCase(),
      organizationCommitment: commitment(String(index + 4)),
    })),
  };
  const calls = { opened: null, submitted: null, confirmed: null };
  const service = makeService({
    repository: {
      listWaitingForChainRounds: async () => [pendingRound],
      recordRoundOpenSubmitted: async (input) => { calls.submitted = input; },
      markRoundOpen: async (input) => { calls.confirmed = input; return { status: "OPEN" }; },
      recordRoundRegistrationIssue: async () => { throw new Error("Unexpected registration issue"); },
    },
    contract: {
      rosterVersion: async () => 1n,
      verifierAt: async (index) => [walletFor(index + 1).address, commitment(String(index + 5))],
      getReview: async () => calls.opened
        ? [pendingRound.evidenceCommitment, 1, 0, 0, 1, pendingRound.panel.map((member) => member.walletAddress)]
        : [commitment("0"), 0, 0, 0, 0, [walletFor(1).address, walletFor(2).address, walletFor(3).address]],
      openReview: async (...args) => {
        calls.opened = args;
        return {
          hash: TRANSACTION_HASH,
          wait: async () => ({ status: 1, blockNumber: 54, logs: [{ address: CONTRACT_ADDRESS, name: "ReviewOpened" }] }),
        };
      },
      interface: {
        parseLog: () => ({
          name: "ReviewOpened",
          args: {
            reviewId: pendingRound.reviewId,
            evidenceCommitment: pendingRound.evidenceCommitment,
            round: 1,
            rosterVersion: 1,
            panel: pendingRound.panel.map((member) => member.walletAddress),
          },
        }),
      },
    },
  });

  const results = await service.registerWaitingRounds({ now: NOW });
  assert.equal(results[0].status, "OPEN");
  assert.deepEqual(calls.opened, [
    pendingRound.reviewId,
    pendingRound.evidenceCommitment,
    1,
    pendingRound.organizerOrganizationCommitment,
    pendingRound.funderOrganizationCommitment,
  ]);
  assert.equal(calls.submitted.transactionHash, TRANSACTION_HASH);
  assert.equal(calls.confirmed.blockNumber, 54);
});

test("background receipt reconciliation keeps unknown transactions pending and applies only confirmed quorum events", async () => {
  let receipt = null;
  const calls = { confirmed: null, outcome: null };
  const service = makeService({
    repository: {
      listPendingVoteSubmissions: async () => [{ voteId: "vote-1", reviewRoundId: "review-round-1", transactionHash: TRANSACTION_HASH }],
      confirmVoteSubmission: async (input) => { calls.confirmed = input; },
      reconcileConfirmedOutcome: async (input) => {
        calls.outcome = input;
        return { reviewRoundStatus: "QUORUM_REACHED", verificationStatus: "VERIFIED", decision: "VERIFIED" };
      },
    },
    contract: {
      address: CONTRACT_ADDRESS,
      runner: { provider: { async getTransactionReceipt() { return receipt; } } },
      interface: {
        parseLog: () => ({
          name: "ReviewFinalized",
          args: {
            reviewId: commitment("1"),
            evidenceCommitment: commitment("2"),
            round: 1,
            decision: 1,
            instructionCommitment: `0x${"0".repeat(64)}`,
          },
        }),
      },
    },
  });

  const pending = await service.reconcilePendingVoteSubmissions({ now: NOW });
  assert.equal(pending[0].status, "SUBMITTED");
  assert.equal(calls.confirmed, null);

  receipt = { status: 1, blockNumber: 70, logs: [{ address: CONTRACT_ADDRESS }] };
  const confirmed = await service.reconcilePendingVoteSubmissions({ now: NOW });
  assert.equal(confirmed[0].status, "QUORUM_REACHED");
  assert.equal(calls.confirmed.blockNumber, 70);
  assert.equal(calls.outcome.event.instructionCommitment, `0x${"0".repeat(64)}`);
  assert.equal(calls.outcome.event.transactionHash, TRANSACTION_HASH);
});
