# DanaTerang System Completion Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement this plan task-by-task inline on `main`. Preserve the existing uncommitted work, use no Docker, and do not commit unless asked. Never put relayer keys, real documents, or credentials in the repository.

**Goal:** Close every finding from the system audit so the documented Phase 1 demo path can be run and verified locally: PostgreSQL connects and migrates, new proofs use canonical schema v2, public audit data comes from Admin-published campaigns, and the UI plus browser checks pass without axe or correctness defects.

**Architecture:** Additive PostgreSQL migrations only. A campaign-publication flag gates a new public read API whose projection mirrors the existing Organizer-Funder evidence summary rules. Proof building moves to a versioned canonical schema in `packages/proof` consumed by the backend proof service. UI changes correct semantics and accessibility without changing API contracts.

**Tech Stack:** Node 20, Express 5, PostgreSQL 18 (local), Next.js 16 with Turbopack, `node:test` + Supertest + pg-mem, Playwright/axe, ethers 6 (read-only chain checks), Solidity 0.8.37 local EVM tests.

---

## File Structure

- `backend/.env` — ignored local config; change only the PostgreSQL port to the verified listener.
- `database/migrations/008_proof_schema_version.sql` + `.down.sql` — add `package_schema_version` to `proofs`, default `1` for existing rows.
- `database/migrations/009_campaign_publication.sql` + `.down.sql` — add `publicly_published_at`, `published_by` to `campaigns`, default private.
- `packages/proof/src/index.js` + `packages/proof/test/canonical-proof.test.js` — canonical schema v2 (quorum-bound) alongside v1.
- `backend/src/proof/proofService.js` + `backend/src/repositories/proofRepository.js` + `backend/test/proof/*` — build v2 packages, persist the schema version, keep v1 rows untouched.
- `backend/src/repositories/campaignRepository.js` + `backend/src/routes/campaigns.js` + `backend/src/routes/publicAudit.js` + `backend/src/routes/admin.js` + `backend/src/app.js` — publication flag, Admin publish/unpublish, public read-only projection.
- `frontend/lib/campaignTree.ts`, `frontend/app/dashboard/page.tsx`, `frontend/app/milestones/page.tsx`, `frontend/components/AuthenticatedLayout.tsx`, `frontend/app/page.tsx`, `frontend/app/globals.css` — semantics, error surfacing, landmark, contrast, dynamic public audit.
- `frontend/tests/test_public_audit.py`, `frontend/tests/test_authenticated_flow.py`, `backend/scripts/browser-test-server.js` — deterministic public-audit expectations plus scoped locators.
- `docs/specs/2026-10-15-system-completion-design.md`, `DanaTerang_Documentation/BlockchainProof.md` — record schema v2 and the publication rule.

---

### Task 1: Database runtime and migrations

**Files:**
- Modify: `backend/.env` (ignored; port only)
- Read: `database/migrations/*.sql`, `backend/src/db/migrate.js`

- [x] **Step 1: Confirm the listener and preflight**

Run a read-only probe of `127.0.0.1:5432` and record server version, whether `schema_migrations` exists, and the applied IDs.

- [x] **Step 2: Correct only the port**

Set `DATABASE_URL` port to `5432`, keeping credentials and database name unchanged.

- [x] **Step 3: Verify connectivity**

Run: `node --input-type=module` probe that connects, prints `server_version_num`, and lists `schema_migrations`.

- [x] **Step 4: Apply missing migrations**

Run: `npm run db:migrate --workspace @dana-terang/api`

- [x] **Step 5: Confirm migration state**

Re-run the probe and confirm every migration ID from `database/migrations` is recorded and no data was dropped.

### Task 2: Canonical proof schema v2

**Files:**
- Modify: `packages/proof/src/index.js`
- Modify: `packages/proof/test/canonical-proof.test.js`
- Create: `database/migrations/008_proof_schema_version.sql`, `.down.sql`
- Modify: `backend/src/repositories/proofRepository.js`
- Modify: `backend/src/proof/proofService.js`
- Modify: `backend/test/proof/proof-service.test.js`

- [x] **Step 1: Write the failing v2 validation tests**

Add tests asserting: v2 requires keys `schemaVersion, campaignId, milestoneId, evidenceVersion, quorum {reviewRound, roundNumber, decision, contractAddress, transactionHash, blockNumber}, createdAt, files, verification, proofVersion`; v1 packages still normalize and hash to the documented vector; v2 rejects a zero/missing transaction hash, a block number below 0, a non-lowercase contract address, and a decision outside `VERIFIED|NEEDS_REVISION|REJECTED`.

- [x] **Step 2: Run to see the failure**

Run: `npm test --workspace @dana-terang/proof`

- [x] **Step 3: Implement v2 normalization**

Add schema-2 support next to schema 1, returning `schemaVersion: 2` with the nested `quorum` object normalized to lowercase hex and integer values, and keep `hashProofPackage` schema-aware.

- [x] **Step 4: Run the proof package tests**

Run: `npm test --workspace @dana-terang/proof`

- [x] **Step 5: Add the schema-version column migration**

Create `008_proof_schema_version.sql` adding `package_schema_version INTEGER NOT NULL DEFAULT 1` plus a check constraint of `IN (1, 2)`; add the matching down migration.

- [x] **Step 6: Persist the schema version**

Update `proofRepository.createProofForRound` to accept and store `packageSchemaVersion`, and include it in `rowToProof`.

- [x] **Step 7: Build v2 packages for new proofs**

Update `proofService.buildPackage` to assemble v2 from the finalized round (round number, decision, contract address, confirmed transaction hash, block number) while `normalizeProofPackage` still accepts stored v1 packages; `handleQuorumFinalized` stores schema version 2.

- [x] **Step 8: Run backend proof tests**

Run: `node --test backend/test/proof/` from the `backend` workspace

### Task 3: Admin-gated public audit

**Files:**
- Create: `database/migrations/009_campaign_publication.sql`, `.down.sql`
- Modify: `backend/src/repositories/campaignRepository.js`
- Modify: `backend/src/routes/admin.js`
- Create: `backend/src/routes/publicAudit.js`
- Modify: `backend/src/app.js`
- Create: `backend/test/public/routes.test.js`
- Modify: `backend/scripts/browser-test-server.js`

- [x] **Step 1: Write failing route tests**

Tests: anonymous `GET /api/public/campaigns` returns only published campaigns; publishing and unpublishing require an active Admin session and a configured Origin; an unpublished campaign is absent from public responses even with a valid ID; the public projection contains no `fileName`, OCR, `revisionInstructions`, organizer identity, funder identity, or proof package.

- [x] **Step 2: Run to see the failure**

Run: `node --test backend/test/public/routes.test.js`

- [x] **Step 3: Add the publication migration**

`009_campaign_publication.sql` adds `publicly_published_at TIMESTAMPTZ` and `published_by UUID REFERENCES users(id) ON DELETE SET NULL`; add the down migration.

- [x] **Step 4: Implement repository publication**

Add `setCampaignPublication({actor, campaignId, published})` (Admin-only, audited) and `listPublishedCampaigns()` / `findPublishedCampaignForPublic(campaignId)` returning the allowlisted projection.

- [x] **Step 5: Add Admin routes**

Add `PATCH /api/admin/campaigns/:campaignId/publication` behind `requireConfiguredOrigin`, session, and `requireRole("ADMIN")`.

- [x] **Step 6: Add public routes**

Mount `createPublicRouter` outside the `authRepository` guard so health-only mode still serves it, with `Cache-Control: no-store` and an empty-but-valid response when nothing is published.

- [x] **Step 7: Run the public route tests**

Run: `node --test backend/test/public/routes.test.js`

### Task 4: Frontend semantics, landmarks, contrast, resilience

**Files:**
- Modify: `frontend/lib/campaignTree.ts`
- Modify: `frontend/app/dashboard/page.tsx`
- Modify: `frontend/app/milestones/page.tsx`
- Modify: `frontend/components/AuthenticatedLayout.tsx`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/app/globals.css`

- [x] **Step 1: Make nested load failures visible**

Change `loadCampaignTree` to report which request failed, keep successfully loaded data, and let callers render a recoverable error instead of an empty list.

- [x] **Step 2: Correct milestone versus verification wording**

Replace “Verified by peer quorum” / “Telah terverifikasi” labels for `MilestoneStatus=COMPLETED` with activity wording, and add explicit evidence-verification metrics on the dashboard.

- [x] **Step 3: Fix the landmark defect**

Move `.workspace-subheader` inside `<main id="main">`.

- [x] **Step 4: Fix contrast failures**

Darken `.nav-section-label` and `.campaign-facts dt` to at least 4.5:1 against their backgrounds.

- [x] **Step 5: Wire the public audit page to published data**

Fetch `/api/public/campaigns` and render published campaign/milestone/verification/proof status with the domain labels from `FrontendUX.md`; show an explicit empty state when nothing is published, and never render filenames or OCR.

- [x] **Step 6: Scope ambiguous browser locators**

Update the two strict-mode violations in `frontend/tests/test_authenticated_flow.py` and replace the demo-data assertions in `frontend/tests/test_public_audit.py` with assertions against the campaign published by the test server.

### Task 5: Verification

**Files:**
- Read: all above

- [x] **Step 1: Workspace tests**

Run: `npm test` — expect every workspace suite to pass.

- [x] **Step 2: Production build**

Run: `npm run build --workspaces --if-present`

- [x] **Step 3: Browser flow with axe**

Run `frontend/tests/run_browser_test.py` and confirm zero axe violations at desktop and mobile viewports.

- [x] **Step 4: Local OCR smoke**

Run: `npm run ocr:smoke --workspace @dana-terang/api`

- [x] **Step 5: Database check**

Run: `npm run db:migrate --workspace @dana-terang/api` and the read-only migration probe.

- [x] **Step 6: Dependency and chain checks**

Run: `npm audit --omit=dev`, then read-only peer-review/proof-anchor startup validation (no transactions).
