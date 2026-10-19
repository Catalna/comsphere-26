# DanaTerang Funder Governance and Experience Implementation Plan

> **For agentic workers:** Use `executing-plans` and TDD to implement this approved plan inline on `main`. Preserve existing uncommitted work, use no Docker, do not commit unless requested.

**Goal:** Make Funder onboarding accountable (accepted Terms & Conditions plus Admin organization verification) and clarify that the Funder's activation is a funding commitment, not a technical toggle.

**Architecture:** Registration records a `terms_acceptances` row pinned to a server-side `TERMS_VERSION`; the version must match or registration is rejected. Organizations gain `verified_at`/`verified_by` (the existing `verified` flag becomes actionable) with an Admin-only verify/unverify endpoint that writes an audit log entry. UI copy renames the Funder activation to "Danai campaign" and renders campaign `ACTIVE` as "Didanai"; status enums in schema/domain stay unchanged.

**Tech Stack:** PostgreSQL migrations, Express 5, `node:test` + pg-mem + Supertest, Next.js 16, Playwright.

---

## File Map

- Create `database/migrations/007_funder_governance.sql`/`.down.sql`; modify `backend/src/auth/validation.js`, `backend/src/repositories/authRepository.js`, `backend/src/routes/admin.js`, `backend/test/auth/routes.test.js`, `backend/test/db/migrations.test.js`.
- Modify `frontend/app/register/page.tsx` (T&C consent), `frontend/app/admin/users/page.tsx` (organizations panel, verification actions, unverified-Funder warning), `frontend/app/campaigns/page.tsx` and `frontend/app/campaigns/[campaignId]/page.tsx` (Didanai wording), `frontend/app/globals.css`, and `frontend/tests/test_authenticated_flow.py`.
- Tests: registration rejects a missing/stale `acceptedTermsVersion`; only Admin lists organizations and toggles verification with audit entries; the browser flow checks the consent box and uses the new activation wording.

## Tasks

- [x] Migration `007`: `terms_acceptances` (user, version, accepted_at, unique per user+version) and `organizations.verified_at`/`verified_by`.
- [x] `TERMS_VERSION` constant in `backend/src/auth/validation.js`; `parseRegistration` requires the exact current version; acceptance stored in the registration transaction.
- [x] `parseOrganizationVerification` (exactly `{verified: boolean}`); Admin `GET /api/admin/organizations` and `PATCH /api/admin/organizations/:id/verification` (Admin-only, audit-logged, verifies membership counts).
- [x] Register page: required consent checkbox bound to `TERMS_VERSION` (kept in sync with the backend constant); submit disabled until consented.
- [x] Admin users page: organizations verification panel with verify/unverify, verified badge on each user's organization, and a warning when assigning FUNDER to an unverified organization.
- [x] Campaign pages: "Danai campaign"/"Memproses pendanaan…" button copy, `DRAFT`→"Draf", `ACTIVE`→"Didanai" display labels; backend enums unchanged.
- [x] Backend tests updated and extended; browser E2E updated for the consent checkbox and new wording.

## Deferred (later slices)

- Supporting-document upload for Funder vetting (needs a standalone organization-document storage path outside campaign evidence).
- Making verified organization mandatory for FUNDER role or campaign funding (product decision; warn-only for now).
- Funder-facing proof status panel on the campaign page (API `GET /api/evidence/:id/proof` exists).
