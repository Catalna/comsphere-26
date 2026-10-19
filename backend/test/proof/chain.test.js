import assert from "node:assert/strict";
import test from "node:test";

import { createProofAnchorChain } from "../../src/proof/anchorChain.js";

const CONFIG = {
  contractAddress: `0x${"a".repeat(40)}`,
  rpcUrl: "https://rpc.example",
  relayerPrivateKey: `0x${"9".repeat(64)}`,
  chainId: 11155111,
};

function dependencies({ chainId = 11155111n, code = `0x${"60"}`, relayerAddress = `0x${"b".repeat(40)}`, contractRelayer = relayerAddress, providerFactory, walletFactory, contractFactory } = {}) {
  const provider = {
    async getNetwork() { return { chainId }; },
    async getCode() { return code; },
    async destroy() {},
  };
  const wallet = { address: relayerAddress };
  const contract = { async relayer() { return contractRelayer; } };
  return {
    providerFactory: providerFactory ?? (() => provider),
    walletFactory: walletFactory ?? (() => wallet),
    contractFactory: contractFactory ?? (() => contract),
  };
}

test("proof anchor chain rejects invalid, mismatched, undeployed, and wrong-relayer configuration", async () => {
  await assert.rejects(createProofAnchorChain({ ...CONFIG, chainId: 0 }), { code: "INVALID_PROOF_ANCHOR_CONFIGURATION" });
  await assert.rejects(createProofAnchorChain({ ...CONFIG, contractAddress: "0x1234" }), { code: "INVALID_PROOF_ANCHOR_CONFIGURATION" });
  await assert.rejects(createProofAnchorChain(CONFIG, dependencies({ chainId: 1n })), { code: "PROOF_ANCHOR_CHAIN_ID_MISMATCH" });
  await assert.rejects(createProofAnchorChain(CONFIG, dependencies({ code: "0x" })), { code: "PROOF_ANCHOR_CONTRACT_NOT_DEPLOYED" });
  await assert.rejects(
    createProofAnchorChain(CONFIG, dependencies({ relayerAddress: `0x${"b".repeat(40)}`, contractRelayer: `0x${"c".repeat(40)}` })),
    { code: "PROOF_ANCHOR_RELAYER_MISMATCH" },
  );
});

test("proof anchor chain exposes a validated contract bound to the configured relayer", async () => {
  const chain = await createProofAnchorChain(CONFIG, dependencies());
  assert.equal(chain.contractAddress.toLowerCase(), CONFIG.contractAddress.toLowerCase());
  assert.equal(chain.relayerAddress.toLowerCase(), `0x${"b".repeat(40)}`.toLowerCase());
  assert.equal(typeof chain.contract.relayer, "function");
  await chain.close();
});
