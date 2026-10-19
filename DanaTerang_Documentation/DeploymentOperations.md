# DanaTerang — Deployment and Operations

## 1. Recommended MVP Deployment

Frontend:

- Vercel

Backend:

- Railway
- Render
- Fly.io
- VPS

Database:

- PostgreSQL
- Supabase / Neon / managed Postgres

Storage:

- Cloudflare R2
- S3-compatible storage

Blockchain:

- Ethereum Sepolia Testnet
- Solidity contract accessed by backend ethers.js service
- Sepolia ETH for gas, paid by the backend service wallet

## 2. Environment Variables

Example:

```env
DATABASE_URL=
JWT_SECRET=
STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
PEER_REVIEW_CONTRACT_ADDRESS=
BLOCKCHAIN_RPC_URL=
BLOCKCHAIN_PRIVATE_KEY=
CONTRACT_ADDRESS=
BLOCKCHAIN_CHAIN_ID=11155111
BLOCKCHAIN_EXPLORER_URL=https://sepolia.etherscan.io
```

`PEER_REVIEW_CONTRACT_ADDRESS` identifies the deployed peer-quorum contract. At startup the API checks the configured chain ID, deployed code, and that `BLOCKCHAIN_PRIVATE_KEY` derives the contract's configured relayer address. `BLOCKCHAIN_PRIVATE_KEY` is the backend service-wallet relayer, not a Verifier key. Keep it server-side, fund it only with Sepolia ETH, and never commit `.env`. The initial three Verifier addresses and Organization commitments are fixed constructor inputs at deployment. Assigned Verifiers hold separate organization-controlled signing wallets; Organizers and Funders do not connect wallets to submit evidence or view proof.

## 3. Monitoring

Monitor:

- API errors,
- failed uploads,
- OCR failures,
- wallet binding failures and peer-vote receipt reconciliation,
- `WAITING_FOR_CHAIN` review-round age and roster mismatches,
- blockchain failures,
- transaction confirmation,
- Sepolia RPC availability and explorer transaction visibility,
- database availability.

## 4. Retry Strategy

Blockchain transactions should support:

- pending state,
- retry,
- failed state,
- idempotent anchoring.

If blockchain is unavailable:

- application data remains valid,
- proof status becomes pending,
- retry later.

For the Phase 1 demo, show proof as `ANCHORED` only after a successful Sepolia transaction receipt includes a block number; provide the transaction hash and Sepolia Etherscan link. A real-world pilot may require a stronger confirmation/finality policy. If OCR fails, show processing/failure rather than `CLEAR`; retain the uploaded file and its version history for authorized review or retry.

## 5. Backups

PostgreSQL:

- automated backups,
- restore test.

Object storage:

- retention policy,
- versioning if available.

## 6. Production Improvements

Later:

- job queue,
- worker service,
- centralized logging,
- metrics,
- alerting,
- secrets manager,
- WAF,
- rate limiting.

Before a real-user pilot, review organization access, verifier authority/conflict handling, privacy and retention/deletion, incident response, backup restoration, signer-key management, user support, and operational ownership. Production-scale onboarding and service-level guarantees are outside the hackathon demo.
