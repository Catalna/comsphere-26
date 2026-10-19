# DanaTerang — Status State Machines

Each status belongs to one named state machine. Do not reuse a bare `status` field across API responses or UI labels: expose `campaignStatus`, `milestoneStatus`, `evidenceStatus`, `screeningStatus`, `verificationStatus`, `disbursementStatus`, and `proofStatus` so identically named concepts cannot be confused.

The Campaign and Milestone lifecycle values below are an initial enum proposal inferred from the current user flow; confirm their exact ownership and transition permissions before implementing the database/API contract. The separate domains and the meanings of `CLEAR`, `VERIFIED`, `READY_FOR_PAYMENT`, `PAYMENT_REPORTED`, `CONFIRMED`, and `ANCHORED` are explicit product requirements.

## Status Domains

| State machine | States | Meaning and owner |
|---|---|---|
| Campaign | `DRAFT`, `ACTIVE`, `COMPLETED`, `CANCELLED` | Program lifecycle. Authorized organizer/funder or admin manages it. Campaign completion does not imply evidence verification or payment confirmation. |
| Milestone | `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` | Activity lifecycle reported by the organizer; a funder may authorize budget/payment separately. `COMPLETED` does not mean a verifier approved the evidence. |
| Evidence version | `UPLOADED`, `PROCESSING`, `READY_FOR_REVIEW`, `PROCESSING_FAILED`, `SUPERSEDED` | File/version and processing lifecycle. A revision creates a new evidence version; it does not overwrite the previous version. |
| AI screening run | `PROCESSING`, `CLEAR`, `FLAGGED`, `FAILED` | Automated screening only. `CLEAR` means configured checks raised no flags; it does not prove truth. Low-confidence required fields produce a `LOW_CONFIDENCE_FIELD` flag and cannot yield `CLEAR`. |
| Peer review round | `WAITING_FOR_CHAIN`, `OPEN`, `QUORUM_REACHED`, `NO_QUORUM`, `CHAIN_FAILED` | The relayer registers a round and only a successful matching `ReviewOpened` receipt exposes it to its fixed panel. Three assigned independent Verifiers sign one vote each. Two matching EIP-712 decisions finalize the round on the quorum contract. A no-quorum round leaves verification `PENDING`; Admin cannot override it. |
| Human verification | `PENDING`, `VERIFIED`, `NEEDS_REVISION`, `REJECTED` | Version-specific result of a peer quorum, not a single Admin decision. `VERIFIED` means that version passed the defined review, not that the real-world event is proven. |
| Disbursement/payment | `NOT_READY`, `READY_FOR_PAYMENT`, `PAYMENT_REPORTED`, `CONFIRMED`, `FAILED` | External payment lifecycle. `READY_FOR_PAYMENT` means the funder may proceed; `PAYMENT_REPORTED` is a self-reported external payment; `CONFIRMED` requires an independent settlement source. Phase 1 can show a report but does not reach `CONFIRMED`. |
| Blockchain proof | `PENDING`, `SUBMITTED`, `ANCHORED`, `FAILED` | On-chain anchoring lifecycle. In Phase 1, `ANCHORED` means a successful Sepolia transaction receipt with a block number; the transaction is inspectable on Sepolia Etherscan. Pilot finality may require a stronger confirmation policy. Do not use `CONFIRMED` as a proof-state label. |

## Transitions

```text
Campaign:      DRAFT → ACTIVE → COMPLETED | CANCELLED
Milestone:     PLANNED → IN_PROGRESS → COMPLETED | CANCELLED
Evidence:      UPLOADED → PROCESSING → READY_FOR_REVIEW
               PROCESSING → PROCESSING_FAILED → PROCESSING (retry)
               retained prior version → SUPERSEDED (after a new version is submitted)
Screening:     PROCESSING → CLEAR | FLAGGED | FAILED
                any terminal run → new screeningRunVersion with PROCESSING on reprocess
Peer review:   WAITING_FOR_CHAIN → OPEN | CHAIN_FAILED
               OPEN → QUORUM_REACHED | NO_QUORUM
                two matching peer signatures → final decision; all three different → NO_QUORUM
Verification:  PENDING → VERIFIED | NEEDS_REVISION | REJECTED (only from confirmed contract quorum)
                 NO_QUORUM → remains PENDING until a separately governed review round resolves it
                NEEDS_REVISION → new evidence version + new PENDING verification
Payment:       NOT_READY → READY_FOR_PAYMENT → PAYMENT_REPORTED → CONFIRMED
               READY_FOR_PAYMENT or PAYMENT_REPORTED → FAILED only when an authoritative
               payment process reports failure
Proof:         PENDING → SUBMITTED → ANCHORED
               SUBMITTED → FAILED → PENDING (idempotent retry using the same proof version)
```

The diagram describes independent domains; a transition in one machine does not silently change another machine's status. A verified evidence version may make a milestone eligible for the funder's payment process, but does not itself move funds. A payment report does not change verification or proof status. Proof anchoring records a proof version and does not change a payment to `CONFIRMED`.

`READY_FOR_PAYMENT` requires a verified evidence version plus the funder's explicit authorization to proceed. The organizer's `MilestoneStatus=COMPLETED` by itself is not sufficient.

## OCR Confidence Policy

OCR supports Indonesian and English documents in the MVP. Store confidence per extracted field on a normalized 0–100 scale. Apply a threshold per field; the amount threshold must be stricter than the vendor-name threshold. Exact numeric thresholds are calibrated against representative Indonesian/English receipts and invoices before pilot use. A required field below its threshold creates a review flag and must be checked by a human; it must not be silently rounded up or treated as `CLEAR`.

## Payment Confirmation Policy

The Phase 1 demo may record `PAYMENT_REPORTED` with the reporting funder and a private reference. It must not set `CONFIRMED` based solely on a funder's manual statement. `CONFIRMED` is available only when a separately approved independent bank/payment-provider evidence source supports the settlement. That source and its authorization policy must be specified before a real pilot uses the state.
