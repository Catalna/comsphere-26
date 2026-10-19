# DanaTerang Blockchain Sepolia Go-Live Implementation Plan

> **For agentic workers:** Use `executing-plans` and TDD to implement this approved plan inline on `main`. Do not commit keys; never place Verifier private keys on the server.

**Goal:** Take the already-implemented blockchain layer (PeerReviewQuorum + ProofAnchor, backend relayer, receipt persistence) from locally-tested to live on Sepolia, because this is a competition requirement.

**Why:** The on-chain layer makes decisions and evidence tamper-evident: a locked three-Verifier roster, 2-of-3 signed vote finalization without Admin override, and immutable SHA-256 commitments of canonical proof packages.

**Tech Stack:** Solidity 0.8.37 + OpenZeppelin 5.4, solc-js, ethers.js 6.17 deployer/relayer, Alchemy Sepolia RPC, Etherscan explorer.

---

## Current state (done before this plan)

- Contracts implemented and green in in-process EVM tests (12/12): roster validation, EIP-712 votes, 2-of-3 finality, NO_QUORUM, peer-quorum roster update; ProofAnchor relayer-only anchoring with duplicate rejection.
- Backend: chain adapters with startup validation (chain id, bytecode, relayer identity), quorum service with relayer, proof anchoring service with idempotent retries, `proofs` table receipts.
- Local `.env` holds the user's Alchemy Sepolia RPC URL (verified: responds with chain 11155111).

## Tasks

- [x] Deploy script `packages/review-contract/scripts/deploy.js` + npm script `deploy`: validates arguments, computes organization commitments with the backend formula (`sha256("danaterang:organization:v1:<uuid>")`), connects to Sepolia, checks deployer balance, deploys `PeerReviewQuorum(verifiers, commitments, relayer)` and `ProofAnchor(relayer)`, prints `.env` lines.
- [x] Smoke-tested against the user's RPC up to the funding gate (correct chain, balance check, clear faucet error).
- [ ] User provides a dedicated relayer wallet with faucet Sepolia ETH; paste key into `backend/.env` `BLOCKCHAIN_PRIVATE_KEY`.
- [ ] Run the deploy with three Verifier wallet addresses and their organization UUIDs; record both contract addresses into `backend/.env`.
- [ ] Restart the API and confirm startup logs pass the chain/contract/relayer validation; exercise one full on-chain round in the running app (bind verifier wallet, open round, submit votes, quorum, proof ANCHORED).
- [ ] Minimal proof UI for the demo: Admin proofs list + retry, Organizer/Funder proof status panel (backend endpoints already exist).
- [ ] Blockchain README section + demo script for judges (what to show, Etherscan links).

## Security invariants (non-negotiable)

- The relayer key lives only in the untracked `backend/.env`; it pays gas and relays signatures but can never choose an outcome.
- Verifier keys stay in their owners' wallets (MetaMask or generated for demo); the server only ever receives signatures, never keys.
- Roster and organization commitments are fixed at deployment; changes require 2-of-3 peer signatures on-chain.
