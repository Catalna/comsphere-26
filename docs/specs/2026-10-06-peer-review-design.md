# DanaTerang Permissioned Peer Review Design

## Goal

Make a version-specific evidence decision transparent and tamper-resistant without trusting one Admin or the application database to invent the result. Review authority belongs to a permissioned set of independent Verifiers; private program evidence remains access-controlled.

## Scope Change

This design supersedes the earlier MVP assumption that Admin is the sole human reviewer, and the OCR slice's Admin-only access to full OCR details. Through the application, Admin becomes an operations role with metadata-only access. Verifiers are the decision makers. This is peer decentralization of review decisions, not decentralized hosting of the API or private object storage.

This model prevents an Admin/API database writer from fabricating a finalized decision without Verifier signatures, but it does not hide centrally stored evidence from a privileged hosting/storage operator or prevent service-level censorship. Key separation, operator access controls, and availability/recovery remain deployment and pilot trust boundaries.

## Governance and Verifier Roster

- The Phase 1 demo starts with a fixed, independently provisioned roster of three Verifier wallet addresses from three distinct Organizations; all three make up each eligible panel. The Admin API cannot add, remove, select, or replace Verifiers. No membership-management UI is included.
- A future roster update is a contract action requiring a signature quorum from the current Verifier roster; there is no Admin override. The pilot must define identity assurance, Organization independence, conflict-of-interest disclosure, wallet recovery, and roster expansion before enrolling real participants.
- A Verifier account binds a wallet by signing a one-time challenge; the API accepts the binding only if the recovered address is already in the contract roster. Admin assigning the `VERIFIER` role alone does not grant voting authority.
- Before opening a round, the API checks that none of the three Verifier Organizations is the Campaign Organizer's or assigned Funder's Organization. The Verifiers attest to no conflict in their signed vote. If that check fails, the case remains pending; the application does not substitute the Admin or a Campaign participant. Contract membership proves the registered wallet, not real-world Organization independence.
- Ordinary Organizers and Funders do not need wallets. Assigned Verifiers use their own organization-controlled signing wallets. Their private keys never enter DanaTerang.

## Signed Votes and Contract-Verified Quorum

- Each assigned Verifier may submit one vote per evidence version and review round: `VERIFIED`, `NEEDS_REVISION`, or `REJECTED`.
- Before voting, the backend relayer registers a one-time opaque review ID, evidence-version commitment, round, and conflict commitments with the contract. This creates no decision and cannot assign/replace a Verifier roster.
- The Verifier signs an EIP-712 typed vote that binds the chain ID, review contract, opaque review ID, evidence-version commitment, Organizer/Funder Organization commitments, round, decision, no-conflict attestation, and any Organizer-facing instruction commitment. The vote does not include the original file, extracted text, personal data, or internal notes.
- The API verifies the recovered signer and round before accepting a vote. It stores the signed vote append-only and relays it to the contract. The contract independently verifies that the signer belongs to the fixed roster and rejects replayed, duplicate, stale-version, or post-finalization votes.
- Any relayer may submit a valid signature to the contract. DanaTerang's service wallet normally pays gas, but it cannot forge a Verifier signature or change a contract decision.
- Two matching votes from distinct panel members finalize that outcome on-chain and emit an event for the specific evidence version and review round. The Admin and application database cannot rewrite it.
- If all three panel votes differ, the round records `NO_QUORUM`; `verificationStatus` remains `PENDING`. The Admin cannot force a result. The Phase 1 UI shows the unresolved state; appeal or additional-panel policy remains a pilot governance decision.
- The contract keeps only opaque identifiers/commitments, Verifier addresses, round, signed vote outcome, salted revision-instruction commitments, and quorum events. It never stores files, OCR text, private notes, or raw personal details. Contract events are public, including signer addresses and vote outcomes.
- The quorum event is distinct from the later canonical JCS proof package. The proof slice will anchor the canonical evidence/review package and link it to the quorum event; it does not replace or override the peer decision.

## Review Notes, Revision Instructions, and Visibility

- Only the three assigned Verifiers can download the platform's original, read full OCR details, and view internal review notes for that case. Other Verifiers, Admin, Organizer, Funder, and Public cannot retrieve the original or OCR text from the platform. Organizers must retain their local upload copy for their own records and later revision uploads.
- Internal notes are stored off-chain and visible only to the assigned panel. They are not put in audit details, contract events, or public responses.
- A `NEEDS_REVISION` vote requires separate Organizer-facing instructions. Each instruction is bound to its signed vote by a salted commitment; after quorum, only the owning Organizer can read the instructions needed for correction. The Funder sees the decision status, not the instructions or internal notes.
- Revision is available only after a quorum outcome of `NEEDS_REVISION`. The owning Organizer may submit the new version even if the Milestone activity status is `COMPLETED`; this does not change Campaign or Milestone state.
- A revision creates a new Evidence row in the same version group with incremented version, a new private object and raw SHA-256, and a `previous_evidence_id` link. The old version becomes `SUPERSEDED`; neither its evidence nor its votes are overwritten. OCR and a new peer review round run on the new version.
- `REJECTED` is terminal for that version. Any appeal/reconsideration requires a new, separately governed round; Admin cannot edit the outcome.

## Admin and Participant Interfaces

- Verifier UI: assigned review queue; version/evidence detail; authorized original download and full OCR; advisory flags; private notes; separate Organizer instructions; wallet signing; pending/confirmed/no-quorum feedback; and clear handling for wallet, signature, RPC, and relayer failures.
- Organizer UI: `verificationStatus` for each version; revision instructions only after `NEEDS_REVISION`; a revision upload action that preserves the prior version and reports OCR/review progress.
- Funder UI: Campaign and evidence status, quorum outcome, and transaction/proof details when available; no original/OCR/internal notes/revision instructions.
- Admin UI: Campaign/review identifiers, workflow state, timestamps, and aggregate vote counts only. No content view, vote button, reviewer-selection override, or decision-edit control. Admin may request reprocessing only for a `PROCESSING_FAILED` evidence version before a review round opens; the response contains job/status metadata only. The public contract events are independently inspectable by everyone, including Admin.
- Public UI is unchanged in this slice. A later allowlisted public audit projection may expose a non-sensitive decision and quorum/contract reference, never the source or reviewer notes.

## APIs and Data

- `GET /api/verifier/reviews`: only pending rounds assigned to the authenticated Verifier.
- `POST /api/verifier/wallet/challenge` and `POST /api/verifier/wallet`: bind the authenticated Verifier account to an on-chain roster address through a one-time signature challenge; never accept or store a private key.
- `GET /api/verifier/reviews/:reviewId`: assigned review context with private source/OCR access and vote state.
- `POST /api/verifier/reviews/:reviewId/votes`: strict decision, private note, optional Organizer instruction, EIP-712 signature, and review round. The server checks identity, assignment, evidence version, role, signature, and conflict rules before relaying.
- `GET /api/admin/reviews`: operations metadata and aggregate counts only.
- `POST /api/admin/evidence/:evidenceId/ocr-retry`: retry only a failed OCR job before a peer review round is opened; never returns file bytes or OCR fields.
- `POST /api/evidence/:evidenceId/revisions`: Organizer-only multipart upload for an evidence version whose quorum outcome is `NEEDS_REVISION`; the server derives Organization, milestone, version group, and next version from the parent row, not the request body.
- Extend Organizer/Funder evidence summaries with `verificationStatus` and safe decision metadata. The platform original-download and full-OCR endpoints are Verifier-assignment-only; Admin application routes never return file bytes, OCR fields, or internal notes. The demo keeps Admin and Verifier identities separate.
- Add an additive migration for reviewer-wallet registration/assignments, review rounds, signed vote envelopes, private notes, Organizer instructions/commitments, and version-specific verification records. Use immutable vote rows, unique `(review_round_id, verifier_id)`, replay-safe vote IDs, transactional audit events, and `no-store` on private responses.
- After OCR reaches `READY_FOR_REVIEW`, the service relayer registers the evidence-version commitment/round with the contract; the Verifier queue opens only after the registration receipt is confirmed. Retrying a registration uses the same opaque review ID and commitment.
- Store contract outcome/transaction/block references in a separate review-chain record; the relational decision state is reconciled from confirmed contract events rather than an Admin-editable field.

## Verification and Acceptance

- Local EVM tests exercise the deployed Solidity source with deterministic test wallets: only roster members vote; one vote per peer/round; duplicate, replayed, wrong-chain, wrong-contract, stale-version, and Admin-only attempts fail; two matching distinct signatures finalize once; three different votes produce `NO_QUORUM`; final outcomes cannot be changed.
- API tests verify assignment-scoped reads, Admin metadata-only access, no cross-Campaign content access, signature verification, retry/version lineage, revision-instruction privacy, vote immutability, audit events, and relayer retry/idempotency.
- Browser tests use a mock wallet signer and deterministic contract adapter for normal votes, rejected signatures, wallet absence, relayer/RPC pending/failure, quorum, no-quorum, Organizer revisions, keyboard operation, axe, and responsive behavior.
- Full workspace tests and production build must pass. A live Sepolia deployment/confirmation remains gated on RPC configuration, contract deployment, service-relayer funding, and independently held Verifier wallets.

## Pilot Gates and Non-Goals

- Open permissionless validators, anonymous reviewers, token incentives, and on-chain escrow are out of scope. The review layer is permissioned P2P.
- A verified smart contract cannot prove real-world identity, Organization independence, evidence truth, or freedom from reviewer collusion. Pilot onboarding and conflict policy must establish those conditions.
- Define a recovery procedure for lost/unavailable Verifier keys and `NO_QUORUM` rounds before cohort onboarding. No Admin superuser decision is the fallback.
- Native PostgreSQL transaction/lease behavior, trained OCR data, storage quotas, retention/deletion rules, backups, chain finality/reorg handling, and incident/key runbooks remain staging/pilot gates.
