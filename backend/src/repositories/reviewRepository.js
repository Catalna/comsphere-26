import { createHash, randomBytes, randomUUID } from "node:crypto";
import { computeOrganizerInstructionCommitment } from "../review/eip712.js";

function repositoryError(code) {
  return Object.assign(new Error(code), { code });
}

function commitment(label, value) {
  return `0x${createHash("sha256").update(`danaterang:${label}:v1:${value}`).digest("hex")}`;
}

function reviewId() {
  return `0x${randomBytes(32).toString("hex")}`;
}

async function inTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original repository failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

function sameVote(row, vote) {
  return row.wallet_address === vote.walletAddress
    && row.decision === vote.decision
    && row.eip712_signature.toLowerCase() === vote.eip712Signature.toLowerCase()
    && row.no_conflict_attested === vote.noConflictAttested
    && row.organizer_instruction_commitment === vote.organizerInstructionCommitment
    && row.organizer_instruction_salt === vote.organizerInstructionSalt
    && row.organizer_instructions === vote.organizerInstructions
    && row.internal_notes === vote.internalNotes;
}

export function createReviewRepository(pool, { contractAddress } = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL-compatible pool is required");
  }
  const validContractAddress = typeof contractAddress === "string" && /^0x[0-9a-f]{40}$/i.test(contractAddress)
    ? contractAddress.toLowerCase()
    : null;

  return Object.freeze({
    async createWalletChallenge({ verifierUserId, walletAddress, nonce, expiresAt, now = new Date() }) {
      if (typeof verifierUserId !== "string" || typeof walletAddress !== "string"
          || !/^0x[0-9a-f]{40}$/.test(walletAddress) || typeof nonce !== "string"
          || !/^0x[0-9a-f]{64}$/.test(nonce) || !(expiresAt instanceof Date)
          || !(now instanceof Date) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
        throw repositoryError("INVALID_WALLET_CHALLENGE");
      }
      const verifierResult = await pool.query(
        "SELECT id, role, status, organization_id FROM users WHERE id = $1 LIMIT 1",
        [verifierUserId],
      );
      const verifier = verifierResult.rows[0];
      if (!verifier || verifier.role !== "VERIFIER" || verifier.status !== "ACTIVE" || !verifier.organization_id) {
        throw repositoryError("FORBIDDEN");
      }
      await pool.query(
        `DELETE FROM verifier_wallet_challenges
         WHERE verifier_user_id = $1 AND (consumed_at IS NOT NULL OR expires_at <= $2)`,
        [verifierUserId, now],
      );
      const existing = await pool.query("SELECT verifier_user_id FROM verifier_wallets WHERE verifier_user_id = $1 LIMIT 1", [verifierUserId]);
      if (existing.rowCount > 0) throw repositoryError("VERIFIER_WALLET_ALREADY_BOUND");

      const id = randomUUID();
      const result = await pool.query(
        `INSERT INTO verifier_wallet_challenges (id, verifier_user_id, wallet_address, nonce, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, verifier_user_id, wallet_address, nonce, expires_at`,
        [id, verifierUserId, walletAddress, nonce, expiresAt, now],
      );
      const row = result.rows[0];
      return {
        challengeId: row.id,
        verifierUserId: row.verifier_user_id,
        walletAddress: row.wallet_address,
        nonce: row.nonce,
        expiresAt: row.expires_at,
      };
    },

    async getVerifierWallet(verifierUserId) {
      if (typeof verifierUserId !== "string") return null;
      const result = await pool.query(
        `SELECT verifier_user_id, wallet_address, organization_id, roster_version, status, verified_at
         FROM verifier_wallets WHERE verifier_user_id = $1 LIMIT 1`,
        [verifierUserId],
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return {
        verifierUserId: row.verifier_user_id,
        walletAddress: row.wallet_address,
        organizationId: row.organization_id,
        rosterVersion: Number(row.roster_version),
        status: row.status,
        verifiedAt: row.verified_at,
      };
    },

    async deleteVerifierWallet(verifierUserId) {
      if (typeof verifierUserId !== "string") return 0;
      await pool.query("DELETE FROM verifier_wallets WHERE verifier_user_id = $1", [verifierUserId]);
      await pool.query("DELETE FROM verifier_wallet_challenges WHERE verifier_user_id = $1", [verifierUserId]);
      return 1;
    },

    async getWalletChallenge({ challengeId, verifierUserId, now = new Date() }) {
      if (typeof challengeId !== "string" || typeof verifierUserId !== "string" || !(now instanceof Date)) return null;
      const result = await pool.query(
        `SELECT id, verifier_user_id, wallet_address, nonce, expires_at, consumed_at
         FROM verifier_wallet_challenges WHERE id = $1 AND verifier_user_id = $2 LIMIT 1`,
        [challengeId, verifierUserId],
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return {
        challengeId: row.id,
        verifierUserId: row.verifier_user_id,
        walletAddress: row.wallet_address,
        nonce: row.nonce,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
      };
    },

    async consumeAndBindWallet({ challengeId, verifierUserId, walletAddress, rosterVersion, now = new Date() }) {
      if (typeof challengeId !== "string" || typeof verifierUserId !== "string"
          || typeof walletAddress !== "string" || !/^0x[0-9a-f]{40}$/.test(walletAddress)
          || !Number.isSafeInteger(rosterVersion) || rosterVersion < 1
          || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw repositoryError("INVALID_WALLET_CHALLENGE");
      }
      return inTransaction(pool, async (client) => {
        const verifierResult = await client.query(
          "SELECT id, role, status, organization_id FROM users WHERE id = $1 LIMIT 1",
          [verifierUserId],
        );
        const verifier = verifierResult.rows[0];
        if (!verifier || verifier.role !== "VERIFIER" || verifier.status !== "ACTIVE" || !verifier.organization_id) {
          throw repositoryError("FORBIDDEN");
        }
        const consumed = await client.query(
          `UPDATE verifier_wallet_challenges SET consumed_at = $4
           WHERE id = $1 AND verifier_user_id = $2 AND wallet_address = $3
             AND consumed_at IS NULL AND expires_at > $4
           RETURNING id`,
          [challengeId, verifierUserId, walletAddress, now],
        );
        if (consumed.rowCount !== 1) throw repositoryError("WALLET_CHALLENGE_INVALID");
        await client.query(
          `INSERT INTO verifier_wallets (
             verifier_user_id, wallet_address, organization_id, roster_version, status, verified_at, created_at
           ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $5)`,
          [verifierUserId, walletAddress, verifier.organization_id, rosterVersion, now],
        );
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, $2, 'VERIFIER_WALLET_BOUND', 'USER', $2, $3, $4)`,
          [randomUUID(), verifierUserId, { walletAddress, rosterVersion }, now],
        );
        return {
          verifierUserId,
          walletAddress,
          organizationId: verifier.organization_id,
          rosterVersion,
          status: "ACTIVE",
          verifiedAt: now,
        };
      });
    },

    async persistSignedVote({
      reviewRoundId,
      verifierUserId,
      walletAddress,
      decision,
      eip712Signature,
      noConflictAttested,
      organizerInstructionCommitment = null,
      organizerInstructionSalt = null,
      organizerInstructions = null,
      internalNotes = "",
      now = new Date(),
    }) {
      if (typeof reviewRoundId !== "string" || typeof verifierUserId !== "string"
          || typeof walletAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)
          || !["VERIFIED", "NEEDS_REVISION", "REJECTED"].includes(decision)
          || typeof eip712Signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(eip712Signature)
          || noConflictAttested !== true || typeof internalNotes !== "string" || internalNotes.length > 4000
          || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw repositoryError("INVALID_VOTE");
      }
      const normalizedVote = {
        walletAddress: walletAddress.toLowerCase(),
        decision,
        eip712Signature,
        noConflictAttested,
        organizerInstructionCommitment,
        organizerInstructionSalt,
        organizerInstructions,
        internalNotes,
      };
      if (decision === "NEEDS_REVISION") {
        if (typeof organizerInstructionCommitment !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(organizerInstructionCommitment)
            || organizerInstructionCommitment.toLowerCase() === `0x${"0".repeat(64)}`
            || typeof organizerInstructionSalt !== "string" || !/^[0-9a-fA-F]{64}$/.test(organizerInstructionSalt)
            || typeof organizerInstructions !== "string" || organizerInstructions.trim().length < 1
            || organizerInstructions.length > 4000) {
          throw repositoryError("INVALID_VOTE");
        }
        let verifiedInstructionCommitment;
        try {
          verifiedInstructionCommitment = computeOrganizerInstructionCommitment({ instructions: organizerInstructions, salt: organizerInstructionSalt });
        } catch {
          throw repositoryError("INVALID_VOTE");
        }
        if (verifiedInstructionCommitment.toLowerCase() !== organizerInstructionCommitment.toLowerCase()) {
          throw repositoryError("INVALID_VOTE");
        }
        normalizedVote.organizerInstructionCommitment = organizerInstructionCommitment.toLowerCase();
        normalizedVote.organizerInstructionSalt = organizerInstructionSalt.toLowerCase();
        normalizedVote.organizerInstructions = organizerInstructions.trim();
      } else if (organizerInstructionCommitment !== null || organizerInstructionSalt !== null || organizerInstructions !== null) {
        throw repositoryError("INVALID_VOTE");
      }

      return inTransaction(pool, async (client) => {
        const assignment = await client.query(
          `SELECT rr.status, ra.wallet_address
           FROM review_rounds rr
           JOIN review_assignments ra ON ra.review_round_id = rr.id
           WHERE rr.id = $1 AND ra.verifier_user_id = $2 LIMIT 1`,
          [reviewRoundId, verifierUserId],
        );
        if (assignment.rowCount === 0) throw repositoryError("REVIEW_NOT_ASSIGNED");
        if (assignment.rows[0].status !== "OPEN") throw repositoryError("REVIEW_NOT_OPEN");
        if (assignment.rows[0].wallet_address !== normalizedVote.walletAddress) throw repositoryError("VERIFIER_WALLET_MISMATCH");

        const selectExisting = async () => client.query(
          `SELECT v.id, v.wallet_address, v.decision, v.eip712_signature, v.no_conflict_attested,
                  v.organizer_instruction_commitment, v.organizer_instruction_salt,
                  v.organizer_instructions, v.internal_notes, s.id AS submission_id,
                  s.status AS submission_status, s.transaction_hash
           FROM review_votes v
           JOIN review_vote_submissions s ON s.vote_id = v.id
           WHERE v.review_round_id = $1 AND v.verifier_user_id = $2 LIMIT 1`,
          [reviewRoundId, verifierUserId],
        );
        const existing = await selectExisting();
        if (existing.rowCount > 0) {
          const row = existing.rows[0];
          if (!sameVote(row, normalizedVote)) throw repositoryError("VOTE_ALREADY_SUBMITTED");
          return { voteId: row.id, submissionId: row.submission_id, status: row.submission_status, transactionHash: row.transaction_hash, idempotent: true };
        }

        const voteId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO review_votes (
             id, review_round_id, verifier_user_id, wallet_address, decision, eip712_signature,
             no_conflict_attested, organizer_instruction_commitment, organizer_instruction_salt,
             internal_notes, organizer_instructions, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, $10, $11)
           ON CONFLICT (review_round_id, verifier_user_id) DO NOTHING
           RETURNING id`,
          [voteId, reviewRoundId, verifierUserId, normalizedVote.walletAddress, decision, eip712Signature,
            normalizedVote.organizerInstructionCommitment, normalizedVote.organizerInstructionSalt,
            internalNotes, normalizedVote.organizerInstructions, now],
        );
        if (inserted.rowCount === 0) {
          const concurrent = await selectExisting();
          const row = concurrent.rows[0];
          if (!row || !sameVote(row, normalizedVote)) throw repositoryError("VOTE_ALREADY_SUBMITTED");
          return { voteId: row.id, submissionId: row.submission_id, status: row.submission_status, transactionHash: row.transaction_hash, idempotent: true };
        }

        const submissionId = randomUUID();
        await client.query(
          `INSERT INTO review_vote_submissions (id, vote_id, status, attempt_count, created_at, updated_at)
           VALUES ($1, $2, 'QUEUED', 0, $3, $3)`,
          [submissionId, voteId, now],
        );
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, $2, 'REVIEW_VOTE_QUEUED', 'REVIEW_VOTE', $3, $4, $5)`,
          [randomUUID(), verifierUserId, voteId, { reviewRoundId, decision }, now],
        );
        return { voteId, submissionId, status: "QUEUED", idempotent: false };
      });
    },

    async markVoteSubmitted({ voteId, transactionHash, now = new Date() }) {
      if (typeof voteId !== "string" || typeof transactionHash !== "string"
          || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || !(now instanceof Date)) {
        throw repositoryError("INVALID_VOTE_SUBMISSION");
      }
      const normalizedHash = transactionHash.toLowerCase();
      const updated = await pool.query(
        `UPDATE review_vote_submissions
         SET status = 'SUBMITTED', attempt_count = attempt_count + 1, transaction_hash = $2,
             last_error_code = NULL, updated_at = $3
         WHERE vote_id = $1 AND status IN ('QUEUED', 'FAILED')
         RETURNING id, status, transaction_hash, attempt_count`,
        [voteId, normalizedHash, now],
      );
      if (updated.rowCount === 1) return { status: updated.rows[0].status, transactionHash: updated.rows[0].transaction_hash, attemptCount: Number(updated.rows[0].attempt_count) };
      const current = await pool.query(
        "SELECT status, transaction_hash, attempt_count FROM review_vote_submissions WHERE vote_id = $1 LIMIT 1",
        [voteId],
      );
      if (current.rowCount > 0 && current.rows[0].status === "SUBMITTED" && current.rows[0].transaction_hash === normalizedHash) {
        return { status: "SUBMITTED", transactionHash: normalizedHash, attemptCount: Number(current.rows[0].attempt_count), idempotent: true };
      }
      throw repositoryError("VOTE_SUBMISSION_STATE_INVALID");
    },

    async markVoteSubmissionFailed({ voteId, errorCode, now = new Date() }) {
      if (typeof voteId !== "string" || !["CHAIN_SUBMISSION_FAILED", "CHAIN_RECEIPT_FAILED"].includes(errorCode)
          || !(now instanceof Date)) {
        throw repositoryError("INVALID_VOTE_SUBMISSION");
      }
      const result = await pool.query(
        `UPDATE review_vote_submissions
         SET status = 'FAILED', attempt_count = attempt_count + CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END,
             last_error_code = $2, updated_at = $3
         WHERE vote_id = $1 AND status IN ('QUEUED', 'SUBMITTED', 'FAILED')
         RETURNING status, attempt_count`,
        [voteId, errorCode, now],
      );
      if (result.rowCount !== 1) throw repositoryError("VOTE_SUBMISSION_NOT_FOUND");
      return { status: result.rows[0].status, attemptCount: Number(result.rows[0].attempt_count) };
    },

    async confirmVoteSubmission({ voteId, blockNumber, now = new Date() }) {
      if (typeof voteId !== "string" || !Number.isSafeInteger(Number(blockNumber)) || Number(blockNumber) < 0
          || !(now instanceof Date)) {
        throw repositoryError("INVALID_VOTE_SUBMISSION");
      }
      const confirmedBlock = Number(blockNumber);
      const updated = await pool.query(
        `UPDATE review_vote_submissions
         SET status = 'CONFIRMED', block_number = $2, last_error_code = NULL, updated_at = $3
         WHERE vote_id = $1 AND status = 'SUBMITTED'
         RETURNING status, block_number`,
        [voteId, confirmedBlock, now],
      );
      if (updated.rowCount === 1) return { status: "CONFIRMED", blockNumber: Number(updated.rows[0].block_number) };
      const current = await pool.query(
        "SELECT status, block_number FROM review_vote_submissions WHERE vote_id = $1 LIMIT 1",
        [voteId],
      );
      if (current.rowCount > 0 && current.rows[0].status === "CONFIRMED" && Number(current.rows[0].block_number) === confirmedBlock) {
        return { status: "CONFIRMED", blockNumber: confirmedBlock, idempotent: true };
      }
      throw repositoryError("VOTE_SUBMISSION_STATE_INVALID");
    },

    async reconcileConfirmedOutcome({ reviewRoundId, event, now = new Date() }) {
      if (typeof reviewRoundId !== "string" || !event || !["QUORUM_REACHED", "NO_QUORUM"].includes(event.kind)
          || typeof event.reviewId !== "string" || typeof event.evidenceCommitment !== "string"
          || !Number.isSafeInteger(Number(event.roundNumber)) || Number(event.roundNumber) < 1
          || typeof event.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(event.transactionHash)
          || !Number.isSafeInteger(Number(event.blockNumber)) || Number(event.blockNumber) < 0
          || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw repositoryError("INVALID_CHAIN_EVENT");
      }
      const decision = event.kind === "QUORUM_REACHED" ? event.decision : null;
      if ((event.kind === "QUORUM_REACHED" && !["VERIFIED", "NEEDS_REVISION", "REJECTED"].includes(decision))
          || (event.kind === "NO_QUORUM" && event.decision != null)) {
        throw repositoryError("INVALID_CHAIN_EVENT");
      }
      let finalInstructionCommitment = null;
      if (event.kind === "QUORUM_REACHED") {
        if (typeof event.instructionCommitment !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(event.instructionCommitment)) {
          throw repositoryError("INVALID_CHAIN_EVENT");
        }
        const instructionCommitment = event.instructionCommitment.toLowerCase();
        if ((decision === "NEEDS_REVISION" && instructionCommitment === `0x${"0".repeat(64)}`)
            || (decision !== "NEEDS_REVISION" && instructionCommitment !== `0x${"0".repeat(64)}`)) {
          throw repositoryError("INVALID_CHAIN_EVENT");
        }
        if (decision === "NEEDS_REVISION") finalInstructionCommitment = instructionCommitment;
      } else if (event.instructionCommitment != null) {
        throw repositoryError("INVALID_CHAIN_EVENT");
      }
      const transactionHash = event.transactionHash.toLowerCase();
      const blockNumber = Number(event.blockNumber);

      return inTransaction(pool, async (client) => {
        const current = await client.query(
          `SELECT rr.review_id, rr.evidence_commitment, rr.round_number, rr.status, rr.decision,
                  rr.quorum_transaction_hash, rr.block_number, v.status AS verification_status,
                  v.instruction_commitment AS verification_instruction_commitment
           FROM review_rounds rr
           JOIN verifications v ON v.review_round_id = rr.id
           WHERE rr.id = $1 LIMIT 1`,
          [reviewRoundId],
        );
        if (current.rowCount === 0) throw repositoryError("REVIEW_NOT_FOUND");
        const row = current.rows[0];
        if (row.review_id !== event.reviewId || row.evidence_commitment !== event.evidenceCommitment
            || Number(row.round_number) !== Number(event.roundNumber)) {
          throw repositoryError("CHAIN_EVENT_MISMATCH");
        }
        const targetStatus = event.kind === "QUORUM_REACHED" ? "QUORUM_REACHED" : "NO_QUORUM";
        if (row.status === targetStatus) {
          if (row.decision === decision && row.quorum_transaction_hash === transactionHash
              && Number(row.block_number) === blockNumber
              && row.verification_instruction_commitment === finalInstructionCommitment) {
            return {
              reviewRoundId,
              reviewRoundStatus: targetStatus,
              verificationStatus: row.verification_status,
              decision,
              transactionHash,
              blockNumber,
              idempotent: true,
            };
          }
          throw repositoryError("REVIEW_OUTCOME_ALREADY_FINALIZED");
        }
        if (row.status !== "OPEN") throw repositoryError("REVIEW_NOT_OPEN");

        const updatedRound = await client.query(
          `UPDATE review_rounds
           SET status = $2, decision = $3, quorum_transaction_hash = $4, block_number = $5,
               completed_at = $6, updated_at = $6
           WHERE id = $1 AND status = 'OPEN'
           RETURNING id`,
          [reviewRoundId, targetStatus, decision, transactionHash, blockNumber, now],
        );
        if (updatedRound.rowCount !== 1) throw repositoryError("REVIEW_OUTCOME_ALREADY_FINALIZED");
        const verificationStatus = decision ?? "PENDING";
        await client.query(
          `UPDATE verifications
           SET status = $2, instruction_commitment = $3, transaction_hash = $4, block_number = $5,
               reviewed_at = $6, updated_at = $7
           WHERE review_round_id = $1`,
          [reviewRoundId, verificationStatus, finalInstructionCommitment, transactionHash, blockNumber, decision ? now : null, now],
        );
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
           VALUES ($1, NULL, $2, 'REVIEW_ROUND', $3, $4, $5)`,
          [randomUUID(), event.kind === "QUORUM_REACHED" ? "REVIEW_QUORUM_CONFIRMED" : "REVIEW_NO_QUORUM",
            reviewRoundId, { decision, transactionHash, blockNumber }, now],
        );
        return {
          reviewRoundId,
          reviewRoundStatus: targetStatus,
          verificationStatus,
          decision,
          transactionHash,
          blockNumber,
          idempotent: false,
        };
      });
    },

    async createRound(client, { evidenceId, now = new Date() }) {
      if (!client || typeof client.query !== "function") throw new TypeError("A transaction client is required");
      if (!validContractAddress || typeof evidenceId !== "string") return null;
      const evidence = await client.query(
        `SELECT e.id, e.status, e.version, e.raw_hash, c.id AS campaign_id,
                c.organization_id, f.organization_id AS funder_organization_id
         FROM evidence e
         JOIN milestones m ON m.id = e.milestone_id
         JOIN campaigns c ON c.id = m.campaign_id
         JOIN users f ON f.id = c.funder_id
         WHERE e.id = $1 LIMIT 1`,
        [evidenceId],
      );
      if (evidence.rowCount === 0 || evidence.rows[0].status !== "READY_FOR_REVIEW") return null;
      const evidenceRow = evidence.rows[0];
      const previous = await client.query(
        "SELECT round_number, status FROM review_rounds WHERE evidence_id = $1 ORDER BY round_number DESC LIMIT 1",
        [evidenceId],
      );
      const roundNumber = previous.rowCount === 0 ? 1 : Number(previous.rows[0].round_number) + 1;
      if (previous.rowCount > 0 && !["NO_QUORUM", "CHAIN_FAILED"].includes(previous.rows[0].status)) {
        throw repositoryError("REVIEW_ROUND_ALREADY_EXISTS");
      }

      const roster = await client.query(
        `SELECT vw.verifier_user_id, vw.wallet_address, vw.organization_id, vw.roster_version
         FROM verifier_wallets vw
         JOIN users u ON u.id = vw.verifier_user_id
         WHERE vw.status = 'ACTIVE' AND u.role = 'VERIFIER' AND u.status = 'ACTIVE'
           AND vw.organization_id <> $1 AND vw.organization_id <> $2
         ORDER BY vw.wallet_address`,
        [evidenceRow.organization_id, evidenceRow.funder_organization_id],
      );
      const panel = roster.rows;
      const distinctOrganizations = new Set(panel.map((member) => member.organization_id));
      const rosterVersions = new Set(panel.map((member) => Number(member.roster_version)));
      if (panel.length !== 3 || distinctOrganizations.size !== 3 || rosterVersions.size !== 1) return null;

      const id = randomUUID();
      const opaqueReviewId = reviewId();
      const versionCommitment = commitment("evidence-version", `${evidenceRow.id}:${evidenceRow.version}:${evidenceRow.raw_hash}`);
      const organizerOrganizationCommitment = commitment("organization", evidenceRow.organization_id);
      const funderOrganizationCommitment = commitment("organization", evidenceRow.funder_organization_id);
      const rosterVersion = Number(panel[0].roster_version);
      await client.query(
        `INSERT INTO review_rounds (
           id, evidence_id, round_number, review_id, evidence_commitment,
           organizer_organization_commitment, funder_organization_commitment,
           status, roster_version, contract_address, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'WAITING_FOR_CHAIN', $8, $9, $10, $10)`,
        [id, evidenceId, roundNumber, opaqueReviewId, versionCommitment, organizerOrganizationCommitment,
          funderOrganizationCommitment, rosterVersion, validContractAddress, now],
      );
      for (const member of panel) {
        await client.query(
          `INSERT INTO review_assignments (review_round_id, verifier_user_id, wallet_address, organization_id, assigned_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, member.verifier_user_id, member.wallet_address, member.organization_id, now],
        );
      }
      await client.query(
        `INSERT INTO verifications (id, evidence_id, review_round_id, status, contract_address, created_at, updated_at)
         VALUES ($1, $2, $3, 'PENDING', $4, $5, $5)`,
        [randomUUID(), evidenceId, id, validContractAddress, now],
      );
      await client.query(
        `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
         VALUES ($1, NULL, 'REVIEW_ROUND_CREATED', 'REVIEW_ROUND', $2, $3, $4)`,
        [randomUUID(), id, { evidenceId, roundNumber, verifierCount: 3, rosterVersion }, now],
      );
      return {
        id,
        evidenceId,
        roundNumber,
        reviewId: opaqueReviewId,
        evidenceCommitment: versionCommitment,
        organizerOrganizationCommitment,
        funderOrganizationCommitment,
        status: "WAITING_FOR_CHAIN",
        rosterVersion,
        contractAddress: validContractAddress,
        panel: panel.map((member) => ({
          verifierUserId: member.verifier_user_id,
          walletAddress: member.wallet_address,
          organizationId: member.organization_id,
          organizationCommitment: commitment("organization", member.organization_id),
        })),
      };
    },

    async listWaitingForChainRounds({ limit = 20 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw repositoryError("INVALID_REVIEW_LIMIT");
      const result = await pool.query(
        `SELECT id, evidence_id, round_number, review_id, evidence_commitment,
                organizer_organization_commitment, funder_organization_commitment,
                roster_version, contract_address, open_transaction_hash
         FROM review_rounds WHERE status = 'WAITING_FOR_CHAIN'
         ORDER BY created_at, id LIMIT $1`,
        [limit],
      );
      const rounds = [];
      for (const row of result.rows) {
        const assignments = await pool.query(
          `SELECT verifier_user_id, wallet_address, organization_id
           FROM review_assignments WHERE review_round_id = $1 ORDER BY wallet_address`,
          [row.id],
        );
        rounds.push({
          reviewRoundId: row.id,
          evidenceId: row.evidence_id,
          roundNumber: Number(row.round_number),
          reviewId: row.review_id,
          evidenceCommitment: row.evidence_commitment,
          organizerOrganizationCommitment: row.organizer_organization_commitment,
          funderOrganizationCommitment: row.funder_organization_commitment,
          rosterVersion: Number(row.roster_version),
          contractAddress: row.contract_address,
          openTransactionHash: row.open_transaction_hash,
          panel: assignments.rows.map((member) => ({
            verifierUserId: member.verifier_user_id,
            walletAddress: member.wallet_address,
            organizationId: member.organization_id,
            organizationCommitment: commitment("organization", member.organization_id),
          })),
        });
      }
      return rounds;
    },

    async recordRoundOpenSubmitted({ reviewRoundId, transactionHash, now = new Date() }) {
      if (typeof reviewRoundId !== "string" || typeof transactionHash !== "string"
          || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || !(now instanceof Date)) {
        throw repositoryError("INVALID_REVIEW_REGISTRATION");
      }
      const normalizedHash = transactionHash.toLowerCase();
      const updated = await pool.query(
        `UPDATE review_rounds
         SET open_transaction_hash = $2, last_error_code = NULL, updated_at = $3
         WHERE id = $1 AND status = 'WAITING_FOR_CHAIN' AND open_transaction_hash IS NULL
         RETURNING status, open_transaction_hash`,
        [reviewRoundId, normalizedHash, now],
      );
      if (updated.rowCount === 1) return { status: "WAITING_FOR_CHAIN", transactionHash: normalizedHash, idempotent: false };
      const current = await pool.query(
        "SELECT status, open_transaction_hash FROM review_rounds WHERE id = $1 LIMIT 1",
        [reviewRoundId],
      );
      if (current.rowCount > 0 && current.rows[0].status === "WAITING_FOR_CHAIN"
          && current.rows[0].open_transaction_hash === normalizedHash) {
        return { status: "WAITING_FOR_CHAIN", transactionHash: normalizedHash, idempotent: true };
      }
      throw repositoryError(current.rowCount === 0 ? "REVIEW_NOT_FOUND" : "REVIEW_REGISTRATION_STATE_INVALID");
    },

    async markRoundOpen({ reviewRoundId, transactionHash, blockNumber, now = new Date() }) {
      if (typeof reviewRoundId !== "string" || typeof transactionHash !== "string"
          || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || !Number.isSafeInteger(Number(blockNumber))
          || Number(blockNumber) < 0 || !(now instanceof Date)) {
        throw repositoryError("INVALID_REVIEW_REGISTRATION");
      }
      const normalizedHash = transactionHash.toLowerCase();
      const confirmedBlock = Number(blockNumber);
      return inTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE review_rounds
           SET status = 'OPEN', open_transaction_hash = $2, open_block_number = $3,
               last_error_code = NULL, updated_at = $4
           WHERE id = $1 AND status = 'WAITING_FOR_CHAIN'
             AND (open_transaction_hash IS NULL OR open_transaction_hash = $2)
           RETURNING id, status, open_transaction_hash, open_block_number`,
          [reviewRoundId, normalizedHash, confirmedBlock, now],
        );
        if (updated.rowCount === 1) {
          await client.query(
            `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
             VALUES ($1, NULL, 'REVIEW_ROUND_OPENED_ON_CHAIN', 'REVIEW_ROUND', $2, $3, $4)`,
            [randomUUID(), reviewRoundId, { transactionHash: normalizedHash, blockNumber: confirmedBlock }, now],
          );
          return { status: "OPEN", transactionHash: normalizedHash, blockNumber: confirmedBlock, idempotent: false };
        }
        const existing = await client.query(
          "SELECT status, open_transaction_hash, open_block_number FROM review_rounds WHERE id = $1 LIMIT 1",
          [reviewRoundId],
        );
        if (existing.rowCount > 0 && existing.rows[0].status === "OPEN"
            && existing.rows[0].open_transaction_hash === normalizedHash
            && Number(existing.rows[0].open_block_number) === confirmedBlock) {
          return { status: "OPEN", transactionHash: normalizedHash, blockNumber: confirmedBlock, idempotent: true };
        }
        throw repositoryError(existing.rowCount === 0 ? "REVIEW_NOT_FOUND" : "REVIEW_REGISTRATION_STATE_INVALID");
      });
    },

    async recordRoundRegistrationIssue({ reviewRoundId, errorCode, permanent = false, clearOpenTransactionHash = false, now = new Date() }) {
      if (typeof reviewRoundId !== "string" || typeof errorCode !== "string" || !/^[A-Z0-9_]{1,64}$/.test(errorCode)
          || typeof permanent !== "boolean" || typeof clearOpenTransactionHash !== "boolean" || !(now instanceof Date)) {
        throw repositoryError("INVALID_REVIEW_REGISTRATION");
      }
      const result = await pool.query(
        `UPDATE review_rounds
         SET status = CASE WHEN $3 THEN 'CHAIN_FAILED' ELSE status END,
             last_error_code = $2,
             open_transaction_hash = CASE WHEN $4 THEN NULL ELSE open_transaction_hash END,
             updated_at = $5
         WHERE id = $1 AND status = 'WAITING_FOR_CHAIN'
         RETURNING status, last_error_code`,
        [reviewRoundId, errorCode, permanent, clearOpenTransactionHash, now],
      );
      if (result.rowCount !== 1) throw repositoryError("REVIEW_REGISTRATION_STATE_INVALID");
      return { status: result.rows[0].status, errorCode: result.rows[0].last_error_code };
    },

    async listAssignedOpenRounds(verifierUserId) {
      if (typeof verifierUserId !== "string") return [];
      const result = await pool.query(
        `SELECT rr.id, rr.evidence_id, rr.round_number, rr.status, rr.created_at,
                e.file_name, e.evidence_type, e.version, e.file_size,
                c.id AS campaign_id, c.title AS campaign_title, m.id AS milestone_id, m.title AS milestone_title
         FROM review_rounds rr
         JOIN review_assignments ra ON ra.review_round_id = rr.id
         JOIN evidence e ON e.id = rr.evidence_id
         JOIN milestones m ON m.id = e.milestone_id
         JOIN campaigns c ON c.id = m.campaign_id
         WHERE ra.verifier_user_id = $1 AND rr.status = 'OPEN'
         ORDER BY rr.created_at, rr.id`,
        [verifierUserId],
      );
      return result.rows.map((row) => ({
        reviewRoundId: row.id,
        evidenceId: row.evidence_id,
        roundNumber: Number(row.round_number),
        reviewRoundStatus: row.status,
        fileName: row.file_name,
        evidenceType: row.evidence_type,
        evidenceVersion: Number(row.version),
        fileSize: Number(row.file_size),
        campaignId: row.campaign_id,
        campaignTitle: row.campaign_title,
        milestoneId: row.milestone_id,
        milestoneTitle: row.milestone_title,
        createdAt: row.created_at,
      }));
    },

    async listAdminReviewMetadata({ limit = 100 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw repositoryError("INVALID_REVIEW_LIMIT");
      const result = await pool.query(
        `SELECT id, evidence_id, round_number, status, created_at, updated_at, completed_at
         FROM review_rounds ORDER BY created_at DESC, id DESC LIMIT $1`,
        [limit],
      );
      const metadata = [];
      for (const row of result.rows) {
        const [assignments, votes] = await Promise.all([
          pool.query("SELECT verifier_user_id FROM review_assignments WHERE review_round_id = $1", [row.id]),
          pool.query("SELECT id FROM review_votes WHERE review_round_id = $1", [row.id]),
        ]);
        metadata.push({
          reviewRoundId: row.id,
          evidenceId: row.evidence_id,
          roundNumber: Number(row.round_number),
          status: row.status,
          voteCount: votes.rowCount,
          assignedVerifierCount: assignments.rowCount,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          completedAt: row.completed_at,
        });
      }
      return metadata;
    },

    async listPendingVoteSubmissions({ limit = 100 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw repositoryError("INVALID_REVIEW_LIMIT");
      const result = await pool.query(
        `SELECT rvs.vote_id, rv.review_round_id, rvs.transaction_hash
         FROM review_vote_submissions rvs
         JOIN review_votes rv ON rv.id = rvs.vote_id
         WHERE rvs.status = 'SUBMITTED' AND rvs.transaction_hash IS NOT NULL
         ORDER BY rvs.updated_at, rvs.id LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({
        voteId: row.vote_id,
        reviewRoundId: row.review_round_id,
        transactionHash: row.transaction_hash,
      }));
    },

    async findAssignedRoundForVote({ reviewRoundId, verifierUserId }) {
      if (typeof reviewRoundId !== "string" || typeof verifierUserId !== "string") return null;
      const result = await pool.query(
        `SELECT rr.id, rr.review_id, rr.evidence_commitment,
                rr.organizer_organization_commitment, rr.funder_organization_commitment,
                rr.round_number, rr.status, ra.wallet_address
         FROM review_rounds rr
         JOIN review_assignments ra ON ra.review_round_id = rr.id
         WHERE rr.id = $1 AND ra.verifier_user_id = $2 LIMIT 1`,
        [reviewRoundId, verifierUserId],
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return {
        reviewRoundId: row.id,
        reviewId: row.review_id,
        evidenceCommitment: row.evidence_commitment,
        organizerOrganizationCommitment: row.organizer_organization_commitment,
        funderOrganizationCommitment: row.funder_organization_commitment,
        roundNumber: Number(row.round_number),
        status: row.status,
        walletAddress: row.wallet_address,
      };
    },

    async getAssignedReviewDetails({ reviewRoundId, verifierUserId }) {
      if (typeof reviewRoundId !== "string" || typeof verifierUserId !== "string") return null;
      const result = await pool.query(
        `SELECT rr.id, rr.evidence_id, rr.round_number, rr.status, rr.decision, rr.created_at,
                e.file_name, e.evidence_type, e.version, e.file_size,
                c.id AS campaign_id, c.title AS campaign_title,
                m.id AS milestone_id, m.title AS milestone_title,
                rv.decision AS own_vote_decision, rv.internal_notes AS own_internal_notes,
                rv.organizer_instructions AS own_organizer_instructions, rv.created_at AS own_vote_created_at
         FROM review_rounds rr
         JOIN review_assignments ra ON ra.review_round_id = rr.id
         JOIN evidence e ON e.id = rr.evidence_id
         JOIN milestones m ON m.id = e.milestone_id
         JOIN campaigns c ON c.id = m.campaign_id
         LEFT JOIN review_votes rv ON rv.review_round_id = rr.id AND rv.verifier_user_id = ra.verifier_user_id
         WHERE rr.id = $1 AND ra.verifier_user_id = $2
           AND rr.status IN ('OPEN', 'QUORUM_REACHED', 'NO_QUORUM')
         LIMIT 1`,
        [reviewRoundId, verifierUserId],
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return {
        reviewRoundId: row.id,
        evidenceId: row.evidence_id,
        roundNumber: Number(row.round_number),
        reviewRoundStatus: row.status,
        decision: row.decision,
        fileName: row.file_name,
        evidenceType: row.evidence_type,
        evidenceVersion: Number(row.version),
        fileSize: Number(row.file_size),
        campaignId: row.campaign_id,
        campaignTitle: row.campaign_title,
        milestoneId: row.milestone_id,
        milestoneTitle: row.milestone_title,
        createdAt: row.created_at,
        ownVote: row.own_vote_decision == null ? null : {
          decision: row.own_vote_decision,
          internalNotes: row.own_internal_notes,
          organizerInstructions: row.own_organizer_instructions,
          createdAt: row.own_vote_created_at,
        },
      };
    },
  });
}
