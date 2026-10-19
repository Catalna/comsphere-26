import assert from "node:assert/strict";
import test from "node:test";

import { readProofAnchorConfig } from "../../src/proof/config.js";

const PRIVATE_KEY = `0x${"9".repeat(64)}`;
const ADDRESS = `0x${"a".repeat(40)}`;

test("proof anchoring is disabled when the contract address is absent", () => {
  assert.equal(readProofAnchorConfig({}), null);
  assert.equal(readProofAnchorConfig({ PROOF_ANCHOR_CONTRACT_ADDRESS: "" }), null);
});

test("proof anchoring requires the shared relayer settings when the address is set", () => {
  assert.throws(() => readProofAnchorConfig({ PROOF_ANCHOR_CONTRACT_ADDRESS: ADDRESS }), { code: "INVALID_PROOF_ANCHOR_CONFIGURATION" });
  assert.throws(() => readProofAnchorConfig({
    PROOF_ANCHOR_CONTRACT_ADDRESS: ADDRESS,
    BLOCKCHAIN_RPC_URL: "ftp://invalid.example",
    BLOCKCHAIN_PRIVATE_KEY: PRIVATE_KEY,
  }), { code: "INVALID_PROOF_ANCHOR_CONFIGURATION" });
  assert.throws(() => readProofAnchorConfig({
    PROOF_ANCHOR_CONTRACT_ADDRESS: "0x1234",
    BLOCKCHAIN_RPC_URL: "https://rpc.example",
    BLOCKCHAIN_PRIVATE_KEY: PRIVATE_KEY,
  }), { code: "INVALID_PROOF_ANCHOR_CONFIGURATION" });

  const config = readProofAnchorConfig({
    PROOF_ANCHOR_CONTRACT_ADDRESS: ADDRESS,
    BLOCKCHAIN_RPC_URL: "https://rpc.example",
    BLOCKCHAIN_PRIVATE_KEY: PRIVATE_KEY,
    BLOCKCHAIN_CHAIN_ID: "11155111",
  });
  assert.equal(config.contractAddress.toLowerCase(), ADDRESS.toLowerCase());
  assert.equal(config.chainId, 11155111);
});
