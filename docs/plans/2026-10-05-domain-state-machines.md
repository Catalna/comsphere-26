# DanaTerang State Machine Library Implementation Plan

> **For agentic workers:** Use `executing-plans` and complete each task in order in the `feat/mvp-foundation` worktree.

**Goal:** Add a pure domain package that validates the independent DanaTerang status machines and their cross-field transition prerequisites.

**Architecture:** `@dana-terang/domain` exports frozen state-domain definitions and `transitionStatus(domain, from, to, context)`. It validates allowed edges and payment/proof prerequisites but does not persist records or implement HTTP authorization; API routes will call it later and still enforce caller permissions.

**Tech Stack:** Node.js 20 ESM, npm workspaces, built-in `node:test`.

---

## File Map

- Create `packages/domain/package.json`: ESM workspace and test script.
- Create `packages/domain/src/index.js`: state-domain definitions and transition validation.
- Create `packages/domain/test/state-machines.test.js`: transition, domain-separation, and prerequisite tests.
- Modify root `README.md`: identify the new domain package.

## State Values

| Domain | States |
|---|---|
| campaign | `DRAFT`, `ACTIVE`, `COMPLETED`, `CANCELLED` |
| milestone | `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |
| evidence | `UPLOADED`, `PROCESSING`, `READY_FOR_REVIEW`, `PROCESSING_FAILED`, `SUPERSEDED` |
| screening | `PROCESSING`, `CLEAR`, `FLAGGED`, `FAILED` |
| verification | `PENDING`, `VERIFIED`, `NEEDS_REVISION`, `REJECTED` |
| disbursement | `NOT_READY`, `READY_FOR_PAYMENT`, `PAYMENT_REPORTED`, `CONFIRMED`, `FAILED` |
| blockchain proof | `PENDING`, `SUBMITTED`, `ANCHORED`, `FAILED` |

`CAMPAIGN` and `MILESTONE` states are the initial proposal documented in the workspace specs; transition owner/roles are not enforced until those are confirmed.

Transition edges are: Campaign `DRAFT→ACTIVE|CANCELLED`, `ACTIVE→COMPLETED|CANCELLED`; Milestone `PLANNED→IN_PROGRESS|CANCELLED`, `IN_PROGRESS→COMPLETED|CANCELLED`; Evidence `UPLOADED→PROCESSING`, `PROCESSING→READY_FOR_REVIEW|PROCESSING_FAILED`, `PROCESSING_FAILED→PROCESSING`; Screening `PROCESSING→CLEAR|FLAGGED|FAILED`; Verification `PENDING→VERIFIED|NEEDS_REVISION|REJECTED`; Disbursement `NOT_READY→READY_FOR_PAYMENT`, `READY_FOR_PAYMENT→PAYMENT_REPORTED|FAILED`, `PAYMENT_REPORTED→CONFIRMED|FAILED`; Proof `PENDING→SUBMITTED`, `SUBMITTED→ANCHORED|FAILED`, `FAILED→PENDING` for an idempotent retry of the same proof version. Any retained prior evidence version may become `SUPERSEDED` only with a new version reference.

Context guards: `READY_FOR_PAYMENT` needs `verificationStatus=VERIFIED` and `funderAuthorized=true`; `PAYMENT_REPORTED` needs `reporterRole=FUNDER` and a nonempty `reporterId`; `CONFIRMED` needs `independentSettlementSource=true` and a nonempty `settlementEvidenceId`; payment `FAILED` needs `authoritativeFailure=true`. `ANCHORED` needs `network=ETHEREUM_SEPOLIA`, `receiptStatus=1`, and a nonnegative integer `blockNumber`; proof retry needs equal `proofVersion` and `retryProofVersion`.

## Task 1: Domain Transition Tests (TDD)

- [x] Add the workspace manifest and first test asserting `transitionStatus("screening", "PROCESSING", "CLEAR", {flagCodes: []})` returns `CLEAR`.
- [x] The test uses Node's test runner and strict assertions:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { transitionStatus } from "../src/index.js";

test("screening state is independent from verifier state", () => {
  assert.equal(transitionStatus("screening", "PROCESSING", "CLEAR", { flagCodes: [] }), "CLEAR");
  assert.throws(() => transitionStatus("screening", "PROCESSING", "VERIFIED"));
});
```

- [x] Run `npm test --workspace @dana-terang/domain`; confirm it fails because `src/index.js` does not exist.
- [x] Add tests that screening cannot transition to `VERIFIED`, `CONFIRMED` belongs only to payment, and a rejected transition throws `InvalidStateTransitionError` with domain/from/to fields.
- [x] Add payment prerequisite tests for the exact context guards listed above; manual reports can only become `PAYMENT_REPORTED`.
- [x] Add proof prerequisite tests for the exact Sepolia receipt guard and same-version retry rule listed above.

## Task 2: Implement the Domain Package

- [x] Export frozen state-domain definitions with response fields `campaignStatus`, `milestoneStatus`, `evidenceStatus`, `screeningStatus`, `verificationStatus`, `disbursementStatus`, and `proofStatus`.
- [x] Encode the transitions from `StatusStateMachines.md`; keep Campaign/Milestone initial values marked as proposed and do not add user-role authorization in this slice.
- [x] Implement `transitionStatus(domain, from, to, context={})`; reject unknown domains/states, invalid edges, failed payment/proof prerequisites, and return the target status on success.
- [x] Run package and root tests; expect all workspace tests to pass.

## Verification

Run `npm test --workspace @dana-terang/domain` and `npm test`. This library validates state semantics only; it is not a substitute for authentication, object-level authorization, or persisted audit events.

## Execution Results

- TDD observed the missing-module failure before implementing the transition package.
- Domain tests cover separated fields, screening flags, funder authorization/reporting, independent payment confirmation, and Sepolia proof receipt/retry rules.
- Root test suite: 18 passing tests (3 API, 6 domain, 9 proof), 0 failures.
- Full workspace build, dependency audit, and UI browser/accessibility checks pass after integration.
