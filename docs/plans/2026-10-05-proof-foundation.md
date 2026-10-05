# DanaTerang Proof Foundation Implementation Plan

> **For agentic workers:** Execute each task in order and verify the docs' canonical test vector before continuing.

**Goal:** Establish the Node workspace and a tested canonical proof package/hash library as the first code slice for DanaTerang.

**Architecture:** Keep the proof formatter as a dependency-light shared workspace package. It validates the fixed schema in `packages/proof/README.md`, NFC-normalizes string values, sorts evidence and flag arrays, uses RFC 8785 JCS for JSON bytes, and uses Node's SHA-256 for both package and raw-file hashes.

**Tech Stack:** Node.js 20 ESM, npm workspaces, `canonicalize@4.0.0` (RFC 8785, Node 18+), built-in `node:test` and `node:crypto`.

---

## File Map

- Create `package.json`: private npm workspace and root test command.
- Create `README.md`: development setup, scope of the proof package, and test command.
- Create `.gitignore`: ignore dependencies, build output, coverage, and local environment files.
- Create `packages/proof/package.json`: proof package metadata, `canonicalize` dependency, test command.
- Create `packages/proof/README.md`: portable proof-package schema, normalization rules, and documented hash vector.
- Create `packages/proof/src/index.js`: schema validation, normalization, JCS serialization, package hash, and raw hash.
- Create `packages/proof/test/canonical-proof.test.js`: documented test vector, raw-hash known vector, sorting/NFC invariance, and invalid-input cases.

## Task 1: Bootstrap the Workspace

- [x] Create the root npm workspace with `packages/*` and `npm test` forwarding to workspace tests.
- [x] Document Node/npm prerequisites and workspace commands in the root README.
- [x] Create `@dana-terang/proof` as an ESM package with `node --test` and `canonicalize@4.0.0` (compatible with the available Node 20 runtime).
- [x] Add `.gitignore` entries for `node_modules/`, `.env*`, `coverage/`, and `dist/`.
- [x] Run `npm install`; confirm the root lockfile is created and dependencies install.

## Task 2: Add Conformance Tests First

- [x] Write a test using the package values in `packages/proof/README.md`; assert `hashProofPackage()` equals `452d8c79872337735b6a0bc8957bae4b4d5931058b1f64fd9fea5efd05365bbf`.
- [x] Run `npm test --workspace @dana-terang/proof`; confirm it fails because the package implementation does not exist yet.
- [x] Add tests that raw SHA-256 of UTF-8 `abc` equals `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`, and that file/flag ordering plus NFC-equivalent strings yield the same package hash.
- [x] Add rejection tests for malformed 64-hex hashes, unknown status values, missing required keys, and confidence outside 0–100.

## Task 3: Implement the Proof Package

- [x] Implement strict schema validation and resource limits for the documented campaign/milestone/version/files/OCR/screening/verification fields. Require explicit `null` for unavailable values and `0` for unavailable confidence.
- [x] NFC-normalize strings, sort `files` by lowercase ASCII `evidenceId`, sort `flagCodes`, call `canonicalize()` for JCS bytes, and hash the resulting UTF-8 string with Node `createHash("sha256")`.
- [x] Implement `hashRawEvidence(bytes)` over exact `Buffer`/`Uint8Array` bytes before OCR or redaction; reject other input types.
- [x] Run the workspace tests and correct the implementation until all proof-package tests pass.

## Verification

Run `npm test --workspace @dana-terang/proof` and `npm test` from the repo root. The documented JCS vector and raw `abc` hash must match exactly. No UI, upload endpoint, database, OCR engine, or Sepolia transaction is part of this first code slice.

## Execution Notes

- `canonicalize@5.1.0` requires Node 22; the available runtime is Node 20.20.2, so the plan uses compatible `canonicalize@4.0.0`.
- TDD observed the missing-module failure before implementation and a failing normalization test before its fix.
- Root test suite: 9 passing tests. `npm audit`: 0 vulnerabilities. `git diff --check` produced no whitespace errors.
