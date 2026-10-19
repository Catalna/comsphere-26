import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "ethers";

import { readPeerReviewConfig } from "../../src/review/config.js";

const VALID_ENV = {
  PEER_REVIEW_CONTRACT_ADDRESS: `0x${"c".repeat(40)}`,
  BLOCKCHAIN_RPC_URL: "https://rpc.example.test",
  BLOCKCHAIN_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  BLOCKCHAIN_CHAIN_ID: "11155111",
};

test("peer-review integration is disabled when no chain settings are provided", () => {
  assert.equal(readPeerReviewConfig({}), null);
});

test("peer-review config requires the contract, RPC endpoint and relayer key together", () => {
  for (const env of [
    { PEER_REVIEW_CONTRACT_ADDRESS: VALID_ENV.PEER_REVIEW_CONTRACT_ADDRESS },
  ]) {
    assert.throws(() => readPeerReviewConfig(env), { code: "INVALID_PEER_REVIEW_CONFIGURATION" });
  }
});

test("peer-review integration is disabled while the contract address is absent", () => {
  assert.equal(readPeerReviewConfig({ ...VALID_ENV, PEER_REVIEW_CONTRACT_ADDRESS: "" }), null);
  assert.equal(readPeerReviewConfig({ ...VALID_ENV, PEER_REVIEW_CONTRACT_ADDRESS: "  " }), null);
});

test("peer-review config validates and normalizes the contract and chain settings", () => {
  const config = readPeerReviewConfig(VALID_ENV);
  assert.equal(config.contractAddress, getAddress(VALID_ENV.PEER_REVIEW_CONTRACT_ADDRESS));
  assert.equal(config.rpcUrl, VALID_ENV.BLOCKCHAIN_RPC_URL);
  assert.equal(config.chainId, 11155111);
  assert.equal(config.relayerPrivateKey, VALID_ENV.BLOCKCHAIN_PRIVATE_KEY);
});

test("peer-review config rejects unsupported URLs, malformed keys, and invalid chain IDs", () => {
  for (const env of [
    { ...VALID_ENV, BLOCKCHAIN_RPC_URL: "ftp://rpc.example.test" },
    { ...VALID_ENV, BLOCKCHAIN_RPC_URL: "not a URL" },
    { ...VALID_ENV, BLOCKCHAIN_PRIVATE_KEY: "secret" },
    { ...VALID_ENV, BLOCKCHAIN_CHAIN_ID: "0" },
    { ...VALID_ENV, PEER_REVIEW_CONTRACT_ADDRESS: "0xinvalid" },
  ]) {
    assert.throws(() => readPeerReviewConfig(env), { code: "INVALID_PEER_REVIEW_CONFIGURATION" });
  }
});
