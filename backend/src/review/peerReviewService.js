import { randomBytes } from "node:crypto";
import { getAddress, hexlify, verifyTypedData } from "ethers";

import {
  buildVoteTypedData,
  buildWalletBindingTypedData,
  createReviewDomain,
  computeOrganizerInstructionCommitment,
  VOTE_TYPES,
} from "./eip712.js";

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const DECISIONS = new Map([
  ["VERIFIED", 1],
  ["NEEDS_REVISION", 2],
  ["REJECTED", 3],
]);

function serviceError(code) {
  return Object.assign(new Error(code), { code });
}

function requireActiveVerifier(actor) {
  if (actor?.role !== "VERIFIER" || actor?.status !== "ACTIVE" || typeof actor.id !== "string") {
    throw serviceError("FORBIDDEN");
  }
}

function validateNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw serviceError("INVALID_REVIEW_TIME");
}

function validExpiry(value) {
  const milliseconds = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) throw serviceError("WALLET_CHALLENGE_INVALID");
  return { milliseconds, seconds: Math.floor(milliseconds / 1000) };
}

function recover(domain, types, message, signature) {
  try {
    return getAddress(verifyTypedData(domain, types, message, signature));
  } catch {
    throw serviceError("INVALID_WALLET_SIGNATURE");
  }
}

function voteMessage(round, decision, instructionCommitment) {
  return {
    reviewId: round.reviewId,
    evidenceCommitment: round.evidenceCommitment,
    organizerOrganizationCommitment: round.organizerOrganizationCommitment,
    funderOrganizationCommitment: round.funderOrganizationCommitment,
    round: Number(round.roundNumber),
    decision: DECISIONS.get(decision),
    instructionCommitment,
    noConflictAttested: true,
  };
}

function outcomeFromReceipt(contract, receipt, transactionHash) {
  if (!contract.interface || typeof contract.interface.parseLog !== "function" || !Array.isArray(receipt.logs)) return null;
  for (const log of receipt.logs) {
    if (log.address && log.address.toLowerCase() !== contractAddressOf(contract).toLowerCase()) continue;
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (!parsed || !["ReviewFinalized", "ReviewNoQuorum"].includes(parsed.name)) continue;
    const args = parsed.args;
    const decisionNumber = Number(args.decision ?? args[3]);
    return {
      kind: parsed.name === "ReviewFinalized" ? "QUORUM_REACHED" : "NO_QUORUM",
      reviewId: args.reviewId ?? args[0],
      evidenceCommitment: args.evidenceCommitment ?? args[1],
      roundNumber: Number(args.round ?? args[2]),
      decision: parsed.name === "ReviewFinalized" ? [...DECISIONS].find(([, value]) => value === decisionNumber)?.[0] : null,
      instructionCommitment: parsed.name === "ReviewFinalized" ? (args.instructionCommitment ?? args[4]) : null,
      transactionHash,
      blockNumber: Number(receipt.blockNumber),
    };
  }
  return null;
}

function contractAddressOf(contract) {
  return contract.target ?? contract.address ?? "";
}

function tupleValue(tuple, name, index) {
  return tuple?.[name] ?? tuple?.[index];
}

function openedEventFromReceipt(contract, receipt, expectedContractAddress) {
  if (!contract.interface || typeof contract.interface.parseLog !== "function" || !Array.isArray(receipt.logs)) return null;
  for (const log of receipt.logs) {
    if (log.address && log.address.toLowerCase() !== expectedContractAddress.toLowerCase()) continue;
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== "ReviewOpened") continue;
    const args = parsed.args;
    return {
      reviewId: args.reviewId ?? args[0],
      evidenceCommitment: args.evidenceCommitment ?? args[1],
      roundNumber: Number(args.round ?? args[2]),
      rosterVersion: Number(args.rosterVersion ?? args[3]),
      panel: [...(args.panel ?? args[4])].map((address) => getAddress(address).toLowerCase()),
    };
  }
  return null;
}

function reviewViewMatches(round, view) {
  const evidenceCommitment = tupleValue(view, "evidenceCommitment", 0);
  const status = Number(tupleValue(view, "status", 1));
  const rosterVersion = Number(tupleValue(view, "roundRosterVersion", 4));
  const panel = tupleValue(view, "panel", 5);
  if (status !== 1 || evidenceCommitment?.toLowerCase() !== round.evidenceCommitment.toLowerCase()
      || rosterVersion !== round.rosterVersion || !Array.isArray(panel) || panel.length !== 3) return false;
  const expected = round.panel.map((member) => member.walletAddress.toLowerCase()).sort();
  return [...panel].map((address) => getAddress(address).toLowerCase()).sort().every((address, index) => address === expected[index]);
}

export function createPeerReviewService({ repository, contract, chainId, contractAddress, challengeTtlMs = 5 * 60_000, onQuorumFinalized = null, now: clock = () => new Date() } = {}) {
  if (!repository || !contract || !Number.isSafeInteger(Number(chainId)) || Number(chainId) < 1
      || typeof contractAddress !== "string" || !Number.isSafeInteger(challengeTtlMs) || challengeTtlMs < 30_000) {
    throw serviceError("REVIEW_SERVICE_NOT_CONFIGURED");
  }

  let domain;
  try {
    domain = createReviewDomain({ chainId: Number(chainId), verifyingContract: contractAddress });
  } catch {
    throw serviceError("REVIEW_SERVICE_NOT_CONFIGURED");
  }

  return Object.freeze({
    async createWalletChallenge({ actor, walletAddress, now = clock() } = {}) {
      requireActiveVerifier(actor);
      validateNow(now);
      if (typeof repository.createWalletChallenge !== "function") throw serviceError("REVIEW_SERVICE_NOT_CONFIGURED");
      let normalizedAddress;
      try {
        normalizedAddress = getAddress(walletAddress);
      } catch {
        throw serviceError("INVALID_WALLET_ADDRESS");
      }
      const nonce = hexlify(randomBytes(32));
      const expiresAt = new Date(now.getTime() + challengeTtlMs);
      const challenge = await repository.createWalletChallenge({
        verifierUserId: actor.id,
        walletAddress: normalizedAddress.toLowerCase(),
        nonce,
        expiresAt,
        now,
      });
      if (!challenge?.challengeId) throw serviceError("WALLET_CHALLENGE_CREATE_FAILED");
      const typedData = buildWalletBindingTypedData(domain, {
        challengeId: challenge.challengeId,
        verifierUserId: actor.id,
        nonce: challenge.nonce ?? nonce,
        walletAddress: normalizedAddress,
        expiresAt: Math.floor(new Date(challenge.expiresAt ?? expiresAt).getTime() / 1000),
      });
      return {
        challengeId: challenge.challengeId,
        nonce: typedData.message.nonce,
        expiresAt: new Date(challenge.expiresAt ?? expiresAt).toISOString(),
        typedData,
      };
    },

    async bindVerifierWallet({ actor, challengeId, walletAddress, signature, now = clock() } = {}) {
      requireActiveVerifier(actor);
      validateNow(now);
      if (typeof repository.getWalletChallenge !== "function"
          || typeof repository.consumeAndBindWallet !== "function"
          || typeof contract.isVerifier !== "function"
          || typeof contract.rosterVersion !== "function") {
        throw serviceError("REVIEW_SERVICE_NOT_CONFIGURED");
      }
      let normalizedAddress;
      try {
        normalizedAddress = getAddress(walletAddress);
      } catch {
        throw serviceError("INVALID_WALLET_ADDRESS");
      }
      const challenge = await repository.getWalletChallenge({ challengeId, verifierUserId: actor.id, now });
      if (!challenge || challenge.consumedAt) throw serviceError("WALLET_CHALLENGE_INVALID");
      if (typeof challenge.walletAddress !== "string" || challenge.walletAddress.toLowerCase() !== normalizedAddress.toLowerCase()) {
        throw serviceError("WALLET_CHALLENGE_INVALID");
      }
      const expiresAt = validExpiry(challenge.expiresAt);
      if (expiresAt.milliseconds <= now.getTime()) throw serviceError("WALLET_CHALLENGE_INVALID");

      const typedData = buildWalletBindingTypedData(domain, {
        challengeId,
        verifierUserId: actor.id,
        nonce: challenge.nonce,
        walletAddress: normalizedAddress,
        expiresAt: expiresAt.seconds,
      });
      const signer = recover(domain, typedData.types, typedData.message, signature);
      if (signer !== normalizedAddress) throw serviceError("INVALID_WALLET_SIGNATURE");
      if (!(await contract.isVerifier(normalizedAddress))) throw serviceError("WALLET_NOT_ON_ROSTER");
      const rosterVersion = Number(await contract.rosterVersion());
      if (!Number.isSafeInteger(rosterVersion) || rosterVersion < 1) throw serviceError("VERIFIER_ROSTER_UNAVAILABLE");

      return repository.consumeAndBindWallet({
        challengeId,
        verifierUserId: actor.id,
        walletAddress: normalizedAddress.toLowerCase(),
        rosterVersion,
        now,
      });
    },

    async getAssignedRoundForVote({ actor, reviewRoundId } = {}) {
      requireActiveVerifier(actor);
      if (typeof repository.findAssignedRoundForVote !== "function") throw serviceError("REVIEW_SERVICE_NOT_CONFIGURED");
      const round = await repository.findAssignedRoundForVote({ reviewRoundId, verifierUserId: actor.id });
      if (!round) throw serviceError("REVIEW_NOT_FOUND");
      if (round.status !== "OPEN") throw serviceError("REVIEW_NOT_OPEN");
      return round;
    },

    async registerWaitingRounds({ limit = 20, now = clock() } = {}) {
      validateNow(now);
      if (typeof repository.listWaitingForChainRounds !== "function"
          || typeof repository.recordRoundOpenSubmitted !== "function"
          || typeof repository.markRoundOpen !== "function"
          || typeof repository.recordRoundRegistrationIssue !== "function"
          || typeof contract.rosterVersion !== "function"
          || typeof contract.verifierAt !== "function"
          || typeof contract.getReview !== "function"
          || typeof contract.openReview !== "function") {
        throw serviceError("REVIEW_SERVICE_NOT_CONFIGURED");
      }
      const rounds = await repository.listWaitingForChainRounds({ limit });
      const results = [];
      for (const round of rounds) {
        try {
          const currentRosterVersion = Number(await contract.rosterVersion());
          const onchainRoster = [];
          for (let index = 0; index < 3; index += 1) {
            const member = await contract.verifierAt(index);
            onchainRoster.push({
              walletAddress: getAddress(tupleValue(member, "verifier", 0)).toLowerCase(),
              organizationCommitment: String(tupleValue(member, "organizationCommitment", 1)).toLowerCase(),
            });
          }
          const storedRoster = round.panel.map((member) => ({
            walletAddress: getAddress(member.walletAddress).toLowerCase(),
            organizationCommitment: member.organizationCommitment.toLowerCase(),
          })).sort((left, right) => left.walletAddress.localeCompare(right.walletAddress));
          const contractRoster = onchainRoster.sort((left, right) => left.walletAddress.localeCompare(right.walletAddress));
          const rosterMatches = currentRosterVersion === round.rosterVersion
            && storedRoster.length === 3
            && contractRoster.every((member, index) => member.walletAddress === storedRoster[index]?.walletAddress
              && member.organizationCommitment === storedRoster[index]?.organizationCommitment);
          if (!rosterMatches) {
            await repository.recordRoundRegistrationIssue({
              reviewRoundId: round.reviewRoundId,
              errorCode: "VERIFIER_ROSTER_MISMATCH",
              permanent: true,
              now,
            });
            results.push({
              reviewRoundId: round.reviewRoundId,
              status: "CHAIN_FAILED",
              errorCode: "VERIFIER_ROSTER_MISMATCH",
              diagnostics: {
                roundRosterVersion: round.rosterVersion,
                onchainRosterVersion: currentRosterVersion,
                roundRoster: storedRoster,
                onchainRoster: contractRoster,
              },
            });
            continue;
          }

          const view = await contract.getReview(round.reviewId, round.roundNumber);
          const viewStatus = Number(tupleValue(view, "status", 1));
          if (viewStatus !== 0 && viewStatus !== 1) {
            await repository.recordRoundRegistrationIssue({
              reviewRoundId: round.reviewRoundId,
              errorCode: "ONCHAIN_REVIEW_STATE_MISMATCH",
              permanent: true,
              now,
            });
            results.push({ reviewRoundId: round.reviewRoundId, status: "CHAIN_FAILED", errorCode: "ONCHAIN_REVIEW_STATE_MISMATCH" });
            continue;
          }

          let receipt = null;
          if (viewStatus === 1) {
            const provider = contract.runner?.provider;
            if (round.openTransactionHash && typeof provider?.getTransactionReceipt === "function") {
              receipt = await provider.getTransactionReceipt(round.openTransactionHash);
            }
            if ((!receipt || Number(receipt.status) !== 1)
                && typeof contract.queryFilter === "function" && typeof contract.filters?.ReviewOpened === "function") {
              receipt = null;
              const filter = contract.filters.ReviewOpened(round.reviewId, round.evidenceCommitment);
              const events = await contract.queryFilter(filter, 0, "latest");
              const opening = events.find((entry) => Number(tupleValue(entry.args, "round", 2)) === round.roundNumber);
              const transactionHash = opening?.transactionHash ?? opening?.log?.transactionHash;
              if (transactionHash && typeof provider?.getTransactionReceipt === "function") {
                receipt = await provider.getTransactionReceipt(transactionHash);
              }
              if (receipt && !round.openTransactionHash) round.openTransactionHash = transactionHash;
            }
            if (!receipt || Number(receipt.status) !== 1) {
              await repository.recordRoundRegistrationIssue({ reviewRoundId: round.reviewRoundId, errorCode: "OPEN_RECEIPT_PENDING", now });
              results.push({ reviewRoundId: round.reviewRoundId, status: "WAITING_FOR_CHAIN", errorCode: "OPEN_RECEIPT_PENDING" });
              continue;
            }
          } else {
            if (round.openTransactionHash) {
              const provider = contract.runner?.provider;
              const previousReceipt = typeof provider?.getTransactionReceipt === "function"
                ? await provider.getTransactionReceipt(round.openTransactionHash)
                : null;
              if (previousReceipt && Number(previousReceipt.status) !== 1) {
                await repository.recordRoundRegistrationIssue({
                  reviewRoundId: round.reviewRoundId,
                  errorCode: "CHAIN_RECEIPT_FAILED",
                  clearOpenTransactionHash: true,
                  now,
                });
                results.push({ reviewRoundId: round.reviewRoundId, status: "WAITING_FOR_CHAIN", errorCode: "CHAIN_RECEIPT_FAILED" });
              } else if (previousReceipt) {
                await repository.recordRoundRegistrationIssue({
                  reviewRoundId: round.reviewRoundId,
                  errorCode: "ONCHAIN_REVIEW_STATE_MISMATCH",
                  permanent: true,
                  now,
                });
                results.push({ reviewRoundId: round.reviewRoundId, status: "CHAIN_FAILED", errorCode: "ONCHAIN_REVIEW_STATE_MISMATCH" });
              } else {
                await repository.recordRoundRegistrationIssue({ reviewRoundId: round.reviewRoundId, errorCode: "OPEN_TRANSACTION_PENDING", now });
                results.push({ reviewRoundId: round.reviewRoundId, status: "WAITING_FOR_CHAIN", errorCode: "OPEN_TRANSACTION_PENDING" });
              }
              continue;
            }
            const transaction = await contract.openReview(
              round.reviewId,
              round.evidenceCommitment,
              round.roundNumber,
              round.organizerOrganizationCommitment,
              round.funderOrganizationCommitment,
            );
            if (typeof transaction?.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transaction.hash)) {
              await repository.recordRoundRegistrationIssue({ reviewRoundId: round.reviewRoundId, errorCode: "CHAIN_REGISTRATION_FAILED", now });
              results.push({ reviewRoundId: round.reviewRoundId, status: "WAITING_FOR_CHAIN", errorCode: "CHAIN_REGISTRATION_FAILED" });
              continue;
            }
            const transactionHash = transaction.hash.toLowerCase();
            await repository.recordRoundOpenSubmitted({ reviewRoundId: round.reviewRoundId, transactionHash, now });
            round.openTransactionHash = transactionHash;
            try {
              receipt = await transaction.wait();
            } catch {
              results.push({ reviewRoundId: round.reviewRoundId, status: "WAITING_FOR_CHAIN", transactionHash });
              continue;
            }
          }

          if (Number(receipt?.status) !== 1 || !Number.isSafeInteger(Number(receipt.blockNumber)) || Number(receipt.blockNumber) < 0) {
            await repository.recordRoundRegistrationIssue({ reviewRoundId: round.reviewRoundId, errorCode: "CHAIN_RECEIPT_FAILED", now });
            results.push({ reviewRoundId: round.reviewRoundId, status: "WAITING_FOR_CHAIN", errorCode: "CHAIN_RECEIPT_FAILED" });
            continue;
          }
          const event = openedEventFromReceipt(contract, receipt, contractAddress);
          const panelMatches = event?.panel?.length === 3
            && event.panel.slice().sort().every((address, index) => address === storedRoster[index]?.walletAddress);
          if (!event || event.reviewId.toLowerCase() !== round.reviewId.toLowerCase()
              || event.evidenceCommitment.toLowerCase() !== round.evidenceCommitment.toLowerCase()
              || event.roundNumber !== round.roundNumber || event.rosterVersion !== round.rosterVersion || !panelMatches) {
            await repository.recordRoundRegistrationIssue({
              reviewRoundId: round.reviewRoundId,
              errorCode: "OPEN_EVENT_MISMATCH",
              permanent: true,
              now,
            });
            results.push({ reviewRoundId: round.reviewRoundId, status: "CHAIN_FAILED", errorCode: "OPEN_EVENT_MISMATCH" });
            continue;
          }
          const confirmedView = await contract.getReview(round.reviewId, round.roundNumber);
          if (!reviewViewMatches(round, confirmedView)) {
            await repository.recordRoundRegistrationIssue({
              reviewRoundId: round.reviewRoundId,
              errorCode: "ONCHAIN_REVIEW_STATE_MISMATCH",
              permanent: true,
              now,
            });
            results.push({ reviewRoundId: round.reviewRoundId, status: "CHAIN_FAILED", errorCode: "ONCHAIN_REVIEW_STATE_MISMATCH" });
            continue;
          }
          const transactionHash = receipt.hash ?? receipt.transactionHash ?? round.openTransactionHash;
          const opened = await repository.markRoundOpen({
            reviewRoundId: round.reviewRoundId,
            transactionHash,
            blockNumber: Number(receipt.blockNumber),
            now,
          });
          results.push({ reviewRoundId: round.reviewRoundId, status: opened.status, transactionHash });
        } catch {
          await repository.recordRoundRegistrationIssue({ reviewRoundId: round.reviewRoundId, errorCode: "CHAIN_REGISTRATION_FAILED", now });
          results.push({ reviewRoundId: round.reviewRoundId, status: "WAITING_FOR_CHAIN", errorCode: "CHAIN_REGISTRATION_FAILED" });
        }
      }
      return results;
    },

    async prepareVote({ actor, reviewRoundId, decision, organizerInstructions, noConflictAttested } = {}) {
      const round = await this.getAssignedRoundForVote({ actor, reviewRoundId });
      if (!DECISIONS.has(decision) || noConflictAttested !== true) throw serviceError("INVALID_VOTE");
      let instructionSalt = null;
      let instructionCommitment = ZERO_BYTES32;
      if (decision === "NEEDS_REVISION") {
        if (typeof organizerInstructions !== "string" || organizerInstructions.trim().length < 1 || organizerInstructions.length > 4000) {
          throw serviceError("INVALID_VOTE");
        }
        instructionSalt = hexlify(randomBytes(32)).slice(2);
        instructionCommitment = computeOrganizerInstructionCommitment({ instructions: organizerInstructions, salt: instructionSalt });
      } else if (organizerInstructions != null) {
        throw serviceError("INVALID_VOTE");
      }
      const vote = voteMessage(round, decision, instructionCommitment);
      const typedData = buildVoteTypedData(domain, vote);
      return { typedData, instructionSalt };
    },

    async verifyAssignedVote({ actor, reviewRoundId, decision, instructionCommitment, noConflictAttested, signature } = {}) {
      const round = await this.getAssignedRoundForVote({ actor, reviewRoundId });
      if (typeof round.walletAddress !== "string") throw serviceError("VERIFIER_WALLET_NOT_BOUND");
      const decisionValue = DECISIONS.get(decision);
      if (!decisionValue || noConflictAttested !== true) throw serviceError("INVALID_VOTE");
      const commitment = instructionCommitment ?? ZERO_BYTES32;
      if (typeof commitment !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(commitment)
          || (decision === "NEEDS_REVISION" && commitment.toLowerCase() === ZERO_BYTES32)
          || (decision !== "NEEDS_REVISION" && commitment.toLowerCase() !== ZERO_BYTES32)) {
        throw serviceError("INVALID_VOTE");
      }
      const vote = voteMessage(round, decision, commitment);
      if (vote.decision !== decisionValue) throw serviceError("INVALID_VOTE");
      let assignedWallet;
      try {
        assignedWallet = getAddress(round.walletAddress);
      } catch {
        throw serviceError("VERIFIER_WALLET_NOT_BOUND");
      }
      const typedData = buildVoteTypedData(domain, vote);
      let signer;
      try {
        signer = getAddress(verifyTypedData(domain, VOTE_TYPES, typedData.message, signature));
      } catch {
        throw serviceError("INVALID_VOTE_SIGNATURE");
      }
      if (signer !== assignedWallet) throw serviceError("INVALID_VOTE_SIGNATURE");
      return { vote, signer, signature };
    },

    async submitVote({
      actor,
      reviewRoundId,
      decision,
      organizerInstructions = null,
      instructionSalt = null,
      internalNotes = "",
      noConflictAttested,
      signature,
      now = clock(),
    } = {}) {
      validateNow(now);
      if (typeof repository.persistSignedVote !== "function"
          || typeof repository.markVoteSubmitted !== "function"
          || typeof repository.markVoteSubmissionFailed !== "function"
          || typeof repository.confirmVoteSubmission !== "function"
          || typeof repository.reconcileConfirmedOutcome !== "function"
          || typeof contract.submitVote !== "function") {
        throw serviceError("REVIEW_SERVICE_NOT_CONFIGURED");
      }
      let instructionCommitment = ZERO_BYTES32;
      if (decision === "NEEDS_REVISION") {
        try {
          instructionCommitment = computeOrganizerInstructionCommitment({ instructions: organizerInstructions, salt: instructionSalt });
        } catch {
          throw serviceError("INVALID_VOTE");
        }
      } else if (organizerInstructions !== null || instructionSalt !== null) {
        throw serviceError("INVALID_VOTE");
      }
      const verified = await this.verifyAssignedVote({
        actor,
        reviewRoundId,
        decision,
        instructionCommitment,
        noConflictAttested,
        signature,
      });
      const stored = await repository.persistSignedVote({
        reviewRoundId,
        verifierUserId: actor.id,
        walletAddress: verified.signer.toLowerCase(),
        decision,
        eip712Signature: signature,
        noConflictAttested,
        organizerInstructionCommitment: decision === "NEEDS_REVISION" ? instructionCommitment : null,
        organizerInstructionSalt: decision === "NEEDS_REVISION" ? instructionSalt : null,
        organizerInstructions: decision === "NEEDS_REVISION" ? organizerInstructions.trim() : null,
        internalNotes,
        now,
      });
      if (stored.idempotent && ["SUBMITTED", "CONFIRMED"].includes(stored.status)) {
        return { status: "PENDING", voteId: stored.voteId, submissionId: stored.submissionId, transactionHash: stored.transactionHash ?? null };
      }

      let transaction;
      try {
        transaction = await contract.submitVote(verified.vote, verified.signature);
      } catch {
        await repository.markVoteSubmissionFailed({ voteId: stored.voteId, errorCode: "CHAIN_SUBMISSION_FAILED", now });
        return { status: "PENDING", voteId: stored.voteId, submissionId: stored.submissionId, transactionHash: null };
      }
      const transactionHash = typeof transaction?.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(transaction.hash)
        ? transaction.hash.toLowerCase()
        : null;
      if (!transactionHash) {
        await repository.markVoteSubmissionFailed({ voteId: stored.voteId, errorCode: "CHAIN_SUBMISSION_FAILED", now });
        return { status: "PENDING", voteId: stored.voteId, submissionId: stored.submissionId, transactionHash: null };
      }
      await repository.markVoteSubmitted({ voteId: stored.voteId, transactionHash, now });

      let receipt;
      try {
        receipt = await transaction.wait();
      } catch {
        return { status: "PENDING", voteId: stored.voteId, submissionId: stored.submissionId, transactionHash };
      }
      if (Number(receipt?.status) !== 1 || !Number.isSafeInteger(Number(receipt.blockNumber)) || Number(receipt.blockNumber) < 0) {
        await repository.markVoteSubmissionFailed({ voteId: stored.voteId, errorCode: "CHAIN_RECEIPT_FAILED", now });
        return { status: "PENDING", voteId: stored.voteId, submissionId: stored.submissionId, transactionHash };
      }
      await repository.confirmVoteSubmission({ voteId: stored.voteId, blockNumber: Number(receipt.blockNumber), now });
      const event = outcomeFromReceipt(contract, receipt, transactionHash);
      if (!event) return { status: "PENDING", voteId: stored.voteId, submissionId: stored.submissionId, transactionHash };
      const outcome = await repository.reconcileConfirmedOutcome({ reviewRoundId, event, now });
      if (outcome.reviewRoundStatus === "QUORUM_REACHED" && typeof onQuorumFinalized === "function") {
        try {
          await onQuorumFinalized({ reviewRoundId, decision: outcome.decision, now });
        } catch (error) {
          console.error(`Proof creation after quorum failed: ${error?.code ?? "unknown"}`);
        }
      }
      return {
        status: outcome.reviewRoundStatus,
        verificationStatus: outcome.verificationStatus,
        decision: outcome.decision,
        voteId: stored.voteId,
        submissionId: stored.submissionId,
        transactionHash,
      };
    },

    async reconcilePendingVoteSubmissions({ limit = 100, now = clock() } = {}) {
      validateNow(now);
      const provider = contract.runner?.provider;
      if (typeof repository.listPendingVoteSubmissions !== "function"
          || typeof repository.confirmVoteSubmission !== "function"
          || typeof repository.markVoteSubmissionFailed !== "function"
          || typeof repository.reconcileConfirmedOutcome !== "function"
          || typeof provider?.getTransactionReceipt !== "function") {
        throw serviceError("REVIEW_SERVICE_NOT_CONFIGURED");
      }
      const pending = await repository.listPendingVoteSubmissions({ limit });
      const results = [];
      for (const submission of pending) {
        let receipt;
        try {
          receipt = await provider.getTransactionReceipt(submission.transactionHash);
        } catch {
          results.push({ voteId: submission.voteId, status: "SUBMITTED", transactionHash: submission.transactionHash });
          continue;
        }
        if (!receipt) {
          results.push({ voteId: submission.voteId, status: "SUBMITTED", transactionHash: submission.transactionHash });
          continue;
        }
        if (Number(receipt.status) !== 1 || !Number.isSafeInteger(Number(receipt.blockNumber)) || Number(receipt.blockNumber) < 0) {
          await repository.markVoteSubmissionFailed({ voteId: submission.voteId, errorCode: "CHAIN_RECEIPT_FAILED", now });
          results.push({ voteId: submission.voteId, status: "FAILED", transactionHash: submission.transactionHash });
          continue;
        }
        await repository.confirmVoteSubmission({ voteId: submission.voteId, blockNumber: Number(receipt.blockNumber), now });
        const event = outcomeFromReceipt(contract, receipt, submission.transactionHash);
        if (!event) {
          results.push({ voteId: submission.voteId, status: "CONFIRMED", transactionHash: submission.transactionHash });
          continue;
        }
        const outcome = await repository.reconcileConfirmedOutcome({
          reviewRoundId: submission.reviewRoundId,
          event,
          now,
        });
        if (outcome.reviewRoundStatus === "QUORUM_REACHED" && typeof onQuorumFinalized === "function") {
          try {
            await onQuorumFinalized({ reviewRoundId: submission.reviewRoundId, decision: outcome.decision, now });
          } catch (error) {
            console.error(`Proof creation after quorum failed: ${error?.code ?? "unknown"}`);
          }
        }
        results.push({
          voteId: submission.voteId,
          status: outcome.reviewRoundStatus,
          verificationStatus: outcome.verificationStatus,
          transactionHash: submission.transactionHash,
        });
      }
      return results;
    },
  });
}
