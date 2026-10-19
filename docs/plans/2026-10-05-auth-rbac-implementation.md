# DanaTerang Auth/RBAC Implementation Plan

> **For agentic workers:** Execute tasks in order on `main`, test-first, and stop at each failed baseline before implementing the matching behavior.

**Goal:** Implement organizer registration, password login, revocable server-side sessions, and protected role administration backed by PostgreSQL.

**Architecture:** PostgreSQL is the runtime source of truth. Test-only `pg-mem` uses the same SQL migration and repository methods. Passwords use Node scrypt; random opaque session tokens are returned only in HttpOnly cookies while SHA-256 token hashes are persisted. Every request reloads the current user role from the session join.

**Tech Stack:** Node 20.9+, Express 5, `pg`, `pg-mem`, `cookie-parser`, `cors`, `express-rate-limit`, Node `crypto`, Supertest, `node:test`.

---

## File Map

- `database/migrations/001_identity.sql`: organizations, users, user_sessions, audit_logs, and schema_migrations.
- `database/migrations/001_identity.down.sql`: explicit rollback for the initial identity schema.
- `backend/src/db/pool.js`, `migrate.js`: PostgreSQL pool and transactional migration runner.
- `backend/src/repositories/authRepository.js`: parameterized queries and transaction-scoped user/session operations.
- `backend/src/auth/passwords.js`, `sessionTokens.js`: scrypt encoding/verification and opaque-token hashing.
- `backend/src/middleware/session.js`, `requireRole.js`: cookie session loading and role gates.
- `backend/src/auth/authService.js`, `validation.js`: registration/login/session orchestration and strict request shape validation.
- `backend/src/routes/auth.js`, `admin.js`, `backend/src/app.js`: register/login/me/logout, role assignment, CORS, origin checks, and rate limits.
- `backend/scripts/provision-admin.js`: one-time environment-driven Admin bootstrap.
- `backend/test/**`: pg-mem migrations/repository and Supertest auth/RBAC tests.
- `backend/.env.example`: empty local configuration names and safe placeholders only.

## Task 1: Postgres Schema and Migration Runner (TDD)

- [x] Add `pg@8.23.1` and test-only `pg-mem@3.0.14` to the API workspace.
- [x] Write migration up/down tests using `newDb().adapters.createPg()`; first assert the schema_migrations table and four identity tables are created by `runMigrations(pool)` and removed by the down migration.
- [x] Run `npm test --workspace @dana-terang/api`; verify the expected missing migration/runner failure.
- [x] Add `001_identity.sql`: Organization types `NGO|COMPANY|GOVERNMENT|COMMUNITY|OTHER`; roles `ADMIN|ORGANIZER|FUNDER|VERIFIER|BENEFICIARY`; User status `ACTIVE|DISABLED`; unique normalized email; nullable organization only for Admin; hashed session-token column; audit logs.
- [x] Implement transactional, version-recorded migration runner; run migration test on pg-mem and keep PostgreSQL syntax portable.
- [x] Add API pool creation and `npm run db:migrate`; the server uses a configured `DATABASE_URL`, runs migrations only under the explicit development setting, and stays health-only if no DB is configured in development.

## Task 2: Repository and Password/Session Primitives (TDD)

- [x] Export `createAuthRepository(pool)` with `registerOrganizer`, `findUserByEmail`, `findSessionUser`, `createSession`, `revokeSession`, `createFirstAdmin`, and `assignRoleAndAudit` methods.
- [x] Test Organizer+Organization+Session creation, normalized-email uniqueness, session lookup by token hash, session revocation, and role-change audit records using pg-mem.
- [x] Implement parameterized repository queries and transaction rollback on failures; a failing session insert test verifies the repository issues `ROLLBACK`.
- [x] Test scrypt password success/failure, malformed hash rejection, 43-character base64url session-token format, and SHA-256 session-token storage (never the raw token).
- [x] Implement scrypt `N=16384,r=8,p=1`, 16-byte salt, 64-byte derived key, `timingSafeEqual`, and random 32-byte base64url session token.

## Task 3: HTTP Auth and RBAC (TDD)

- [x] Write Supertest cases before routes: register always creates `ORGANIZER` + Organization + session; extra `role` input is rejected; login failure is generic; `/me` returns no hashes/tokens; logout revokes; Admin-only role assignment rejects non-admins, cannot assign `ADMIN`, and cannot demote the bootstrap Admin.
- [x] Run the API test and verify it fails for the missing routes.
- [x] Implement `POST /api/auth/register`, `/login`, `/logout`, `GET /api/auth/me`, and `PATCH /api/admin/users/:userId/role`; role changes and audit writes share a transaction and revoke the target's sessions.
- [x] Add an auth middleware that reads the opaque cookie, hashes it, loads an unexpired/non-revoked session, and attaches the current User/role; add default-deny `requireRole`.
- [x] Add exact `WEB_ORIGIN` CORS allowlisting, Origin checks on state-changing requests, and in-process rate limits (5 register / 10 login attempts per IP per 15 minutes).
- [x] Add one-time `admin:provision` CLI using `DATABASE_URL` and bootstrap environment values; fail if an Admin already exists and never print the password.

## Verification

Run `npm test`, `npm audit`, and `npm run build --workspace @dana-terang/web`. API tests use pg-mem; a real PostgreSQL migration/integration test remains a gate before real accounts are used. Do not store credentials in the repo or commit an `.env` file.

`pg-mem` 3.0.14 accepts transaction commands but does not restore inserted rows on `ROLLBACK` through its `pg` adapter. Tests verify the repository rollback protocol; atomic rollback semantics must be confirmed against PostgreSQL before pilot use.
