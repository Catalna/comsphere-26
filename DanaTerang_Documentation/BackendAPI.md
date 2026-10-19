# DanaTerang — Backend API

## 1. Backend Responsibilities

The backend is the orchestration layer.

It coordinates:

- auth,
- RBAC,
- campaign workflow,
- milestone workflow,
- file upload,
- raw SHA-256 before OCR/redaction and canonical-package hashing,
- Indonesian/English OCR with per-field confidence,
- independent screening state,
- permissioned Verifier quorum and version-specific review,
- optional external-payment reports (attributed, not independently verified),
- blockchain anchoring,
- audit logs.

## 2. Suggested Modules

```text
auth/
users/
organizations/
campaigns/
milestones/
evidence/
redaction/
ocr/
screening/
verification/
disbursement/
blockchain/
audit/
```

## 3. Suggested API Endpoints

### Auth

```text
POST /auth/register
POST /auth/login
GET  /auth/me
```

### Campaigns

```text
POST /campaigns
GET  /campaigns
GET  /campaigns/:id
PATCH /campaigns/:id
```

### Admin campaign publication

```text
GET   /admin/campaigns  # Admin-only publication status and campaign metadata
PATCH /admin/campaigns/:id/publication  # { "published": boolean }; exact Origin required
```

Campaigns are private by default. Only an active Admin may publish or unpublish a campaign for public audit. The action is audit-logged.

### Milestones

```text
POST /campaigns/:id/milestones
GET  /campaigns/:id/milestones
PATCH /milestones/:id
```

### Evidence

```text
POST /milestones/:id/evidence
GET  /milestones/:id/evidence
GET  /evidence/:id
POST /evidence/:id/revisions
POST /admin/evidence/:id/ocr-retry  # failed OCR before a review round opens; metadata only
POST /evidence/:id/redacted-derivative  # optional; creates a separate file/hash
```

Only Verifiers assigned to that evidence version may download the original or retrieve full OCR. Organizer APIs return their own safe evidence/screening summary and final revision instructions after a `NEEDS_REVISION` quorum. Funder APIs return status only. Admin receives operational metadata only and may request retry of a failed OCR job before review opens, without seeing original bytes or OCR fields. A revision upload is allowed only after a quorum result of `NEEDS_REVISION` and creates a new immutable version without reopening the Milestone. Original file URLs remain private. A redacted derivative receives its own SHA-256 hash and may be published only after explicit approval; it never replaces the original evidence version.

### Verification

```text
GET  /verifier/wallet
POST /verifier/wallet/challenge
POST /verifier/wallet
GET  /verifier/reviews
GET  /verifier/reviews/:reviewRoundId
POST /verifier/reviews/:reviewRoundId/votes/prepare
POST /verifier/reviews/:reviewRoundId/votes
GET  /evidence/:id/ocr  # assigned Verifier only
GET  /admin/reviews  # operations metadata and vote counts only
```

Wallet binding uses a one-time typed-data challenge scoped to the configured chain and review contract. `/votes/prepare` returns the exact typed data to sign; `/votes` accepts the signature and persists it append-only before relay. State-changing routes require the exact configured Origin and return `Cache-Control: private, no-store`.

Each round has three independent Verifiers and finalizes only when two distinct EIP-712 signatures agree on the same decision for that evidence version. A relayer pays gas; the contract verifies peer signatures and records the outcome. Admin has no vote or override. If all three votes differ, verification remains `PENDING` with `reviewRoundStatus=NO_QUORUM`. `NEEDS_REVISION` records a separate Organizer-facing instruction commitment; only the owning Organizer sees the final instructions, and only the author sees their internal note. Contract vote events and pseudonymous reviewer addresses are public; original files, OCR text, and notes remain off-chain.

### Optional External Payment Report

The following disbursement endpoint sketch is conceptual and is not required for the Phase 1 demo. It must not imply that DanaTerang moves funds or verifies settlement. If a manual report is implemented, preserve the reporting party and keep its reference private by default. Payment-status meanings and transitions are defined in `StatusStateMachines.md`.

```text
GET  /milestones/:id/disbursement
POST /milestones/:id/disbursement/approve
POST /milestones/:id/disbursement/mark-paid
POST /milestones/:id/disbursement/confirm
```

`/confirm` may set `disbursementStatus=CONFIRMED` only when a separately authorized independent settlement source supports the transition. It must not confirm a funder's manual report.

If the conceptual `/approve` and `/mark-paid` actions are implemented, `/approve` maps to `READY_FOR_PAYMENT` only after the verifier and funder prerequisites are satisfied, while `/mark-paid` maps only to `PAYMENT_REPORTED`. Neither action initiates a transfer.

### Public Audit

```text
GET /public/campaigns
GET /public/campaigns/:id
```

Public responses include only Admin-published campaigns and use an explicit allowlist: campaign title/status/budget, milestone title/status/budget, aggregate evidence-verification counts, and proof status/transaction reference. They never return Organizer/Funder identities, private `fileUrl` values, filenames, raw hashes, OCR fields/text, payment references, revision instructions, or internal review notes.

Unpublished campaign IDs return `404`, including to anonymous callers. A redacted derivative remains out of scope for the current public projection; it requires a separately approved publication workflow.

## 4. Status Fields in Responses

Use state-machine-specific names rather than one ambiguous status field in aggregated campaign views:

```json
{
  "campaignStatus": "ACTIVE",
  "milestoneStatus": "IN_PROGRESS",
  "evidenceStatus": "READY_FOR_REVIEW",
  "screeningStatus": "FLAGGED",
  "reviewRoundStatus": "OPEN",
  "verificationStatus": "PENDING",
  "disbursementStatus": "NOT_READY",
  "proofStatus": "PENDING"
}
```

Allowed states and transitions are defined in `StatusStateMachines.md`.

## 5. Evidence Upload Sequence

```text
Receive file
→ validate file type / size
→ calculate raw SHA-256 over exact bytes
→ upload to object storage
→ save metadata
→ trigger OCR
→ run rules
→ save flags
→ mark ready for review
```

## 6. Blockchain Anchoring Sequence

```text
Record the version-specific peer quorum on Ethereum Sepolia
→ create the versioned canonical JSON package after the quorum outcome
→ encode deterministic package as UTF-8
→ calculate SHA-256 package hash
→ send transaction to Ethereum Sepolia Testnet using ethers.js/backend service wallet
→ wait confirmation
→ store txHash / blockNumber
→ update proof status
```

For Phase 1, the proof is the SHA-256 hash of the versioned canonical package defined in `BlockchainProof.md`. The backend wallet pays gas in Sepolia ETH. Assigned Verifiers sign review votes with their own wallet; Organizers and Funders do not need one. Payment reports are not part of the demo proof.

## 7. Queue Recommendation

For production use a queue for:

- OCR processing,
- blockchain transactions,
- retries,
- notification jobs.

MVP can use simple background jobs if needed.
