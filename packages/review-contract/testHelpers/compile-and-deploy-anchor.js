import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Interface, keccak256, toUtf8Bytes, Wallet } from "ethers";
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { createAddressFromPrivateKey, createAddressFromString, createAccount, hexToBytes } from "@ethereumjs/util";
import { createLegacyTx } from "@ethereumjs/tx";
import { createVM, runTx } from "@ethereumjs/vm";
import solc from "solc";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const CONTRACT_PATH = join(PACKAGE_ROOT, "contracts", "ProofAnchor.sol");
const GAS_LIMIT = 5_000_000n;
const GAS_PRICE = 1_000_000_000n;

function resolveImport(sourceName) {
  const filePath = sourceName.startsWith("@openzeppelin/")
    ? resolve(REPOSITORY_ROOT, "node_modules", sourceName)
    : resolve(dirname(CONTRACT_PATH), sourceName);
  try {
    return { contents: readFileSync(filePath, "utf8") };
  } catch {
    return { error: `Unable to resolve Solidity import ${sourceName}: ${filePath}` };
  }
}

function compileContract() {
  const source = readFileSync(CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: { "ProofAnchor.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
  const artifact = output.contracts?.["ProofAnchor.sol"]?.ProofAnchor;
  if (!artifact?.evm?.bytecode?.object) throw new Error("ProofAnchor contract bytecode is missing");
  return { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` };
}

function privateKeyFor(index) {
  return `0x${String(index + 1).padStart(64, "0")}`;
}

export async function compileAndDeployAnchor() {
  const artifact = compileContract();
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Prague });
  const vm = await createVM({ common });
  const wallets = Array.from({ length: 3 }, (_, index) => new Wallet(privateKeyFor(index)));
  for (const wallet of wallets) {
    await vm.stateManager.putAccount(
      createAddressFromPrivateKey(hexToBytes(wallet.privateKey)),
      createAccount({ nonce: 0n, balance: 10n ** 22n }),
    );
  }
  const relayer = wallets[0];
  const outsider = wallets[1];
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
    return { result, receipt: result.receipt, async wait() { return result.receipt; } };
  }

  async function deploy(relayerAddress = relayer.address) {
    const data = `${artifact.bytecode}${iface.encodeDeploy([relayerAddress]).slice(2)}`;
    const result = await sendTransaction(relayer, null, data);
    const address = result.result.createdAddress?.toString();
    if (!address) throw new Error("ProofAnchor deployment did not return an address");
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
      async anchorProof(...args) {
        return sendTransaction(relayer, address, iface.encodeFunctionData("anchorProof", args));
      },
      async anchorProofFrom(wallet, ...args) {
        return sendTransaction(wallet, address, iface.encodeFunctionData("anchorProof", args));
      },
      async proofCommitments(...args) {
        return readContract(address, "proofCommitments", args).then((result) => result[0]);
      },
      async relayerAddress() {
        return readContract(address, "relayer", []).then((result) => result[0]);
      },
    };
  }

  const deployment = await deploy();
  return {
    vm,
    common,
    contract: deployment.contract,
    address: deployment.address,
    relayer,
    outsider,
    proofId: keccak256(toUtf8Bytes("proof-1")),
    otherProofId: keccak256(toUtf8Bytes("proof-2")),
    commitment: keccak256(toUtf8Bytes("canonical-package-1")),
    async deploy(options) { return deploy(options); },
    async close() {},
  };
}
