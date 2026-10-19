# DanaTerang Repository Layout Implementation Plan

> **For agentic workers:** Use the `executing-plans` skill to implement this plan task-by-task on the user's requested `main` branch. Preserve all existing local changes and do not commit unless requested.

**Goal:** Promote the Git project root from `DanaTerang/source/` to `DanaTerang/`, with app workspaces and SQL migrations in root `frontend/`, `backend/`, and `database/` directories, without changing runtime behavior or npm package names.

**Architecture:** Promote the current repository by moving all `source/` contents and its `.git` metadata one level up, preserving the current branch and uncommitted changes. The app directories and migrations have already been moved within that repository; retain those locations, then update the migration runner, root workspace list, lockfile, browser-test root paths, and active documentation references.

**Tech Stack:** npm workspaces, Next.js, Express, PostgreSQL SQL migrations, Python Playwright test runner.

---

## File Map

- Move `apps/web/` to `frontend/`; keep workspace name `@dana-terang/web`.
- Move `apps/api/` to `backend/`; keep workspace name `@dana-terang/api`.
- Move `apps/api/db/migrations/*.sql` to `database/migrations/`.
- Promote all repository files plus `.git` from `DanaTerang/source/` to `DanaTerang/`; preserve the existing `DanaTerang_Documentation/` directory and `.zcodeignore`.
- Modify root `package.json` and regenerate root `package-lock.json` for workspace paths `frontend`, `backend`, and `packages/*`.
- Modify `backend/src/db/migrate.js` so default migration discovery targets `database/migrations/`.
- Modify `frontend/tests/run_browser_test.py` and `frontend/tests/test_public_audit.py` to resolve root `node_modules` from the new layout.
- Modify `README.md` and the active Auth/RBAC plan paths; add `database/README.md` with migration location and commands.
- Keep `packages/`, `docs/`, app behavior, package names, API paths, and SQL contents unchanged.

## Task 0: Promote the Repository Root to `DanaTerang/`

**Files:** move all children of `source/` to `DanaTerang/`, including `.git`, while preserving existing parent-level files and directories.

- [x] Verify `DanaTerang/.git` does not exist, `source/.git` exists, and none of the source child names collide with existing parent entries. Preserve `.zcodeignore` and `DanaTerang_Documentation/` in place.
- [x] From `DanaTerang/`, move every child of `source/` except `.git` to the current directory. This includes hidden `.gitignore`, workspace files, app directories, docs/packages, and `node_modules`; do not overwrite existing entries. Run:

  ```powershell
  $sourcePath = (Resolve-Path -LiteralPath "source").Path
  Get-ChildItem -LiteralPath $sourcePath -Force |
    Where-Object { $_.Name -ne ".git" } |
    ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination "." }
  ```

- [x] Move `source/.git` to `DanaTerang/.git` only after the worktree files are in place; this preserves the existing branch, history, and unstaged changes.
- [x] Verify `source/` contains no remaining files, then remove only the empty `source/` directory.
- [x] If the moved `apps/` directory is empty, remove only that empty directory so the root contains the approved workspace layout.
- [x] Confirm `git rev-parse --show-toplevel` prints the absolute `DanaTerang/` path and `git branch --show-current` prints `main`.
- [ ] Do not stage, commit, or alter `DanaTerang_Documentation/` or `.zcodeignore`.

## Task 1: Move the Frontend Workspace

**Files:** move `apps/web/` to `frontend/`; modify `package.json`, `frontend/tests/run_browser_test.py`, and `frontend/tests/test_public_audit.py`.

- [x] Move the directory with `Move-Item -LiteralPath "apps/web" -Destination "frontend"` from the repository root. Preserve ignored build output and all local files.
- [x] Update root workspaces to temporarily include `"frontend"`, `"apps/*"`, and `"packages/*"` so both app workspaces remain discoverable during the move.
- [x] In `frontend/tests/run_browser_test.py`, set `REPO_ROOT = WEB_DIR.parent`; leave `WEB_DIR` as the parent of `tests/`.
- [x] In `frontend/tests/test_public_audit.py`, change the `axe-core` root lookup from `parents[3]` to `parents[2]`.
- [x] Run `npm test --workspace @dana-terang/web`; expect the browser suite to pass against its dynamic local port.
- [x] Run `npm run build --workspace @dana-terang/web`; expect Next.js compilation and static page generation to succeed.

## Task 2: Move Backend and Database Migrations

**Files:** move `apps/api/` to `backend/`, move its migrations to `database/migrations/`; modify root `package.json` and `backend/src/db/migrate.js`.

- [x] Create root `database/`, then move `apps/api/` to `backend/` and `backend/db/migrations/` to `database/migrations/` using `Move-Item`; preserve API source, tests, scripts, and `.env.example`.
- [x] Set final root workspaces to exactly `"frontend"`, `"backend"`, and `"packages/*"`; remove the temporary `"apps/*"` entry.
- [x] In `backend/src/db/migrate.js`, set the default directory to `fileURLToPath(new URL("../../../database/migrations/", import.meta.url))`.
- [x] Run `npm install` at the repository root to refresh workspace links and `package-lock.json`; expect it to complete without dependency changes beyond workspace metadata.
- [x] Run `npm test --workspace @dana-terang/api`; expect all API tests, including migration discovery from the default directory, to pass.
- [x] Run `npm ls --workspaces --depth=0`; expect frontend, backend, domain, and proof workspaces to resolve with their existing package names.

## Task 3: Update Root Documentation and Verify the Monorepo

**Files:** modify `README.md`, `docs/plans/2026-10-05-auth-rbac-implementation.md`, and `docs/specs/2026-10-05-repository-layout-design.md`; create `database/README.md`.

- [x] Update the README Playwright dependency command from `apps/web/requirements-test.txt` to `frontend/requirements-test.txt` and update the app directory overview.
- [x] Update active Auth/RBAC implementation-plan paths from `apps/api/` to `backend/` and migration paths to `database/migrations/`. Keep the initial app-shell plan as historical context and retain the approved layout spec's “moved from” references.
- [x] In the approved layout spec, change `currently apps/...` descriptions to `moved from apps/...` so they remain historically accurate after the move.
- [x] Add `database/README.md` stating that ordered up migrations and matching `.down.sql` files live in `database/migrations/`, the API runner applies them, and local explicit migration command is `npm run db:migrate --workspace @dana-terang/api`.
- [x] Search active source/config/docs for old paths; repository search found matches only in the layout design/implementation documents and the historical app-shell plan, with no stale paths in active source or README/Auth plan.
- [x] Run `npm test`; expect API, frontend browser, domain, and proof tests to pass.
- [x] Run `npm audit`; expect zero vulnerabilities.
- [x] Run `npm run build --workspace @dana-terang/web`; expect a successful production build.
- [x] Run `git diff --check` and inspect `git status --short`; confirm no `.env` or other credentials were moved into tracked files.

## Environment Gate

The repository currently has no PostgreSQL server or `DATABASE_URL`. Verify migration discovery with the existing `pg-mem` migration test after the move. Real PostgreSQL migration and transaction integration checks remain a separate gate before pilot use.
