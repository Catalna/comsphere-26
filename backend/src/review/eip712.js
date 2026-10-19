import { getAddress, keccak256, solidityPackedKeccak256, toUtf8Bytes } from "ethers";

export const REVIEW_DOMAIN_NAME = "DanaTerang Peer Review";
export const REVIEW_DOMAIN_VERSION = "1";

export const VOTE_TYPES = Object.freeze({
  Vote: Object.freeze([
    { name: "reviewId", type: "bytes32" },
    { name: "evidenceCommitment", type: "bytes32" },
    { name: "organizerOrganizationCommitment", type: "bytes32" },
    { name: "funderOrganizationCommitment", type: "bytes32" },
    { name: "round", type: "uint32" },
    { name: "decision", type: "uint8" },
    { name: "instructionCommitment", type: "bytes32" },
    { name: "noConflictAttested", type: "bool" },
  ]),
});

export const WALLET_BINDING_TYPES = Object.freeze({
  WalletBinding: Object.freeze([
    { name: "challengeId", type: "string" },
    { name: "verifierUserId", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "walletAddress", type: "address" },
    { name: "expiresAt", type: "uint64" },
  ]),
});

function domainWithAddress(domain) {
  if (!domain || !Number.isSafeInteger(Number(domain.chainId)) || Number(domain.chainId) < 1) {
    throw new TypeError("Invalid peer-review chain ID");
  }
  return {
    name: REVIEW_DOMAIN_NAME,
    version: REVIEW_DOMAIN_VERSION,
    chainId: Number(domain.chainId),
    verifyingContract: getAddress(domain.verifyingContract),
  };
}

export function createReviewDomain({ chainId, verifyingContract }) {
  return domainWithAddress({ chainId, verifyingContract });
}

export function buildVoteTypedData(domain, vote) {
  return {
    domain: domainWithAddress(domain),
    types: VOTE_TYPES,
    primaryType: "Vote",
    message: { ...vote },
  };
}

export function buildWalletBindingTypedData(domain, challenge) {
  return {
    domain: domainWithAddress(domain),
    types: WALLET_BINDING_TYPES,
    primaryType: "WalletBinding",
    message: {
      challengeId: challenge.challengeId,
      verifierUserId: challenge.verifierUserId,
      nonce: challenge.nonce,
      walletAddress: getAddress(challenge.walletAddress),
      expiresAt: Number(challenge.expiresAt),
    },
  };
}

export function computeOrganizerInstructionCommitment({ instructions, salt }) {
  const normalizedInstructions = typeof instructions === "string" ? instructions.trim() : "";
  const normalizedSalt = typeof salt === "string" && /^[0-9a-fA-F]{64}$/.test(salt)
    ? `0x${salt}`
    : salt;
  if (!normalizedInstructions || typeof normalizedSalt !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(normalizedSalt)) {
    throw new TypeError("Invalid Organizer instruction commitment input");
  }
  const instructionHash = keccak256(toUtf8Bytes(normalizedInstructions));
  return solidityPackedKeccak256(["bytes32", "bytes32"], [normalizedSalt, instructionHash]);
}
