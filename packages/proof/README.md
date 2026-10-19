# `@dana-terang/proof`

Shared proof functions for DanaTerang.

## API

- `normalizeProofPackage(input)` validates and returns the normalized schema object.
- `canonicalizeProofPackage(input)` returns UTF-8-ready RFC 8785 JCS JSON text.
- `hashProofPackage(input)` returns lowercase SHA-256 hex for that JCS text.
- `hashRawEvidence(bytes)` returns lowercase SHA-256 hex over the exact `Buffer`/`Uint8Array` bytes received before OCR or redaction.

## Package schema

The legacy schema-1 proof package represents one evidence version after a single human review. New peer-quorum proofs use schema version 2. Both versions contain opaque lowercase ASCII `campaignId`/`milestoneId`, `evidenceVersion`, UTC ISO-8601 `createdAt`, `files`, `verification`, and `proofVersion`; version 2 additionally includes the confirmed quorum reference described below.

Each file contains `evidenceId`, `evidenceType`, `rawHash`, nullable `redactedHash`, `ocr`, and `screening`. OCR fields are `language`, `vendor`, `documentDate`, `amount`, and `invoiceNumber`; each extracted field has `value` and integer `confidence` 0–100. Amount contains `value`, `currency`, and `confidence`. Verification contains `verificationStatus`, `reviewedAt`, and opaque `verifierRef`.

Every schema key is required; unavailable values are explicit `null` and unavailable confidence is `0`. IDs are stable lowercase ASCII. Strings are NFC-normalized, file entries are sorted by `evidenceId`, flag codes are sorted, hashes use lowercase 64-character hex, and currency is normalized to uppercase and checked against the Node runtime's supported ISO currency registry. Amount is normalized to an unsigned decimal string with no grouping separators, no leading zeroes except `0`, and no trailing fractional zeroes. Timestamps use `YYYY-MM-DDTHH:mm:ss.sssZ`.

JCS sorts object keys and defines canonical JSON string/number serialization. The package hash is `SHA-256(UTF8(JCS(package)))`. Raw file hashes and package hashes are separate. No original file, full OCR text, personal data, account data, or internal review notes belong in the package. A redacted derivative has a distinct raw hash and never replaces the original hash.

Schema version 2 adds the exact required object `quorum`: `reviewRef` (nonzero bytes32 opaque review ID), `roundNumber` (positive integer), `decision` (`VERIFIED`, `NEEDS_REVISION`, or `REJECTED`), `contractAddress` (nonzero EVM address), `transactionHash` (nonzero bytes32 confirmed review transaction), and `blockNumber` (nonnegative integer). `quorum.decision` must equal `verification.verificationStatus`. The review contract address and transaction receipt fields are taken from the confirmed peer-review round, never from a client request. Version 1 remains supported for validation and historical hash reproduction; new peer-quorum packages must use version 2.

The library rejects packages with more than 100 files, more than 100 flag codes per file, strings longer than 4096 characters, or canonical output larger than 1,000,000 UTF-8 bytes. These are processing/resource guards, not upload limits; the API must also enforce its own request and file-size limits.

## Test vector

The schema-1 fixture in `test/canonical-proof.test.js` uses a raw hash of 64 zeroes. Its expected package hash is:

```text
452d8c79872337735b6a0bc8957bae4b4d5931058b1f64fd9fea5efd05365bbf
```

The schema-2 quorum fixture uses a raw hash of 64 zeroes, `reviewRef` of `0x` plus 64 `a` characters, contract address `0x` plus 40 `b` characters, transaction hash `0x` plus 64 `c` characters, round 1, and block 5,432,100. Its expected package hash is:

```text
783f39f73a962c03af80e7b3e3a47bca658872db00e37088bf99038607ac3b20
```
