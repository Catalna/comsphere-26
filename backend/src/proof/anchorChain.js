import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";

const PROOF_ANCHOR_ARTIFACT_URL = new URL("../../../packages/review-contract/src/proof-anchor-abi.json", import.meta.url);
const PROOF_ANCHOR_ABI = JSON.parse(readFileSync(PROOF_ANCHOR_ARTIFACT_URL, "utf8")).abi;

function chainError(code) {
  return Object.assign(new Error(code), { code });
}

export async function createProofAnchorChain(config, {
  providerFactory = (url, chainId) => new JsonRpcProvider(url, chainId),
  walletFactory = (privateKey, provider) => new Wallet(privateKey, provider),
  contractFactory = (address, abi, signer) => new Contract(address, abi, signer),
  abi = PROOF_ANCHOR_ABI,
} = {}) {
  if (!config || typeof config.rpcUrl !== "string" || typeof config.relayerPrivateKey !== "string"
      || !Number.isSafeInteger(config.chainId) || config.chainId < 1) {
    throw chainError("INVALID_PROOF_ANCHOR_CONFIGURATION");
  }
  let contractAddress;
  try {
    contractAddress = getAddress(config.contractAddress);
  } catch {
    throw chainError("INVALID_PROOF_ANCHOR_CONFIGURATION");
  }

  let provider;
  try {
    provider = providerFactory(config.rpcUrl, config.chainId);
    const network = await provider.getNetwork();
    if (BigInt(network.chainId) !== BigInt(config.chainId)) throw chainError("PROOF_ANCHOR_CHAIN_ID_MISMATCH");
    const bytecode = await provider.getCode(contractAddress);
    if (typeof bytecode !== "string" || !/^0x[0-9a-f]+$/i.test(bytecode) || /^0x0+$/i.test(bytecode)) {
      throw chainError("PROOF_ANCHOR_CONTRACT_NOT_DEPLOYED");
    }
    const wallet = walletFactory(config.relayerPrivateKey, provider);
    const contract = contractFactory(contractAddress, abi, wallet);
    const configuredRelayer = getAddress(await contract.relayer());
    const relayerAddress = getAddress(wallet.address);
    if (configuredRelayer !== relayerAddress) throw chainError("PROOF_ANCHOR_RELAYER_MISMATCH");

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
    if (["PROOF_ANCHOR_CHAIN_ID_MISMATCH", "PROOF_ANCHOR_CONTRACT_NOT_DEPLOYED", "PROOF_ANCHOR_RELAYER_MISMATCH"].includes(error?.code)) {
      throw error;
    }
    throw chainError("PROOF_ANCHOR_CONNECTION_FAILED");
  }
}
