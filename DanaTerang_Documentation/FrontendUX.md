# DanaTerang — Frontend and UX

## 1. Frontend Goals

The UI should make accountability easy to understand.

Organizers, Funders, and public users should not need to understand:

- gas,
- RPC,
- smart contracts,
- wallet internals,
- cryptographic details.

## 2. Organizer Dashboard

Main pages:

- Dashboard
- Campaigns
- Campaign Detail
- Milestones
- Evidence Upload
- Evidence History
- Review Status and final revision instructions for its own evidence only
- Upload a new immutable evidence version after a `NEEDS_REVISION` quorum, without reopening the Milestone
- Optional Payment Report

## 3. Funder Dashboard

Main pages:

- Funded Programs
- Campaign Progress
- Milestone Review
- Optional External Payment Report
- Audit Trail
- Verification status only; no filename/source/OCR, flags, revision instructions, or internal notes

## 4. Verifier Dashboard

Main pages:

- Pending Reviews
- Evidence Detail
- OCR Result
- Per-field OCR confidence
- AI Flags
- Connect organization-controlled signing wallet (Verifier only; service relays and pays gas)
- Sign `VERIFIED`, `NEEDS_REVISION`, or `REJECTED` vote for the assigned evidence version
- Internal notes and separate Organizer-facing revision instructions
- Three-seat quorum target, pending receipt, confirmed result, and `NO_QUORUM` pending state

Three independent Verifiers review a version; two matching signed votes are required. Admin's Operations view is limited to queue metadata and counts, with no evidence/OCR access or decision controls.

The Verifier flow connects the bound wallet, checks the contract chain, reviews the original and OCR, attests no conflict, then signs typed data in the wallet. The private key never enters the page or API. The Verifier sees their own internal note after signing; peer votes and notes remain hidden. The quorum-completing `NEEDS_REVISION` vote determines the final Organizer-facing instruction commitment.

## 5. Public Audit Page

Only campaigns explicitly published by an Admin appear. New campaigns are private by default; the Admin can publish or withdraw them from the `Publikasi audit` page.

Primary information:

- campaign title,
- total budget,
- milestone status,
- evidence and quorum counts by milestone,
- version-specific verification status,
- blockchain proof status and confirmed Sepolia transaction reference.

Organizer/Funder identities, filenames, source files, OCR values, screening flags, payment references, revision instructions, and internal reviewer notes are excluded from the public projection.

When a proof is anchored, provide an optional direct transaction link labeled:

`Lihat transaksi di Sepolia Etherscan`

## 6. Admin Publication

The Admin can review the campaign title, lifecycle status, and budget in a private publication table. A clearly labeled button publishes or withdraws each campaign. Publishing is auditable; the row must show the resulting `Tampil publik` or `Privat` state. This page exposes no evidence content, OCR, payment references, or reviewer notes.

## 7. Suggested Status Design

### Screening

- Processing
- No configured flags detected
- Flagged

### Verification

- Pending peer quorum
- Verified by 2-of-3 quorum
- Needs Revision (quorum)
- Rejected (quorum)
- Quorum not reached (still pending; no Admin override)

### Optional External Payment Report

- Not Reported
- Ready for Payment (funder authorization; not a transfer)
- Reported by Funder
- Confirmed by Independent Source (pilot only)
- Failed (only when an actual payment process reports failure)

### Blockchain Proof

- Pending
- Submitted
- Anchored on Ethereum Sepolia
- Failed

Show each state with its domain label (for example, **Screening: CLEAR**, **Review: VERIFIED by quorum**, **Payment: PAYMENT_REPORTED**, **Blockchain proof: ANCHORED**). `CONFIRMED` is reserved for an independently confirmed payment and is unavailable in the Phase 1 demo. `No configured flags detected` describes screening only; a 2-of-3 peer quorum applies to the reviewed evidence version. See `StatusStateMachines.md` for allowed transitions.

## 8. UX Rule

Use:

> Simple by default, detailed when requested.

Example public card:

```text
Milestone #2
Roof Renovation

Evidence review: Verified by 2-of-3 peer quorum
Payment: Reported by funder (if provided)
Blockchain Proof: Anchored on Sepolia

[View Details]
```

Do not show raw blockchain data first. A public page shows an approved summary; original evidence and payment references remain private by default. Link the transaction to Sepolia Etherscan. Users do not need to connect a wallet.
