# Database Migrations

PostgreSQL schema migrations live in `database/migrations/`. Each numbered `.sql` file applies an up migration; the matching `.down.sql` file reverses it.

## Native Windows Development (No Docker)

1. Install PostgreSQL 16 or newer with the Windows installer and keep the PostgreSQL service running on `127.0.0.1:5432`. Install the command-line tools (`psql`) or use pgAdmin.
2. In `psql -U postgres -h 127.0.0.1`, create a local role and database:

   ```sql
   CREATE ROLE danaterang_dev LOGIN PASSWORD 'replace-with-a-local-password';
   CREATE DATABASE danaterang OWNER danaterang_dev;
   ```

3. Copy `backend/.env.example` to `backend/.env`, set `DATABASE_URL` to `postgres://danaterang_dev:<url-encoded-password>@127.0.0.1:5432/danaterang`, set `WEB_ORIGIN=http://localhost:3000`, and set `AUTO_MIGRATE=true` for local development only. Keep the real `.env` untracked.
4. Run `npm run db:migrate --workspace @dana-terang/api` once to verify the connection and migration permissions. The API can also apply migrations at startup only when development `AUTO_MIGRATE=true` is explicitly set.
5. For the first Admin, set `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, and a unique 12–128 character `BOOTSTRAP_ADMIN_PASSWORD` in the ignored `backend/.env`, then run `npm run admin:provision --workspace @dana-terang/api` once. The bootstrap is one-time and returns no credential material; retain the password in your own password manager.
6. Start `npm run dev:api` and `npm run dev:web` in separate terminals. Next.js reads `frontend/.env.local`; copy `frontend/.env.example` there if the API is not at its default local address.

## Local OCR Setup (No Docker)

OCR runs inside the API process. It does not send evidence to a cloud OCR provider or download language models while processing a document.

1. Create the ignored local data directory at the configured `OCR_LANGUAGE_DATA_PATH` (the example resolves to `<repo>/.local/tessdata` when run from the `backend/` workspace).
2. Place the uncompressed Tesseract language files `eng.traineddata` and `ind.traineddata` in that directory. Obtain the files from the Tesseract `tessdata_best` distribution; keep them and real evidence out of Git. The API checks for both files when processing starts.
3. Copy the OCR settings from `backend/.env.example`. The demo confidence thresholds are vendor 70, date 80, amount 90, and invoice 70; they are provisional and must be calibrated against representative documents before a real pilot.
4. With PostgreSQL configured and migrations applied, start `npm run dev:api`. The API returns an upload after storing its evidence metadata and durable OCR job; its local worker renders PDFs (up to 10 pages at 150 DPI) and processes PDF/JPG/PNG files. Missing language data or OCR errors leave a retryable processing status rather than a false `CLEAR`.
5. Run the optional synthetic smoke check with `npm run ocr:smoke --workspace @dana-terang/api`. It prints detected language plus field-presence/confidence only; it never prints extracted values or text.

The OCR worker polls a PostgreSQL-backed queue. Each evidence version retains separate OCR run history; only Verifiers assigned to that evidence version can read full OCR text or retrieve original bytes. Admin may retry failed OCR before a review round opens, but receives no source or OCR content. Organizers see their own screening summary and, after a `NEEDS_REVISION` quorum, the final Organizer-facing instructions; Funders see status only. `CLEAR` means only that configured rules raised no flags, not that the expense or document is verified.

Migration `005_peer_review.sql` adds address-bound Verifier wallets, one-time wallet challenges, version-specific review rounds, assignments, immutable signed votes, relay receipts, and quorum verification records. When `PEER_REVIEW_CONTRACT_ADDRESS`, `BLOCKCHAIN_RPC_URL`, and `BLOCKCHAIN_PRIVATE_KEY` are configured, the API checks the chain ID, deployed bytecode, and contract relayer at startup. The contract is deployed with a fixed three-wallet roster and Organization commitments; there is no Admin panel-selection operation. Verifier wallets sign typed data locally; Organizers and Funders do not need a wallet. `NO_QUORUM` leaves verification pending.

Campaign/Auth unit and route tests use `pg-mem`; they do not replace the native PostgreSQL migration/integration check.

The API's migration runner applies migrations in order and records applied IDs in `schema_migrations`. For a configured database, run:

```sh
npm run db:migrate --workspace @dana-terang/api
```

The API server only runs migrations automatically in development when `AUTO_MIGRATE=true`. Production migrations are run explicitly with the command above. No Docker setup is used by this project.
