export type ProofStatus = "PENDING" | "ANCHORING" | "ANCHORED" | "FAILED";

export type Proof = {
  proofId: string;
  proofVersion: number;
  status: ProofStatus;
  evidenceId: string;
  campaignId: string;
  milestoneId: string;
  packageHash: string;
  contractAddress: string | null;
  transactionHash: string | null;
  blockNumber: number | null;
  attempts: number;
  lastErrorCode: string | null;
  createdAt: string;
  anchoredAt: string | null;
  updatedAt: string;
};

/** Chain metadata the UI shows. Must match the deployment used by the backend. */
export const CHAIN = {
  name: "Ethereum Sepolia Testnet",
  explorerUrl: (process.env.NEXT_PUBLIC_BLOCKCHAIN_EXPLORER_URL ?? "https://sepolia.etherscan.io").replace(/\/$/, ""),
} as const;

export function explorerTxUrl(transactionHash: string): string {
  return `${CHAIN.explorerUrl}/tx/${transactionHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${CHAIN.explorerUrl}/address/${address}`;
}

export function proofStatusLabel(status: ProofStatus): string {
  if (status === "ANCHORED") return "Tercatat di Sepolia";
  if (status === "ANCHORING") return "Sedang dicatat ke jaringan";
  if (status === "PENDING") return "Menunggu dicatat ke jaringan";
  return "Gagal tercatat di jaringan";
}
