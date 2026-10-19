import { getAddress } from "ethers";

function configurationError() {
  return Object.assign(new Error("Invalid peer-review configuration"), { code: "INVALID_PEER_REVIEW_CONFIGURATION" });
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readPeerReviewConfig(env = process.env) {
  const contractValue = nonEmpty(env.PEER_REVIEW_CONTRACT_ADDRESS);
  // No contract address means the on-chain relay is disabled (for example while
  // the deployment is still pending); provided-but-broken settings still fail loudly.
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
