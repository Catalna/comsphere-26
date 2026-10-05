# `@dana-terang/domain`

Pure workflow status validation for DanaTerang. Statuses are scoped by domain: campaign, milestone, evidence, screening, human verification, disbursement, and blockchain proof. API response fields use the corresponding `*Status` field name; do not pass a status value between domains.

`transitionStatus(domain, from, to, context)` returns `to` when the transition is allowed and its prerequisites are satisfied. It throws `InvalidStateTransitionError` for unknown or disallowed transitions. The package does not authenticate the actor, persist state, or write audit events; API services must enforce authorization and record each successful transition.

Important invariants:

- `CLEAR` only belongs to screening and requires an empty flag list.
- `VERIFIED` only belongs to human review of one evidence version.
- `READY_FOR_PAYMENT` requires `verificationStatus=VERIFIED` and explicit funder authorization.
- `PAYMENT_REPORTED` is a funder report; `CONFIRMED` requires independent settlement evidence.
- `ANCHORED` belongs to the blockchain proof machine and requires a successful Ethereum Sepolia receipt with a block number.

Campaign and Milestone transition values are the initial proposal in the project docs. Confirm transition ownership before binding these states to database/API permissions.
