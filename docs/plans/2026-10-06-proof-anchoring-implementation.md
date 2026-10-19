# DanaTerang Proof Anchoring Implementation Plan

> **For agentic workers:** Use `executing-plans` and TDD to implement this approved plan inline on `main`. Preserve existing uncommitted work, use no Docker, do not commit unless requested, and never put relayer keys or real documents in the repository.

> **Historical schema note:** This original slice implemented schema version 1, which is retained only for legacy proof records. New peer-quorum proofs use schema version 2 as specified in `DanaTerang_Documentation/BlockchainProof.md` and `docs/specs/2026-10-15-system-completion-design.md`; do not use the schema-1 steps below for new quorum proofs.

**Goal:** After a 2-of-3 quorum outcome, build the documented canonical proof package, persist its SHA-256 commitment with receipts, and anchor it on-chain idempotently through a relayer, with proof details exposed per role.

**Architecture:** The backend builds a schema-1 canonical proof package (JCS, `@dana-terang/proof`) from the finalized review round, its evidence version, and the latest OCR run. Only the package's SHA-256 commitment goes on-chain; the canonical package itself stays private in PostgreSQL. A new minimal `ProofAnchor` contract records one commitment per opaque proof ID, relayer-only, and emits `ProofAnchored`. The backend anchors through the same relayer wallet as peer review, retries idempotently, and degrades to a disabled feature when chain configuration is absent.

**Tech Stack:** Solidity 0.8.37, OpenZeppelin Contracts 5.4, solc-js, `@ethereumjs/vm` 10, ethers.js 6.17, PostgreSQL `pg`, Express 5, `node:test`, Supertest.

---

## File Map

- Modify `packages/review-contract/scripts/compile.js` to emit `src/proof-anchor-abi.json` alongside the quorum ABI; create `contracts/ProofAnchor.sol` and `test/ProofAnchor.test.js`.
- Create `database/migrations/006_proof_anchor.sql` and `.down.sql` for the proofs table (one row per finalized evidence version, commitment, anchor status, receipt columns).
- Create `backend/src/proof/{config.js,anchorChain.js,proofService.js}`, `backend/src/repositories/proofRepository.js`, and `backend/src/routes/proofs.js`.
- Modify `backend/src/app.js`, `backend/src/review/peerReviewService.js` (hook after `QUORUM_REACHED` finalization), `backend/.env.example`, and role/privacy documentation.
- Tests: `packages/review-contract/test/ProofAnchor.test.js`, `backend/test/proof/{config.test.js,chain.test.js,proof-service.test.js,routes.test.js}`.
- Remaining after backend slice: frontend proof-details surfaces (Admin list/retry, Organizer/Funder proof view), browser E2E extension, README/database README updates, and the public-audit slice that consumes this data.

## Task 1: Failing Contract Tests for ProofAnchor

**Files:** create `packages/review-contract/test/ProofAnchor.test.js`; modify `scripts/compile.js`.

- [x] Constructor rejects a zero relayer address; stores the relayer.
- [x] `anchorProof(proofId, commitment)` requires the relayer (`EXPECT_RELAYER_ONLY`), nonzero proofId/commitment (`EXPECT_INVALID_PROOF_ID`, `EXPECT_INVALID_COMMITMENT`).
- [x] Anchoring emits `ProofAnchored(proofId, commitment)` and stores the commitment; `proofCommitments(proofId)` returns it.
- [x] Re-anchoring the same proofId reverts (`EXPECT_ALREADY_ANCHORED`) even with a different commitment — idempotency guarantee.
- [x] Different proofIds can anchor different commitments; no admin/owner path exists.
- [x] `npm test --workspace @dana-terang/review-contract` passes with the new tests.

## Task 2: ProofAnchor Contract and ABI Emission

**Files:** create `packages/review-contract/contracts/ProofAnchor.sol`; modify `scripts/compile.js` to also write `src/proof-anchor-abi.json`.

- [x] Immutable `relayer` set in the constructor via OpenZeppelin `Address`-free plain check; no upgrade or rotation path in Phase 1 (documented limitation).
- [x] `anchorProof(bytes32 proofId, bytes32 commitment)` with custom errors and the event; public mapping for commitments.
- [x] Compile emits both ABI artifacts; contract tests pass.

## Task 3: Proof Schema and Repository

**Files:** create `database/migrations/006_proof_anchor.sql`/`.down.sql`, `backend/src/repositories/proofRepository.js`; test in `backend/test/proof/proof-service.test.js`.

- [x] `proofs` table: `id UUID PK`, `evidence_id` (unique, FK evidence), `proof_version >= 1` default 1, `review_round_id` FK, `campaign_id`, `milestone_id`, `package JSONB` (canonical, private), `package_hash TEXT 64-hex`, `status IN ('PENDING','ANCHORING','ANCHORED','FAILED')`, `proof_id TEXT 66-hex` unique, `contract_address`, `transaction_hash`, `block_number`, `attempts`, `last_error_code`, `created_at`, `updated_at`, `anchored_at`. Proof rows are created only for `QUORUM_REACHED` rounds.
- [x] Repository methods: `createProofForRound` (idempotent insert), `getProofByEvidence`, `listProofs` (metadata projection), `markAnchoring/markAnchored/markFailed`, `incrementAttempts`.
- [x] Apply the migration to the local database.

## Task 4: Proof Service, Anchor Chain Adapter, and Quorum Hook

**Files:** create `backend/src/proof/{config.js,anchorChain.js,proofService.js}`; modify `backend/src/review/peerReviewService.js`, `backend/.env.example`.

- [x] `config.js` reads `PROOF_ANCHOR_CONTRACT_ADDRESS`, `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`, `BLOCKCHAIN_CHAIN_ID`; `enabled` is false unless all are set, so local dev without Sepolia keeps the feature off.
- [x] `anchorChain.js` mirrors `review/chain.js`: validates chain id, deployed bytecode, and that the wallet is the contract relayer; injectable factories for tests.
- [x] `proofService.buildPackage(round)`: assembles the schema-1 package from round + evidence + latest OCR run + screening flags; uses `@dana-terang/proof` `hashProofPackage`; OCR full text never enters the package.
- [x] `proofService.anchor(proofId)`: idempotent — local status gate + contract duplicate revert treated as already-anchored; persists transaction hash and block number from the receipt.
- [x] Hook: after a round finalizes `QUORUM_REACHED`, create the proof row (PENDING) and attempt anchoring when enabled; failures only mark the proof FAILED and never break the review flow.
- [x] Service tests with an in-memory fake contract and pg-mem cover: package hash stability, idempotent retries, disabled configuration no-op, failure isolation.

## Task 5: Proof Routes and App Wiring

**Files:** create `backend/src/routes/proofs.js`; modify `backend/src/app.js`.

- [x] `GET /api/admin/proofs` — Admin-only metadata list (ids, status, hashes, timestamps, attempts; no OCR/text).
- [x] `POST /api/admin/proofs/:proofId/retry` — Admin-only retry for FAILED proofs.
- [x] `GET /api/evidence/:evidenceId/proof` — role-scoped: Organizer (own organization) and Admin see hash/status/receipt; Funder sees status only; full OCR/originals remain Verifier-only.
- [x] Route tests via Supertest with pg-mem and a fake chain.

## Task 6 (later slices): Frontend Surfaces and Public Audit

- [ ] Admin proofs page (list + retry), Organizer/Funder proof panel on the campaign page, and the dynamic public-audit slice consuming anchored proofs.
- [ ] Extend the browser E2E flow and README/database README for proof configuration.

## External Configuration Gates

Live Sepolia anchoring requires `PROOF_ANCHOR_CONTRACT_ADDRESS`, `BLOCKCHAIN_RPC_URL`, a funded relayer key, and `BLOCKCHAIN_CHAIN_ID` in an untracked `.env`. Without them the feature reports disabled and proofs stay `PENDING`; this is expected locally. Do not claim Sepolia checks passed before running them.
