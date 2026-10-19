# DanaTerang Permissioned Peer Review Implementation Plan

> **For agentic workers:** Use `executing-plans` and TDD to implement this approved plan inline on `main`. Preserve existing uncommitted work, use no Docker, do not commit unless requested, and never put reviewer keys or real documents in the repository.

**Goal:** Finalize each evidence-version review through a contract-verified 2-of-3 Verifier quorum, preserve revision history, and restrict source/OCR access to assigned Verifiers.

**Architecture:** Three independently provisioned Verifier wallets sign EIP-712 votes. A Solidity contract verifies roster membership and immutable decision state; a backend relayer normally submits signed votes and pays gas. PostgreSQL stores round assignments, votes, private notes/instructions, and confirmed contract outcomes. The hosted API/private object storage remain outside the P2P decision layer.

**Tech Stack:** Solidity 0.8.37, OpenZeppelin Contracts 5.4, solc-js, `@ethereumjs/vm` 10, ethers.js 6.17, PostgreSQL `pg`, Express 5, Next.js 16, Supertest, `node:test`, Playwright.

---

## File Map

- Create `packages/review-contract/package.json`, `contracts/PeerReviewQuorum.sol`, `scripts/compile.js`, `src/abi.json`, and local EVM tests in `packages/review-contract/test/`.
- Create `database/migrations/005_peer_review.sql` and `.down.sql` for reviewer wallet bindings, review rounds/assignments/votes, and version-specific quorum outcomes.
- Create `backend/src/review/{config.js,chain.js,eip712.js,peerReviewService.js}`, `backend/src/repositories/reviewRepository.js`, and `backend/src/routes/reviews.js` for chain setup, signatures, relaying, assignment-scoped reads, and metadata-only Admin operations.
- Modify `backend/src/server.js`, `backend/src/app.js`, `backend/src/repositories/ocrRepository.js`, `backend/src/repositories/evidenceRepository.js`, `backend/src/evidence/evidenceService.js`, and `backend/src/routes/evidence.js` for round creation, private file permissions, event reconciliation, and revisions.
- Create `frontend/app/verifier/reviews/page.tsx`, `frontend/app/verifier/reviews/[reviewId]/page.tsx`, and `frontend/app/admin/reviews/page.tsx`; modify `frontend/app/campaigns/[campaignId]/page.tsx` for Organizer/Funder summary and revision behavior.
- Modify `backend/scripts/browser-test-server.js`, `frontend/tests/test_authenticated_flow.py`, `.env.example` files, and the active product/privacy/API/data-model documentation. Keep the earlier single-Admin implementation plans as historical records with their superseded-scope note.

## Task 1: Local EVM Harness and Failing Contract Tests

**Files:** create `packages/review-contract/package.json`, `packages/review-contract/test/PeerReviewQuorum.test.js`, and `packages/review-contract/testHelpers/compile-and-deploy.js`; modify the root lockfile.

- [x] Write contract tests first for constructor roster validation, valid/invalid EIP-712 signatures, one vote per signer/review round, evidence-version binding, 2-of-3 finality, all-different `NO_QUORUM`, replay rejection, immutable outcomes, and peer-quorum roster updates.
- [x] Add the `@dana-terang/review-contract` workspace under `packages/`; the root workspace glob already includes `packages/*`.
- [x] Install the local EVM test dependencies with `npm install --workspace @dana-terang/review-contract --save-dev --save-exact @ethereumjs/vm@10.1.3 @ethereumjs/common@10.1.3 @ethereumjs/tx@10.1.3 @ethereumjs/util@10.1.3`; solc 0.8.37, ethers 6.17, and OpenZeppelin 5.4 are exact workspace dependencies. Root `overrides` pins solc's transitive `tmp` package to audit-fixed 0.2.7.
- [x] Implement the test compiler helper using solc standard JSON and a filesystem import resolver for OpenZeppelin. Execute signed transactions in an in-memory `@ethereumjs/vm` with deterministic test wallets; do not use Docker or a live RPC.
- [x] Run `npm test --workspace @dana-terang/review-contract`; confirm the initial missing-source failures and all six contract tests pass after implementation.

## Task 2: Solidity EIP-712 Quorum Contract

**Files:** create `packages/review-contract/contracts/PeerReviewQuorum.sol` and `packages/review-contract/scripts/compile.js`; generate `packages/review-contract/src/abi.json`; test in `packages/review-contract/test/PeerReviewQuorum.test.js`.

- [x] Implement a constructor with exactly three nonzero, distinct Verifier addresses and three distinct Organization commitments. Do not add an owner/Admin decision function.
- [x] Add `openReview(reviewId, evidenceCommitment, round)` as a one-time binding for an opaque review ID. Only the configured relayer may register a round; this capability opens a round but cannot cast a vote or set an outcome.
- [x] Define the typed vote fields and signed domain in the contract:

```solidity
struct Vote {
    bytes32 reviewId;
    bytes32 evidenceCommitment;
    bytes32 organizerOrganizationCommitment;
    bytes32 funderOrganizationCommitment;
    uint32 round;
    uint8 decision; // 1 VERIFIED, 2 NEEDS_REVISION, 3 REJECTED
    bytes32 instructionCommitment;
    bool noConflictAttested;
}
```

- [x] Use OpenZeppelin `EIP712` and `ECDSA`; reject a recovered signer outside the fixed roster, a false conflict attestation, mismatched review/evidence/round commitments, duplicate signers, unsupported decisions, and votes after finalization.
- [x] Record one signed vote per roster member. Finalize only when two distinct signatures agree on the same decision; after all three votes without a matching pair, set the round to `NO_QUORUM` and keep verification pending. A new round cannot open until the previous round reaches `NO_QUORUM`.
- [x] Emit vote/finalization/no-quorum events containing opaque IDs/commitments, pseudonymous reviewer addresses, decision, and round; no file bytes, OCR, notes, names, emails, or raw personal details.
- [x] Add peer-quorum `updateVerifierRoster` requiring signatures from two distinct members of the current roster; validate new addresses/Organization commitments are nonzero and distinct, increment roster version, and prevent old-roster signatures from replaying.
- [x] Add a deterministic compile command that writes the contract ABI consumed by the API. Contract tests pass and the contract has no Admin ownership/override path.

## Task 3: Review Schema and Round Repository

**Files:** create `database/migrations/005_peer_review.sql`, `.down.sql`, `backend/src/repositories/reviewRepository.js`, and `backend/test/db/review-repository.test.js`; modify `backend/test/db/migrations.test.js`, `backend/test/db/ocr-repository.test.js`, and `backend/src/repositories/ocrRepository.js`.

- [x] Add migration tests for unique round/version identity, exactly three distinct assignments, one vote per `(review_round_id, verifier_id)`, unique wallet binding, allowed round/vote/verification states, and foreign-key/down-migration behavior.
- [x] Run `node --test test/db/migrations.test.js test/db/review-repository.test.js`; migrations/repository tests pass.
- [x] Add `review_rounds` with durable `WAITING_FOR_CHAIN|OPEN|QUORUM_REACHED|NO_QUORUM` states, `review_assignments`, vote/submission tables, `verifier_wallets`, one final `verifications` row per evidence version, and one-time wallet-challenge storage. Store EIP-712 signature, wallet address, conflict attestation, salted Organizer-instruction commitment, private internal note, relay status, transaction hash, block number, and final decision fields separately.
- [x] On successful OCR/screening completion, create a `WAITING_FOR_CHAIN` review round and three-member assignments transactionally with the evidence/round state. If the registered roster cannot supply three independent non-conflicted Verifiers, create no round and keep verification pending; do not silently fall back to Admin. Reject duplicate Organization/wallet members.
- [x] Implement repository methods to create version-specific rounds, assign only the fixed eligible roster, and list assigned open reviews.
- [x] Verify the repository refuses non-ready evidence and conflicting/oversized or non-exact rosters; schema constraints reject duplicate votes, invalid revision-instruction records, and duplicate final-verification rows. OCR completion opens a round in the same transaction.

## Task 4: EIP-712 Service and Gas-Relayed Contract Calls

**Files:** create `backend/src/review/eip712.js`, `backend/src/review/peerReviewService.js`, and `backend/test/review/peer-review-service.test.js`; modify `backend/package.json`, `backend/src/config.js`, `backend/src/server.js`, and `backend/.env.example`.

- [x] Write service tests using deterministic ethers wallets for one-time wallet binding, valid/invalid signatures, wrong signer, wrong chain ID, wrong verifying contract, altered evidence commitment, wrong round, idempotent vote identity, and missing chain configuration.
- [x] Use the existing exact ethers.js 6.17 API dependency; parse `PEER_REVIEW_CONTRACT_ADDRESS`, reuse `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`, and `BLOCKCHAIN_CHAIN_ID`, and fail startup if the configured chain, deployed code, or relayer does not match.
- [x] Implement one shared EIP-712 domain/message builder. Verify signatures with `ethers.verifyTypedData`; require the recovered wallet to match the assigned Verifier wallet and role.
- [x] Implement wallet binding as a one-time signed challenge. A `VERIFIER` account may bind only an address returned as an active member by the contract; Admin role assignment alone cannot bind another wallet.
- [x] Add repository operations that store immutable signed votes, record relay/receipt state, and reconcile final decisions and Organizer-instruction commitments from confirmed contract events.
- [x] Implement an idempotent registrar for `WAITING_FOR_CHAIN` rounds. It validates the stored panel against the contract roster, records the transaction hash, and exposes the Verifier queue only after a successful open receipt and matching contract state.
- [x] Store the immutable vote record, submit the signed vote from the relayer, persist transaction hashes, and return pending until a successful receipt confirms the vote or quorum.
- [ ] On a submit timeout without a known transaction hash, query chain state before resending. Never log signatures, private notes, Organizer instructions, OCR text, or wallet private keys.
- [x] Reconcile confirmed contract events to `verificationStatus`; the API does not finalize from the database vote count.
- [ ] Run the full service flow against the local EVM adapter; mocked receipt polling covers unknown/pending receipts, but the API service has not yet been exercised against that adapter.

## Task 5: Review APIs, Access Boundaries, and Revision Uploads

**Files:** modify `backend/src/routes/reviews.js`, `backend/src/routes/evidence.js`, `backend/src/repositories/evidenceRepository.js`, `backend/src/evidence/evidenceService.js`, and add `backend/test/review/routes.test.js`; modify `backend/test/evidence/routes.test.js`.

- [x] Test and implement the core role/access boundaries: only assigned Verifiers can read original/full OCR and their own private note; Admin gets operational metadata only; Organizer receives the final revision instruction; Funder receives status only; unassigned Verifier access is non-disclosing.
- [x] Make signed votes immutable and idempotent for the same assigned Verifier; reject altered duplicate votes and invalid signatures before relay; bind the final revision instruction to the contract event commitment.
- [x] Change `GET /api/evidence/:id/file` and full OCR reads to require a Verifier assigned to that evidence version. Participant summaries are safe; Organizer/Funder/Admin cannot download source bytes.
- [x] Implement wallet challenge/binding, Verifier queue/detail, vote prepare/submit, and Admin metadata-only endpoints. State-changing requests require the configured exact Origin; responses use `Cache-Control: private, no-store`.
- [x] Implement safe Admin review metadata reads (identifiers, status, counts, timestamps only); do not include filename, source/OCR content, notes, instructions, votes, or reviewer selection controls.
- [x] Implement `POST /api/admin/evidence/:id/ocr-retry` semantics for failed OCR only before review opens. Admin receives processing metadata only.
- [x] Implement `POST /api/evidence/:evidenceId/revisions` for the owning Organizer after a `NEEDS_REVISION` quorum. Derive version lineage from the stored parent, create the OCR job transactionally, and supersede the old evidence without reopening the Milestone.
- [x] Run focused API/repository checks for assignment-scoped content, metadata-only Admin, final Organizer instructions, and immutable revision history.

## Task 6: Verifier Wallet UI and Participant Status

**Files:** create `frontend/app/verifier/reviews/page.tsx`, `frontend/app/verifier/reviews/[reviewId]/page.tsx`, `frontend/app/admin/reviews/page.tsx`; modify `frontend/app/campaigns/[campaignId]/page.tsx`, `frontend/tests/test_authenticated_flow.py`, and `backend/scripts/browser-test-server.js`.

- [x] Add an EIP-1193 wallet adapter for Verifier-only `eth_requestAccounts` and `eth_signTypedData_v4`. Show the expected chain/address; handle absent wallet, wrong network, user rejection, relay pending/failure, receipt confirmation, and no-quorum without exposing a key.
- [x] Build a Verifier queue/detail with assigned review state, original download, OCR confidence/flags, private notes, separate Organizer instructions, and signed decision controls. Hide votes from peers until the current Verifier has submitted.
- [x] Build Admin Operations using identifiers/status/counts/timestamps only; do not show filename/source/OCR/notes/votes or allow reviewer selection, approval, revision, rejection, or override.
- [x] Update Organizer Campaign detail to show decision status and only the Organizer-facing instructions after `NEEDS_REVISION`; add a revision upload flow that preserves the prior file/hash and updates to the new version's OCR/round state. Funder sees only status/quorum summary.
- [x] Extend the browser-test API with deterministic verifier wallets, mock contract outcomes, signature rejection, relayer errors, quorum, no-quorum, and revision outcomes. Test keys are fixtures only; no real wallet keys or Sepolia RPC in CI.
- [x] Write browser tests for wallet wrong-network/rejection recovery, 2-of-3 verification with keyboard signing, no-quorum pending, Admin metadata-only, source/OCR denial, Organizer revision, Funder status-only summary, focus outlines, role-based live announcements, axe, and responsive layouts.
- [x] Run `npm test --workspace @dana-terang/web`; the existing Auth/Campaign/OCR flow and all peer-review states pass. One dev-proxy `ECONNRESET` flake was observed once and cleared on rerun with no code change.

## Task 7: Documentation and Full Verification

**Files:** update `README.md`, `backend/.env.example`, `database/README.md`, `DanaTerang_Documentation/{MVPPhases,ProductRequirements,BackendAPI,DataModel,SecurityPrivacy,StatusStateMachines,AIandOCR,FrontendUX,BlockchainProof,DeploymentOperations}.md`, and this plan's checkboxes.

- [x] Document the permissioned 2-of-3 peer policy, Verifier wallet requirement, relayer/service-key boundary, Admin metadata-only role, assigned-only evidence/OCR access, no-quorum state, and versioned revision behavior. State that reviewer addresses and decisions are publicly visible on chain.
- [x] Document `PEER_REVIEW_CONTRACT_ADDRESS`, RPC/chain/relayer settings, and the fixed Verifier roster as contract-deployment inputs; keep all private keys out of environment examples. Organizers/Funders require no wallet.
- [x] Run `npm test` from repository root; web/API/domain/proof plus Solidity/local-EVM suites pass (147 API tests, 6 domain, 9 proof, 7 contract, browser flow included).
- [x] Run `npm run build --workspace @dana-terang/web`, `npm audit`, and `git diff --check`; clean production build, zero advisories, and no whitespace errors (only pre-existing CRLF line-ending warnings).
- [x] Verify migrations 005 up/down with `pg-mem`. Native PostgreSQL and live Sepolia checks remain gated on user-provisioned services/addresses.
- [x] Confirm no `.env`, real Verifier private key, signing secret, or real evidence is tracked or emitted in logs; browser-test wallets are deterministic fixtures only.

## External Gates

- The initial fixed verifier addresses and service-relayer wallet must be independently provisioned and tested; never request or commit private keys. Verifiers sign locally, the service relays, and the contract verifies signatures.
- Native PostgreSQL is required to verify transactions, event reconciliation, and revision lineage with live SQL behavior; no Docker fallback is permitted.
- Live Sepolia deployment requires `BLOCKCHAIN_RPC_URL`, funded service relayer, deployed `PeerReviewQuorum`/proof contract addresses, and confirmation policy. Do not claim real chain proof until a successful receipt is read back.
- A pilot still needs organization identity assurance, conflict/appeal policy, key recovery, `NO_QUORUM` escalation, storage quotas, retention/deletion rules, backups, and incident response.
