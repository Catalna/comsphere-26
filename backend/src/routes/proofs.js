import { Router } from "express";

import { isUserId } from "../auth/validation.js";
import { createSessionMiddleware } from "../middleware/session.js";
import { requireRole } from "../middleware/requireRole.js";

function sendProofError(error, response, next) {
  const mapped = {
    PROOF_NOT_FOUND: [404, "not_found"],
    PROOF_SOURCE_NOT_FOUND: [404, "not_found"],
    PROOF_NOT_ANCHORABLE: [409, "proof_not_retryable"],
    PROOF_SUBMISSION_STATE_INVALID: [409, "proof_not_retryable"],
    PROOF_RETRY_LIMIT_EXCEEDED: [409, "proof_retry_limit_exceeded"],
    PROOF_ANCHOR_DISABLED: [503, "proof_anchor_disabled"],
    PROOF_ANCHOR_READ_FAILED: [503, "proof_anchor_unavailable"],
    PROOF_ANCHOR_TRANSACTION_FAILED: [502, "proof_anchor_failed"],
    PROOF_ANCHOR_RECEIPT_PENDING: [202, "proof_anchor_pending"],
    PROOF_ANCHOR_RECEIPT_FAILED: [502, "proof_anchor_failed"],
    PROOF_ANCHOR_RECEIPT_UNAVAILABLE: [502, "proof_anchor_failed"],
    PROOF_COMMITMENT_MISMATCH: [502, "proof_commitment_mismatch"],
  }[error?.code];
  if (mapped) return response.status(mapped[0]).json({ error: mapped[1] });
  return next(error);
}

export function createProofRouter({ proofRepository, proofService, authService, webOrigin }) {
  if (!proofRepository || !proofService || !authService) {
    throw new TypeError("Proof routes require configured repositories and services");
  }
  const router = Router();
  const requireSession = createSessionMiddleware(authService);
  const requireAdmin = requireRole("ADMIN");

  router.get("/admin/proofs", requireSession, requireAdmin, async (_request, response, next) => {
    try {
      const proofs = await proofRepository.listProofs({});
      return response.status(200).json({
        proofs: proofs.map((proof) => proofService.projectProof(proof, "ADMIN")),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/proofs/:proofId/retry", requireSession, requireAdmin, async (request, response, next) => {
    try {
      const { proofId } = request.params;
      if (!/^0x[0-9a-f]{64}$/.test(proofId)) return response.status(400).json({ error: "invalid_request" });
      const result = await proofService.anchorProof(proofId);
      return response.status(result.status === "ANCHORED" ? 200 : 202).json({
        proofId,
        status: result.status,
      });
    } catch (error) {
      return sendProofError(error, response, next);
    }
  });

  router.get("/evidence/:evidenceId/proof", requireSession, async (request, response, next) => {
    try {
      const { evidenceId } = request.params;
      if (!isUserId(evidenceId)) return response.status(400).json({ error: "invalid_request" });
      const actor = request.currentUser;
      const context = await proofRepository.getProofAccessContext(evidenceId);
      const proof = await proofRepository.findProofByEvidenceId(evidenceId);
      if (!proof) return response.status(404).json({ error: "not_found" });

      let viewer;
      if (actor.role === "ADMIN") {
        viewer = "ADMIN";
      } else if (actor.role === "ORGANIZER" && actor.organizationId === context.organizerOrganizationId) {
        viewer = "ORGANIZER";
      } else if (actor.role === "FUNDER" && actor.id === context.funderId) {
        viewer = "FUNDER";
      } else {
        return response.status(403).json({ error: "forbidden" });
      }
      return response.status(200).json({ proof: proofService.projectProof(proof, viewer) });
    } catch (error) {
      return sendProofError(error, response, next);
    }
  });

  return router;
}
