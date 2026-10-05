import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidStateTransitionError,
  STATUS_MACHINES,
  transitionStatus,
} from "../src/index.js";

test("state domains keep screening, review, payment, and proof statuses distinct", () => {
  assert.equal(STATUS_MACHINES.screening.field, "screeningStatus");
  assert.equal(STATUS_MACHINES.verification.field, "verificationStatus");
  assert.equal(STATUS_MACHINES.disbursement.field, "disbursementStatus");
  assert.equal(STATUS_MACHINES.proof.field, "proofStatus");
  assert.ok(STATUS_MACHINES.screening.states.includes("CLEAR"));
  assert.ok(STATUS_MACHINES.verification.states.includes("VERIFIED"));
  assert.ok(STATUS_MACHINES.disbursement.states.includes("CONFIRMED"));
  assert.ok(!STATUS_MACHINES.proof.states.includes("CONFIRMED"));
});

test("screening transitions require flags consistent with CLEAR or FLAGGED", () => {
  assert.equal(transitionStatus("screening", "PROCESSING", "CLEAR", { flagCodes: [] }), "CLEAR");
  assert.equal(
    transitionStatus("screening", "PROCESSING", "FLAGGED", { flagCodes: ["LOW_CONFIDENCE_FIELD"] }),
    "FLAGGED",
  );
  assert.throws(
    () => transitionStatus("screening", "PROCESSING", "CLEAR", { flagCodes: ["AMOUNT_MISMATCH"] }),
    InvalidStateTransitionError,
  );
  assert.throws(
    () => transitionStatus("screening", "PROCESSING", "VERIFIED", { flagCodes: [] }),
    InvalidStateTransitionError,
  );
});

test("payment readiness and confirmation need separate evidence", () => {
  assert.throws(
    () => transitionStatus("disbursement", "NOT_READY", "READY_FOR_PAYMENT"),
    InvalidStateTransitionError,
  );
  assert.equal(
    transitionStatus("disbursement", "NOT_READY", "READY_FOR_PAYMENT", {
      verificationStatus: "VERIFIED",
      funderAuthorized: true,
    }),
    "READY_FOR_PAYMENT",
  );
  assert.throws(
    () => transitionStatus("disbursement", "READY_FOR_PAYMENT", "PAYMENT_REPORTED", { reporterRole: "ORGANIZER", reporterId: "org-1" }),
    InvalidStateTransitionError,
  );
  assert.equal(
    transitionStatus("disbursement", "READY_FOR_PAYMENT", "PAYMENT_REPORTED", { reporterRole: "FUNDER", reporterId: "funder-1" }),
    "PAYMENT_REPORTED",
  );
  assert.throws(
    () => transitionStatus("disbursement", "PAYMENT_REPORTED", "CONFIRMED"),
    InvalidStateTransitionError,
  );
  assert.equal(
    transitionStatus("disbursement", "PAYMENT_REPORTED", "CONFIRMED", {
      independentSettlementSource: true,
      settlementEvidenceId: "settlement-1",
    }),
    "CONFIRMED",
  );
});

test("proof anchoring requires a successful Sepolia receipt and retries the same version", () => {
  assert.throws(
    () => transitionStatus("proof", "SUBMITTED", "ANCHORED", { network: "ETHEREUM_SEPOLIA", receiptStatus: 0, blockNumber: 100 }),
    InvalidStateTransitionError,
  );
  assert.equal(
    transitionStatus("proof", "SUBMITTED", "ANCHORED", { network: "ETHEREUM_SEPOLIA", receiptStatus: 1, blockNumber: 100 }),
    "ANCHORED",
  );
  assert.throws(
    () => transitionStatus("proof", "FAILED", "PENDING", { proofVersion: 3, retryProofVersion: 4 }),
    InvalidStateTransitionError,
  );
  assert.equal(
    transitionStatus("proof", "FAILED", "PENDING", { proofVersion: 3, retryProofVersion: 3 }),
    "PENDING",
  );
});

test("invalid edges carry their state-machine domain", () => {
  assert.throws(
    () => transitionStatus("verification", "VERIFIED", "PENDING"),
    (error) => error instanceof InvalidStateTransitionError && error.domain === "verification" && error.from === "VERIFIED" && error.to === "PENDING",
  );
});

test("campaign, milestone, evidence, and verifier states stay within their own machines", () => {
  assert.equal(transitionStatus("campaign", "DRAFT", "ACTIVE"), "ACTIVE");
  assert.equal(transitionStatus("milestone", "IN_PROGRESS", "COMPLETED"), "COMPLETED");
  assert.equal(transitionStatus("evidence", "UPLOADED", "PROCESSING"), "PROCESSING");
  assert.equal(transitionStatus("verification", "PENDING", "NEEDS_REVISION"), "NEEDS_REVISION");
  assert.throws(
    () => transitionStatus("evidence", "READY_FOR_REVIEW", "VERIFIED"),
    InvalidStateTransitionError,
  );
});
