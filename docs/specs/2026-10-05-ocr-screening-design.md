# DanaTerang OCR and Screening Design

## Goal

Process each uploaded evidence version with local Indonesian/English OCR and deterministic advisory screening, while preserving the private original and making processing state, results, and retries understandable to authorized users.

## Decisions

- Use Tesseract.js locally for OCR and `pdfjs-dist` with `@napi-rs/canvas` to rasterize PDFs. Do not send evidence to an external OCR provider.
- Return from upload after the original, metadata, and a PostgreSQL-backed OCR job are persisted. A background worker processes queued jobs.
- Keep one bounded worker per API process for the initial deployment. Claim jobs transactionally so a restarted process or a second worker can continue queued work without processing the same job twice.
- Keep each OCR/screening run immutable and versioned. A retry creates a new run for the same evidence version; it never overwrites the original or a prior run.
- Scope duplicate detection to evidence in the same Campaign. Do not reveal whether another Campaign or Organization contains a matching document.
- `CLEAR` is only a screening result: it means no configured advisory rule raised a flag. It is not an evidence decision or a truth claim.
- Human review follows the permissioned 2-of-3 peer model in `2026-10-06-peer-review-design.md`. OCR screening and peer verification remain separate status domains.

## OCR and Document Handling

- Support PDF, JPEG, and PNG, matching the existing evidence upload formats. Use Tesseract language data for `ind` and `eng`; record the detected language as `id`, `en`, `mixed`, or `unknown`.
- Provision both Tesseract language-data files locally through deployment/setup configuration. OCR processing must not download model data or send document content over the network; a missing language-data file produces a retryable processing failure.
- Render PDFs locally, one page at a time, at 150 DPI. Reject encrypted, malformed, or more-than-10-page PDFs with a safe processing failure code. Reject decoded images above 25 megapixels before OCR.
- Keep OCR worker concurrency at one initially. Do not log page text, extracted fields, or source file bytes. Temporary raster buffers are released after each page/run.
- Extract `vendor`, `documentDate`, `amount`, and optional `invoiceNumber`. Store confidence as an integer from 0 through 100 for each field. Missing optional invoice numbers do not cause a missing-field flag.
- Normalize document dates to `YYYY-MM-DD`. Normalize monetary values to nonnegative decimal strings without floating-point conversion; represent currency using an uppercase ISO-4217 code when confidently detected. Record unknown or ambiguous values as null rather than guessing.
- Persist full extracted text as sensitive review data. Never include it in ordinary evidence list/detail responses, logs, public responses, or blockchain packages.

## Screening Rules

Run deterministic rules after extraction:

1. Add `MISSING_FIELD` for a missing required vendor, document date, or amount.
2. Add `LOW_CONFIDENCE_FIELD` when an extracted field value is below its configured threshold. A missing optional invoice number does not create a flag. Thresholds are configuration values; the initial demo profile is vendor 70, document date 80, amount 90, and invoice number 70. The amount threshold must remain stricter than the vendor threshold. These demo values are not calibrated for a real pilot.
3. Add `AMOUNT_MISMATCH` when a confidently parsed amount exceeds the Milestone budget. Add `CURRENCY_MISMATCH` when a confidently detected currency conflicts with the Milestone currency. Add `CURRENCY_UNCERTAIN` when an amount is present but its currency cannot be confidently determined; this prevents a misleading `CLEAR` result.
4. Add `SUSPICIOUS_DATE` for a confidently parsed future date or a date outside an explicitly configured Campaign date range.
5. Add `POSSIBLE_DUPLICATE` when another evidence version in the same Campaign has the same raw SHA-256, or the same normalized vendor + invoice number + document date.

Each flag stores a stable code, affected field when applicable, severity, and short non-sensitive explanation. A run may be `CLEAR` only when it has no flags and every required field passes its configured threshold; otherwise it is `FLAGGED`. A parser/OCR/renderer error produces `FAILED`, not `CLEAR`.

## Data and Processing Flow

1. Evidence upload stores the original and inserts evidence metadata, an initial OCR run, and a queued OCR job transactionally. The API returns evidence with `evidenceStatus=PROCESSING` and `screeningStatus=PROCESSING`.
2. The worker claims a queued job, reads the private original by storage key, performs bounded rendering/OCR, normalizes fields, and runs Campaign-scoped checks.
3. In one database transaction, the worker persists the immutable run and flags, marks the job complete, and updates evidence to `READY_FOR_REVIEW`. The screening run ends as `CLEAR` or `FLAGGED`.
4. A failed run stores a safe failure code, marks the run `FAILED`, job failed, and evidence `PROCESSING_FAILED`. The Admin may retry; retry creates a new run number and preserves earlier run records.
5. Jobs left claimed after a process failure become eligible for recovery after a configured lease expires. The initial staging topology runs one API instance; row-claiming remains safe if another worker is added.

Add an additive migration for OCR runs, flags, and jobs. Store `fieldConfidence` as structured JSON with schema validation in the application. A run may transition while `PROCESSING`; once terminal, its captured fields and flags are immutable, and a retry inserts a new run number. Use database constraints for run numbering, statuses, relationships, and unique job/run identity. Add audit events for queueing, processing completion/failure, and Admin-requested retries without storing OCR text in audit details.

## API, Authorization, and UI

- Extend authorized evidence list/detail responses with `evidenceStatus`, latest `screeningStatus`, and safe flag summaries; continue to omit `storageKey` and full OCR text. Retain the current `status` response field for existing clients while adding the explicitly named `evidenceStatus` field.
- Add an assigned-Verifier-only OCR detail endpoint for full text and extracted fields; all private responses use `Cache-Control: private, no-store`.
- Allow Admin to retry a failed OCR job only before a review round opens. The endpoint returns job/status metadata only and every accepted retry creates a new immutable run.
- On the Campaign detail screen, show processing, ready, and failed states. Poll only while a run is active and announce updates accessibly. Organizer/Funder users see status/flags; assigned Verifiers see full OCR; Admin sees operational status only.
- Keep the existing Civic Ledger visual system and native responsive controls. Do not add human review actions in this slice; those belong to the next vertical slice.

## Verification and Acceptance

- Unit tests inject an OCR engine and renderer so normal API tests need no network or OCR language-data download. Add deterministic parser, confidence, screening, PDF bounds, job-claim/recovery, and retry tests.
- API tests verify queued uploads, tenant-safe duplicate detection, assigned-Verifier-only OCR text, metadata-only Admin retry, campaign-scoped summaries, safe failure responses, and immutable prior runs.
- Browser tests cover processing → ready/flagged, processing failure → Admin retry, Organizer/Funder summary visibility, assigned-Verifier OCR detail, keyboard/screen-reader state announcements, and responsive layout.
- Run full workspace tests, frontend production build, and dependency audit. Native PostgreSQL and a real local OCR fixture smoke test are required before declaring the OCR slice verified in the target runtime.

## Pilot Gates and Non-Goals

- Calibrate thresholds against representative Indonesian and English evidence before a real pilot; do not present the demo thresholds as accuracy guarantees.
- Add an organization-level cumulative evidence-storage quota and upload-rate protection before accepting pilot documents. The existing 10 MiB per-file limit alone does not bound total storage use.
- This slice does not decide evidence validity, create a Verification outcome, process payments, publish OCR fields, generate a blockchain proof, or provide redaction/publication controls.
- PostgreSQL, OCR language data, and private object storage must stay locally or under the operator's control. No beneficiary PII is required for the demo.
