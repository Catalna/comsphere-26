// Deploys PeerReviewQuorum and ProofAnchor to an EVM network (target: Sepolia).
//
// Usage:
//   node scripts/deploy.js \
//     --rpc-url https://eth-sepolia.g.alchemy.com/v2/<key> \
//     --private-key 0x<deployer/relayer key> \
//     --verifiers 0xAAA...,0xBBB...,0xCCC... \
//     --organization-ids <uuid1>,<uuid2>,<uuid3>
//
// Organization commitments are computed exactly like the backend
// (sha256("danaterang:organization:v1:<organization-uuid>")) so the on-chain
// roster matches runtime conflict checks. --organization-commitments accepts
// raw 0x-hex commitments instead if you need to override the formula.
// The deployer key pays gas and is also the contracts' relayer unless --relayer
// is given. The printed addresses go into backend/.env
// (PEER_REVIEW_CONTRACT_ADDRESS, PROOF_ANCHOR_CONTRACT_ADDRESS).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ContractFactory, JsonRpcProvider, Wallet, getAddress, isHexString } from "ethers";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PEER_REVIEW_ARTIFACT = JSON.parse(readFileSync(join(PACKAGE_ROOT, "src", "abi.json"), "utf8"));
const PROOF_ANCHOR_ARTIFACT = JSON.parse(readFileSync(join(PACKAGE_ROOT, "src", "proof-anchor-abi.json"), "utf8"));
const SEPOLIA_CHAIN_ID = 11155111n;

function fail(message) {
  process.stderr.write(`Deploy failed: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    rpcUrl: process.env.DEPLOY_RPC_URL ?? null,
    privateKey: process.env.DEPLOY_PRIVATE_KEY ?? null,
    relayer: null,
    verifiers: [],
    organizationIds: [],
    organizationCommitments: [],
    allowAnyChain: false,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--rpc-url") options.rpcUrl = value;
    else if (key === "--private-key") options.privateKey = value;
    else if (key === "--relayer") options.relayer = value;
    else if (key === "--verifiers") options.verifiers = value.split(",").map((entry) => entry.trim());
    else if (key === "--organization-ids") options.organizationIds = value.split(",").map((entry) => entry.trim());
    else if (key === "--organization-commitments") options.organizationCommitments = value.split(",").map((entry) => entry.trim());
    else if (key === "--allow-any-chain") { options.allowAnyChain = true; index -= 1; }
    else fail(`Unknown argument ${key}`);
  }
  return options;
}

function organizationCommitment(organizationId) {
  return `0x${createHash("sha256").update(`danaterang:organization:v1:${organizationId}`).digest("hex")}`;
}

function parseAddress(value, label) {
  try {
    const address = getAddress(value);
    if (address === getAddress("0x0000000000000000000000000000000000000000")) fail(`${label} must not be the zero address`);
    return address;
  } catch {
    return fail(`${label} is not a valid address: ${value}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.rpcUrl || !options.privateKey) fail("Missing --rpc-url or --private-key");
  if (options.verifiers.length !== 3) fail("--verifiers needs exactly three comma-separated addresses");
  if (options.organizationIds.length === 0 && options.organizationCommitments.length === 0) {
    fail("Provide --organization-ids (preferred; matches backend hashing) or --organization-commitments");
  }
  if (options.organizationIds.length > 0 && options.organizationIds.length !== 3) {
    fail("--organization-ids needs exactly three values");
  }
  if (options.organizationCommitments.length > 0 && options.organizationCommitments.length !== 3) {
    fail("--organization-commitments needs exactly three values");
  }

  const verifiers = options.verifiers.map((value, index) => parseAddress(value, `Verifier #${index + 1}`));
  if (new Set(verifiers.map((value) => value.toLowerCase())).size !== 3) fail("Verifier addresses must be distinct");

  let commitments = options.organizationCommitments;
  if (options.organizationIds.length === 3) {
    commitments = options.organizationIds.map((value) => {
      if (!/^[0-9a-fA-F-]{36}$/.test(value)) fail(`Organization ID is not a UUID: ${value}`);
      return organizationCommitment(value);
    });
  } else {
    commitments = commitments.map((value) => {
      if (!isHexString(value, 32)) fail(`Organization commitment is not 32 bytes of hex: ${value}`);
      return value.toLowerCase();
    });
  }
  if (new Set(commitments).size !== 3) fail("Organization commitments must be distinct");

  const provider = new JsonRpcProvider(options.rpcUrl);
  const network = await provider.getNetwork();
  process.stdout.write(`Connected to chain ${network.chainId}\n`);
  if (network.chainId !== SEPOLIA_CHAIN_ID && !options.allowAnyChain) {
    fail(`Expected Sepolia (chain ${SEPOLIA_CHAIN_ID}); use --allow-any-chain to override`);
  }

  const deployer = new Wallet(options.privateKey, provider);
  const relayer = options.relayer ? parseAddress(options.relayer, "Relayer") : deployer.address;
  const balance = await provider.getBalance(deployer.address);
  process.stdout.write(`Deployer ${deployer.address} balance ${Number(balance) / 1e18} ETH\n`);
  if (balance === 0n) fail("Deployer has no gas funds; request Sepolia ETH from a faucet first");

  const peerReview = await new ContractFactory(PEER_REVIEW_ARTIFACT.abi, PEER_REVIEW_ARTIFACT.bytecode, deployer)
    .deploy(verifiers, commitments, relayer);
  process.stdout.write(`PeerReviewQuorum deploying: ${peerReview.deploymentTransaction()?.hash}\n`);
  await peerReview.waitForDeployment();

  const proofAnchor = await new ContractFactory(PROOF_ANCHOR_ARTIFACT.abi, PROOF_ANCHOR_ARTIFACT.bytecode, deployer)
    .deploy(relayer);
  process.stdout.write(`ProofAnchor deploying: ${proofAnchor.deploymentTransaction()?.hash}\n`);
  await proofAnchor.waitForDeployment();

  const peerReviewAddress = await peerReview.getAddress();
  const proofAnchorAddress = await proofAnchor.getAddress();
  process.stdout.write("\nDeployment complete. Add these to backend/.env:\n\n");
  process.stdout.write(`PEER_REVIEW_CONTRACT_ADDRESS=${peerReviewAddress.toLowerCase()}\n`);
  process.stdout.write(`PROOF_ANCHOR_CONTRACT_ADDRESS=${proofAnchorAddress.toLowerCase()}\n\n`);
  process.stdout.write(`Relayer: ${relayer.toLowerCase()}\n`);
  process.stdout.write("Then restart the API; startup validates chain id, deployed bytecode, and relayer identity.\n");
}

main().catch((error) => fail(error?.message ?? String(error)));
