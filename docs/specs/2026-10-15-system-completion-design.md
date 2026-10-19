# DanaTerang System Completion Design

## Goal

Bring the current working tree in line with the documented Phase 1 demo acceptance criteria, repair local database connectivity, and make the automated build, tests, browser checks, OCR smoke test, and database-backed development path verifiable without overwriting existing work.

## Scope and design

1. **Local runtime:** Change only the port in the ignored `backend/.env` database URL to the verified local PostgreSQL listener. Before applying migrations, inspect PostgreSQL version, migration IDs, and relevant table counts using read-only queries. Apply only missing migrations 001–007; never drop or reset user data.
2. **Proof format:** New peer-quorum proofs use canonical schema version 2. The package commits to the evidence version, quorum decision, round number, peer-review contract address, confirmed transaction hash, and block number. Add deterministic canonicalization/hash vectors. Preserve existing version-1 proof records unchanged; do not create or submit live chain transactions during verification.
3. **Public audit privacy:** Add a persisted campaign-publication flag, defaulting to private. Only an authenticated Admin can publish or unpublish a campaign. Public endpoints and the landing page expose allowlisted campaign, milestone, review-status, and proof metadata only for published campaigns; never expose source files, filenames, OCR details, personal account data, revision instructions, private notes, or payment references.
4. **UI reliability:** Keep milestone activity status separate from evidence verification status. Correct misleading dashboard labels and counts. Campaign-tree loading must surface an error if a nested request fails instead of silently treating failed data as empty. Put authenticated page headings inside the main landmark, meet WCAG AA contrast, and scope duplicate-name browser-test locators.
5. **Verification:** Add regression tests before implementation. Run workspace tests, production build, browser flows with axe at desktop/mobile sizes, local OCR smoke, database migration/connectivity checks, dependency audit, and read-only Sepolia contract/relayer checks. A live Sepolia transaction, deployment, or production rollout is out of scope without separate authorization.

## Acceptance criteria

- PostgreSQL connects through the local environment and the migration table reflects all available migrations without deleting existing records.
- New proof packages satisfy schema version 2 and reproducible test vectors; old proof packages remain unchanged.
- Unpublished campaigns are not publicly discoverable; publishing requires an active Admin session; public responses contain only the approved projection.
- Dashboard metrics distinguish `MilestoneStatus` from `VerificationStatus`; nested API failures display a recoverable error.
- Browser accessibility checks report zero axe violations on audited public and authenticated pages, with no horizontal overflow at 390px.
- `npm test`, the workspace production build, local OCR smoke, and read-only runtime checks complete without unexpected errors. Live chain writes are not performed.

## Constraints

Preserve the existing dirty worktree and ignored local credentials. Do not reset, clean, or replace user changes. Keep the changes limited to findings from the system audit and the acceptance criteria above.
