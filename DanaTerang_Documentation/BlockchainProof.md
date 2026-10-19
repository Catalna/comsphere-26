# DanaTerang — Blockchain Proof Layer

## 1. Purpose

Blockchain is used as a **tamper-evident proof layer**.

It does not replace PostgreSQL.

It does not store original receipts, photos, or reports.

It does not automatically prove that real-world events are truthful.

In the Phase 1 demo, the chain records the permissioned 2-of-3 Verifier quorum and a versioned evidence/review commitment on **Ethereum Sepolia Testnet**. Verifiers sign with organization-controlled wallets; a backend relayer submits transactions and pays gas. Organizers and Funders do not need wallets. The proof does not record or confirm external payment reports.

## 2. What Blockchain Proves

Blockchain helps prove that:

- a proof existed at a certain time,
- the recorded proof was not silently changed,
- a milestone verification state was anchored,
- the proof commitment for a particular evidence version and verifier outcome was anchored.

## 3. What Goes On-Chain

Recommended minimum fields:

- campaign ID
- milestone ID
- proof type and package hash (Phase 1) or Merkle root (optional profile)
- verification status
- timestamp
- opaque, non-sensitive verifier reference (if needed)
- version

Payment-reference and disbursement proofs are not part of the Phase 1 demo. They require a separately defined process and privacy review before use.

For indexed contract references, derive `campaignId` and `milestoneId` as `keccak256(UTF8(opaqueId))`. This identifier hashing is separate from the SHA-256 canonical-package proof hash. Never use a person's name, email, or other direct personal data as an identifier.

## 4. What Must Stay Off-Chain

Do not store:

- raw receipt files,
- beneficiary personal data,
- account numbers,
- full OCR text,
- sensitive invoices,
- internal review notes.

## 5. Evidence Hashing and Canonical Package

### Raw Evidence Hash

Calculate SHA-256 from the exact original file bytes immediately after upload and before OCR, image processing, or redaction. The raw hash is immutable for that file version.

Purpose:

- protect integrity of original file.

### Canonical JSON Package — Legacy Schema Version 1

The `schemaVersion: 1` example and test vector below preserve the initial single-verifier package profile. Keep them unchanged for compatibility and do not create new peer-quorum proofs with this version. New peer-quorum proofs use schema version 2, specified below.

For legacy schema version 1, create a package for the specific evidence version after its human-review outcome is recorded. New peer-quorum records require the separately versioned schema 2 described above. Normalize each version to its fixed JSON schema, apply the JSON Canonicalization Scheme (JCS, RFC 8785) to produce deterministic key ordering/string/number serialization, encode the result as UTF-8 without a BOM, then compute `SHA-256(canonicalJsonBytes)`. Normalize strings to Unicode NFC before JCS. Use the resulting package hash as the on-chain proof hash.

JCS defines fixed ordering for object fields, including nested objects. Every schema key is present; unavailable values are `null`, and an unavailable confidence score is `0`. IDs are stable lowercase ASCII opaque identifiers; arrays are sorted by stable identifier, and `flagCodes` are sorted lexicographically before canonicalization. Normalize hashes to lowercase 64-character hex, confidence to integer 0–100, and currency to uppercase ISO 4217. Canonical amounts are nonnegative decimal strings with no grouping separators or leading zeroes (except `0`), no trailing fractional zeroes, and no decimal point for integer values. Timestamps use UTC ISO-8601 with fixed millisecond precision: `YYYY-MM-DDTHH:mm:ss.sssZ`. Persist event timestamps when the event happens; never generate a new timestamp while re-hashing an existing version. The indented JSON below is a readable schema example; hash the JCS-canonicalized bytes, not the pretty-printed text.

```json
{
  "schemaVersion": 1,
  "campaignId": "opaque-campaign-id",
  "milestoneId": "opaque-milestone-id",
  "evidenceVersion": 1,
  "createdAt": "2026-10-04T12:35:00.000Z",
  "files": [
    {
      "evidenceId": "opaque-evidence-id",
      "evidenceType": "RECEIPT",
      "rawHash": "<64-lowercase-hex>",
      "redactedHash": null,
      "ocr": {
        "language": "id",
        "vendor": {"value": "Example Store", "confidence": 94},
        "documentDate": {"value": "2026-10-01", "confidence": 89},
        "amount": {"value": "30000000", "currency": "IDR", "confidence": 98},
        "invoiceNumber": {"value": "INV-001", "confidence": 91}
      },
      "screening": {"screeningStatus": "FLAGGED", "flagCodes": ["LOW_CONFIDENCE_DATE"]}
    }
  ],
  "verification": {
    "verificationStatus": "VERIFIED",
    "reviewedAt": "2026-10-04T12:34:56.789Z",
    "verifierRef": "opaque-verifier-ref"
  },
  "proofVersion": 1
}
```

### Canonical SHA-256 Test Vector

For the schema example above, use `rawHash` equal to 64 zero characters. The JCS-canonical UTF-8 bytes (shown as one line, with no surrounding quotes) are:

```text
{"campaignId":"opaque-campaign-id","createdAt":"2026-10-04T12:35:00.000Z","evidenceVersion":1,"files":[{"evidenceId":"opaque-evidence-id","evidenceType":"RECEIPT","ocr":{"amount":{"confidence":98,"currency":"IDR","value":"30000000"},"documentDate":{"confidence":89,"value":"2026-10-01"},"invoiceNumber":{"confidence":91,"value":"INV-001"},"language":"id","vendor":{"confidence":94,"value":"Example Store"}},"rawHash":"0000000000000000000000000000000000000000000000000000000000000000","redactedHash":null,"screening":{"flagCodes":["LOW_CONFIDENCE_DATE"],"screeningStatus":"FLAGGED"}}],"milestoneId":"opaque-milestone-id","proofVersion":1,"schemaVersion":1,"verification":{"reviewedAt":"2026-10-04T12:34:56.789Z","verificationStatus":"VERIFIED","verifierRef":"opaque-verifier-ref"}}
```

Expected SHA-256 package hash: `452d8c79872337735b6a0bc8957bae4b4d5931058b1f64fd9fea5efd05365bbf`. This fixture validates canonical serialization and hashing only; the all-zero raw hash is not a real evidence hash.

### Canonical Peer-Quorum Package — Schema Version 2

Every new proof created after a 2-of-3 peer quorum uses `schemaVersion: 2`. It preserves the version-1 evidence, OCR, screening, and verification fields and adds a `quorum` object that binds the outcome to the confirmed peer-review contract transaction:

```json
{
  "schemaVersion": 2,
  "campaignId": "opaque-campaign-id",
  "milestoneId": "opaque-milestone-id",
  "evidenceVersion": 1,
  "createdAt": "2026-10-05T09:00:00.000Z",
  "quorum": {
    "reviewRef": "0x<64-lowercase-hex>",
    "roundNumber": 1,
    "decision": "VERIFIED",
    "contractAddress": "0x<40-lowercase-hex>",
    "transactionHash": "0x<64-lowercase-hex>",
    "blockNumber": 5432100
  },
  "files": [
    {
      "evidenceId": "opaque-evidence-id",
      "evidenceType": "RECEIPT",
      "rawHash": "<64-lowercase-hex>",
      "redactedHash": null,
      "ocr": {
        "language": "id",
        "vendor": { "value": "Example Store", "confidence": 94 },
        "documentDate": { "value": "2026-10-01", "confidence": 89 },
        "amount": { "value": "30000000", "currency": "IDR", "confidence": 98 },
        "invoiceNumber": { "value": "INV-001", "confidence": 91 }
      },
      "screening": { "screeningStatus": "FLAGGED", "flagCodes": ["LOW_CONFIDENCE_DATE"] }
    }
  ],
  "verification": {
    "verificationStatus": "VERIFIED",
    "reviewedAt": "2026-10-04T12:34:56.789Z",
    "verifierRef": "opaque-verifier-ref"
  },
  "proofVersion": 1
}
```

`quorum.reviewRef` is the opaque bytes32 review ID. `quorum.decision` must equal `verification.verificationStatus`; the transaction hash, block number, and contract address come only from the confirmed `ReviewFinalized` event/round record. Zero hashes and the zero contract address are invalid. Existing version-1 rows remain version 1 and are never rewritten. Canonicalize with JCS (RFC 8785), UTF-8, NFC-normalized strings, and the timestamp rules above before hashing with SHA-256.

The schema-2 reproducibility vector uses the JSON structure above, `rawHash` set to 64 zero characters, and `quorum.reviewRef`, `contractAddress`, and `transactionHash` set respectively to 64 `a` characters after `0x`, 40 `b` characters after `0x`, and 64 `c` characters after `0x`. Its expected SHA-256 package hash is `783f39f73a962c03af80e7b3e3a47bca658872db00e37088bf99038607ac3b20`.

The full-text OCR output, personal information, account data, and internal review notes are excluded from this package. Keep the package off-chain. Any OCR correction, redaction change, or new verifier outcome creates a new evidence/proof version and package hash; never mutate the package behind an existing hash. A public user cannot reproduce its hash unless they are given the exact normalized package.

### Optional Merkle Root

Merkle roots are an optional profile for larger evidence sets, not the Phase 1 default. Before enabling one, specify the leaf inputs, leaf/node domain prefixes, sort order, odd-leaf handling, and proof type so an independent verifier can reproduce the root. Do not treat a Merkle root over file hashes alone as a commitment to OCR or verifier outcome; those fields require a separate package commitment.

```text
Per-file canonical leaf inputs
→ Merkle Tree
→ Evidence Root
→ Include root and review metadata in a versioned proof package
→ Anchor the selected proof hash
```

## 6. Smart Contract Scope

Recommended MVP contract:

```solidity
enum ProofType { PACKAGE_SHA256, MERKLE_ROOT }
enum VerificationStatus { VERIFIED, NEEDS_REVISION, REJECTED }

struct MilestoneProof {
    bytes32 campaignId;
    bytes32 milestoneId;
    bytes32 proofHash;
    ProofType proofType;
    VerificationStatus verificationStatus;
    uint64 version;
}
```

Minimal functions:

- `anchorProof()`
- `updateProofVersion()`
- `getProof()`

This is a conceptual proof-anchor contract shape, not a deployed ABI; vote adjudication belongs to the separate peer-quorum contract. Use the `keccak256(UTF8(opaqueId))` references defined above; never publish a reviewer name or personal identity. Permissioned peer-review events expose Verifier wallet addresses and vote outcomes, so Verifiers must use organization-controlled signing wallets that are not reused for personal activity. The service relayer's transaction sender is not itself a reviewer. The canonical package contains its own fixed UTC ISO-8601 event timestamps; the public chain record also provides the block timestamp. `proofHash` is the SHA-256 package hash; Ethereum's `keccak256` is used only for indexed opaque IDs.

Implement the contract in Solidity and call it through ethers.js. Phase 1 uses real Ethereum Sepolia Testnet transactions, not mocked proof records. The service wallet signs relay transactions and pays gas with Sepolia ETH; only assigned Verifiers connect a wallet to sign votes. Organizers, Funders, and public observers do not need wallets.

## 7. Transaction Reference

Do not store a blockchain transaction hash inside the same transaction.

The Sepolia network already produces:

- transaction hash,
- block number,
- block timestamp.

Store these off-chain in PostgreSQL after the Sepolia transaction receipt succeeds. For Phase 1, `proofStatus=ANCHORED` when the receipt has success status and a block number and the transaction is inspectable on Sepolia Etherscan. `proofStatus` is independent of `verificationStatus`: use `PENDING`, `SUBMITTED`, `ANCHORED`, or `FAILED`, never a generic `CONFIRMED` label for a proof. A pilot may adopt a stronger finality policy.

Expose a technical-proof link using `https://sepolia.etherscan.io/tx/{txHash}`. Users may inspect the transaction there without connecting a wallet to DanaTerang.

## 8. Optional Future Payment Proof and Escrow

Payment proof and on-chain escrow are future, separately scoped capabilities. A funder's manual payment report in the MVP remains off-chain and is labeled as reported by that funder.

This is separate from the proof layer.

Potential flow:

```text
Funds Locked
→ Evidence Reviewed and Approved
→ Release Condition Met
→ Smart Contract Releases Funds
```

This is not required for core DanaTerang.
