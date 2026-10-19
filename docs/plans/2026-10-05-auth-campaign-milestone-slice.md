# DanaTerang Auth and Campaign/Milestone Slice Plan

> **For agentic workers:** Use `executing-plans` and TDD on the requested `main` branch. Preserve existing uncommitted work; do not use Docker and do not commit unless requested.

**Goal:** Make a user able to register/sign in, provision a Funder through Admin, and manage an organization-scoped Campaign with Milestones through the browser and API.

**Architecture:** Keep PostgreSQL as runtime source of truth and use `pg-mem` for fast repository/route tests. Add native-PostgreSQL setup instructions for Windows; no Docker services. Campaign access is scoped by Organizer organization or assigned Funder user, with Admin override; the assigned Funder activates a draft campaign.

**Tech Stack:** Node 20 ESM, Express 5, PostgreSQL `pg`, `pg-mem`, Next.js 16, React 19, Supertest, `node:test`, Playwright.

---

## File Map

- `database/migrations/002_campaigns_milestones.sql` and `.down.sql`: Campaign and Milestone tables, constraints, and indexes.
- `backend/src/repositories/campaignRepository.js`: parameterized persistence and organization-scoped queries.
- `backend/src/routes/campaigns.js`, `backend/src/routes/admin.js`: Campaign/Milestone API, safe Admin user listing, and safe Funder directory.
- `backend/src/auth/validation.js`: exact request schemas and decimal/date validation for these endpoints.
- `backend/test/db/campaign-repository.test.js`, `backend/test/campaigns/routes.test.js`: pg-mem and Supertest coverage.
- `frontend/app/login/`, `frontend/app/register/`, `frontend/app/admin/users/`, `frontend/app/campaigns/`: Auth UI, role administration, and campaign/milestone screens.
- `frontend/lib/api.ts`: same-origin API client and typed error handling; `frontend/next.config.mjs` rewrites `/api/*` to `API_INTERNAL_URL` (default `http://127.0.0.1:4000`).
- `frontend/tests/test_authenticated_flow.py`: Playwright flow against the isolated pg-mem API process, including axe checks and 390px overflow checks.
- `frontend/.env.example`: local Next.js rewrite target without credentials.
- `backend/.env.example`, `database/README.md`, `README.md`: native PostgreSQL and local run instructions; no real secrets.

## Delivery Tasks

1. Admin user listing/Funder directory endpoints and Auth/Admin UI, so a bootstrapped Admin can promote registered users and an Organizer can select an eligible Funder.
2. Campaign/Milestone migration and repository, with tests for ownership, budget constraints, and status transitions.
3. Campaign/Milestone routes with default-deny role gates, exact validation, audit records, and Supertest permission tests.
4. Organizer/Funder campaign screens, campaign creation/activation, milestone editing/status, loading/error/empty states, and Playwright coverage.
5. Native PostgreSQL setup instructions and full verification from the DanaTerang root.

Evidence upload/OCR/review/proof/public-audit and Phase 2 work remain later roadmap slices in `docs/specs/2026-10-05-mvp-completion-design.md`; they are not silently folded into this bounded slice.

## Task 1: Safe Admin User Listing

**Files:** modify `backend/src/repositories/authRepository.js` and `backend/src/routes/admin.js`; test `backend/test/db/auth-repository.test.js` and `backend/test/auth/routes.test.js`.

- [x] Add a Supertest case first: an authenticated Admin gets `200` and user summaries with `id`, `name`, `email`, `role`, and organization summary; no password hash, session data, or token appears.
- [x] Add cases that an Organizer receives `403` and an unauthenticated caller receives `401` from `GET /api/admin/users`.
- [x] Run `node --test test/auth/routes.test.js`; expect the new route to return `404` before implementation.
- [x] Add `authRepository.listUsersForAdmin()` using a parameterized query ordered by normalized email and joining Organization summary fields only.
- [x] Add `GET /users` to the existing Admin router behind session authentication and `requireRole("ADMIN")`; serialize only the documented safe user fields and set `Cache-Control: no-store`.
- [x] Run `npm test --workspace @dana-terang/api`; expect all API tests to pass.

## Task 2: Campaign/Milestone Schema and Repository

**Files:** create `database/migrations/002_campaigns_milestones.sql` and `.down.sql`, `backend/src/repositories/campaignRepository.js`, and `backend/test/db/campaign-repository.test.js`.

- [x] Test migration execution and table constraints using `pg-mem`; include Campaign status/type checks, positive amounts, unique `(campaign_id, order_index)`, and foreign keys to Organizations, Funders, and Campaigns.
- [x] Test that an Organizer's campaign uses their account Organization, the Funder must be active with role `FUNDER`, the initial Campaign is `DRAFT`, and Milestones start `PLANNED`.
- [x] Test that campaign list/detail queries scope Organizers by `organization_id`, Funders by `funder_id`, and Admins globally; guessed cross-organization IDs return no row.
- [x] Test that the sum of milestone budgets cannot exceed the campaign total and currencies match; Campaign metadata is editable only while `DRAFT`.
- [x] Add the migration with `campaigns` fields `id`, `organization_id`, `funder_id NOT NULL`, `title`, `description`, `total_budget NUMERIC(20,2)`, `currency`, `funding_mode`, `status`, `start_date`, `end_date`, `created_at`, `updated_at`; constrain `funding_mode` to `EXTERNAL_TRACKING` for this MVP.
- [x] Add `milestones` fields `id`, `campaign_id`, `title`, `description`, `budget_amount NUMERIC(20,2)`, `currency`, `order_index`, `status`, `start_date`, `due_date`, `created_at`, `updated_at`, with the tested checks/indexes.
- [x] Implement parameterized, transaction-scoped repository operations for create/list/get/update Campaign, activate Campaign, create/list/update Milestone, and insert corresponding audit events.
- [x] Run `npm test --workspace @dana-terang/api`; expect the default migration runner to load migration `002` from `database/migrations/` and all repository tests to pass.

**Test-adapter note:** `pg-mem` 3.0.14 returned no rows for `users.role = 'FUNDER'` while the unique partial Admin index existed, although lookup by ID returned the persisted Funder. Funder eligibility therefore loads by parameterized primary key and checks role/status in code; role-based data visibility remains scoped by organization/funder IDs.

## Task 3: Campaign/Milestone API and Authorization

**Files:** create `backend/src/routes/campaigns.js` and `backend/test/campaigns/routes.test.js`; modify `backend/src/app.js`, `backend/src/routes/admin.js`, and `backend/src/auth/validation.js`.

- [x] Write Supertest cases first for safe `GET /api/funders` plus `POST/GET/PATCH /api/campaigns`, `POST /api/campaigns/:campaignId/activate`, `GET/POST /api/campaigns/:campaignId/milestones`, and `PATCH /api/milestones/:milestoneId`.
- [x] Assert an Organizer can create a draft only for their own Organization; reject client-supplied `organizationId`, invalid/non-Funder IDs, extra JSON keys, nonpositive decimal amounts, and milestone budgets that exceed the campaign budget.
- [x] Assert only the attached active Funder or Admin can activate a draft Campaign; only an Organizer in that Campaign's Organization may create Milestones while the Campaign is `DRAFT` and report status while it is `ACTIVE`; all foreign-organization reads/writes return non-disclosing `404` or `403` responses.
- [x] Assert Organizer Milestone progress follows `PLANNED → IN_PROGRESS → COMPLETED`, and a Campaign must be `ACTIVE` before progress starts; activity completion never changes verification, payment, or proof status.
- [x] Assert every allowed campaign/milestone transition goes through `transitionStatus()` from `@dana-terang/domain`, and rejected transitions do not mutate the row or emit audit events.
- [x] Run `node --test test/campaigns/routes.test.js`; confirm the new endpoints fail before the routes exist.
- [x] Implement exact body parsers, parameterized repository calls, role gates, safe response serializers, and transaction-scoped audit records; mount the router under `/api`.
- [x] Run `npm test --workspace @dana-terang/api`; expect route, authorization, state, validation, and repository tests to pass.

## Task 4: Browser Auth, Admin Provisioning, and Campaign Screens

**Files:** create `frontend/lib/api.ts`, login/register pages, Admin users page, Campaign list/create/detail pages, and `backend/scripts/browser-test-server.js`; modify `frontend/app/page.tsx`, `frontend/tests/run_browser_test.py`, and `frontend/tests/test_public_audit.py`.

**UX flow and state coverage:**

- Register → cookie session → Campaign list; login preserves the intended return URL; logout clears the session.
- Admin opens Users, sees safe role/org summaries, promotes a user to Funder, and receives confirmation that the target must sign in again because role changes revoke sessions.
- Organizer first-use Campaign list offers “Create campaign”; if no Funder exists, it explains that an Admin must assign the Funder role. Funder with no assignments sees a distinct “No campaigns assigned” state.
- Campaign creation is a labeled one-column form. Errors stay next to the field and typed values remain; failed fetches offer Retry without clearing state.
- Campaign detail distinguishes Draft/Active and separate Milestone, payment-report, screening, review, and proof domains. A Funder can activate only after Milestones exist; Organizers can progress Milestones only when Active.
- Every route has first-load, refresh, empty, recoverable error, permission/not-found, and success feedback states. Buttons use visible busy/disabled states; errors persist in an announced live region.
- Use native links, buttons, selects, and labeled inputs; all paths work by keyboard, focus is visible, and controls remain usable at 390px without hover-only actions.

- [x] Add browser tests first for registration/login/logout, Admin role promotion of a registered user to `FUNDER`, Organizer draft creation, Funder activation, and Organizer milestone progress. Assert errors, empty/loading states, and no role controls for unauthorized users.
- [x] Use a deterministic test API backed by migrated `pg-mem` for the browser suite; launch it on a reserved local port from the Python test runner and pass its exact URL to Next.js. Do not use Docker or real credentials in browser tests.
- [x] Implement the API client with same-origin `credentials: "include"`, JSON headers, safe generic error handling, and configurable internal rewrite through `API_INTERNAL_URL`.
- [x] Implement accessible form labels, inline validation/errors, disabled/loading states, and status text that keeps Campaign, Milestone, screening, verification, payment, and proof domains distinct.
- [x] Add an Admin users endpoint/UI that can list safe user summaries and call the existing role-change endpoint; never render or return password/session data.
- [x] Implement Organizer/Funder Campaign/Milestone screens using only the API contract; remove hard-coded mutable demo data from internal workflow screens while retaining the public demo notice until the public-audit slice.
- [x] Run `npm test --workspace @dana-terang/web` and `npm run build --workspace @dana-terang/web`; expect the browser workflow and production build to pass.

## Task 5: Native PostgreSQL Setup and Slice Verification

**Files:** modify `backend/.env.example`, `database/README.md`, and root `README.md`.

- [x] Document native PostgreSQL for Windows (no Docker): install PostgreSQL 16+, keep its service on localhost, create a database owned by a local development role, and use `psql` or pgAdmin to inspect it.
- [x] Add safe variable names to `backend/.env.example`: `DATABASE_URL`, `WEB_ORIGIN=http://localhost:3000`, `AUTO_MIGRATE=true` for development only, `LOCAL_OBJECT_STORAGE_ROOT`, and blank future S3/Sepolia settings; include no real credentials.
- [x] Document creating a local DB role/database, copying `.env.example` to ignored `backend/.env`, running `npm run db:migrate --workspace @dana-terang/api`, then starting API and frontend in separate terminals.
- [x] Verify ordered migrations and campaign schema against `pg-mem`; native PostgreSQL verification remains pending until the service and connection string are available.
- [x] Run `npm test`, `npm audit`, and `npm run build --workspace @dana-terang/web`; all pass with zero audit advisories.
- [ ] Run `git diff --check`, inspect `git status --short`, and confirm no `.env` is tracked.
- [ ] Run the migration and Campaign/Milestone flow against native PostgreSQL after the service and connection string are available.

## Remaining Roadmap (Separate Vertical Slices)

After this slice is accepted, continue with private evidence upload/versioning and SHA-256, Indonesian/English OCR and screening, permissioned 2-of-3 peer review/revisions, Sepolia contract/proof service, dynamic public audit, then Phase 2 privacy/retention/security/operations and cloud staging. Admin does not decide peer-review outcomes. Each slice needs its own TDD plan and completion checks; no Docker is introduced.

## Environment Gates

Campaign/Auth tests run with `pg-mem`; a native PostgreSQL server is not currently installed or configured. Sepolia validation remains gated on a provider RPC URL, a dedicated testnet service-wallet private key funded with Sepolia ETH, and the deployed contract address. Store these only in ignored local/backend environment files or staging secret storage; never request or commit private keys.
