import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { validateEvidenceUpload } from "../../src/evidence/uploadValidation.js";

const fixtures = [
  { evidenceType: "RECEIPT", originalname: "receipt.pdf", mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.7\nreceipt-bytes") },
  { evidenceType: "PHOTO", originalname: "photo.jpg", mimetype: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]) },
  { evidenceType: "PHOTO", originalname: "photo.png", mimetype: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]) },
];

test("accepts supported evidence signatures and hashes exact original bytes", () => {
  for (const fixture of fixtures) {
    const result = validateEvidenceUpload(fixture);
    assert.equal(result.fileName, fixture.originalname);
    assert.equal(result.contentType, fixture.mimetype);
    assert.equal(result.evidenceType, fixture.evidenceType);
    assert.equal(result.fileSize, fixture.buffer.length);
    assert.equal(result.rawHash, createHash("sha256").update(fixture.buffer).digest("hex"));
  }
});

test("rejects empty, oversized, unsupported, and MIME-mismatched files", () => {
  assert.throws(() => validateEvidenceUpload({ ...fixtures[0], buffer: Buffer.alloc(0) }), { code: "EMPTY_FILE" });
  assert.throws(() => validateEvidenceUpload({ ...fixtures[0], maxBytes: 4 }), { code: "FILE_TOO_LARGE" });
  assert.throws(() => validateEvidenceUpload({ ...fixtures[0], mimetype: "text/plain" }), { code: "UNSUPPORTED_FILE_TYPE" });
  assert.throws(() => validateEvidenceUpload({ ...fixtures[0], buffer: Buffer.from("not a pdf") }), { code: "FILE_SIGNATURE_MISMATCH" });
});

test("rejects unknown evidence types and sanitizes path-like original names", () => {
  assert.throws(() => validateEvidenceUpload({ ...fixtures[0], evidenceType: "SECRET" }), { code: "INVALID_EVIDENCE_TYPE" });
  const result = validateEvidenceUpload({ ...fixtures[0], originalname: "..\\private\\receipt.pdf" });
  assert.equal(result.fileName, "receipt.pdf");
  assert.equal(/[\\/]/.test(result.fileName), false);
});
