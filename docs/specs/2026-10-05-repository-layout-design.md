# DanaTerang Repository Layout Design

## Goal

Make `DanaTerang/` the project and Git root, then clearly separate the frontend, backend, and database while retaining the existing npm workspace model and shared packages.

## Approved Structure

```text
DanaTerang/
  .git/                     # moved from source/.git; same repository and branch
  frontend/                # Next.js application (moved from apps/web)
  backend/                 # Express API (moved from apps/api)
  database/
    migrations/            # PostgreSQL up/down migrations (moved from apps/api/db/migrations)
  packages/
    domain/
    proof/
  docs/
  DanaTerang_Documentation/ # existing directory; preserve in place
```

The names `@dana-terang/web` and `@dana-terang/api` remain unchanged so existing workspace-targeted commands do not need a new package identity. Root npm workspaces change from `apps/*` to `frontend`, `backend`, and `packages/*`.

The Git repository currently rooted at `DanaTerang/source/` is promoted one level up to `DanaTerang/` by moving its contents and `.git` metadata. Preserve the existing `DanaTerang_Documentation/` directory and `.zcodeignore` at the parent level; do not stage or overwrite them as part of the project move.

## Move and Path Updates

- The contents of `apps/web` are now in root `frontend/`, and `apps/api` is now in root `backend/`.
- SQL migration files are in root `database/migrations/`; the API migration runner's default directory points there.
- Project scripts, documentation references, and test tooling now use the root `frontend/`, `backend/`, and `database/migrations/` paths.
- The browser-test runner resolves the repository root correctly from the frontend workspace location.
- The former `source/` repository contents and `.git` metadata are now rooted at `DanaTerang/`; the pre-existing documentation directory and `.zcodeignore` remain in place.
- Keep `packages/`, `docs/`, repository tooling, runtime behavior, and database schema contents unchanged.
- Update `package-lock.json` for the new workspace locations using npm; do not change package names or dependencies solely for this move.

## Compatibility and Scope

This is a filesystem/workspace reorganization, not an API, schema, or runtime behavior change. Package-local relative imports should remain valid when the complete app directories move together; root-relative references and migration discovery must be updated explicitly. No database rows or deployed schema are moved.

## Verification

- Confirm npm recognizes all three workspaces and the existing named workspace scripts resolve.
- Run `npm test`, `npm audit`, and `npm run build --workspace @dana-terang/web` from the repository root.
- Verify migration discovery resolves to `database/migrations` and existing migration tests still pass.
- PostgreSQL-backed migration/integration verification remains a separate environment gate until `DATABASE_URL` is available.
