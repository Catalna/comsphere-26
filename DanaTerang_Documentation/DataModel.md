# DanaTerang — Data Model

## 1. Main Entities

### User

Fields:

- id
- name
- email
- passwordHash
- role
- organizationId
- status
- createdAt
- updatedAt

Roles:

- ADMIN
- ORGANIZER
- FUNDER
- VERIFIER
- BENEFICIARY
- PUBLIC

### Organization

Fields:

- id
- name
- type
- description
- address
- verified
- createdAt
- updatedAt

Types:

- NGO
- COMPANY
- GOVERNMENT
- COMMUNITY
- OTHER

The `verified` field is a proposed organization status, not formal accreditation. Phase 1 does not provide an organization-accreditation service; a pilot must define the evidence and authority behind this status.

### Campaign

Fields:

- id
- organizationId
- funderId
- title
- description
- totalBudget
- currency
- fundingMode
- status
- publiclyPublishedAt
- publishedBy
- startDate
- endDate
- createdAt
- updatedAt

`status` is `CampaignStatus` and uses the independent campaign lifecycle in `StatusStateMachines.md`.
`publiclyPublishedAt` and `publishedBy` are null by default. An active Admin explicitly publishes or withdraws a campaign; only published campaigns appear in the public-audit projection.

Funding modes:

- EXTERNAL_TRACKING
- PAYMENT_PROVIDER
- ONCHAIN_ESCROW

MVP should mainly support `EXTERNAL_TRACKING`.

### Milestone

Fields:

- id
- campaignId
- title
- description
- budgetAmount
- currency
- orderIndex
- status
- startDate
- dueDate
- createdAt
- updatedAt

`status` is `MilestoneStatus` and describes activity lifecycle only; it does not encode screening, verifier, payment, or blockchain state.

### Evidence

Fields:

- id
- milestoneId
- uploaderId
- evidenceType
- storageKey (internal private-object key; never a public URL)
- redactedFileUrl (optional derivative)
- redactedHash (SHA-256 of the exact redacted derivative bytes; optional)
- redactedCreatedAt (optional)
- fileName
- fileSize
- rawHash
- versionGroupId
- version
- previousEvidenceId
- status
- createdAt
- updatedAt

Types:

- RECEIPT
- PHOTO
- REPORT
- INVOICE
- CONTRACT
- OTHER

`storageKey` refers to the private original off-chain file and is never returned to clients. Only the three Verifiers assigned to that version may retrieve the platform-stored original; Organizer/Funder responses contain safe summaries, and Admin cannot retrieve content through the application. `rawHash` is computed before OCR and redaction. A redacted derivative is a separate file with a separate hash; never replace the original file or its hash. Each redaction edit creates a new evidence/derivative version. A derivative is publishable only after explicit review/approval and must be served separately from the private original. `status` is `EvidenceStatus` from `StatusStateMachines.md`.

### OCRResult

Fields:

- id
- evidenceId
- runNumber
- vendor
- date
- amount
- currency
- invoiceNumber
- extractedText
- documentLanguage (`id`, `en`, `mixed`, or `unknown`)
- fieldConfidence (per-field integer confidence from 0 to 100)
- screeningStatus (`PROCESSING`, `CLEAR`, `FLAGGED`, or `FAILED`)
- screeningRunVersion
- confidence (legacy/optional summary only; not a replacement for fieldConfidence)
- createdAt

`fieldConfidence` records confidence separately for `vendor`, `documentDate`, `amount`, and `invoiceNumber`. The stored `date` field maps to canonical-package `documentDate`; canonical `amount` is a nonnegative decimal string with uppercase ISO-4217 `currency`, no grouping separators/leading zeroes, and no trailing fractional zeroes. Thresholds are field-specific; the amount threshold is stricter than the vendor threshold. A required field below threshold produces a `LOW_CONFIDENCE_FIELD` review flag and prevents `CLEAR`. Exact numeric thresholds are calibrated before pilot use. Each reprocess creates a new screening run/version. Full OCR fields and text are available only to Verifiers assigned to the version's active review round. Screening results are advisory and do not establish that evidence is true.

### AIFlag

Fields:

- id
- ocrRunId
- type
- severity
- message
- createdAt

### Verification

Fields:

- id
- evidenceId
- status
- reviewRoundId
- contractAddress
- instructionCommitment (nullable; copied from the final contract event for `NEEDS_REVISION`)
- transactionHash
- blockNumber
- finalizedAt
- createdAt
- updatedAt

Statuses:

- PENDING
- VERIFIED
- NEEDS_REVISION
- REJECTED

`status` is `VerificationStatus`: `PENDING`, `VERIFIED`, `NEEDS_REVISION`, or `REJECTED`. A final status is derived from the 2-of-3 peer quorum contract for that evidence version and is not editable by Admin. If an implementation has already persisted `APPROVED`, map it explicitly to `VERIFIED` during a compatible migration; do not silently reinterpret stored values.

### ReviewRound

Fields:

- id
- evidenceId
- evidenceVersion
- roundNumber
- status (`WAITING_FOR_CHAIN`, `OPEN`, `QUORUM_REACHED`, `NO_QUORUM`, or `CHAIN_FAILED`)
- evidenceCommitment
- Organizer/Funder Organization commitments
- rosterVersion
- contractAddress
- openTransactionHash
- quorumTransactionHash
- blockNumber
- createdAt
- completedAt

A review round binds a three-peer panel to one immutable evidence version. `NO_QUORUM` leaves `verificationStatus=PENDING`; only the contract can finalize a decision.

### ReviewAssignment

Fields:

- reviewRoundId
- verifierId
- verifierWalletAddress
- organizationId
- conflictAttestedAt
- assignedAt

Every panel member belongs to a distinct Organization not participating as the Campaign Organizer or Funder. The initial roster is fixed; later roster changes require peer quorum rather than an Admin mutation.

### ReviewVote

Fields:

- id
- reviewRoundId
- verifierId
- decision (`VERIFIED`, `NEEDS_REVISION`, or `REJECTED`)
- eip712Signature
- noConflictAttested
- instructionCommitment (nullable)
- organizerInstructionSalt (off-chain only)
- internalNotes (private, off-chain)
- organizerInstructions (private until `NEEDS_REVISION` quorum)
- createdAt

Votes are append-only and unique by `(reviewRoundId, verifierId)`. EIP-712 signatures bind the decision to the chain/contract domain, evidence version, and review round. Internal notes never go on-chain; Organizer instructions are distinct and visible only to the owning Organizer after a revision quorum.

### VerifierWallet and WalletChallenge

`VerifierWallet` binds one active Verifier account and Organization to a unique, active contract-roster address and roster version. The account binds the address by signing a one-time challenge with an expiry; the database stores a nonce and consumed timestamp, never a private key. A role assignment by Admin does not itself authorize wallet binding or voting.

### ReviewVoteSubmission

Tracks the relayer state separately from immutable `ReviewVote` content: `QUEUED`, `SUBMITTED`, `CONFIRMED`, or `FAILED`, with attempt count, transaction hash, block number, and a safe error code. Receipt/event reconciliation—not the local vote count—updates the version-specific `Verification`.

### Disbursement

This entity is optional for the Phase 1 demo and represents an external payment report, not a transfer initiated or verified by DanaTerang. Its `status` is `DisbursementStatus`, separate from all other status domains.

Fields:

- id
- milestoneId
- approvedAmount
- currency
- method
- status
- transactionReference
- paymentProofUrl
- paidAt
- createdAt
- updatedAt

Methods:

- MANUAL_BANK_TRANSFER
- PAYMENT_PROVIDER
- ONCHAIN_ESCROW

Statuses:

- NOT_READY
- READY_FOR_PAYMENT
- PAYMENT_REPORTED
- CONFIRMED
- FAILED

`CONFIRMED` requires an independent settlement source; a funder's manual statement can only produce `PAYMENT_REPORTED`. `paymentProofUrl` and transaction references are private by default. If stored records already use `APPROVED` or `PAID`, reconcile each legacy record and its source before mapping it to the new status domain; do not silently reinterpret a `PAID` value as independently confirmed.

`paidAt`, when supplied, is the date stated by the reporting party; it is not an observed settlement timestamp.

### BlockchainProof

Fields:

- id
- referenceType
- referenceId
- dataHash
- hashAlgorithm (`SHA-256`)
- proofType (`PACKAGE_SHA256` for Phase 1; `MERKLE_ROOT` only if that profile is enabled)
- status (`PENDING`, `SUBMITTED`, `ANCHORED`, or `FAILED`)
- txHash
- blockNumber
- network
- timestamp
- createdAt

`status` is `BlockchainProofStatus`; `dataHash` contains the selected `proofType` hash. For Phase 1, `ANCHORED` requires a successful Sepolia receipt and block number. Phase 1 uses `network=ETHEREUM_SEPOLIA`; stronger pilot finality policy is separate. It does not confirm any payment.

Reference types:

- EVIDENCE
- VERIFICATION
- DISBURSEMENT
- MILESTONE
- CAMPAIGN

Phase 1 proof is limited to an evidence/review version commitment. `DISBURSEMENT` proof is not used for the demo. Canonical payload structure, hashing rules, and one test vector are specified in `BlockchainProof.md`; additional conformance vectors and the optional Merkle format remain to be completed. Raw files, personal information, full OCR text, and review notes must not be placed on-chain.

### AuditLog

Fields:

- id
- userId
- action
- entityType
- entityId
- details
- createdAt

## 2. Relationship Summary

```text
Organization 1 --- * User
Organization 1 --- * Campaign
Campaign 1 --- * Milestone
Milestone 1 --- * Evidence
Evidence 1 --- 0..* OCRResult (one per screening run/version)
OCRResult 1 --- * AIFlag
Evidence 1 --- * ReviewRound
ReviewRound 1 --- 3 ReviewAssignment
ReviewRound 1 --- 0..3 ReviewVote
Evidence 1 --- 0..1 Verification (quorum result for its version)
Milestone 1 --- 0..* Disbursement
Entity --- 0..* BlockchainProof
```
