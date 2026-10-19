# DanaTerang Authentication and RBAC Design

## Goal and Scope

Implement the Phase 1 API identity layer so organizers can register with an organization, sign in, and access protected routes under distinct roles. The first release covers PostgreSQL persistence, registration/login/logout/current-user, a one-time Admin bootstrap command, and Admin-managed role changes.

This slice does not implement a login UI, email verification, password reset, MFA, organization accreditation, campaign authorization, or a production-shared rate-limit store. It does not accept self-selected privileged roles.

## Registration and Role Provisioning

`POST /api/auth/register` accepts `name`, `email`, `password`, `organizationName`, and `organizationType` (`NGO`, `COMPANY`, `GOVERNMENT`, `COMMUNITY`, or `OTHER`). It creates an Organization with `verified=false` and an `ACTIVE` User with the fixed role `ORGANIZER` in one database transaction, then creates a session. The request schema rejects unknown keys such as `role`; the caller cannot select `FUNDER`, `VERIFIER`, `BENEFICIARY`, or `ADMIN`.

The first Admin is created by an explicit one-time CLI command requiring `DATABASE_URL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD`. It refuses to run if an Admin already exists and never prints the password. The protected `PATCH /api/admin/users/:userId/role` route may assign `ORGANIZER`, `FUNDER`, `VERIFIER`, or `BENEFICIARY`; it cannot create another `ADMIN` or demote/disable the last active Admin. The change and session revocation for that user are committed together with an audit-log event.

New users start `ACTIVE`. Organization `verified` stays false until a separate review process exists. Email is trimmed and lowercased for lookup/uniqueness. Password is not trimmed; require 12–128 characters.

## Passwords and Sessions

- Hash passwords with Node `crypto.scrypt`: `N=16384`, `r=8`, `p=1`, 16 random salt bytes, and a 64-byte derived key. Store a self-describing encoding: `scrypt$16384$8$1$<salt-base64url>$<key-base64url>`.
- Compare derived keys with `timingSafeEqual`; malformed stored hashes fail closed.
- Generate an opaque 32-byte CSPRNG session token. Return it only in a cookie; persist `SHA-256(token)` in `user_sessions`, never the raw token.
- Session lifetime is 8 hours. Every protected request loads a non-revoked, unexpired session and the current User role from PostgreSQL. Logout sets `revoked_at`; role change revokes all sessions for the affected User.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=28800`; set `Secure` in production and omit it only for local HTTP development.
- No JWT secret is required for this opaque-session design. `DATABASE_URL` and `WEB_ORIGIN` are required for production configuration.

## API Contract

| Endpoint | Access | Behavior |
|---|---|---|
| `POST /api/auth/register` | Public, rate-limited | Validate registration, atomically create Organizer + Organization + session, set cookie. |
| `POST /api/auth/login` | Public, rate-limited | Normalize email, verify scrypt hash, create session, set cookie. Invalid email/password share the same `401 invalid_credentials` response. |
| `GET /api/auth/me` | Authenticated session | Return only User ID, name, normalized email, role, organization ID, and organization summary. |
| `POST /api/auth/logout` | Authenticated session | Revoke current session and clear cookie. |
| `PATCH /api/admin/users/:userId/role` | `ADMIN` | Assign an allowed non-Admin role, write audit event, revoke target's sessions in one transaction. |

Registration validation errors return `400 invalid_request`; duplicate email returns a generic `409 account_unavailable`; unauthenticated requests return `401 authentication_required`; role failures return `403 forbidden`. Responses never include password hashes, session hashes, tokens, SQL, file paths, or stack traces.

## Database and Migrations

Use PostgreSQL at runtime via `pg`. The initial migration adds:

- `organizations`: UUID ID, name, allowed type, `verified=false`, timestamps;
- `users`: UUID ID, name, normalized unique email, scrypt password hash, role check constraint, nullable organization ID only for Admin, active/disabled status, timestamps;
- `user_sessions`: UUID ID, User foreign key, unique 64-character token hash, expiry, revoke timestamp, creation timestamp;
- `audit_logs`: actor, action, target entity, non-secret details, timestamp.

Apply migrations transactionally and record applied migration IDs in `schema_migrations`. This is an initial schema for a repository with no deployed data; any later changes to a persisted enum/column must use additive migration steps rather than repurposing an existing value.

## CSRF, CORS, and Rate Limits

`WEB_ORIGIN` is an explicit single-origin allowlist; do not combine wildcard origin with credentials. Auth cookies use `SameSite=Lax`. Require the configured `Origin` on state-changing browser requests and reject a mismatched origin. Apply configurable in-process rate limits of 5 registrations and 10 login attempts per IP per 15 minutes in the single-process demo. A multi-instance pilot must use a shared rate-limit store.

## Testing and Failure Handling

Run the same SQL migration/repository contract against `pg-mem` in tests, with `pg` as the runtime adapter. Tests cover transaction atomicity, unique normalized email, fixed Organizer registration regardless of extra `role` input, password success/failure, generic login errors, cookie flags, session expiry/revocation, Admin-only role changes, session revocation on role change, and audit-log writes. A real PostgreSQL migration and integration test remains a gate before using real accounts; the current environment has no PostgreSQL server.
