import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";

const REVIEW_CONTRACT_ARTIFACT_URL = new URL("../../../packages/review-contract/src/abi.json", import.meta.url);
const REVIEW_CONTRACT_ABI = JSON.parse(readFileSync(REVIEW_CONTRACT_ARTIFACT_URL, "utf8")).abi;

function chainError(code) {
  return Object.assign(new Error(code), { code });
}

export async function createPeerReviewChain(config, {
  providerFactory = (url, chainId) => new JsonRpcProvider(url, chainId),
  walletFactory = (privateKey, provider) => new Wallet(privateKey, provider),
  contractFactory = (address, abi, signer) => new Contract(address, abi, signer),
  abi = REVIEW_CONTRACT_ABI,
} = {}) {
  if (!config || typeof config.rpcUrl !== "string" || typeof config.relayerPrivateKey !== "string"
      || !Number.isSafeInteger(config.chainId) || config.chainId < 1) {
    throw chainError("INVALID_PEER_REVIEW_CONFIGURATION");
  }
  let contractAddress;
  try {
    contractAddress = getAddress(config.contractAddress);
  } catch {
    throw chainError("INVALID_PEER_REVIEW_CONFIGURATION");
  }

  let provider;
  try {
    provider = providerFactory(config.rpcUrl, config.chainId);
    const network = await provider.getNetwork();
    if (BigInt(network.chainId) !== BigInt(config.chainId)) throw chainError("PEER_REVIEW_CHAIN_ID_MISMATCH");
    const bytecode = await provider.getCode(contractAddress);
    if (typeof bytecode !== "string" || !/^0x[0-9a-f]+$/i.test(bytecode) || /^0x0+$/i.test(bytecode)) {
      throw chainError("PEER_REVIEW_CONTRACT_NOT_DEPLOYED");
    }
    const wallet = walletFactory(config.relayerPrivateKey, provider);
    const contract = contractFactory(contractAddress, abi, wallet);
    const configuredRelayer = getAddress(await contract.reviewRelayer());
    const relayerAddress = getAddress(wallet.address);
    if (configuredRelayer !== relayerAddress) throw chainError("PEER_REVIEW_RELAYER_MISMATCH");

    let closed = false;
    return Object.freeze({
      provider,
      wallet,
      contract,
      contractAddress,
      relayerAddress,
      async close() {
        if (closed) return;
        closed = true;
        await provider.destroy?.();
      },
    });
  } catch (error) {
    try { await provider?.destroy?.(); } catch { /* Preserve the original connection error. */ }
    if (["PEER_REVIEW_CHAIN_ID_MISMATCH", "PEER_REVIEW_CONTRACT_NOT_DEPLOYED", "PEER_REVIEW_RELAYER_MISMATCH"].includes(error?.code)) {
      throw error;
    }
    throw chainError("PEER_REVIEW_CONNECTION_FAILED");
  }
}
