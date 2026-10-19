# DanaTerang MVP Completion Design

## Goal

Deliver the documented Phase 1 evidence-review demo end-to-end, then make the same workflow ready for a limited Phase 2 pilot with real program documents but no beneficiary personal data.

## Current State

The repository has tested canonical-proof and state-machine libraries, Auth/RBAC and Campaign/Milestone APIs, private evidence upload/storage with raw SHA-256, and local OCR/screening processing. Permissioned peer review, the quorum contract, canonical Sepolia proof anchoring, dynamic public audit data, and pilot operations remain to be implemented.

## Approved Product Decisions

- Phase 1 Definition of Done follows `DanaTerang_Documentation/MVPPhases.md`: campaign/milestone → upload and raw SHA-256 → OCR/screening → human decision → versioned Sepolia proof → safe public audit.
- Phase 2 target is a limited staging pilot using real program documents while excluding beneficiary PII in the initial cohort.
- Human evidence decisions use a permissioned panel of three independently registered Verifiers and require two matching signed votes. Admin handles operational metadata only and cannot vote, choose/replace panel members, view original/OCR/internal notes, or override a result. This is not an open permissionless validator network; no token incentives are included.
- Organizers create draft campaigns and milestones for their own organization; an attached Funder activates the campaign; Organizers report milestone progress.
- Payment remains outside the platform. Phase 1/initial pilot may store a source-attributed `PAYMENT_REPORTED` record only; no payment rails, escrow, or independent `CONFIRMED` state.
- Local development and cloud staging are both targets. Provider credentials remain environment configuration, never repository content.

## Architecture

- Keep `frontend/`, `backend/`, `database/`, and `packages/` as root workspaces.
- PostgreSQL remains the application source of truth; ordered migrations define campaign, milestone, evidence, OCR, verification, proof, and audit data.
- Use a private local-filesystem storage adapter for Docker-free development and an S3-compatible adapter for cloud staging; originals remain private in both.
- Use Tesseract.js for Indonesian/English OCR and deterministic, rules-based screening; OCR is advisory and peer verification remains authoritative.
- Use EIP-712 Verifier signatures and a Solidity quorum contract for version-specific review outcomes, with an ethers.js gas relayer. The existing canonical proof package is anchored after quorum; the quorum outcome is not editable by Admin.
- Keep originals, full OCR, and review notes private; the public API returns an allowlisted summary and proof metadata only.

## End-to-End Flow

1. An Organizer signs in and creates a draft Campaign under the Organization attached to their account.
2. The Organizer adds Milestones and associates an eligible Funder. Only that Funder or an Admin can activate the Campaign.
3. The Organizer uploads a supported program document. The backend validates size/type, computes SHA-256 from exact bytes, stores the original privately, and creates an immutable Evidence version.
4. OCR produces per-field values/confidence and screening flags. Processing and failure states remain visible; a screening `CLEAR` is never treated as a review decision.
5. Three assigned Verifiers inspect that Evidence version and sign votes. Two matching EIP-712 signatures finalize `VERIFIED`, `NEEDS_REVISION`, or `REJECTED` in the quorum contract. Admin cannot vote or override. A revision creates a new Evidence version and retains earlier history.
6. After a quorum outcome, the backend creates the documented canonical JCS package and submits its SHA-256 commitment to Sepolia. A proof is `ANCHORED` only after a successful receipt with a block number; retries are idempotent for the same proof version.
7. The public audit page reads only an approved non-sensitive projection and links to Sepolia Etherscan. It never exposes the original file, full OCR text, or review notes.

Campaign and milestone transition permissions use the approved ownership rules above; every other status transition uses `packages/domain` and is enforced again by the API. State from screening, verification, payment reporting, and blockchain proof remains separate.

## Delivery Decomposition

Implement and verify independent vertical slices in this order:

1. Local runtime foundation: native PostgreSQL setup, private local-filesystem storage, health checks, migrations, safe local environment setup, and role-ready login UI. Do not require Docker.
2. Campaign/Milestone slice: schema, scoped repositories, transitions, API, Organizer/Funder screens, and Admin activation.
3. Evidence slice: private upload, exact-byte hashing, object storage, access checks, immutable versions, and audit events.
4. OCR/screening slice: Indonesian/English OCR, normalized per-field confidence, advisory rules, retries, and UI states.
5. Permissioned review slice: assigned Verifier queue/detail, signed 2-of-3 version-specific decisions, revision flow, and audit history. Admin is operations-only.
6. Proof slice: canonical package, deployable Solidity quorum/proof contracts, ethers relayer, idempotent submission/retry, receipt persistence, and proof details.
7. Public audit slice: dynamic allowlisted API projection and accessible responsive page.
8. Phase 2 readiness: tenant isolation/security tests, consent and retention/deletion rules, no-beneficiary-PII pilot controls, backup/restore and incident runbooks, staging deployment, and agreed evaluation measures.

## Acceptance Criteria

### Phase 1 Demo

- A local developer can run the native PostgreSQL service, API, and frontend with private filesystem storage from documented configuration and apply migrations without editing source code.
- An Organizer can create a draft campaign and milestones, associate an existing Funder, and submit program evidence; cross-organization requests are denied.
- Uploaded bytes remain private, their persisted SHA-256 matches the original bytes, OCR/screening states and field confidence are visible, and failures can be retried without overwriting versions.
- Two of three assigned Verifiers can finalize a decision for a specific version; a single Admin cannot cast or override a vote. `NEEDS_REVISION` exposes Organizer-facing instructions and a new upload creates a new version.
- With valid Sepolia configuration and a funded service wallet, a reviewed version is anchored by a real contract transaction; the persisted receipt includes a successful status and block number.
- The public page shows current approved campaign/milestone status and proof details without returning original files, full OCR text, payment references, or internal notes.
- Automated API, domain, proof, browser, migration, authorization, and end-to-end tests pass; the frontend production build and dependency audit pass.

### Phase 2 Pilot Readiness

- Two Organizations cannot access one another's campaigns or files, including through guessed IDs or stale signed URLs.
- Consent, allowed document types, no-beneficiary-PII handling, public-release/redaction review, retention/deletion behavior, and immutable-chain limits are documented and tested.
- A pilot owner approves a concrete retention period and deletion/hold exceptions before any cohort data is accepted; the software exposes the approved policy and records deletion actions.
- Verifier roster governance, signed votes, quorum outcomes, role changes, access, evidence versions, review outcomes, and proof retries are auditable. Admin cannot unilaterally change the roster or outcomes.
- Backup/restore, incident response, signer-key handling, and user-support runbooks are exercised in staging; pilot baseline and success measures are agreed before real cohort onboarding.
- Manual payment reports remain attributed, private by default, and distinct from independently confirmed settlement.

## External Configuration Gates

The current environment has no Docker, PostgreSQL CLI/server, or configured `DATABASE_URL`, object-storage credentials, Sepolia RPC, service-wallet key, deployed contract address, or provisioned Verifier wallets. Peer review requires independently held Verifier wallets; the service wallet only relays signed votes and pays gas. Local infrastructure and `.env.example` can be implemented without those values, but native PostgreSQL, cloud-staging, and live Sepolia checks require the corresponding services and credentials. Do not claim those checks passed before running them. Never commit secrets or ask users to submit wallet private keys.

Cloud hosting remains provider-neutral until an account/provider is selected. Payment-provider integration, fiat custody, escrow, beneficiary PII, open validator networks, and token incentives are out of scope for this delivery.
