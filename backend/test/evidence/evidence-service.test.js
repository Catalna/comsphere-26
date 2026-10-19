import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createEvidenceService } from "../../src/evidence/evidenceService.js";

const actor = { id: "organizer-id", role: "ORGANIZER", organizationId: "organization-id" };
const file = {
  buffer: Buffer.from("%PDF-1.7\nprivate receipt fixture"),
  mimetype: "application/pdf",
  originalname: "receipt.pdf",
};

test("evidence service stores exact bytes and persists their raw SHA-256", async () => {
  let stored;
  const evidenceService = createEvidenceService({
    evidenceRepository: {
      async assertUploadAllowed() {},
      async createEvidence(record) { return { ...record, id: "evidence-id", status: "UPLOADED", version: 1 }; },
    },
    storage: { async putObject(input) { stored = input; }, async deleteObject() {} },
  });

  const evidence = await evidenceService.upload({ actor, milestoneId: "milestone-id", evidenceType: "RECEIPT", file });
  assert.deepEqual(stored.body, file.buffer);
  assert.equal(stored.contentType, file.mimetype);
  assert.match(stored.key, /^[0-9a-f-]{36}$/i);
  assert.equal(evidence.rawHash, createHash("sha256").update(file.buffer).digest("hex"));
});

test("evidence service deletes a stored object when metadata persistence fails", async () => {
  const deleted = [];
  const evidenceService = createEvidenceService({
    evidenceRepository: {
      async assertUploadAllowed() {},
      async createEvidence() { throw Object.assign(new Error("database unavailable"), { code: "DB_FAILURE" }); },
    },
    storage: { async putObject() {}, async deleteObject(key) { deleted.push(key); } },
  });

  await assert.rejects(
    evidenceService.upload({ actor, milestoneId: "milestone-id", evidenceType: "RECEIPT", file }),
    { code: "DB_FAILURE" },
  );
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /^[0-9a-f-]{36}$/i);
});
