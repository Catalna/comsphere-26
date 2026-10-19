# DanaTerang — Security and Privacy

## 1. Security Goals

DanaTerang must protect:

- sensitive evidence,
- user accounts,
- organization data,
- verification integrity,
- blockchain signing keys,
- public/private data boundaries.

## 2. Authentication

Recommended:

- email/password,
- hashed passwords,
- session/JWT,
- secure cookies,
- optional MFA later.

## 3. Authorization

Use RBAC.

Roles:

- ADMIN
- ORGANIZER
- FUNDER
- VERIFIER
- BENEFICIARY
- PUBLIC

Every endpoint must verify permissions server-side.

## 4. Evidence Storage

Private evidence should not be public by default.

Only the three Verifiers assigned to that version's review panel may retrieve the platform-stored original or full OCR. Each Verifier may read only their own internal note; peer votes and notes are hidden. Organizers receive their own safe evidence/screening summary and the final quorum's revision instructions. Funders receive verification status only. Admin is operations-only: review identifiers, states, counts, and timestamps only, with no evidence content or decision controls. Access is scoped to the assigned review and Campaign, not granted by role alone.

Use:

- private buckets,
- signed URLs,
- expiry,
- file type validation,
- file size limits.

Public pages expose only explicitly approved, non-sensitive summaries and proof metadata. Do not expose original-file URLs, full OCR text, payment references, revision instructions, or internal verifier notes to Funder/Public/Admin views. A viewer must not be offered a re-hash flow for a file they cannot access. Contract events reveal reviewer wallet addresses and vote outcomes; they must not contain original bytes, OCR, notes, or personal data.

Two of three independent Verifier signatures finalize a decision. Admin cannot cast, change, or override a vote, and reviewer-roster changes require peer quorum. This decentralizes review decisions, not the hosted API or off-chain storage; infrastructure operators remain a separate trust boundary.

If publication requires redaction, keep the original private and immutable off-chain, create a separate derivative with its own raw SHA-256 hash, and publish only that reviewed derivative. Its hash proves only the integrity of the derivative after hashing; it does not prove that redaction was complete or that the source evidence is truthful.

## 5. Sensitive Information

Avoid putting on-chain:

- names,
- addresses,
- phone numbers,
- bank account numbers,
- full receipts,
- full OCR output,
- beneficiary personal information.

## 6. Blockchain Keys

Never expose private keys to frontend.

For backend signing:

- use environment variables for MVP,
- use secure key management in production,
- restrict signer permissions.

The Phase 1 service key is for Ethereum Sepolia Testnet only and must remain server-side. The backend service wallet relays peer votes and pays gas in Sepolia ETH; it cannot sign on behalf of a Verifier. A Verifier binds an organization-controlled wallet through an expiring, one-time typed-data challenge; private keys remain in the wallet. Assigned Verifiers hold their own keys, while Organizers and Funders do not provide a wallet or private key. Public proof details link to Sepolia Etherscan.

## 7. Evidence Integrity

Required:

- raw SHA-256 at upload,
- immutable version history,
- audit log,
- blockchain proof after verification.

## 8. Privacy Model

Public users should see only:

- non-sensitive metadata,
- status,
- approved summary,
- blockchain proof.

Authorized users may access full evidence.

On-chain commitments are immutable. Before a real-world pilot, define what can be deleted or redacted off-chain, what package/redacted hash remains publicly visible, how long the off-chain original is retained, and how these limits are explained before upload. Use opaque, non-sensitive references on-chain; raw and redacted hashes can still reveal that two parties possess the same file or that a known file was submitted.

## 9. Audit Logging

Log:

- login,
- upload,
- review,
- approval,
- revision request,
- payment record,
- proof anchoring,
- role changes.

## 10. Threats to Consider

- forged evidence,
- duplicated evidence,
- insider manipulation,
- unauthorized file access,
- compromised verifier account,
- stolen blockchain signer key,
- replayed payment reference,
- database tampering.

DanaTerang reduces risk but does not eliminate real-world fraud.
