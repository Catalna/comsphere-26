# DanaTerang

DanaTerang is an evidence-first accountability platform for funded programs. The local workflow supports authentication and roles, organization-scoped campaigns/milestones, private evidence upload with exact-byte SHA-256, Indonesian/English OCR with advisory screening, and version-specific peer review through a permissioned 2-of-3 Verifier quorum. The Solidity contract and API support local deterministic testing; live Sepolia deployment, dynamic public audit, and pilot operations remain separate rollout steps.

## Development

Requirements: Node.js 20.19+ and npm 10+.

For local database-backed work, install PostgreSQL 16+ natively on Windows and follow `database/README.md`. This project does not require Docker.

The local database starts empty. Follow `database/README.md` to apply migrations and provision the first Admin using a password you choose before attempting Admin-only publication or governance actions.

Install browser-test prerequisites once before running the full workspace suite:

```sh
python -m pip install -r frontend/requirements-test.txt
python -m playwright install chromium
```

```sh
npm install
npm test
npm run dev:api
npm run dev:web
```

The `packages/proof` workspace implements canonical proof schemas 1 (legacy) and 2 (peer-quorum bound) plus raw-file hashing. `packages/domain` validates independent workflow status machines. `backend/` contains the Express API, private storage adapters, and local OCR worker; `frontend/` contains the Next.js app; and `database/migrations/` contains PostgreSQL migrations. Copy `backend/.env.example` and `frontend/.env.example` to local `.env` files and fill only the settings needed for the service you run. Follow `database/README.md` to provision local OCR language data and run the synthetic receipt smoke test. The public audit page shows only campaigns explicitly published by an Admin; unpublished campaigns remain private.

## Peer review

Each evidence version is assigned to three Verifiers from independent Organizations. Verifiers bind organization-controlled wallets with one-time typed-data challenges and sign votes locally; the backend relays signatures but cannot choose a result. Two matching decisions finalize on the contract. If quorum is not reached, verification remains pending without an Admin override. Admin review operations expose identifiers, status, counts, and timestamps only; source files and full OCR are limited to assigned Verifiers, while Funders see status only and Organizers see final instructions for their own revisions.

To enable the API's Sepolia integration, set `PEER_REVIEW_CONTRACT_ADDRESS`, `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`, and `BLOCKCHAIN_CHAIN_ID` in an untracked backend `.env` or secret store. Startup checks the configured chain, deployed contract, and relayer identity. Never use a real Verifier key in the service; Verifier keys stay in their wallets. The initial three wallet addresses and Organization commitments are fixed at contract deployment and are not selected by the Admin UI.
