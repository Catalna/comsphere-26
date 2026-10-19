# DanaTerang — Product Requirements

## 1. Product Summary

DanaTerang is an **evidence-first transparency and accountability platform** for donation, CSR, grant, and other funded programs. Its MVP organizes evidence and human review around campaign milestones and makes the resulting record easier to inspect.

DanaTerang is not primarily a donation marketplace and is not designed as a crypto payment platform. Its role is to structure how allocated funds are used, attach verifiable evidence to milestones, screen that evidence for inconsistencies, support human verification, and create a tamper-evident audit trail.

DanaTerang does not hold or move money in the MVP. Payment information may be entered manually as a report from the funder; the platform does not independently verify an external transfer.

## 2. Product Objective

The main objective is to reduce information asymmetry between:

- Funders / CSR teams
- Organizers / NGOs / project implementers
- Verifiers
- Beneficiaries
- Public observers

DanaTerang should make fund usage:

- traceable,
- evidence-backed,
- reviewable,
- tamper-evident,
- understandable to non-technical users.

## 3. Problem Statement

Fund usage evidence is often fragmented across:

- chat,
- spreadsheets,
- cloud storage,
- receipts,
- photos,
- PDF reports,
- manual final reports.

This makes it difficult for funders and observers to verify individual disbursement milestones.

A final narrative report is not enough to prove that each stage of fund usage is properly documented.

## 4. Core Value Proposition

> **Verify the evidence trail, not just the promise.**

DanaTerang transforms fragmented reporting into a structured, evidence-linked audit trail.

## 5. Core Product Model

DanaTerang is based on:

1. Campaign / Program
2. Milestones
3. Evidence versions and raw-file hashes
4. AI-assisted screening flags
5. Human verification
6. Versioned blockchain proof
7. Public audit trail with non-sensitive information

Optional payment reporting is separate from this core evidence-review flow.

Evidence verification is performed by a permissioned panel of three independent Verifiers. Two matching signatures from distinct roster wallets finalize the reviewed evidence version. Admin supports operations and metadata only; there is no Admin vote or override. Organizer/Funder flows do not require a wallet.

## 6. Funding Model

DanaTerang is **funding-rail agnostic**.

The platform should not require all programs to use crypto.

Supported conceptual models:

### A. External Funding / Tracking Mode

Funds are transferred outside DanaTerang through:

- bank transfer,
- corporate payment process,
- other external payment method.

DanaTerang records the program and milestone information. An optional manual payment report may include an amount and private reference attributed to the reporting funder; it does not prove that the transfer settled.

### B. Payment Provider Integration

Future implementation may connect DanaTerang to a licensed payment or escrow provider.

DanaTerang remains the approval and accountability layer.

### C. On-Chain Escrow

Optional future mode where a smart contract controls digital-asset funds.

This is not required for the core product.

## 7. Main Users

### Organizer / NGO

Responsibilities:

- create or manage campaigns,
- define milestones,
- upload evidence,
- respond to review requests,
- view verification status and any optional externally reported payment.

### Funder / Donor / CSR

Responsibilities:

- create or fund programs,
- define or approve budgets,
- monitor milestones,
- approve a disbursement if the program uses that step,
- optionally report an external payment without DanaTerang independently confirming settlement,
- inspect audit trail.

### Verifier

Responsibilities:

- review evidence,
- inspect AI screening result,
- approve,
- request revision,
- reject,
- add review notes.

### Beneficiary

Optional / post-MVP role.

Responsibilities may include:

- confirm receipt of benefit,
- upload supporting evidence,
- provide confirmation or testimony.

### Public / Observer

Responsibilities:

- view public campaign information,
- inspect milestone status,
- inspect non-sensitive evidence metadata,
- verify blockchain proof.

### Admin

Responsibilities:

- manage users,
- manage organizations,
- manage system configuration,
- inspect audit logs.

## 8. MVP Features

### Phase 1 — Hackathon Demo Required

1. Create or open a demo campaign and milestone.
2. Upload evidence, store originals off-chain, and calculate a raw SHA-256 hash per file.
3. Run Indonesian/English OCR, store per-field confidence, and show basic consistency checks as advisory flags.
4. Provide a permissioned three-peer review decision using EIP-712 wallet signatures; two matching votes approve, request a revision, or reject. Admin cannot vote or override.
5. Preserve evidence and review versions; contract-verify a 2-of-3 outcome and anchor a schema-versioned proof commitment that includes the evidence version, quorum round/decision, confirmed review contract transaction, and recorded time.
6. Show a public audit page for campaigns an Admin explicitly publishes. The public allowlist includes campaign/milestone status, aggregate quorum status, and proof references; original evidence is not downloadable by default.
7. Provide a responsive web UI for the demo flow.

Phase 1 peer decisions and proof anchoring use Solidity contracts on Ethereum Sepolia Testnet, called through ethers.js. Assigned Verifiers need their own organization-controlled wallet to sign votes; a backend service wallet relays transactions and pays gas. Organizers and Funders do not need wallets. Public proof details link to Sepolia Etherscan.

### Phase 1 — Optional if Time Allows

- Manual external payment report, clearly attributed to the funder and labeled as reported rather than independently verified. It is not part of demo acceptance or the on-chain proof.
- Merkle root for multiple evidence files.

### Phase 2 — Real-World Pilot Gate

Before using real sensitive or beneficiary-related data, define organization-level access, verifier authority and conflict handling, consent and privacy controls, retention/deletion behavior, payment-status semantics, security and incident procedures, backups, signer-key management, and user support. Pilot measures and target values must be agreed with participants before the pilot begins.

## 9. Out of Scope for MVP

Do not implement as part of the Phase 1 demo:

- donation marketplace,
- native mobile app,
- DeFi system,
- tokenomics,
- DAO governance,
- full accounting system,
- automatic legal audit,
- AI fraud conviction,
- real fiat custody,
- full escrow custody infrastructure.

Production-scale onboarding, service-level guarantees, and an independent-auditor service are also outside the demo scope. Payment-provider integration and escrow require a separately scoped future project.

## 10. Product Principles

1. Evidence first
2. AI assists, humans decide
3. Blockchain proves integrity, not real-world truth
4. Privacy by design
5. Blockchain should be invisible to ordinary users
6. Evidence history must not silently disappear
7. Public transparency should remain understandable
8. Money custody is not required for the core system
