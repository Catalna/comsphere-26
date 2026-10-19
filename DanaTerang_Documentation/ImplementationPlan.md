# DanaTerang — Implementation Plan

## 1. Implementation Strategy

Build the Phase 1 demo in dependency order, then treat a real-world pilot as a separately gated phase.

Do not start from blockchain.

The first priority is a complete working evidence-review workflow: upload, raw-file hashing, OCR/screening, human review, versioned proof, and public audit. Payment remains external and optional.

## 2. Build Step 1 — Project Foundation

Build:

- repository structure,
- Next.js frontend,
- Express backend,
- PostgreSQL connection,
- environment configuration.

## 3. Build Step 2 — Demo Roles and Access

Implement:

- register / login,
- User,
- Organization,
- RBAC.

## 4. Build Step 3 — Campaign and Milestone

Implement:

- create campaign,
- create milestone,
- campaign detail,
- milestone status.

## 5. Build Step 4 — Evidence

Implement:

- evidence upload,
- object storage,
- raw SHA-256,
- evidence metadata,
- evidence history / versioning.

## 6. Build Step 5 — OCR and Screening

Implement:

- OCR extraction,
- amount/date/vendor parsing,
- basic rules,
- duplicate hash check,
- flags.

## 7. Build Step 6 — Verification

Implement permissioned peer review. The Admin is operations-only; three Verifiers from independent Organizations receive each eligible review, and two matching EIP-712 signatures finalize the version-specific decision through the quorum contract.

- assigned review queue and evidence/OCR detail,
- organization-controlled Verifier wallet signing; service relays and pays gas,
- `VERIFIED`, `NEEDS_REVISION`, or `REJECTED` votes,
- separate private internal notes and Organizer-facing revision instructions,
- new immutable evidence version after `NEEDS_REVISION`,
- Admin metadata-only workflow view with no vote/override or source/OCR access.

## 8. Build Step 7 — Optional Payment Report

Only if time allows for the demo, implement a manually entered external-payment report that is attributed to the funder and clearly labeled as reported, not independently verified.

Do not move funds, expose payment references publicly by default, or include payment information in the Phase 1 on-chain proof.

## 9. Build Step 8 — Ethereum Sepolia Proof

Implement:

- versioned evidence/review proof commitment (canonical package rules are in `BlockchainProof.md`),
- canonical proof contract on Ethereum Sepolia Testnet after a contract-verified peer quorum,
- ethers.js backend relayer (gas paid in Sepolia ETH; Verifiers sign votes, Organizers/Funders use no wallet),
- anchor proof,
- tx hash,
- block number,
- proof verification and Sepolia Etherscan link.

## 10. Build Step 9 — Public Audit Page

Show:

- campaign,
- milestone progress,
- evidence status,
- verification status,
- optional externally reported payment, clearly attributed,
- blockchain proof.

## 11. Phase 1 Demo Priority

### Required

1. Campaign
2. Milestone
3. Evidence upload
4. Raw SHA-256 per original file
5. OCR and basic advisory screening flags
6. Human verifier decision and evidence-version history
7. Versioned proof commitment after verifier outcome
8. Public audit page with non-sensitive summary

### Optional if Time Allows

9. Manually reported external payment, attributed to funder
10. Merkle root for multiple evidence files

## 12. Definition of Done

The MVP is successful when a judge can see this flow:

```text
Create Campaign
→ Create Milestone
→ Upload Receipt
→ Hash Generated
→ OCR Extracted
→ Screening Result (No Flags / Flagged)
→ Verifier Decision
→ Proof Anchored on Sepolia (transaction visible on Etherscan)
→ Public Audit Page
```

Payment reporting is not required for this flow. If shown, the UI identifies it as a funder report, not independent confirmation. Failed OCR or anchoring must appear as processing/pending/failure rather than success; evidence and its version history remain available for review or retry.

The product should remain understandable without explaining blockchain first.

## 13. Phase 2 — Real-World Pilot Gate

Do not start a pilot with sensitive real-user data until organization access, verifier authority and conflict handling, consent/privacy/retention/deletion, payment-status semantics, security and incident response, backup/restore, signer-key management, and user support have been defined and reviewed. Agree baseline and target evaluation measures with pilot participants before the pilot begins. Payment-provider integration and escrow are separate projects.
