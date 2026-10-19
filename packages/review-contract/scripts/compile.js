import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const OUTPUT_DIRECTORY = join(PACKAGE_ROOT, "src");

const CONTRACTS = [
  { source: "PeerReviewQuorum.sol", contractName: "PeerReviewQuorum", outputPath: join(OUTPUT_DIRECTORY, "abi.json") },
  { source: "ProofAnchor.sol", contractName: "ProofAnchor", outputPath: join(OUTPUT_DIRECTORY, "proof-anchor-abi.json") },
];

function resolveImport(sourceName) {
  const filePath = sourceName.startsWith("@openzeppelin/")
    ? resolve(REPOSITORY_ROOT, "node_modules", sourceName)
    : resolve(join(PACKAGE_ROOT, "contracts"), sourceName);
  try {
    return { contents: requireFile(filePath) };
  } catch {
    return { error: `Unable to resolve Solidity import ${sourceName}` };
  }
}

function requireFile(filePath) {
  return readFileSync(filePath, "utf8");
}

async function compileContract({ source, contractName, outputPath }) {
  const sourceCode = await readFile(join(PACKAGE_ROOT, "contracts", source), "utf8");
  const input = {
    language: "Solidity",
    sources: { [source]: { content: sourceCode } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
  const contract = output.contracts?.[source]?.[contractName];
  if (!contract?.evm?.bytecode?.object) throw new Error(`${contractName} compilation produced no bytecode`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ contractName, abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` }, null, 2)}\n`);
  process.stdout.write(`${contractName} compiled successfully.\n`);
}

async function main() {
  for (const contract of CONTRACTS) {
    await compileContract(contract);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
