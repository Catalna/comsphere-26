import { Router } from "express";
import rateLimit from "express-rate-limit";

import { isUserId } from "../auth/validation.js";
import { createSessionMiddleware } from "../middleware/session.js";
import { requireRole } from "../middleware/requireRole.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value, allowed) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function configuredOrigin(webOrigin) {
  return function checkOrigin(request, response, next) {
    if (!webOrigin || request.get("origin") !== webOrigin) return response.status(403).json({ error: "forbidden" });
    return next();
  };
}

function createLimiter(limit) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: "rate_limited" }),
  });
}

function sendReviewError(error, response, next) {
  const mapped = {
    FORBIDDEN: [403, "forbidden"],
    REVIEW_NOT_FOUND: [404, "not_found"],
    REVIEW_NOT_ASSIGNED: [404, "not_found"],
    WALLET_NOT_ON_ROSTER: [403, "wallet_not_on_roster"],
    VERIFIER_WALLET_NOT_BOUND: [409, "verifier_wallet_not_bound"],
    WALLET_CHALLENGE_INVALID: [400, "invalid_wallet_challenge"],
    VERIFIER_WALLET_ALREADY_BOUND: [409, "verifier_wallet_already_bound"],
    INVALID_WALLET_SIGNATURE: [400, "invalid_wallet_signature"],
    INVALID_WALLET_ADDRESS: [400, "invalid_wallet_address"],
    REVIEW_NOT_OPEN: [409, "review_not_open"],
    INVALID_VOTE: [400, "invalid_vote"],
    INVALID_VOTE_SIGNATURE: [400, "invalid_vote_signature"],
    VOTE_ALREADY_SUBMITTED: [409, "vote_already_submitted"],
    VOTE_SUBMISSION_STATE_INVALID: [409, "vote_submission_pending"],
    REVIEW_SERVICE_NOT_CONFIGURED: [503, "peer_review_unavailable"],
    "23505": [409, "conflict"],
  }[error?.code];
  if (mapped) return response.status(mapped[0]).json({ error: mapped[1] });
  return next(error);
}

export function createReviewRouter({ reviewRepository, peerReviewService, evidenceRepository, authService, webOrigin }) {
  if (!reviewRepository || !peerReviewService || !authService) throw new TypeError("Review routes require configured repositories and services");
  const router = Router();
  const requireSession = createSessionMiddleware(authService);
  const requireVerifier = requireRole("VERIFIER");
  const requireAdmin = requireRole("ADMIN");
  const originCheck = configuredOrigin(webOrigin);
  const walletChallengeLimit = createLimiter(10);
  const walletBindingLimit = createLimiter(10);
  const voteLimit = createLimiter(12);

  router.use((_request, response, next) => {
    response.set("Cache-Control", "private, no-store");
    return next();
  });

  router.get("/verifier/wallet", requireSession, requireVerifier, async (request, response, next) => {
    try {
      const wallet = await reviewRepository.getVerifierWallet(request.currentUser.id);
      return response.status(200).json({ wallet });
    } catch (error) {
      return sendReviewError(error, response, next);
    }
  });

  router.post("/verifier/wallet/challenge", originCheck, requireSession, requireVerifier, walletChallengeLimit, async (request, response, next) => {
    if (!onlyKeys(request.body, ["walletAddress"]) || typeof request.body.walletAddress !== "string") {
      return response.status(400).json({ error: "invalid_request" });
    }
    try {
      const challenge = await peerReviewService.createWalletChallenge({ actor: request.currentUser, walletAddress: request.body.walletAddress });
      return response.status(201).json(challenge);
    } catch (error) {
      return sendReviewError(error, response, next);
    }
  });

  router.delete("/verifier/wallet", originCheck, requireSession, requireVerifier, async (request, response, next) => {
    try {
      await reviewRepository.deleteVerifierWallet(request.currentUser.id);
      return response.status(200).json({ unbound: true });
    } catch (error) {
      return sendReviewError(error, response, next);
    }
  });

  router.post("/verifier/wallet", originCheck, requireSession, requireVerifier, walletBindingLimit, async (request, response, next) => {
    if (!onlyKeys(request.body, ["challengeId", "walletAddress", "signature"])
        || typeof request.body.challengeId !== "string" || typeof request.body.walletAddress !== "string"
        || typeof request.body.signature !== "string") {
      return response.status(400).json({ error: "invalid_request" });
    }
    try {
      const wallet = await peerReviewService.bindVerifierWallet({
        actor: request.currentUser,
        challengeId: request.body.challengeId,
        walletAddress: request.body.walletAddress,
        signature: request.body.signature,
      });
      return response.status(200).json({ wallet });
    } catch (error) {
      return sendReviewError(error, response, next);
    }
  });

  router.get("/verifier/reviews", requireSession, requireVerifier, async (request, response, next) => {
    try {
      const reviews = await reviewRepository.listAssignedOpenRounds(request.currentUser.id);
      return response.status(200).json({ reviews });
    } catch (error) {
      return sendReviewError(error, response, next);
    }
  });

  router.get("/verifier/reviews/:reviewRoundId", requireSession, requireVerifier, async (request, response, next) => {
    if (!isUserId(request.params.reviewRoundId)) return response.status(400).json({ error: "invalid_request" });
    if (typeof evidenceRepository?.getVerifierOcrDetails !== "function") {
      return response.status(503).json({ error: "peer_review_unavailable" });
    }
    try {
      const review = await reviewRepository.getAssignedReviewDetails({
        reviewRoundId: request.params.reviewRoundId,
        verifierUserId: request.currentUser.id,
      });
      if (!review) return response.status(404).json({ error: "not_found" });
      const ocr = await evidenceRepository.getVerifierOcrDetails(request.currentUser, review.evidenceId);
      if (!ocr) return response.status(404).json({ error: "not_found" });
      return response.status(200).json({ review, ocr });
    } catch (error) {
      return sendReviewError(error, response, next);
    }
  });

  router.post("/verifier/reviews/:reviewRoundId/votes/prepare", originCheck, requireSession, requireVerifier, async (request, response, next) => {
    if (!isUserId(request.params.reviewRoundId)
        || !onlyKeys(request.body, ["decision", "organizerInstructions", "noConflictAttested"])) {
      return response.status(400).json({ error: "invalid_request" });
    }
    try {
      const prepared = await peerReviewService.prepareVote({
        actor: request.currentUser,
        reviewRoundId: request.params.reviewRoundId,
        decision: request.body.decision,
        organizerInstructions: request.body.organizerInstructions,
        noConflictAttested: request.body.noConflictAttested,
      });
      return response.status(200).json(prepared);
    } catch (error) {
      return sendReviewError(error, response, next);
    }
  });

  router.post("/verifier/reviews/:reviewRoundId/votes", originCheck, requireSession, requireVerifier, voteLimit, async (request, response, next) => {
    if (!isUserId(request.params.reviewRoundId)
        || !onlyKeys(request.body, ["decision", "organizerInstructions", "instructionSalt", "internalNotes", "noConflictAttested", "signature"])) {
      return response.status(400).json({ error: "invalid_request" });
    }
    try {
      const result = await peerReviewService.submitVote({
        actor: request.currentUser,
        reviewRoundId: request.params.reviewRoundId,
        decision: request.body.decision,
        organizerInstructions: request.body.organizerInstructions,
        instructionSalt: request.body.instructionSalt,
        internalNotes: request.body.internalNotes ?? "",
        noConflictAttested: request.body.noConflictAttested,
        signature: request.body.signature,
      });
      return response.status(result.status === "PENDING" || result.status === "NO_QUORUM" ? 202 : 200).json(result);
    } catch (error) {
      return sendReviewError(error, response, next);
    }
  });

  router.get("/admin/reviews", requireSession, requireAdmin, async (_request, response, next) => {
    try {
      const reviews = await reviewRepository.listAdminReviewMetadata();
      return response.status(200).json({ reviews });
    } catch (error) {
      return sendReviewError(error, response, next);
    }
  });

  return router;
}
