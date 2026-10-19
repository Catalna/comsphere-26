import assert from "node:assert/strict";
import test from "node:test";

import { compileAndDeployAnchor } from "../testHelpers/compile-and-deploy-anchor.js";

const ZERO = `0x${"00".repeat(32)}`;

test("constructor rejects a zero relayer address", async () => {
  const chain = await compileAndDeployAnchor();
  try {
    await assert.rejects(chain.deploy(ZERO));
  } finally {
    await chain.close();
  }
});

test("only the configured relayer may anchor a proof commitment", async () => {
  const chain = await compileAndDeployAnchor();
  try {
    await assert.rejects(
      chain.contract.anchorProofFrom(chain.outsider, chain.proofId, chain.commitment),
      { code: "EVM_TRANSACTION_REVERTED" },
    );
    const anchored = await chain.contract.anchorProof(chain.proofId, chain.commitment);
    await anchored.wait();
  } finally {
    await chain.close();
  }
});

test("anchorProof stores the commitment, emits the event, and rejects invalid inputs", async () => {
  const chain = await compileAndDeployAnchor();
  try {
    await assert.rejects(chain.contract.anchorProof(ZERO, chain.commitment));
    await assert.rejects(chain.contract.anchorProof(chain.proofId, ZERO));
    const anchored = await chain.contract.anchorProof(chain.proofId, chain.commitment);
    await anchored.wait();
    const stored = await chain.contract.proofCommitments(chain.proofId);
    assert.equal(stored, chain.commitment);
  } finally {
    await chain.close();
  }
});

test("re-anchoring the same proofId reverts even with a different commitment", async () => {
  const chain = await compileAndDeployAnchor();
  try {
    const first = await chain.contract.anchorProof(chain.proofId, chain.commitment);
    await first.wait();
    await assert.rejects(chain.contract.anchorProof(chain.proofId, chain.otherProofId === chain.proofId ? ZERO : chain.otherProofId));
    const stored = await chain.contract.proofCommitments(chain.proofId);
    assert.equal(stored, chain.commitment);
  } finally {
    await chain.close();
  }
});

test("different proofIds anchor independently and no admin path exists", async () => {
  const chain = await compileAndDeployAnchor();
  try {
    const first = await chain.contract.anchorProof(chain.proofId, chain.commitment);
    await first.wait();
    const secondCommitment = `0x${"ff".repeat(32)}`;
    const second = await chain.contract.anchorProof(chain.otherProofId, secondCommitment);
    await second.wait();
    assert.equal(await chain.contract.proofCommitments(chain.proofId), chain.commitment);
    assert.equal(await chain.contract.proofCommitments(chain.otherProofId), secondCommitment);
    const iface = chain.contract.interface;
    const names = iface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    assert.deepEqual(names.sort(), ["anchorProof", "proofCommitments", "relayer"]);
  } finally {
    await chain.close();
  }
});
