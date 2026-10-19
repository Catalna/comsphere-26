import { randomUUID } from "node:crypto";

import { validateEvidenceUpload } from "./uploadValidation.js";

export function createEvidenceService({ evidenceRepository, storage, maxBytes = 10 * 1024 * 1024 }) {
  if (!evidenceRepository || !storage) throw new TypeError("Evidence repository and storage are required");

  return Object.freeze({
    async upload({ actor, milestoneId, evidenceType, file }) {
      const validated = validateEvidenceUpload({
        buffer: file?.buffer,
        mimetype: file?.mimetype,
        originalname: file?.originalname,
        evidenceType,
        maxBytes,
      });
      await evidenceRepository.assertUploadAllowed(actor, milestoneId);
      const storageKey = randomUUID();
      await storage.putObject({ key: storageKey, body: validated.bytes, contentType: validated.contentType });
      try {
        return await evidenceRepository.createEvidence({
          actor,
          milestoneId,
          evidenceType: validated.evidenceType,
          storageKey,
          fileName: validated.fileName,
          contentType: validated.contentType,
          fileSize: validated.fileSize,
          rawHash: validated.rawHash,
        });
      } catch (error) {
        try { await storage.deleteObject(storageKey); } catch { /* Preserve the persistence failure. */ }
        throw error;
      }
    },

    async revise({ actor, evidenceId, file, revisionContext } = {}) {
      const parent = revisionContext ?? await evidenceRepository.getRevisionContext(actor, evidenceId);
      const validated = validateEvidenceUpload({
        buffer: file?.buffer,
        mimetype: file?.mimetype,
        originalname: file?.originalname,
        evidenceType: parent.evidenceType,
        maxBytes,
      });
      const storageKey = randomUUID();
      await storage.putObject({ key: storageKey, body: validated.bytes, contentType: validated.contentType });
      try {
        return await evidenceRepository.createRevisionEvidence({
          actor,
          evidenceId,
          storageKey,
          fileName: validated.fileName,
          contentType: validated.contentType,
          fileSize: validated.fileSize,
          rawHash: validated.rawHash,
        });
      } catch (error) {
        try { await storage.deleteObject(storageKey); } catch { /* Preserve the persistence failure. */ }
        throw error;
      }
    },
  });
}
