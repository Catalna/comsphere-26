import { getAddress } from "ethers";

function configurationError() {
  return Object.assign(new Error("Invalid proof-anchor configuration"), { code: "INVALID_PROOF_ANCHOR_CONFIGURATION" });
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readProofAnchorConfig(env = process.env) {
  const contractValue = nonEmpty(env.PROOF_ANCHOR_CONTRACT_ADDRESS);
  if (contractValue === null) return null;

  const rpcUrl = nonEmpty(env.BLOCKCHAIN_RPC_URL);
  const relayerPrivateKey = nonEmpty(env.BLOCKCHAIN_PRIVATE_KEY);
  if (!rpcUrl || !relayerPrivateKey) throw configurationError();

  let contractAddress;
  let parsedUrl;
  try {
    contractAddress = getAddress(contractValue);
    parsedUrl = new URL(rpcUrl);
  } catch {
    throw configurationError();
  }
  if (!new Set(["http:", "https:"]).has(parsedUrl.protocol) || !parsedUrl.hostname
      || !/^0x[0-9a-fA-F]{64}$/.test(relayerPrivateKey)) {
    throw configurationError();
  }

  const chainId = Number(env.BLOCKCHAIN_CHAIN_ID ?? "11155111");
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw configurationError();
  return Object.freeze({ contractAddress, rpcUrl, relayerPrivateKey, chainId });
}
