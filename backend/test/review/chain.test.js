import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "ethers";

import { createPeerReviewChain } from "../../src/review/chain.js";

const CONTRACT_ADDRESS = `0x${"c".repeat(40)}`;
const RELAYER_ADDRESS = `0x${"a".repeat(40)}`;
const CONFIG = {
  contractAddress: CONTRACT_ADDRESS,
  rpcUrl: "https://rpc.example.test",
  relayerPrivateKey: `0x${"1".repeat(64)}`,
  chainId: 11155111,
};

function dependencies({ chainId = CONFIG.chainId, code = "0x6001", relayerAddress = RELAYER_ADDRESS } = {}) {
  const state = { destroyed: false, providerArgs: null, walletArgs: null, contractArgs: null };
  const provider = {
    async getNetwork() { return { chainId: BigInt(chainId) }; },
    async getCode() { return code; },
    destroy() { state.destroyed = true; },
  };
  return {
    state,
    providerFactory: (...args) => { state.providerArgs = args; return provider; },
    walletFactory: (...args) => { state.walletArgs = args; return { address: RELAYER_ADDRESS }; },
    contractFactory: (...args) => {
      state.contractArgs = args;
      return { async reviewRelayer() { return relayerAddress; } };
    },
  };
}

test("chain adapter verifies Sepolia, deployed code, and the contract's configured relayer", async () => {
  const deps = dependencies();
  const chain = await createPeerReviewChain(CONFIG, deps);
  assert.equal(chain.contractAddress, getAddress(CONTRACT_ADDRESS));
  assert.equal(chain.relayerAddress, getAddress(RELAYER_ADDRESS));
  assert.equal(deps.state.providerArgs[0], CONFIG.rpcUrl);
  assert.equal(deps.state.providerArgs[1], CONFIG.chainId);
  assert.equal(deps.state.contractArgs[0], getAddress(CONTRACT_ADDRESS));
  assert.equal(Array.isArray(deps.state.contractArgs[1]), true);
  await chain.close();
  assert.equal(deps.state.destroyed, true);
});

test("chain adapter rejects wrong networks, missing bytecode, and relayer mismatch", async () => {
  await assert.rejects(createPeerReviewChain(CONFIG, dependencies({ chainId: 1 })), { code: "PEER_REVIEW_CHAIN_ID_MISMATCH" });
  await assert.rejects(createPeerReviewChain(CONFIG, dependencies({ code: "0x" })), { code: "PEER_REVIEW_CONTRACT_NOT_DEPLOYED" });
  await assert.rejects(createPeerReviewChain(CONFIG, dependencies({ relayerAddress: `0x${"b".repeat(40)}` })), { code: "PEER_REVIEW_RELAYER_MISMATCH" });
});
