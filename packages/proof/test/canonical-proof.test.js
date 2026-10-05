import assert from "node:assert/strict";
import test from "node:test";

import { hashProofPackage, hashRawEvidence } from "../src/index.js";

const fixture = {
  schemaVersion: 1,
  campaignId: "opaque-campaign-id",
  milestoneId: "opaque-milestone-id",
  evidenceVersion: 1,
  createdAt: "2026-10-04T12:35:00.000Z",
  files: [
    {
      evidenceId: "opaque-evidence-id",
      evidenceType: "RECEIPT",
      rawHash: "0".repeat(64),
      redactedHash: null,
      ocr: {
        language: "id",
        vendor: { value: "Example Store", confidence: 94 },
        documentDate: { value: "2026-10-01", confidence: 89 },
        amount: { value: "30000000", currency: "IDR", confidence: 98 },
        invoiceNumber: { value: "INV-001", confidence: 91 },
      },
      screening: {
        screeningStatus: "FLAGGED",
        flagCodes: ["LOW_CONFIDENCE_DATE"],
      },
    },
  ],
  verification: {
    verificationStatus: "VERIFIED",
    reviewedAt: "2026-10-04T12:34:56.789Z",
    verifierRef: "opaque-verifier-ref",
  },
  proofVersion: 1,
};

test("hashProofPackage matches the documented JCS test vector", () => {
  assert.equal(
    hashProofPackage(fixture),
    "452d8c79872337735b6a0bc8957bae4b4d5931058b1f64fd9fea5efd05365bbf",
  );
});

test("hashRawEvidence hashes exact bytes with SHA-256", () => {
  assert.equal(
    hashRawEvidence(Buffer.from("abc", "utf8")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("file and flag ordering does not change the package hash", () => {
  const first = structuredClone(fixture);
  const secondFile = structuredClone(fixture.files[0]);
  secondFile.evidenceId = "opaque-evidence-id-2";
  secondFile.rawHash = "f".repeat(64);
  first.files.push(secondFile);
  first.files[0].screening.flagCodes = ["Z_FLAG", "A_FLAG"];

  const reordered = structuredClone(first);
  reordered.files.reverse();
  reordered.files[1].screening.flagCodes.reverse();

  assert.equal(hashProofPackage(first), hashProofPackage(reordered));
});

test("NFC-equivalent strings produce the same package hash", () => {
  const composed = structuredClone(fixture);
  const decomposed = structuredClone(fixture);
  composed.files[0].ocr.vendor.value = "Café";
  decomposed.files[0].ocr.vendor.value = "Cafe\u0301";

  assert.equal(hashProofPackage(composed), hashProofPackage(decomposed));
});

test("normalizes decimal amount formatting and currency case", () => {
  const formatted = structuredClone(fixture);
  formatted.files[0].ocr.amount.value = "00030000000.000";
  formatted.files[0].ocr.amount.currency = "idr";

  assert.equal(hashProofPackage(formatted), hashProofPackage(fixture));
});

test("rejects malformed file hashes and out-of-range confidence", () => {
  const badHash = structuredClone(fixture);
  badHash.files[0].rawHash = "not-a-hash";
  assert.throws(() => hashProofPackage(badHash));

  const badConfidence = structuredClone(fixture);
  badConfidence.files[0].ocr.amount.confidence = 101;
  assert.throws(() => hashProofPackage(badConfidence));
});

test("rejects currency codes not supported by the ISO currency registry", () => {
  const invalidCurrency = structuredClone(fixture);
  invalidCurrency.files[0].ocr.amount.currency = "ZZZ";
  assert.throws(() => hashProofPackage(invalidCurrency));

  const nonAsciiCurrency = structuredClone(fixture);
  nonAsciiCurrency.files[0].ocr.amount.currency = "\u0131dr";
  assert.throws(() => hashProofPackage(nonAsciiCurrency));
});

test("rejects unknown state values and missing required keys", () => {
  const badStatus = structuredClone(fixture);
  badStatus.files[0].screening.screeningStatus = "UNTRUSTED_STATUS_VALUE";
  assert.throws(() => hashProofPackage(badStatus), (error) => !error.message.includes("UNTRUSTED_STATUS_VALUE"));

  const missingKey = structuredClone(fixture);
  delete missingKey.files[0].redactedHash;
  assert.throws(() => hashProofPackage(missingKey));
});

test("rejects oversized proof packages and metadata strings", () => {
  const tooManyFiles = structuredClone(fixture);
  for (let index = 1; index < 101; index += 1) {
    const file = structuredClone(fixture.files[0]);
    file.evidenceId = `opaque-evidence-${String(index).padStart(3, "0")}`;
    tooManyFiles.files.push(file);
  }
  assert.throws(() => hashProofPackage(tooManyFiles));

  const tooLongVendor = structuredClone(fixture);
  tooLongVendor.files[0].ocr.vendor.value = "x".repeat(4097);
  assert.throws(() => hashProofPackage(tooLongVendor));
});
