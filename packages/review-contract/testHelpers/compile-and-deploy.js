import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { createLegacyTx } from "@ethereumjs/tx";
import { createAccount, createAddressFromPrivateKey, createAddressFromString, hexToBytes } from "@ethereumjs/util";
import { createVM, runTx } from "@ethereumjs/vm";
import { AbiCoder, Interface, Wallet, keccak256, toUtf8Bytes } from "ethers";
import solc from "solc";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = join(PACKAGE_ROOT, "contracts", "PeerReviewQuorum.sol");
const VM_CHAIN_ID = 31337;
const GAS_LIMIT = 15_000_000n;
const GAS_PRICE = 1_000_000_000n;

export const typedVote = {
  types: {
    Vote: [
      { name: "reviewId", type: "bytes32" },
      { name: "evidenceCommitment", type: "bytes32" },
      { name: "organizerOrganizationCommitment", type: "bytes32" },
      { name: "funderOrganizationCommitment", type: "bytes32" },
      { name: "round", type: "uint32" },
      { name: "decision", type: "uint8" },
      { name: "instructionCommitment", type: "bytes32" },
      { name: "noConflictAttested", type: "bool" },
    ],
  },
  message(values) {
    return {
      reviewId: values.reviewId,
      evidenceCommitment: values.evidenceCommitment,
      organizerOrganizationCommitment: values.organizerOrganizationCommitment ?? `0x${"aa".repeat(32)}`,
      funderOrganizationCommitment: values.funderOrganizationCommitment ?? `0x${"bb".repeat(32)}`,
      round: values.round,
      decision: values.decision,
      instructionCommitment: values.instructionCommitment,
      noConflictAttested: values.noConflictAttested,
    };
  },
};

export const rosterUpdateTypes = {
  RosterUpdate: [
    { name: "rosterHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "rosterVersion", type: "uint64" },
  ],
};

function resolveImport(sourceName) {
  const filePath = sourceName.startsWith("@openzeppelin/")
    ? resolve(PACKAGE_ROOT, "../..", "node_modules", sourceName)
    : resolve(dirname(CONTRACT_PATH), sourceName);
  try {
    return { contents: requireFile(filePath) };
  } catch (error) {
    return { error: `Unable to resolve Solidity import ${sourceName}: ${error.message}` };
  }
}

function requireFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function compileContract() {
  const source = readFileSync(CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: { "PeerReviewQuorum.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
  const artifact = output.contracts?.["PeerReviewQuorum.sol"]?.PeerReviewQuorum;
  if (!artifact?.evm?.bytecode?.object) throw new Error("PeerReviewQuorum contract bytecode is missing");
  return { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` };
}

function privateKeyFor(index) {
  return `0x${String(index + 1).padStart(64, "0")}`;
}

function rosterHash(verifiers, organizationCommitments) {
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["address[3]", "bytes32[3]"],
    [verifiers, organizationCommitments],
  ));
}

export async function compileAndDeploy() {
  const artifact = compileContract();
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Prague });
  const vm = await createVM({ common });
  const wallets = Array.from({ length: 8 }, (_, index) => new Wallet(privateKeyFor(index)));
  for (const wallet of wallets) {
    const key = hexToBytes(wallet.privateKey);
    await vm.stateManager.putAccount(
      createAddressFromPrivateKey(key),
      createAccount({ nonce: 0n, balance: 10n ** 22n }),
    );
  }
  const relayer = wallets[7];
  const verifierWallets = wallets.slice(0, 3);
  const verifierAddresses = verifierWallets.map((wallet) => wallet.address);
  const organizationCommitments = ["peer-org-1", "peer-org-2", "peer-org-3"].map((value) => keccak256(toUtf8Bytes(value)));
  const iface = new Interface(artifact.abi);

  async function sendTransaction(wallet, to, data) {
    const key = hexToBytes(wallet.privateKey);
    const from = createAddressFromPrivateKey(key);
    const account = await vm.stateManager.getAccount(from);
    const tx = createLegacyTx({
      nonce: account?.nonce ?? 0n,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      value: 0n,
      ...(to ? { to: createAddressFromString(to) } : {}),
      data: hexToBytes(data),
    }, { common }).sign(key);
    const result = await runTx(vm, { tx });
    if (Number(result.receipt.status) !== 1) {
      const reason = result.execResult.exceptionError?.error ?? "EVM_TRANSACTION_REVERTED";
      throw Object.assign(new Error(reason), { code: "EVM_TRANSACTION_REVERTED", result });
    }
    return {
      result,
      receipt: result.receipt,
      async wait() { return result.receipt; },
    };
  }

  async function deploy(options = {}) {
    const verifiers = options.verifiers ?? verifierAddresses;
    const orgs = options.organizationCommitments ?? organizationCommitments;
    const relayerAddress = options.relayer ?? relayer.address;
    const data = `${artifact.bytecode}${iface.encodeDeploy([verifiers, orgs, relayerAddress]).slice(2)}`;
    const result = await sendTransaction(relayer, null, data);
    const address = result.result.createdAddress?.toString();
    if (!address) throw new Error("Contract deployment did not return an address");
    return { address, contract: makeContract(address) };
  }

  async function readContract(address, functionName, args) {
    const data = hexToBytes(iface.encodeFunctionData(functionName, args));
    const result = await vm.evm.runCall({
      to: createAddressFromString(address),
      caller: createAddressFromString(relayer.address),
      origin: createAddressFromString(relayer.address),
      data,
      gasLimit: GAS_LIMIT,
    });
    if (result.execResult.exceptionError) throw new Error(result.execResult.exceptionError.error);
    return iface.decodeFunctionResult(functionName, `0x${Buffer.from(result.execResult.returnValue).toString("hex")}`);
  }

  function makeContract(address) {
    return {
      address,
      interface: iface,
      async openReview(...args) {
        return sendTransaction(relayer, address, iface.encodeFunctionData("openReview", args));
      },
      async submitVote(vote, signature) {
        return sendTransaction(relayer, address, iface.encodeFunctionData("submitVote", [vote, signature]));
      },
      async updateVerifierRoster(...args) {
        return sendTransaction(relayer, address, iface.encodeFunctionData("updateVerifierRoster", args));
      },
      async getReview(...args) { return readContract(address, "getReview", args); },
      async isVerifier(verifier) { return readContract(address, "isVerifier", [verifier]).then((result) => result[0]); },
      async getRosterNonce() { return readContract(address, "rosterNonce", []).then((result) => result[0]); },
    };
  }

  const deployment = await deploy();
  const domain = { name: "DanaTerang Peer Review", version: "1", chainId: Number(common.chainId()), verifyingContract: deployment.address };
  const newVerifierWallets = wallets.slice(3, 6);
  const newVerifiers = newVerifierWallets.map((wallet) => wallet.address);
  const newOrgs = ["peer-org-4", "peer-org-5", "peer-org-6"].map((value) => keccak256(toUtf8Bytes(value)));
  return {
    vm,
    common,
    domain,
    contract: deployment.contract,
    address: deployment.address,
    addresses: verifierAddresses,
    orgs: organizationCommitments,
    verifiers: verifierWallets,
    relayer,
    outsider: wallets[6],
    newAddresses: newVerifiers,
    newVerifiers,
    newOrgs,
    rosterUpdateTypes,
    rosterUpdateMessage(nextVerifiers, nextOrgs, nonce) {
      return { rosterHash: rosterHash(nextVerifiers, nextOrgs), nonce, rosterVersion: 1 };
    },
    async deploy(options) { return deploy(options); },
    async close() {},
  };
}
