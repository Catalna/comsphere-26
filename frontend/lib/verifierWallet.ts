export type TypedData = {
  domain: { chainId: number; verifyingContract: string; name: string; version: string };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

type EthereumProvider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function ethereumProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw Object.assign(new Error("wallet_not_available"), { code: "wallet_not_available" });
  }
  return window.ethereum;
}

const SEPOLIA_CHAIN_ID = "0xaa36a7";

/**
 * Chain the review contract is deployed on. Defaults to Ethereum Sepolia; local
 * and test deployments configure a different chain through the environment so
 * the wallet check matches the contract the backend actually uses.
 */
function expectedChainId() {
  const configured = process.env.NEXT_PUBLIC_REVIEW_CHAIN_ID;
  if (typeof configured === "string" && /^0x[0-9a-f]+$/i.test(configured)) return configured.toLowerCase();
  if (typeof configured === "string" && /^\d+$/.test(configured)) return `0x${BigInt(configured).toString(16)}`;
  return SEPOLIA_CHAIN_ID;
}

const EXPECTED_CHAIN_ID = expectedChainId();
const EXPECTED_NETWORK = {
  chainId: EXPECTED_CHAIN_ID,
  chainName: EXPECTED_CHAIN_ID === SEPOLIA_CHAIN_ID ? "Sepolia" : "DanaTerang Review Network",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

export async function ensureSepoliaNetwork() {
  const provider = ethereumProvider();
  const current = await provider.request({ method: "eth_chainId" });
  if (String(current).toLowerCase() === EXPECTED_CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: EXPECTED_CHAIN_ID }] });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? Number((error as { code: unknown }).code) : 0;
    if (code === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [EXPECTED_NETWORK] });
      return;
    }
    if (code === 4001) {
      throw Object.assign(new Error("wallet_wrong_network"), { code: "wallet_wrong_network" });
    }
    throw Object.assign(new Error("wallet_network_unknown"), { code: "wallet_network_unknown" });
  }
  const switched = await provider.request({ method: "eth_chainId" });
  if (String(switched).toLowerCase() !== EXPECTED_CHAIN_ID) {
    throw Object.assign(new Error("wallet_wrong_network"), { code: "wallet_wrong_network" });
  }
}

export async function requestVerifierAddress() {
  await ensureSepoliaNetwork();
  const provider = ethereumProvider();
  const result = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(result) || typeof result[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(result[0])) {
    throw Object.assign(new Error("wallet_account_unavailable"), { code: "wallet_account_unavailable" });
  }
  return result[0];
}

export async function signTypedData(address: string, typedData: TypedData) {
  await ensureSepoliaNetwork();
  const provider = ethereumProvider();
  const chainResult = await provider.request({ method: "eth_chainId" });
  let chainId: bigint;
  try {
    chainId = BigInt(String(chainResult));
  } catch {
    throw Object.assign(new Error("wallet_network_unknown"), { code: "wallet_network_unknown" });
  }
  if (chainId !== BigInt(typedData.domain.chainId)) {
    throw Object.assign(new Error("wallet_wrong_network"), { code: "wallet_wrong_network" });
  }
  const metamaskTypedData: TypedData = {
    ...typedData,
    types: {
      ...typedData.types,
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  };
  const signature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [address, JSON.stringify(metamaskTypedData)],
  });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw Object.assign(new Error("wallet_signature_invalid"), { code: "wallet_signature_invalid" });
  }
  return signature;
}

export function walletMessage(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "wallet_not_available") return "Dompet verifier tidak ditemukan. Buka halaman ini di browser dengan wallet organisasi.";
  if (code === "wallet_wrong_network") return "Pilih jaringan yang sama dengan kontrak review sebelum menandatangani.";
  if (code === "4001") return "Permintaan tanda tangan dibatalkan. Tidak ada vote yang dikirim.";
  if (code === "wallet_account_unavailable") return "Wallet tidak memberikan alamat akun yang valid.";
  if (code === "wallet_signature_invalid") return "Wallet tidak menghasilkan tanda tangan yang valid.";
  if (code === "wallet_account_changed") return "Akun MetaMask yang aktif bukan wallet yang terbind dengan akun ini. Ganti ke akun MetaMask sesuai wallet terbind lalu coba lagi.";
  if (code === "-32002") return "MetaMask masih menampung permintaan tanda tangan lama. Buka MetaMask, selesaikan atau tolak permintaan yang tertunda, lalu coba lagi.";
  if (code === "wallet_network_unknown") return "MetaMask belum menyiapkan jaringan. Buka MetaMask, pilih jaringan Sepolia, lalu coba lagi.";
  return "Wallet belum dapat digunakan. Periksa koneksi lalu coba lagi.";
}
