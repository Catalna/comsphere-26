# DanaTerang OCR and Screening Implementation Plan

> **For agentic workers:** Use `executing-plans` and TDD to implement this plan on the approved `main` branch. Preserve uncommitted changes, use no Docker, and do not commit unless requested. Steps use checkbox syntax for tracking.

> **Scope note:** This OCR slice was implemented under the prior Admin-only review policy. The approved peer-review design at `docs/specs/2026-10-06-peer-review-design.md` supersedes that policy and requires moving full OCR access/review actions to assigned Verifiers.

**Goal:** Run local Indonesian/English OCR and deterministic advisory screening for each private evidence version, with persistent background jobs, Admin retry, and safe participant-facing status.

**Architecture:** Tesseract.js and local PDF rasterization produce OCR text and per-field confidence. PostgreSQL stores OCR runs, flags, and queued jobs; an injected, bounded worker claims jobs and records immutable terminal results. Existing campaign authorization remains authoritative, and full OCR text is Admin-only.

**Tech Stack:** Node 20 ESM, PostgreSQL `pg`, `pg-mem`, `pdfjs-dist`, `@napi-rs/canvas`, Tesseract.js, Express 5, Next.js 16, Supertest, `node:test`, Playwright.

---

## File Map

- Create `backend/src/ocr/config.js`, `documentRasterizer.js`, `tesseractEngine.js`, `documentParser.js`, and `screeningRules.js` for bounded local document processing.
- Create `database/migrations/004_ocr_processing.sql` and `.down.sql` for immutable OCR run metadata, flags, and durable queue rows.
- Create `backend/src/repositories/ocrRepository.js` and `backend/src/ocr/ocrWorker.js` for job claim/recovery and OCR result persistence.
- Modify `backend/src/evidence/evidenceService.js`, `backend/src/repositories/evidenceRepository.js`, `backend/src/app.js`, `backend/src/server.js`, and `backend/src/config.js` to atomically enqueue work and start/stop the worker.
- Modify `backend/src/routes/evidence.js` and add `backend/test/ocr/**` plus API coverage in `backend/test/evidence/routes.test.js` for safe summaries, Admin-only detail/retry, state, and tenant isolation.
- Modify `frontend/app/campaigns/[campaignId]/page.tsx`, `frontend/tests/test_authenticated_flow.py`, `backend/scripts/browser-test-server.js`, `.env.example` files, and setup docs for visible processing states and deterministic browser OCR fixtures.

## Task 1: Local OCR Configuration and PDF Rasterization

**Files:** create `backend/src/ocr/config.js`, `backend/src/ocr/documentRasterizer.js`, `backend/src/ocr/tesseractEngine.js`, and `backend/test/ocr/config.test.js`, `backend/test/ocr/document-rasterizer.test.js`, `backend/test/ocr/tesseract-engine.test.js`; modify `backend/package.json` and `backend/.env.example`.

- [x] Write tests for default/invalid config, JPEG/PNG dimension validation, one-page PDF rendering, malformed/encrypted PDF failure, PDF page count over 10, decoded image over 25 MP, and a missing local language-data directory.
- [x] Run `node --test test/ocr/config.test.js test/ocr/document-rasterizer.test.js test/ocr/tesseract-engine.test.js` from `backend/`; confirm the initial missing-module failures and the final 11 passing tests.
- [x] Install runtime dependencies with `npm install --workspace @dana-terang/api @napi-rs/canvas tesseract.js franc-min` and pin the Node-20-compatible, audit-clean PDF.js release using `npm install --workspace @dana-terang/api --save-exact pdfjs-dist@5.5.207`; retain the generated root lockfile.
- [x] Implement `renderEvidencePages({bytes, contentType, maxPages=10, maxPixels=25000000, dpi=150})` as an async iterator. Validate JPEG/PNG dimensions before yielding image data, render one PDF page at a time, reject invalid input with a safe `code`, and never write temporary pages to a public or persistent directory.
- [x] Implement `createTesseractEngine({createWorker, languageDataPath})` behind an injected worker factory; require local `ind` and `eng` data, return text/word confidence, and do not download language data inside a job.
- [x] Run all Task 1 tests; bounded defaults, image dimension checks, real local PDF.js/canvas page rendering, PDF limits, and deterministic worker results passed without network access.

## Task 2: OCR Field Parsing and Deterministic Screening

**Files:** create `backend/src/ocr/documentParser.js`, `backend/src/ocr/screeningRules.js`, and `backend/test/ocr/document-parser.test.js`, `backend/test/ocr/screening-rules.test.js`.

- [x] Write parser fixtures for Indonesian and English vendor/date/amount/invoice examples, mixed/unknown language, ambiguous dates/currency, and decimal values; assert amounts remain normalized strings, never JS floats.
- [x] Run `node --test test/ocr/document-parser.test.js test/ocr/screening-rules.test.js`; confirm missing-module failures before implementation and 10 passing tests after implementation.
- [x] Implement `parseOcrDocument({text, words})` returning `vendor`, `documentDate`, `amount`, `currency`, optional `invoiceNumber`, `detectedLanguage`, `fieldConfidence`, and original text. Normalize dates to ISO; return null for ambiguous values.
- [x] Implement `screenOcrResult({parsed, milestone, campaign, thresholds, duplicateMatches, today})` with required fields vendor/date/amount and stable flags `MISSING_FIELD`, `LOW_CONFIDENCE_FIELD`, `AMOUNT_MISMATCH`, `CURRENCY_MISMATCH`, `CURRENCY_UNCERTAIN`, `SUSPICIOUS_DATE`, and `POSSIBLE_DUPLICATE`. Compare decimal strings exactly without `Number` or floating-point arithmetic.
- [x] Set demo thresholds to vendor 70, date 80, amount 90, and invoice 70; validate `amount > vendor`. A missing invoice number alone is not a flag; `CLEAR` requires no flags and all required fields over threshold.
- [x] Run parser and screening tests; clear/flagged outputs are deterministic and currency-unknown/malformed required values cannot be cleared.

## Task 3: OCR Schema and Repository

**Files:** create `database/migrations/004_ocr_processing.sql`, `.down.sql`, `backend/src/repositories/ocrRepository.js`, and `backend/test/db/ocr-repository.test.js`; modify `backend/test/db/migrations.test.js`, `backend/test/db/evidence-repository.test.js`, and `backend/src/repositories/evidenceRepository.js`.

- [x] Add migration tests first for run status and version constraints, unique `(evidence_id, run_number)`, flags/jobs foreign keys, unique job per run, and ordered up/down behavior; verify both a valid run and representative invalid rows.
- [x] Run `node --test test/db/migrations.test.js test/db/ocr-repository.test.js`; confirm the new migration/repository tests fail before implementation and all four pass after implementation.
- [x] Add `ocr_runs` with evidence id, run number, screening status, extracted fields, currency, detected language, `field_confidence`, private `extracted_text`, safe `failure_code`, and timestamps; constrain status/value ranges and unique evidence/run number.
- [x] Add `ai_flags` tied to one OCR run with stable code, optional field, severity, short message, and creation time. Add `ocr_jobs` tied uniquely to one run with `QUEUED|RUNNING|COMPLETED|FAILED`, attempt count, lease expiry, and safe failure code.
- [x] Implement repository methods to create a queued run, claim one queued/expired job with an atomic conditional `UPDATE ... RETURNING`, and list duplicate candidates within the same Campaign.
- [x] Update `createEvidence` to enforce `UPLOADED → PROCESSING` through the domain state machine, then insert evidence, an initial `PROCESSING` run, an OCR job, and `OCR_JOB_QUEUED` audit event in the same transaction; retain the existing response `status` field while adding `evidenceStatus` and `screeningStatus`.
- [x] Run migration/repository tests and `node --test test/db/evidence-repository.test.js`; upload metadata plus job creation commit atomically and duplicate-candidate queries stay Campaign-scoped.

## Task 4: Background Worker, Retry Recovery, and Server Lifecycle

**Files:** create `backend/src/ocr/ocrWorker.js`, `backend/test/ocr/ocr-worker.test.js`; modify `backend/src/repositories/ocrRepository.js`, `backend/src/ocr/tesseractEngine.js`, `backend/src/server.js`, and `backend/scripts/browser-test-server.js`.

- [x] Write worker tests with injected repository, storage, renderer, and OCR engine for success, parser flagging, safe processing failure, expired lease recovery, and graceful stop.
- [x] Run `node --test test/ocr/ocr-worker.test.js`; confirm the initial missing-module failure and passing worker cases after implementation.
- [x] Implement `createOcrWorker({repository, storage, renderer, engine, pollIntervalMs, leaseMs, maxAttempts:3, concurrency:1})` with `start()`/`stop()`. The worker reads only by stored object key, never logs extracted text, renews a lease every `leaseMs / 3`, verifies original bytes against the persisted SHA-256, and commits the run, flags, job state, and evidence state together.
- [x] Add repository completion/failure operations that atomically persist OCR fields, replace only that run's flags, clear the job lease, update job/run/evidence states, and write audit records with no text payload.
- [x] On OCR success set screening to `CLEAR` or `FLAGGED` and evidence to `READY_FOR_REVIEW`; on processing failure store a safe code, set screening `FAILED`, and evidence `PROCESSING_FAILED`. Record `OCR_COMPLETED` or `OCR_FAILED` with no extracted text in audit details.
- [x] Re-queue jobs whose `RUNNING` lease expired while attempts remain; fail the job after three claims.
- [x] Start the production worker when PostgreSQL and evidence storage are configured; if local OCR language data is missing, fail queued runs safely with a retryable code instead of leaving them indefinitely in `PROCESSING`. Stop polling and release worker resources during graceful shutdown. Inject deterministic OCR in the browser-test API process.
- [x] Run worker, evidence-service, migration, and server-config tests; unit/API coverage verifies safe outcomes, leases, and job persistence. Browser-server interaction will be exercised with Task 6.

## Task 5: Authorized OCR APIs and Safe Evidence Summaries

**Files:** modify `backend/src/routes/evidence.js`, `backend/src/repositories/evidenceRepository.js`, `backend/test/evidence/routes.test.js`, and add `backend/test/ocr/routes.test.js`.

- [x] Test upload returns promptly with `PROCESSING`; participant list/detail responses include named evidence/screening states and safe flags but omit full OCR text/storage keys; Admin-only OCR details and retries are enforced.
- [x] Test a second Organizer cannot see another Campaign's flags or OCR run, duplicate checks never cross Campaign boundaries, and repeated Admin retries create distinct runs without overwriting prior terminal results.
- [x] Implement `GET /api/evidence/:evidenceId/ocr` and `POST /api/evidence/:evidenceId/reprocess` behind session + `ADMIN` role; require the configured exact Origin for the state-changing retry, use non-disclosing `404` for out-of-scope IDs, and set `private, no-store` for all responses.
- [x] Extend evidence list/detail serializers additively with `evidenceStatus`, latest `screeningStatus`, and safe flag summaries while retaining existing `status` for current clients.
- [x] Add repository methods for latest safe screening summary, Admin-only full OCR detail, and versioned Admin retry; every retry inserts a new run and job.
- [x] Run `npm test --workspace @dana-terang/api`; all 103 API tests pass with Admin-only private data, existing upload/download access, and no cross-tenant disclosure.

## Task 6: Campaign UI Processing and Admin OCR Detail

**Files:** modify `frontend/app/campaigns/[campaignId]/page.tsx`, `frontend/tests/test_authenticated_flow.py`, and `backend/scripts/browser-test-server.js`.

- [x] Add deterministic fake OCR outcomes to the browser-test server for one flagged run and one processing failure; keep browser tests independent of traineddata downloads.
- [x] Write browser tests for `PROCESSING → READY_FOR_REVIEW/FLAGGED`, failure then Admin retry, Organizer/Funder flag-only access, and Admin full OCR detail; assert full text never appears in Organizer/Funder DOM or API responses.
- [x] Update the Evidence panel to show distinct evidence/screening states and safe flags. Poll every 2 seconds only while processing, stop on terminal states, and announce state changes with a polite live region.
- [x] Add a disclosure for Admin-only OCR fields/text and an Admin retry button; retain the original file selection/error behavior and Civic Ledger visual styles.
- [x] Run `npm test --workspace @dana-terang/web`; Auth/Campaign/evidence/OCR browser flow, axe checks, keyboard activation, and desktop/mobile overflow checks pass.

## Task 7: Local Setup and Verification

**Files:** create `backend/src/ocr/smokeFixture.js`, `backend/scripts/ocr-smoke.js`, and `backend/test/ocr/ocr-smoke.test.js`; modify `backend/package.json`, `backend/.env.example`, `database/README.md`, `README.md`, root `package.json`, and this plan's checkboxes.

- [x] Document local `OCR_LANGUAGE_DATA_PATH`, `OCR_POLL_INTERVAL_MS=1000`, `OCR_JOB_LEASE_MS=300000`, `OCR_MAX_ATTEMPTS=3`, and demo thresholds. Explain how to provision `ind`/`eng` traineddata without putting evidence or secrets in the repository.
- [x] Add `npm run ocr:smoke --workspace @dana-terang/api`, which processes a synthetic non-sensitive receipt and reports only extracted field presence/confidence, not full text.
- [x] Run `npm test` from the repository root and read all output; browser checks and all 120 API/domain/proof tests pass.
- [x] Run `npm run build --workspace @dana-terang/web`, `npm audit`, and `git diff --check`; build is clean, audit reports zero vulnerabilities, and diff check reports no whitespace errors (Git notes existing LF/CRLF normalization).
- [x] Verify ordered migration 004 up/down using `pg-mem` and test OCR job enqueue/claim/completion/failure with that adapter.
- [x] Confirm `OCR_LANGUAGE_DATA_PATH`, private storage root, database credentials, and Sepolia secrets are not tracked or emitted to logs.

## External Gates

- Native PostgreSQL is required to verify atomic multi-worker claim behavior, leases, and real migration behavior; no Docker fallback is permitted.
- Tesseract `ind` and `eng` traineddata must be locally provisioned for the actual OCR smoke test; ordinary unit/browser suites inject a deterministic engine and do not require network access.
- Run `npm run db:migrate --workspace @dana-terang/api` and `npm run ocr:smoke --workspace @dana-terang/api` after PostgreSQL and both local language files are provisioned.
- Add organization-level cumulative storage quotas and upload-rate protection before a real pilot, as recorded in the approved design.
- OCR confidence thresholds require calibration against representative Indonesian and English program documents before pilot use; demo defaults are not accuracy claims.
