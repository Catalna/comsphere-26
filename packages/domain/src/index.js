function machine(field, states, transitions) {
  const frozenTransitions = Object.fromEntries(
    Object.entries(transitions).map(([from, to]) => [from, Object.freeze([...to])]),
  );
  return Object.freeze({ field, states: Object.freeze([...states]), transitions: Object.freeze(frozenTransitions) });
}

export const STATUS_MACHINES = Object.freeze({
  campaign: machine("campaignStatus", ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"], {
    DRAFT: ["ACTIVE", "CANCELLED"], ACTIVE: ["COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [],
  }),
  milestone: machine("milestoneStatus", ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"], {
    PLANNED: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [],
  }),
  evidence: machine("evidenceStatus", ["UPLOADED", "PROCESSING", "READY_FOR_REVIEW", "PROCESSING_FAILED", "SUPERSEDED"], {
    UPLOADED: ["PROCESSING", "SUPERSEDED"],
    PROCESSING: ["READY_FOR_REVIEW", "PROCESSING_FAILED", "SUPERSEDED"],
    READY_FOR_REVIEW: ["SUPERSEDED"], PROCESSING_FAILED: ["PROCESSING", "SUPERSEDED"], SUPERSEDED: [],
  }),
  screening: machine("screeningStatus", ["PROCESSING", "CLEAR", "FLAGGED", "FAILED"], {
    PROCESSING: ["CLEAR", "FLAGGED", "FAILED"], CLEAR: [], FLAGGED: [], FAILED: [],
  }),
  verification: machine("verificationStatus", ["PENDING", "VERIFIED", "NEEDS_REVISION", "REJECTED"], {
    PENDING: ["VERIFIED", "NEEDS_REVISION", "REJECTED"], VERIFIED: [], NEEDS_REVISION: [], REJECTED: [],
  }),
  disbursement: machine("disbursementStatus", ["NOT_READY", "READY_FOR_PAYMENT", "PAYMENT_REPORTED", "CONFIRMED", "FAILED"], {
    NOT_READY: ["READY_FOR_PAYMENT"],
    READY_FOR_PAYMENT: ["PAYMENT_REPORTED", "FAILED"],
    PAYMENT_REPORTED: ["CONFIRMED", "FAILED"], CONFIRMED: [], FAILED: [],
  }),
  proof: machine("proofStatus", ["PENDING", "SUBMITTED", "ANCHORED", "FAILED"], {
    PENDING: ["SUBMITTED"], SUBMITTED: ["ANCHORED", "FAILED"], FAILED: ["PENDING"], ANCHORED: [],
  }),
});

export class InvalidStateTransitionError extends Error {
  constructor(domain, from, to, reason) {
    super("Invalid state transition");
    this.name = "InvalidStateTransitionError";
    this.domain = domain;
    this.from = from;
    this.to = to;
    this.reason = reason;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function contextFailure(domain, from, to, context) {
  if (!isRecord(context)) return "context must be an object";

  if (domain === "screening") {
    if (to === "CLEAR" && (!Array.isArray(context.flagCodes) || context.flagCodes.length !== 0)) {
      return "CLEAR requires an empty flag list";
    }
    if (to === "FLAGGED" && (!Array.isArray(context.flagCodes) || context.flagCodes.length === 0)) {
      return "FLAGGED requires at least one flag code";
    }
  }

  if (domain === "evidence" && to === "SUPERSEDED" && !requireText(context.supersedingEvidenceVersionId)) {
    return "SUPERSEDED requires a new evidence version reference";
  }

  if (domain === "disbursement") {
    if (to === "READY_FOR_PAYMENT" && (context.verificationStatus !== "VERIFIED" || context.funderAuthorized !== true)) {
      return "payment readiness requires verified evidence and funder authorization";
    }
    if (to === "PAYMENT_REPORTED" && (context.reporterRole !== "FUNDER" || !requireText(context.reporterId))) {
      return "payment reports require an identified funder reporter";
    }
    if (to === "CONFIRMED" && (context.independentSettlementSource !== true || !requireText(context.settlementEvidenceId))) {
      return "payment confirmation requires independent settlement evidence";
    }
    if (to === "FAILED" && context.authoritativeFailure !== true) {
      return "payment failure requires an authoritative payment result";
    }
  }

  if (domain === "proof") {
    if (to === "SUBMITTED" && (context.network !== "ETHEREUM_SEPOLIA" || !/^0x[0-9a-f]{64}$/i.test(context.txHash ?? ""))) {
      return "proof submission requires a Sepolia transaction hash";
    }
    if (to === "ANCHORED" && (context.network !== "ETHEREUM_SEPOLIA" || context.receiptStatus !== 1 || !Number.isSafeInteger(context.blockNumber) || context.blockNumber < 0)) {
      return "proof anchoring requires a successful Sepolia receipt and block number";
    }
    if (to === "FAILED" && !requireText(context.failureCode)) {
      return "proof failure requires a failure code";
    }
    if (from === "FAILED" && to === "PENDING" && (!Number.isSafeInteger(context.proofVersion) || context.proofVersion < 1 || context.retryProofVersion !== context.proofVersion)) {
      return "proof retry must reuse the same proof version";
    }
  }

  return null;
}

export function transitionStatus(domain, from, to, context = {}) {
  const definition = STATUS_MACHINES[domain];
  if (!definition) throw new TypeError("Unknown status domain");
  if (!definition.states.includes(from) || !definition.states.includes(to)) {
    throw new InvalidStateTransitionError(domain, from, to, "unknown_state");
  }
  if (!definition.transitions[from]?.includes(to)) {
    throw new InvalidStateTransitionError(domain, from, to, "transition_not_allowed");
  }
  const failure = contextFailure(domain, from, to, context);
  if (failure) throw new InvalidStateTransitionError(domain, from, to, failure);
  return to;
}
