# MVP Documentation Alignment Plan

> Historical checklist: the initial single-verifier/no-wallet assumption was superseded on 2026-10-06 by `../docs/specs/2026-10-06-peer-review-design.md`. Assigned Verifiers now sign 2-of-3 decisions; Organizer/Funder wallet-free flows remain.

> **For agentic workers:** Execute each task in order and verify the documentation after every group of edits.

**Goal:** Align the active DanaTerang documentation with the approved two-phase MVP scope in `MVPPhases.md`.

**Architecture:** Keep the existing document structure. Product requirements own scope, user flows own workflow wording, implementation plan owns sequencing, and each technical document owns details within that scope. Keep the submitted PDF and team DOCX unchanged as historical references.

**Tech Stack:** Documentation-only changes; Markdown files, checked with targeted text search and cross-document review.

---

## File Map

- `README.md`: current product and phase summary; link to active scope and historical references.
- `ProductRequirements.md`: product boundary, two phases, required demo scope, pilot/out-of-scope distinction.
- `UserFlow.md` and `ImplementationPlan.md`: matching demo flow, payment wording, and phase-specific definition of done.
- `StatusStateMachines.md`: independent state domains and transitions.
- `SystemArchitecture.md`, `DataModel.md`, `BackendAPI.md`, `AIandOCR.md`: technical behavior bounded by demo/pilot decisions.
- `BlockchainProof.md`, `SecurityPrivacy.md`, `DeploymentOperations.md`: proof limits, privacy, failures, and pilot readiness.
- `FrontendUX.md`, `DesignUI.md`: user-facing status language and public evidence behavior.
- `MVPPhases.md`: approved phase decision; no changes unless a contradiction is found.
- `AddingDocs/Star-Platinum_DanaTerang_NATIONAL.pdf` and `AddingDocs/DanaTerang_Laporan_Acuan_Kelompok.docx`: preserve as submitted/initial references.

## Task 1: Align Product Scope

- [x] Update README, ProductRequirements, UserFlow, and ImplementationPlan to describe the same demo flow: upload, raw SHA-256, OCR/screening, permissioned 2-of-3 peer review, versioned proof, public audit.
- [x] State that manual payment recording is optional, external, reported by the funder, not independently verified, and not part of demo acceptance or on-chain proof.
- [x] Separate Phase 2 pilot prerequisites and evaluation from Phase 1 demo requirements.

## Task 2: Align Technical Specifications

- [x] Mark initial enums and transitions by state-machine domain; preserve provisional integration/schema notes where implementation compatibility may matter.
- [x] Clarify that OCR flags are advisory, revisions preserve prior evidence/proofs, and proof hashes never imply truth of source evidence.
- [x] Clarify public-summary-only access by default, non-public original evidence/payment references, and demo handling of OCR/anchoring failures.
- [x] Keep remaining OCR numeric thresholds, redaction approval/retention policy, payment-confirmation source, Sepolia finality/recovery, and optional Merkle details in `MVPPhases.md`.

## Task 3: Cross-Document Verification

- [x] Search active Markdown for conflicting claims about demo must-haves, payment confirmation, public file access, AI verdicts, and blockchain truth claims.
- [x] Read each edited document and resolve contradictions without changing the archived PDF/DOCX.
- [x] Confirm that `MVPPhases.md` is linked from README and that pilot prerequisites are not described as demo requirements.

## Task 4: Incorporate Technical Decisions

- [x] Define raw-file SHA-256 before OCR/redaction and deterministic canonical JSON using JCS (RFC 8785), UTF-8, UTC ISO-8601 timestamps, SHA-256 package hash, and optional future Merkle profile.
- [x] Add a canonical byte/hash fixture to `BlockchainProof.md` and verify that the documented SHA-256 matches the exact bytes.
- [x] Represent a redacted derivative as a separate file/hash without replacing the private original.
- [x] Define separate Campaign, Milestone, Evidence, Screening, Verification, Disbursement, and Proof state domains.
- [x] Specify Indonesian/English OCR with per-field confidence and a stricter amount threshold; leave numeric thresholds for calibration.
- [x] Specify a real Ethereum Sepolia transaction through a Solidity/ethers.js backend service wallet, Sepolia ETH gas, Sepolia Etherscan, and no user wallet requirement.

## Verification

Use the workspace content-search tool across active `*.md` files for these patterns, then review each match in context:

- `payment.{0,30}(confirmed|paid)|confirm.{0,30}payment|\bPAID\b|\bCONFIRMED\b`
- `re-hash a file|download.*evidence|fileUrl|payment reference`
- `AI Decision|AI verdict|prove.*truth|CLEAR`
- `Phase 1|Phase 2|MVPPhases.md`
- `JCS|UTF-8|ISO-8601|redactedHash|fieldConfidence`
- `Ethereum Sepolia|Sepolia Etherscan|READY_FOR_PAYMENT|PAYMENT_REPORTED|PROOF: ANCHORED`

Expected: active Markdown consistently labels external payment as reported, AI as screening support, original evidence as private by default, status domains separately, canonical package hashing, per-field OCR confidence, Sepolia proof flow, and the two approved phases; historical PDF/DOCX remain untouched. The workspace does not have `rg` installed, so verification uses the dedicated content-search tool instead.

## Execution Notes

- The requested `rg` command could not run because `rg` is not installed; equivalent targeted searches were run with the workspace content-search tool.
- The proposal PDF and team reference DOCX were not edited.
- Remaining pilot gates are listed in `MVPPhases.md`; user-provided technical decisions are specified in `BlockchainProof.md`, `StatusStateMachines.md`, `AIandOCR.md`, and the dependent technical documents.
