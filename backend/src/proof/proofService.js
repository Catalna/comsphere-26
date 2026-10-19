import { hashProofPackage } from "@dana-terang/proof";

const ZERO_COMMITMENT = `0x${"00".repeat(32)}`;
const VERIFICATION_STATUSES = new Set(["VERIFIED", "NEEDS_REVISION", "REJECTED"]);
const SCREENING_STATUSES = new Set(["CLEAR", "FLAGGED", "FAILED"]);
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const CONTRACT_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const PACKAGE_SCHEMA_VERSION = 2;

function proofError(code) {
  return Object.assign(new Error(code), { code });
}

function isoMilliseconds(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
  const result = value.toISOString();
  return ISO_TIMESTAMP_PATTERN.test(result) ? result : null;
}

function documentDateString(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function confidence(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : 0;
}

function chainReference(value, pattern) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!pattern.test(normalized) || /^0x0+$/.test(normalized)) return null;
  return normalized;
}

export function buildCanonicalPackage(source) {
  if (!source || source.decision === null || !VERIFICATION_STATUSES.has(source.decision)
      || !source.completedAt) {
    throw proofError("PROOF_SOURCE_NOT_READY");
  }
  const reviewedAt = source.completedAt instanceof Date ? isoMilliseconds(source.completedAt) : String(source.completedAt);
  if (!reviewedAt) throw proofError("PROOF_SOURCE_NOT_READY");

  const quorum = {
    reviewRef: chainReference(source.reviewId, TRANSACTION_HASH_PATTERN),
    roundNumber: Number.isSafeInteger(source.roundNumber) && source.roundNumber >= 1 ? source.roundNumber : null,
    decision: source.decision,
    contractAddress: chainReference(source.contractAddress, CONTRACT_ADDRESS_PATTERN),
    transactionHash: chainReference(source.quorumTransactionHash, TRANSACTION_HASH_PATTERN),
    blockNumber: Number.isSafeInteger(source.blockNumber) && source.blockNumber >= 0 ? source.blockNumber : null,
  };
  if (!quorum.reviewRef || !quorum.contractAddress || !quorum.transactionHash
      || quorum.roundNumber === null || quorum.blockNumber === null) {
    throw proofError("PROOF_SOURCE_NOT_READY");
  }

  const ocr = source.ocr;
  if (!ocr || !SCREENING_STATUSES.has(ocr.screeningStatus)) {
    throw proofError("PROOF_SOURCE_NOT_READY");
  }
  const amountValue = ocr.amount ?? null;
  const currencyValue = ocr.currency ?? null;
  if ((amountValue === null) !== (currencyValue === null)) {
    throw proofError("PROOF_SOURCE_NOT_READY");
  }

  const packageInput = {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    campaignId: String(source.campaignId).toLowerCase(),
    milestoneId: String(source.milestoneId).toLowerCase(),
    evidenceVersion: source.evidenceVersion,
    createdAt: source.now,
    quorum,
    files: [{
      evidenceId: String(source.evidenceId).toLowerCase(),
      evidenceType: source.evidenceType,
      rawHash: String(source.rawHash).toLowerCase(),
      redactedHash: null,
      ocr: {
        language: ocr.detectedLanguage,
        vendor: { value: ocr.vendor ?? null, confidence: confidence(ocr.fieldConfidence?.vendor) },
        documentDate: { value: documentDateString(ocr.documentDate), confidence: confidence(ocr.fieldConfidence?.documentDate) },
        amount: { value: amountValue, currency: currencyValue, confidence: confidence(ocr.fieldConfidence?.amount) },
        invoiceNumber: { value: ocr.invoiceNumber ?? null, confidence: confidence(ocr.fieldConfidence?.invoiceNumber) },
      },
      screening: {
        screeningStatus: ocr.screeningStatus,
        flagCodes: [...(ocr.flagCodes ?? [])].map((code) => String(code).toUpperCase()).sort(),
      },
    }],
    verification: {
      verificationStatus: source.decision,
      reviewedAt,
      verifierRef: String(source.reviewId).toLowerCase(),
    },
    proofVersion: 1,
  };
  return packageInput;
}

export function createProofService({ repository, anchorContract = null, contractAddress = null, maxAttempts = 8, now: clock = () => new Date() } = {}) {
  if (!repository) throw new TypeError("Proof service requires a repository");

  async function buildPackage(reviewRoundId) {
    const source = await repository.getProofSourceData(reviewRoundId);
    const now = isoMilliseconds(clock());
    if (!now) throw proofError("INVALID_PROOF_TIME");
    const input = buildCanonicalPackage({ ...source, now });
    const packageHash = hashProofPackage(input);
    return { source, input, packageHash, proofId: `0x${packageHash}` };
  }

  async function handleQuorumFinalized({ reviewRoundId, now = clock() } = {}) {
    const { source, input, packageHash, proofId } = await buildPackage(reviewRoundId);
    const created = await repository.createProofForRound({
      evidenceId: source.evidenceId,
      reviewRoundId,
      proofVersion: 1,
      packageSchemaVersion: PACKAGE_SCHEMA_VERSION,
      campaignId: source.campaignId,
      milestoneId: source.milestoneId,
      canonicalPackage: input,
      packageHash,
      now,
    });
    if (!created.created) {
      return { proofId: created.proof.proofId, status: created.proof.status, created: false, attempted: false };
    }
    if (!anchorContract) {
      return { proofId, status: "PENDING", created: true, attempted: false, anchorDisabled: true };
    }
    try {
      const anchored = await anchorProof(proofId, { now });
      return { proofId, created: true, ...anchored };
    } catch (error) {
      const current = await repository.findProofByProofId(proofId);
      return {
        proofId,
        created: true,
        attempted: false,
        status: current?.status ?? "FAILED",
        anchorError: error?.code ?? "PROOF_ANCHOR_FAILED",
      };
    }
  }

  async function anchorProof(proofId, { now = clock() } = {}) {
    const proof = await repository.findProofByProofId(proofId);
    if (!proof) throw proofError("PROOF_NOT_FOUND");
    if (proof.status === "ANCHORED") return { status: "ANCHORED", attempted: false };

    if (!anchorContract) throw proofError("PROOF_ANCHOR_DISABLED");

    if (proof.status === "ANCHORING") {
      if (!proof.transactionHash) return { status: "ANCHORING", attempted: false };
      return recoverAnchoring(proof, now);
    }

    if (proof.attempts >= maxAttempts) throw proofError("PROOF_RETRY_LIMIT_EXCEEDED");
    await repository.markAnchoring({ proofId, now });

    const commitment = `0x${proof.packageHash}`;
    let onChain;
    try {
      onChain = String(await anchorContract.proofCommitments(proofId)).toLowerCase();
    } catch {
      await repository.markFailed({ proofId, errorCode: "PROOF_ANCHOR_READ_FAILED", now });
      throw proofError("PROOF_ANCHOR_READ_FAILED");
    }
    if (onChain !== ZERO_COMMITMENT) {
      if (onChain === commitment) return recoverAnchoring(await repository.findProofByProofId(proofId), now);
      await repository.markFailed({ proofId, errorCode: "PROOF_COMMITMENT_MISMATCH", now });
      throw proofError("PROOF_COMMITMENT_MISMATCH");
    }

    let transaction;
    try {
      transaction = await anchorContract.anchorProof(proofId, commitment);
    } catch {
      await repository.markFailed({ proofId, errorCode: "PROOF_ANCHOR_TRANSACTION_FAILED", now });
      throw proofError("PROOF_ANCHOR_TRANSACTION_FAILED");
    }
    const transactionHash = typeof transaction?.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(transaction.hash)
      ? transaction.hash.toLowerCase()
      : null;
    if (!transactionHash) {
      await repository.markFailed({ proofId, errorCode: "PROOF_ANCHOR_TRANSACTION_FAILED", now });
      throw proofError("PROOF_ANCHOR_TRANSACTION_FAILED");
    }
    await repository.markAnchorSubmitted({ proofId, contractAddress, transactionHash, now });

    let receipt;
    try {
      receipt = await transaction.wait();
    } catch {
      throw proofError("PROOF_ANCHOR_RECEIPT_PENDING");
    }
    if (Number(receipt?.status) !== 1 || !Number.isSafeInteger(Number(receipt.blockNumber)) || Number(receipt.blockNumber) < 0) {
      throw proofError("PROOF_ANCHOR_RECEIPT_FAILED");
    }
    const anchored = await repository.markAnchored({ proofId, blockNumber: Number(receipt.blockNumber), anchoredAt: now });
    return { status: anchored.status, attempted: true, transactionHash, blockNumber: anchored.blockNumber };
  }

  async function recoverAnchoring(proof, now) {
    const commitment = `0x${proof.packageHash}`;
    let onChain;
    try {
      onChain = String(await anchorContract.proofCommitments(proof.proofId)).toLowerCase();
    } catch {
      throw proofError("PROOF_ANCHOR_READ_FAILED");
    }
    if (onChain === ZERO_COMMITMENT) return { status: proof.status, attempted: false };
    if (onChain !== commitment) {
      await repository.markFailed({ proofId: proof.proofId, errorCode: "PROOF_COMMITMENT_MISMATCH", now });
      throw proofError("PROOF_COMMITMENT_MISMATCH");
    }
    if (!proof.transactionHash) throw proofError("PROOF_ANCHOR_RECEIPT_UNAVAILABLE");
    let blockNumber = proof.blockNumber;
    if (!Number.isSafeInteger(blockNumber)) {
      try {
        const receipt = await anchorContract.runner?.provider?.getTransactionReceipt(proof.transactionHash);
        if (receipt && Number(receipt.status) === 1 && Number.isSafeInteger(Number(receipt.blockNumber))) {
          blockNumber = Number(receipt.blockNumber);
        }
      } catch { /* Fall through to the receipt-unavailable guard below. */ }
    }
    if (!Number.isSafeInteger(blockNumber)) throw proofError("PROOF_ANCHOR_RECEIPT_PENDING");
    const anchored = await repository.markAnchored({ proofId: proof.proofId, blockNumber, anchoredAt: now });
    return { status: anchored.status, attempted: true, transactionHash: proof.transactionHash, blockNumber: anchored.blockNumber };
  }

  async function retryFailedProofs({ limit = 50, now = clock() } = {}) {
    if (!anchorContract) return [];
    const pending = await repository.listAnchorableProofs({ limit });
    const results = [];
    for (const proof of pending) {
      try {
        results.push({ proofId: proof.proofId, ...(await anchorProof(proof.proofId, { now })) });
      } catch (error) {
        results.push({ proofId: proof.proofId, status: error?.code ?? "PROOF_ANCHOR_FAILED", attempted: true });
      }
    }
    return results;
  }

  function projectProof(proof, viewer) {
    if (!proof) return null;
    const base = {
      proofId: proof.proofId,
      proofVersion: proof.proofVersion,
      status: proof.status,
      createdAt: proof.createdAt,
    };
    if (viewer === "FUNDER") return base;
    return {
      ...base,
      evidenceId: proof.evidenceId,
      campaignId: proof.campaignId,
      milestoneId: proof.milestoneId,
      packageHash: proof.packageHash,
      contractAddress: proof.contractAddress,
      transactionHash: proof.transactionHash,
      blockNumber: proof.blockNumber,
      attempts: proof.attempts,
      lastErrorCode: proof.lastErrorCode,
      anchoredAt: proof.anchoredAt,
      updatedAt: proof.updatedAt,
    };
  }

  return Object.freeze({
    handleQuorumFinalized,
    anchorProof,
    retryFailedProofs,
    buildPackage,
    projectProof,
  });
}
