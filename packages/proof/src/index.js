import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

const EVIDENCE_TYPES = new Set(["RECEIPT", "PHOTO", "REPORT", "INVOICE", "CONTRACT", "OTHER"]);
const LANGUAGES = new Set(["id", "en", "mixed", "unknown"]);
const SCREENING_STATES = new Set(["CLEAR", "FLAGGED", "FAILED"]);
const VERIFICATION_STATES = new Set(["VERIFIED", "NEEDS_REVISION", "REJECTED"]);
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_INPUT_PATTERN = /^\d+(?:\.\d+)?$/;
const ISO_CURRENCY_CODES = new Set(Intl.supportedValuesOf("currency"));
const MAX_FILES = 100;
const MAX_FLAG_CODES = 100;
const MAX_STRING_LENGTH = 4096;
const MAX_CANONICAL_PACKAGE_BYTES = 1_000_000;

function invalid(path, reason) {
  throw new TypeError(`Invalid canonical proof package at ${path}: ${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, expectedKeys, path) {
  if (!isRecord(value)) invalid(path, "expected an object");
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(path, `expected keys ${expected.join(", ")}`);
  }
}

function text(value, path, { nullable = false, maximumLength = MAX_STRING_LENGTH } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") invalid(path, "expected a string");
  const result = value.normalize("NFC");
  if (result.length > maximumLength) invalid(path, `exceeds ${maximumLength} characters`);
  return result;
}

function identifier(value, path) {
  const result = text(value, path, { maximumLength: 128 });
  if (!ID_PATTERN.test(result)) invalid(path, "expected a stable lowercase ASCII opaque identifier");
  return result;
}

function sha256Hex(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const result = text(value, path);
  if (!HASH_PATTERN.test(result)) invalid(path, "expected a 64-character SHA-256 hex string");
  return result.toLowerCase();
}

function integer(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid(path, `expected an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function timestamp(value, path) {
  const result = text(value, path);
  const parsed = new Date(result);
  if (!ISO_TIMESTAMP_PATTERN.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) {
    invalid(path, "expected UTC ISO-8601 with fixed millisecond precision");
  }
  return result;
}

function documentDate(value, path) {
  const result = text(value, path, { nullable: true });
  if (result === null) return null;
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    invalid(path, "expected a valid YYYY-MM-DD date or null");
  }
  return result;
}

function confidenceField(input, path, valueNormalizer) {
  exactKeys(input, ["value", "confidence"], path);
  const value = valueNormalizer(input.value, `${path}.value`);
  const confidence = integer(input.confidence, `${path}.confidence`, { maximum: 100 });
  if (value === null && confidence !== 0) invalid(path, "null values must use confidence 0");
  return { value, confidence };
}

function vendorField(value, path) {
  return text(value, path, { nullable: true });
}

function amountField(value, path) {
  const result = text(value, path, { nullable: true });
  if (result === null) return null;
  if (!AMOUNT_INPUT_PATTERN.test(result)) invalid(path, "expected a nonnegative decimal string without grouping separators");
  const [integerPart, fractionalPart = ""] = result.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fractionalPart.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

function enumValue(value, allowed, path) {
  const result = text(value, path);
  if (!allowed.has(result)) invalid(path, "unsupported value");
  return result;
}

function normalizeOcr(input, path) {
  exactKeys(input, ["language", "vendor", "documentDate", "amount", "invoiceNumber"], path);
  const amount = input.amount;
  exactKeys(amount, ["value", "currency", "confidence"], `${path}.amount`);
  const amountValue = amountField(amount.value, `${path}.amount.value`);
  const currencyText = text(amount.currency, `${path}.amount.currency`, { nullable: true });
  if (currencyText !== null && !/^[A-Za-z]{3}$/.test(currencyText)) {
    invalid(`${path}.amount.currency`, "expected a three-letter ASCII ISO-4217 code or null");
  }
  const currency = currencyText === null ? null : currencyText.toUpperCase();
  if (currency !== null && !ISO_CURRENCY_CODES.has(currency)) {
    invalid(`${path}.amount.currency`, "expected an ISO-4217 currency code or null");
  }
  if ((amountValue === null) !== (currency === null)) {
    invalid(`${path}.amount`, "amount and currency must both be null or both be present");
  }
  const amountConfidence = integer(amount.confidence, `${path}.amount.confidence`, { maximum: 100 });
  if (amountValue === null && amountConfidence !== 0) {
    invalid(`${path}.amount`, "null values must use confidence 0");
  }

  return {
    language: enumValue(input.language, LANGUAGES, `${path}.language`),
    vendor: confidenceField(input.vendor, `${path}.vendor`, vendorField),
    documentDate: confidenceField(input.documentDate, `${path}.documentDate`, documentDate),
    amount: { value: amountValue, currency, confidence: amountConfidence },
    invoiceNumber: confidenceField(input.invoiceNumber, `${path}.invoiceNumber`, vendorField),
  };
}

function normalizeFile(input, path) {
  exactKeys(input, ["evidenceId", "evidenceType", "rawHash", "redactedHash", "ocr", "screening"], path);
  exactKeys(input.screening, ["screeningStatus", "flagCodes"], `${path}.screening`);
  if (!Array.isArray(input.screening.flagCodes)) invalid(`${path}.screening.flagCodes`, "expected an array");
  if (input.screening.flagCodes.length > MAX_FLAG_CODES) invalid(`${path}.screening.flagCodes`, `maximum is ${MAX_FLAG_CODES}`);

  const flagCodes = input.screening.flagCodes.map((code, index) => {
    const normalized = text(code, `${path}.screening.flagCodes[${index}]`, { maximumLength: 64 });
    if (!/^[A-Z0-9_]+$/.test(normalized)) invalid(`${path}.screening.flagCodes[${index}]`, "expected an uppercase flag code");
    return normalized;
  }).sort();
  if (new Set(flagCodes).size !== flagCodes.length) invalid(`${path}.screening.flagCodes`, "duplicate flag codes are not allowed");

  const screeningStatus = enumValue(input.screening.screeningStatus, SCREENING_STATES, `${path}.screening.screeningStatus`);
  if (screeningStatus === "CLEAR" && flagCodes.length > 0) invalid(`${path}.screening`, "CLEAR cannot contain flags");
  if (screeningStatus === "FLAGGED" && flagCodes.length === 0) invalid(`${path}.screening`, "FLAGGED requires at least one flag code");

  return {
    evidenceId: identifier(input.evidenceId, `${path}.evidenceId`),
    evidenceType: enumValue(input.evidenceType, EVIDENCE_TYPES, `${path}.evidenceType`),
    rawHash: sha256Hex(input.rawHash, `${path}.rawHash`),
    redactedHash: sha256Hex(input.redactedHash, `${path}.redactedHash`, { nullable: true }),
    ocr: normalizeOcr(input.ocr, `${path}.ocr`),
    screening: { screeningStatus, flagCodes },
  };
}

export function normalizeProofPackage(input) {
  exactKeys(input, [
    "schemaVersion", "campaignId", "milestoneId", "evidenceVersion", "createdAt",
    "files", "verification", "proofVersion",
  ], "package");
  if (input.schemaVersion !== 1) invalid("schemaVersion", "only schema version 1 is supported");
  if (!Array.isArray(input.files) || input.files.length === 0) invalid("files", "expected at least one evidence file");
  if (input.files.length > MAX_FILES) invalid("files", `maximum is ${MAX_FILES}`);
  exactKeys(input.verification, ["verificationStatus", "reviewedAt", "verifierRef"], "verification");

  const files = input.files.map((file, index) => normalizeFile(file, `files[${index}]`));
  files.sort((left, right) => left.evidenceId < right.evidenceId ? -1 : left.evidenceId > right.evidenceId ? 1 : 0);
  if (new Set(files.map((file) => file.evidenceId)).size !== files.length) {
    invalid("files", "evidenceId values must be unique");
  }

  const reviewedAt = timestamp(input.verification.reviewedAt, "verification.reviewedAt");
  const createdAt = timestamp(input.createdAt, "createdAt");
  if (Date.parse(createdAt) < Date.parse(reviewedAt)) invalid("createdAt", "package must be created at or after human review");

  return {
    schemaVersion: 1,
    campaignId: identifier(input.campaignId, "campaignId"),
    milestoneId: identifier(input.milestoneId, "milestoneId"),
    evidenceVersion: integer(input.evidenceVersion, "evidenceVersion", { minimum: 1 }),
    createdAt,
    files,
    verification: {
      verificationStatus: enumValue(input.verification.verificationStatus, VERIFICATION_STATES, "verification.verificationStatus"),
      reviewedAt,
      verifierRef: identifier(input.verification.verifierRef, "verification.verifierRef"),
    },
    proofVersion: integer(input.proofVersion, "proofVersion", { minimum: 1 }),
  };
}

export function canonicalizeProofPackage(input) {
  const canonicalJson = canonicalize(normalizeProofPackage(input));
  if (typeof canonicalJson !== "string") throw new TypeError("JCS canonicalization failed");
  if (Buffer.byteLength(canonicalJson, "utf8") > MAX_CANONICAL_PACKAGE_BYTES) {
    throw new RangeError(`Canonical proof package exceeds ${MAX_CANONICAL_PACKAGE_BYTES} bytes`);
  }
  return canonicalJson;
}

export function hashProofPackage(input) {
  return createHash("sha256").update(canonicalizeProofPackage(input), "utf8").digest("hex");
}

export function hashRawEvidence(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("raw evidence must be a Buffer or Uint8Array");
  return createHash("sha256").update(bytes).digest("hex");
}
