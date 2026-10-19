import { Router } from "express";
import multer from "multer";

import { isUserId } from "../auth/validation.js";
import { createSessionMiddleware } from "../middleware/session.js";
import { requireRole } from "../middleware/requireRole.js";

const DEFAULT_MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

function configuredOrigin(webOrigin) {
  return function checkOrigin(request, response, next) {
    if (!webOrigin || request.get("origin") !== webOrigin) {
      return response.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}

function sendRepositoryError(error, response, next) {
  const mapped = {
    FORBIDDEN: [403, "forbidden"],
    MILESTONE_NOT_FOUND: [404, "not_found"],
    EVIDENCE_NOT_FOUND: [404, "not_found"],
    INVALID_EVIDENCE: [400, "invalid_upload"],
    INVALID_OBJECT_KEY: [400, "invalid_upload"],
    INVALID_FILE: [400, "invalid_upload"],
    INVALID_FILE_NAME: [400, "invalid_upload"],
    INVALID_EVIDENCE_TYPE: [400, "invalid_upload"],
    EMPTY_FILE: [400, "invalid_upload"],
    UNSUPPORTED_FILE_TYPE: [400, "invalid_upload"],
    FILE_SIGNATURE_MISMATCH: [400, "invalid_upload"],
    FILE_TOO_LARGE: [413, "file_too_large"],
    MILESTONE_NOT_IN_PROGRESS: [409, "milestone_not_uploadable"],
    OCR_ALREADY_PROCESSING: [409, "ocr_already_processing"],
    OCR_NOT_RETRYABLE: [409, "ocr_not_retryable"],
    REVISION_NOT_ALLOWED: [409, "revision_not_allowed"],
    "23505": [409, "conflict"],
  }[error?.code];
  if (mapped) return response.status(mapped[0]).json({ error: mapped[1] });
  return next(error);
}

function parseSingleUpload(upload) {
  return function readMultipart(request, response, next) {
    upload(request, response, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return response.status(413).json({ error: "file_too_large" });
      }
      if (error instanceof multer.MulterError) return response.status(400).json({ error: "invalid_upload" });
      return next(error);
    });
  };
}

function safeContentDisposition(fileName) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createEvidenceRouter({ evidenceRepository, evidenceService, storage, authService, webOrigin, maxBytes = DEFAULT_MAX_EVIDENCE_BYTES }) {
  const router = Router();
  const requireSession = createSessionMiddleware(authService);
  const originCheck = configuredOrigin(webOrigin);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 1, fieldSize: 256 } }).single("file");
  const requireUploadAccess = async (request, response, next) => {
    if (!isUserId(request.params.milestoneId)) return response.status(400).json({ error: "invalid_request" });
    try {
      await evidenceRepository.assertUploadAllowed(request.currentUser, request.params.milestoneId);
      return next();
    } catch (error) {
      return sendRepositoryError(error, response, next);
    }
  };
  const requireRevisionAccess = async (request, response, next) => {
    if (!isUserId(request.params.evidenceId)) return response.status(400).json({ error: "invalid_request" });
    try {
      request.revisionContext = await evidenceRepository.getRevisionContext(request.currentUser, request.params.evidenceId);
      return next();
    } catch (error) {
      return sendRepositoryError(error, response, next);
    }
  };

  router.use((_request, response, next) => {
    response.set("Cache-Control", "private, no-store");
    return next();
  });

  router.post("/milestones/:milestoneId/evidence", originCheck, requireSession, requireRole("ORGANIZER"), requireUploadAccess, parseSingleUpload(upload), async (request, response, next) => {
    if (!isUserId(request.params.milestoneId)) return response.status(400).json({ error: "invalid_request" });
    if (Object.keys(request.body ?? {}).some((key) => key !== "evidenceType")) {
      return response.status(400).json({ error: "invalid_request" });
    }
    try {
      const evidence = await evidenceService.upload({
        actor: request.currentUser,
        milestoneId: request.params.milestoneId,
        evidenceType: request.body?.evidenceType,
        file: request.file,
      });
      return response.status(201).json({ evidence });
    } catch (error) {
      return sendRepositoryError(error, response, next);
    }
  });

  router.post("/evidence/:evidenceId/revisions", originCheck, requireSession, requireRole("ORGANIZER"), requireRevisionAccess, parseSingleUpload(upload), async (request, response, next) => {
    if (Object.keys(request.body ?? {}).length > 0) return response.status(400).json({ error: "invalid_request" });
    try {
      const evidence = await evidenceService.revise({
        actor: request.currentUser,
        evidenceId: request.params.evidenceId,
        file: request.file,
        revisionContext: request.revisionContext,
      });
      return response.status(201).json({ evidence });
    } catch (error) {
      return sendRepositoryError(error, response, next);
    }
  });

  router.get("/milestones/:milestoneId/evidence", requireSession, requireRole("ADMIN", "ORGANIZER", "FUNDER"), async (request, response, next) => {
    if (!isUserId(request.params.milestoneId)) return response.status(400).json({ error: "invalid_request" });
    try {
      const evidence = await evidenceRepository.listForMilestone(request.currentUser, request.params.milestoneId);
      if (!evidence) return response.status(404).json({ error: "not_found" });
      return response.status(200).json({ evidence });
    } catch (error) {
      return sendRepositoryError(error, response, next);
    }
  });

  router.get("/evidence/:evidenceId/ocr", requireSession, requireRole("VERIFIER"), async (request, response, next) => {
    if (!isUserId(request.params.evidenceId)) return response.status(400).json({ error: "invalid_request" });
    try {
      const details = await evidenceRepository.getVerifierOcrDetails(request.currentUser, request.params.evidenceId);
      if (!details) return response.status(404).json({ error: "not_found" });
      return response.status(200).json(details);
    } catch (error) {
      return sendRepositoryError(error, response, next);
    }
  });

  router.post("/admin/evidence/:evidenceId/ocr-retry", originCheck, requireSession, requireRole("ADMIN"), async (request, response, next) => {
    if (!isUserId(request.params.evidenceId)) return response.status(400).json({ error: "invalid_request" });
    try {
      const retry = await evidenceRepository.createAdminRetry({
        actor: request.currentUser,
        evidenceId: request.params.evidenceId,
      });
      return response.status(202).json(retry);
    } catch (error) {
      return sendRepositoryError(error, response, next);
    }
  });

  router.get("/evidence/:evidenceId", requireSession, requireRole("ADMIN", "ORGANIZER", "FUNDER"), async (request, response, next) => {
    if (!isUserId(request.params.evidenceId)) return response.status(400).json({ error: "invalid_request" });
    try {
      const evidence = await evidenceRepository.findEvidenceForUser(request.currentUser, request.params.evidenceId);
      if (!evidence) return response.status(404).json({ error: "not_found" });
      return response.status(200).json({ evidence });
    } catch (error) {
      return sendRepositoryError(error, response, next);
    }
  });

  router.get("/evidence/:evidenceId/file", requireSession, requireRole("VERIFIER"), async (request, response, next) => {
    if (!isUserId(request.params.evidenceId)) return response.status(400).json({ error: "invalid_request" });
    try {
      const file = await evidenceRepository.findStoredObjectForAssignedVerifier(request.currentUser, request.params.evidenceId);
      if (!file) return response.status(404).json({ error: "not_found" });
      const stream = await storage.readObject(file.storageKey);
      response.set("X-Content-Type-Options", "nosniff");
      response.set("Content-Type", file.contentType);
      response.set("Content-Disposition", safeContentDisposition(file.fileName));
      stream.once("error", (error) => {
        if (response.headersSent) response.destroy(error);
        else next(error);
      });
      return stream.pipe(response);
    } catch (error) {
      return sendRepositoryError(error, response, next);
    }
  });

  return router;
}
