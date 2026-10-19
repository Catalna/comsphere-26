# DanaTerang Documentation

DanaTerang is an **evidence-first accountability platform** for donation, CSR, grant, and other funded programs. It organizes milestone evidence, screening, human review, and tamper-evident proof.

The product does **not hold or move user funds**. Payment information may be recorded as reported by a funder, but the MVP does not independently verify that an external transfer settled.

## Core Product Principle

> Verify the evidence trail, not just the promise.

## Core Flow

Campaign → Milestones → Evidence Upload → Raw SHA-256 → OCR / Screening Flags → 2-of-3 Signed Peer Review → Versioned Blockchain Proof → Public Audit Trail

Payment reporting is optional in the demo, remains external to DanaTerang, and is not part of the on-chain proof.

## Active Scope

- `MVPPhases.md` records the agreed hackathon-demo and real-world-pilot boundaries.
- `../docs/specs/2026-10-06-peer-review-design.md` defines the permissioned peer quorum, wallet/signature, and Admin metadata-only governance decisions.
- `StatusStateMachines.md` defines independent status domains and transitions.
- Assigned Verifiers sign 2-of-3 decisions with organization-controlled wallets; the service wallet relays/pays gas. Organizers/Funders do not need wallets; public contract events expose pseudonymous Verifier addresses and outcomes.
- Phase 1 proof is a SHA-256 hash of the JCS-canonical JSON package, anchored on Ethereum Sepolia Testnet by a backend relayer; users can inspect the transaction through Sepolia Etherscan without connecting a wallet.
- `ProductRequirements.md` defines product scope; `UserFlow.md` defines the workflow; `ImplementationPlan.md` defines build order and completion criteria.
- `MVPAlignmentPlan.md` tracks the documentation-alignment work.

The proposal PDF and team reference DOCX in `AddingDocs/` are preserved as records of the initial submission and team discussion. They provide context and may describe an earlier scope than the active Markdown specifications.

## Main Documents

- `ProductRequirements.md` — product goals, scope, users, features, MVP definition
- `UserFlow.md` — end-to-end workflow and major use cases
- `SystemArchitecture.md` — technical architecture and service boundaries
- `AIandOCR.md` — Indonesian/English OCR, per-field confidence, screening flags, and human-review rules
- `BlockchainProof.md` — canonical JSON package/hash, raw-file hashes, Sepolia anchoring, and on-chain data design
- `DataModel.md` — main entities, relationships, enums, and database responsibilities
- `BackendAPI.md` — backend modules and API design
- `FrontendUX.md` — dashboards, public audit page, roles, and UX behavior
- `DesignUI.md` — visual direction and UI examples
- `SecurityPrivacy.md` — security, privacy, data handling, and trust boundaries
- `DeploymentOperations.md` — deployment, monitoring, retries, and operational setup
- `ImplementationPlan.md` — recommended implementation order for the hackathon/MVP
- `MVPPhases.md` — agreed demo/pilot scope, acceptance criteria, and follow-up decisions
- `StatusStateMachines.md` — campaign, milestone, evidence, screening, verification, payment, and proof states
