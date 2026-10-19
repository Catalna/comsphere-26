import assert from "node:assert/strict";
import test from "node:test";

import { hashProofPackage, hashRawEvidence, normalizeProofPackage } from "../src/index.js";

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

const quorumFixture = {
  schemaVersion: 2,
  campaignId: "opaque-campaign-id",
  milestoneId: "opaque-milestone-id",
  evidenceVersion: 1,
  createdAt: "2026-10-05T09:00:00.000Z",
  quorum: {
    reviewRef: "0x" + "a".repeat(64),
    roundNumber: 1,
    decision: "VERIFIED",
    contractAddress: "0x" + "b".repeat(40),
    transactionHash: "0x" + "c".repeat(64),
    blockNumber: 5_432_100,
  },
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

test("canonicalizes a schema version 2 peer-quorum package with a stable hash", () => {
  assert.equal(
    hashProofPackage(quorumFixture),
    "783f39f73a962c03af80e7b3e3a47bca658872db00e37088bf99038607ac3b20",
  );
});

test("schema version 2 normalizes chain references to lowercase hex", () => {
  const normalized = normalizeProofPackage(structuredClone(quorumFixture));
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.quorum.reviewRef, `0x${"a".repeat(64)}`);
  assert.equal(normalized.quorum.contractAddress, `0x${"b".repeat(40)}`);
  assert.equal(normalized.quorum.transactionHash, `0x${"c".repeat(64)}`);
  assert.equal(normalized.quorum.blockNumber, 5432100);
});

test("schema version 2 rejects a quorum that disagrees with the verification outcome", () => {
  const mismatch = structuredClone(quorumFixture);
  mismatch.quorum.decision = "REJECTED";
  assert.throws(() => hashProofPackage(mismatch));
});

test("schema version 2 rejects an unknown quorum decision", () => {
  const unknownDecision = structuredClone(quorumFixture);
  unknownDecision.quorum.decision = "APPROVED";
  unknownDecision.verification.verificationStatus = "APPROVED";
  assert.throws(() => hashProofPackage(unknownDecision));
});

test("schema version 2 rejects zero, malformed, or missing chain references", () => {
  const zeroReviewRef = structuredClone(quorumFixture);
  zeroReviewRef.quorum.reviewRef = `0x${"0".repeat(64)}`;
  assert.throws(() => hashProofPackage(zeroReviewRef));

  const zeroTransaction = structuredClone(quorumFixture);
  zeroTransaction.quorum.transactionHash = `0x${"0".repeat(64)}`;
  assert.throws(() => hashProofPackage(zeroTransaction));

  const zeroAddress = structuredClone(quorumFixture);
  zeroAddress.quorum.contractAddress = `0x${"0".repeat(40)}`;
  assert.throws(() => hashProofPackage(zeroAddress));

  const shortHash = structuredClone(quorumFixture);
  shortHash.quorum.transactionHash = "0xabc";
  assert.throws(() => hashProofPackage(shortHash));

  const badBlock = structuredClone(quorumFixture);
  badBlock.quorum.blockNumber = -1;
  assert.throws(() => hashProofPackage(badBlock));

  const badRound = structuredClone(quorumFixture);
  badRound.quorum.roundNumber = 0;
  assert.throws(() => hashProofPackage(badRound));

  const missingQuorum = structuredClone(quorumFixture);
  delete missingQuorum.quorum;
  assert.throws(() => hashProofPackage(missingQuorum));

  const extraQuorumKey = structuredClone(quorumFixture);
  extraQuorumKey.quorum.reviewerCount = 3;
  assert.throws(() => hashProofPackage(extraQuorumKey));
});

test("schema version 2 requires the package to be created at or after human review", () => {
  const tooEarly = structuredClone(quorumFixture);
  tooEarly.createdAt = "2026-10-04T12:00:00.000Z";
  assert.throws(() => hashProofPackage(tooEarly));
});

test("legacy schema version 1 packages still hash to the documented vector", () => {
  assert.equal(
    hashProofPackage(structuredClone(fixture)),
    "452d8c79872337735b6a0bc8957bae4b4d5931058b1f64fd9fea5efd05365bbf",
  );
});
