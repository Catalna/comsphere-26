import assert from "node:assert/strict";
import test from "node:test";

import { compileAndDeploy, typedVote } from "../testHelpers/compile-and-deploy.js";

const ZERO = `0x${"00".repeat(32)}`;
const REVIEW_ID = `0x${"11".repeat(32)}`;
const EVIDENCE_COMMITMENT = `0x${"22".repeat(32)}`;
const ORGANIZER_ORG = `0x${"aa".repeat(32)}`;
const FUNDER_ORG = `0x${"bb".repeat(32)}`;

async function openReview(contract) {
  await contract.openReview(REVIEW_ID, EVIDENCE_COMMITMENT, 1, ORGANIZER_ORG, FUNDER_ORG);
}

async function vote(contract, signers, index, { decision = 1, instructionCommitment = ZERO, noConflictAttested = true } = {}) {
  const signature = await signers[index].signTypedData(
    contract.domain,
    typedVote.types,
    typedVote.message({ reviewId: REVIEW_ID, evidenceCommitment: EVIDENCE_COMMITMENT, round: 1, decision, instructionCommitment, noConflictAttested }),
  );
  return contract.contract.submitVote(
    typedVote.message({ reviewId: REVIEW_ID, evidenceCommitment: EVIDENCE_COMMITMENT, round: 1, decision, instructionCommitment, noConflictAttested }),
    signature,
  );
}

test("constructor rejects zero or repeated Verifier wallets and Organization commitments", async () => {
  const chain = await compileAndDeploy();
  try {
    await assert.rejects(chain.deploy({ verifiers: [chain.addresses[0], chain.addresses[0], chain.addresses[2]] }));
    await assert.rejects(chain.deploy({ organizationCommitments: [chain.orgs[0], chain.orgs[0], chain.orgs[2]] }));
  } finally {
    await chain.close();
  }
});

test("only two matching, distinct Verifier signatures finalize a version-specific decision", async () => {
  const chain = await compileAndDeploy();
  try {
    await openReview(chain.contract);
    const first = await vote(chain, chain.verifiers, 0, { decision: 1 });
    await first.wait();
    let review = await chain.contract.getReview(REVIEW_ID, 1);
    assert.equal(Number(review.status), 1);
    assert.equal(Number(review.decision), 0);
    assert.equal(Number(review.voteCount), 1);

    const second = await vote(chain, chain.verifiers, 1, { decision: 1 });
    await second.wait();
    review = await chain.contract.getReview(REVIEW_ID, 1);
    assert.equal(Number(review.status), 2);
    assert.equal(Number(review.decision), 1);
    assert.equal(Number(review.voteCount), 2);
    await assert.rejects(vote(chain, chain.verifiers, 2, { decision: 3 }));
    await assert.rejects(chain.contract.openReview(REVIEW_ID, EVIDENCE_COMMITMENT, 2, ORGANIZER_ORG, FUNDER_ORG));
  } finally {
    await chain.close();
  }
});

test("ReviewFinalized records the instructions carried by the vote that completes quorum", async () => {
  const chain = await compileAndDeploy();
  try {
    await openReview(chain.contract);
    const firstInstructions = `0x${"44".repeat(32)}`;
    const otherInstructions = `0x${"55".repeat(32)}`;
    await (await vote(chain, chain.verifiers, 0, { decision: 2, instructionCommitment: firstInstructions })).wait();
    const receipt = await (await vote(chain, chain.verifiers, 1, { decision: 2, instructionCommitment: otherInstructions })).wait();
    const review = await chain.contract.getReview(REVIEW_ID, 1);
    assert.equal(Number(review.status), 2);
    assert.equal(Number(review.decision), 2);
    const finalEvent = receipt.logs
      .map((log) => {
        try {
          return chain.contract.interface.parseLog({
            address: `0x${Buffer.from(log[0]).toString("hex")}`,
            topics: log[1].map((topic) => `0x${Buffer.from(topic).toString("hex")}`),
            data: `0x${Buffer.from(log[2]).toString("hex")}`,
          });
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === "ReviewFinalized");
    assert.equal(finalEvent.args.instructionCommitment, otherInstructions);
  } finally {
    await chain.close();
  }
});

test("review opening rejects participant-organization conflicts with the Verifier roster", async () => {
  const chain = await compileAndDeploy();
  try {
    await assert.rejects(chain.contract.openReview(REVIEW_ID, EVIDENCE_COMMITMENT, 1, chain.orgs[0], FUNDER_ORG));
    await assert.rejects(chain.contract.openReview(REVIEW_ID, EVIDENCE_COMMITMENT, 1, ORGANIZER_ORG, chain.orgs[1]));
    await openReview(chain.contract);
  } finally {
    await chain.close();
  }
});

test("rejects unregistered, duplicate, conflict-attesting-false, and wrong-context signatures", async () => {
  const chain = await compileAndDeploy();
  try {
    await openReview(chain.contract);
    const outsiderVote = typedVote.message({ reviewId: REVIEW_ID, evidenceCommitment: EVIDENCE_COMMITMENT, round: 1, decision: 1, instructionCommitment: ZERO, noConflictAttested: true });
    const outsiderSignature = await chain.outsider.signTypedData(chain.domain, typedVote.types, outsiderVote);
    await assert.rejects(chain.contract.submitVote(outsiderVote, outsiderSignature));

    await assert.rejects(vote(chain, chain.verifiers, 0, { decision: 1, noConflictAttested: false }));
    const wrongVersion = typedVote.message({ reviewId: REVIEW_ID, evidenceCommitment: `0x${"33".repeat(32)}`, round: 1, decision: 1, instructionCommitment: ZERO, noConflictAttested: true });
    const wrongVersionSignature = await chain.verifiers[0].signTypedData(chain.domain, typedVote.types, wrongVersion);
    await assert.rejects(chain.contract.submitVote(wrongVersion, wrongVersionSignature));

    const wrongOrganization = typedVote.message({ reviewId: REVIEW_ID, evidenceCommitment: EVIDENCE_COMMITMENT, organizerOrganizationCommitment: chain.orgs[0], funderOrganizationCommitment: FUNDER_ORG, round: 1, decision: 1, instructionCommitment: ZERO, noConflictAttested: true });
    const wrongOrganizationSignature = await chain.verifiers[0].signTypedData(chain.domain, typedVote.types, wrongOrganization);
    await assert.rejects(chain.contract.submitVote(wrongOrganization, wrongOrganizationSignature));

    const validVote = typedVote.message({ reviewId: REVIEW_ID, evidenceCommitment: EVIDENCE_COMMITMENT, round: 1, decision: 1, instructionCommitment: ZERO, noConflictAttested: true });
    const wrongChainSignature = await chain.verifiers[0].signTypedData({ ...chain.domain, chainId: chain.domain.chainId + 1 }, typedVote.types, validVote);
    await assert.rejects(chain.contract.submitVote(validVote, wrongChainSignature));
    const otherDeployment = await chain.deploy();
    const wrongContractSignature = await chain.verifiers[0].signTypedData({ ...chain.domain, verifyingContract: otherDeployment.address }, typedVote.types, validVote);
    await assert.rejects(chain.contract.submitVote(validVote, wrongContractSignature));

    await (await vote(chain, chain.verifiers, 0, { decision: 1 })).wait();
    await assert.rejects(vote(chain, chain.verifiers, 0, { decision: 2 }));
  } finally {
    await chain.close();
  }
});

test("three distinct decisions record NO_QUORUM without an Admin override", async () => {
  const chain = await compileAndDeploy();
  try {
    await openReview(chain.contract);
    await assert.rejects(chain.contract.openReview(REVIEW_ID, EVIDENCE_COMMITMENT, 2, ORGANIZER_ORG, FUNDER_ORG));
    await (await vote(chain, chain.verifiers, 0, { decision: 1 })).wait();
    await (await vote(chain, chain.verifiers, 1, { decision: 2, instructionCommitment: `0x${"44".repeat(32)}` })).wait();
    await (await vote(chain, chain.verifiers, 2, { decision: 3 })).wait();
    const review = await chain.contract.getReview(REVIEW_ID, 1);
    assert.equal(Number(review.status), 3);
    assert.equal(Number(review.decision), 0);
    await assert.rejects(vote(chain, chain.verifiers, 0, { decision: 1 }));
    await (await chain.contract.openReview(REVIEW_ID, EVIDENCE_COMMITMENT, 2, ORGANIZER_ORG, FUNDER_ORG)).wait();
    const nextRound = await chain.contract.getReview(REVIEW_ID, 2);
    assert.equal(Number(nextRound.status), 1);
  } finally {
    await chain.close();
  }
});

test("peer quorum, not a single signer, controls verifier-roster updates", async () => {
  const chain = await compileAndDeploy();
  try {
    const update = chain.rosterUpdateMessage(chain.newVerifiers, chain.newOrgs, 0);
    const signature = await chain.verifiers[0].signTypedData(chain.domain, chain.rosterUpdateTypes, update);
    await assert.rejects(chain.contract.updateVerifierRoster(chain.newVerifiers, chain.newOrgs, [signature]));
    const secondSignature = await chain.verifiers[1].signTypedData(chain.domain, chain.rosterUpdateTypes, update);
    await (await chain.contract.updateVerifierRoster(chain.newVerifiers, chain.newOrgs, [signature, secondSignature])).wait();
    for (let index = 0; index < 3; index += 1) {
      assert.equal(await chain.contract.isVerifier(chain.addresses[index]), false);
      assert.equal(await chain.contract.isVerifier(chain.newAddresses[index]), true);
    }
  } finally {
    await chain.close();
  }
});
