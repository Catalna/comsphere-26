# DanaTerang — MVP Phases and Scope Decisions

## 1. Purpose

This document records the agreed product scope for DanaTerang's hackathon demo and the later real-world pilot. It connects the proposal, product requirements, user flows, implementation plan, and technical specifications so they describe compatible phases.

The original proposal PDF and team reference DOCX remain unchanged as records of the submitted proposal and initial team discussion. They remain useful context. This document records the current scope decision where those earlier materials differ from the active build plan.

## 2. Product Boundary

DanaTerang structures evidence and review around funded-program milestones. It may record payment information supplied by a participant, but it does not move, hold, or independently verify fiat funds in the MVP.

The product makes evidence history more reviewable and tamper-evident. OCR flags and blockchain proofs do not establish that a real-world expense, document, or activity is truthful. A permissioned 2-of-3 Verifier quorum makes the evidence-review decision; Admin cannot override it.

## 3. Phase 1 — Hackathon Demo

### Goal

Demonstrate one complete evidence-review path for a campaign milestone within the hackathon build scope.

### Included flow

1. Create or open a demo campaign and milestone.
2. Upload evidence and calculate a SHA-256 hash for each original file.
3. Store the original file off-chain and run Indonesian/English OCR with per-field confidence.
4. Run lightweight consistency checks and show their reasons as screening flags.
5. Let a permissioned panel of three independent Verifiers sign decisions; two matching votes approve the evidence, request a revision, or reject it.
6. Anchor a versioned canonical evidence/review package hash on Ethereum Sepolia Testnet; expose its transaction through Sepolia Etherscan.
7. Show a public audit page with non-sensitive campaign, milestone, review, and proof information.

### Payment handling

Payment remains outside DanaTerang. Manually entered payment information is optional for the demo and is not a core acceptance criterion. If shown, it must be described as **reported by the funder** (or identify the reporting party); it must not be presented as independently verified or as proof that a transfer settled. Payment references and supporting documents are not public by default and are not part of the demo's on-chain proof.

### Proof and revision behavior

- Each uploaded original file receives its own raw SHA-256 hash.
- Before OCR or redaction, calculate the raw hash over the exact uploaded file bytes.
- A peer-quorum outcome is associated with the specific evidence version reviewed.
- A revision creates a new evidence version and does not replace the old file, hash, review record, or proof.
- A later outcome creates a new proof version/event; prior proof remains inspectable.
- Canonical proof data is normalized into deterministic JSON using JCS (RFC 8785), UTF-8, and UTC ISO-8601 timestamps, then hashed with SHA-256. The canonical fields and formatting rules are specified in `BlockchainProof.md`.
- Phase 1 uses the canonical package hash. A Merkle root is an optional profile and must have a separately reproducible leaf/node construction before use.
- If a redacted derivative is needed, retain the private original and its raw hash. Give the derivative its own SHA-256 hash; never replace the original hash. Only an explicitly approved derivative may be published.
- On-chain data is limited to evidence commitments, opaque identifiers/status, pseudonymous Verifier wallet addresses, and quorum votes/outcomes needed to verify the review record. Original files, full OCR text, personal data, and internal review notes remain off-chain.
- Public audit pages show status and an approved non-sensitive summary; original evidence is not downloadable by default.
- The initial canonical package serialization/test vector remains in `BlockchainProof.md` as legacy schema version 1. New peer-quorum proofs use schema version 2, including the confirmed review round, decision, contract address, transaction hash, and block number; its exact fields and reproducible hash vector are specified in `BlockchainProof.md`. Operational approval/publication rules for redacted evidence remain a pilot prerequisite.
- A campaign appears on the public audit page only after an Admin explicitly publishes it. New campaigns are private by default; the public projection excludes organizer/funder identities, filenames, original evidence, OCR, private review notes, revision instructions, and payment references.
- The backend service wallet submits transactions and pays Sepolia gas using Sepolia ETH; Organizers and Funders do not need a wallet.
- Assigned Verifiers sign EIP-712 votes with their own organization-controlled wallets; the service wallet relays those signatures and pays gas. Admin manages operational metadata only and cannot vote, choose the panel, or override quorum.

### Out of scope

- Payment-provider integration, fiat custody, and on-chain escrow.
- Formal organization accreditation or an independent-auditor service.
- Beneficiary accounts or beneficiary confirmation.
- Claims of automatic fraud detection, statutory audit, or proof of real-world truth.
- Production-scale onboarding, service-level guarantees, and production key-management infrastructure.

### Demo definition of done

A reviewer can follow a campaign milestone from evidence upload through raw-file hashing, OCR/screening, a 2-of-3 peer decision, a versioned blockchain proof, and a public audit view. The UI distinguishes screening flags from quorum verification and never implies that a manually reported payment was independently verified. If OCR, quorum, or blockchain processing fails, the UI shows a failure/pending state rather than a successful result; off-chain evidence and its history remain available for authorized review or retry.

## 4. Phase 2 — Real-World Pilot

### Goal

Validate whether organizers and funders will use the workflow with real programs and whether it improves evidence completeness, review effort, and shared understanding of program status.

### Pilot prerequisites

Before a limited cohort of real users uploads sensitive or beneficiary-related data, the pilot plan must define and review:

- organization-level access boundaries and role assignment;
- verifier roster governance, identity/organization independence, conflict-of-interest handling, review guidance, corrections, no-quorum escalation, and appeals;
- consent, public/private data boundaries, redaction, retention, deletion, and access to originals;
- what can and cannot be deleted after an immutable on-chain commitment has been published, and how that limitation is explained to users;
- payment-status vocabulary, reporting party, supporting evidence, and what the public may infer;
- security controls, incident handling, backups, restore testing, and blockchain signer-key management;
- OCR field-threshold calibration, quorum-vote and proof-version chain-confirmation policy, reviewer key recovery, retry/idempotency, and response to a Sepolia reorganization or unavailable RPC;
- user support and a process for failed OCR, failed anchoring, or corrected evidence.

The pilot continues to treat external payments as external unless a separately scoped, legally reviewed payment integration is approved. Escrow and custody require their own product, legal, security, and operational design.

### Pilot evaluation

Set baseline and target values with pilot participants before the pilot begins. Candidate measures include evidence completeness per milestone, time from submission to review, revision frequency, organizer/funder task effort, and the ability of a public observer to understand what was reviewed and what remains unverified. Do not present impact or fraud-reduction claims without pilot evidence.

## 5. Cross-Document Responsibilities

All documents are considered project references. Active specifications should remain consistent with these decisions; the PDF and DOCX remain unchanged historical context and may describe the initial scope. Their responsibilities are:

| Document | Responsibility |
|---|---|
| `README.md` | Current product summary, active phase, and navigation to specifications and historical references. |
| `ProductRequirements.md` | Product scope, user needs, required features, and phase boundaries. |
| `UserFlow.md` | User-visible workflows, decisions, revisions, and payment wording. |
| `ImplementationPlan.md` | Build order and phase-specific definition of done. |
| `StatusStateMachines.md` | Independent status domains, permitted transitions, and status meanings. |
| Architecture, data model, API, AI/OCR, blockchain, security, operations, and UX documents | Technical and interface details within the agreed product scope. |
| Proposal PDF and team reference DOCX | Unmodified records of the original submission and initial team discussion. |

When active Markdown specifications disagree, resolve the product-scope question in `ProductRequirements.md`, the workflow question in `UserFlow.md`, and the implementation-order question in `ImplementationPlan.md`; then update dependent technical specifications. Keep the PDF and DOCX unchanged and explain their historical role from the README.

## 6. Follow-up Technical Decisions

These decisions remain to be completed before a real pilot or any claim that depends on them:

1. Calibrate and approve numerical confidence thresholds for each OCR field using representative Indonesian and English documents; extend the `BlockchainProof.md` test vector with null-field, multi-file, and Unicode cases and verify it in the selected implementation language.
2. Define who may approve/publish redacted derivatives, public-release consent, and retention/deletion behavior while the raw/redacted file hashes remain committed by an immutable on-chain package hash.
3. Finalize role authorization, appeals, Campaign/Milestone transition ownership, and the independent evidence source required to transition a payment to `CONFIRMED`.
4. Define stronger pilot finality if needed, signer-key controls, and recovery behavior for failed RPC calls/reorganizations (Phase 1 anchoring requires a successful Sepolia receipt and block number).
5. Specify a Merkle leaf/node format and verification vectors only if that optional profile is selected.
