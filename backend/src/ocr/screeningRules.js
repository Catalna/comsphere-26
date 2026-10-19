const DEFAULT_THRESHOLDS = Object.freeze({ vendor: 70, documentDate: 80, amount: 90, invoiceNumber: 70 });
const REQUIRED_FIELDS = ["vendor", "documentDate", "amount"];

function invalidThresholds() {
  return Object.assign(new TypeError("Invalid OCR confidence thresholds"), { code: "INVALID_SCREENING_THRESHOLDS" });
}

function normalized(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ") : "";
}

function decimalParts(value) {
  if (typeof value !== "string" || value.length > 32 || !/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  if (integer.length > 20) return null;
  return { integer: integer.replace(/^0+(?=\d)/, ""), fraction };
}

function compareDecimals(left, right) {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  if (!leftParts || !rightParts) return null;
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const leftValue = BigInt(leftParts.integer) * (10n ** BigInt(scale)) + BigInt(leftParts.fraction.padEnd(scale, "0") || "0");
  const rightValue = BigInt(rightParts.integer) * (10n ** BigInt(scale)) + BigInt(rightParts.fraction.padEnd(scale, "0") || "0");
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function validatedThresholds(input) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(input ?? {}) };
  if (Object.values(thresholds).some((value) => !Number.isSafeInteger(value) || value < 0 || value > 100)
      || thresholds.amount <= thresholds.vendor) {
    throw invalidThresholds();
  }
  return thresholds;
}

function addFlag(flags, code, field, severity, message) {
  flags.push({ code, field, severity, message });
}

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function matchesDuplicate({ parsed, rawHash, duplicateMatches }) {
  const vendor = normalized(parsed.vendor);
  const invoiceNumber = normalized(parsed.invoiceNumber);
  const documentDate = parsed.documentDate;
  return duplicateMatches.some((candidate) => {
    if (rawHash && typeof candidate?.rawHash === "string" && candidate.rawHash.toLowerCase() === rawHash.toLowerCase()) return true;
    return Boolean(vendor && invoiceNumber && documentDate
      && normalized(candidate?.vendor) === vendor
      && normalized(candidate?.invoiceNumber) === invoiceNumber
      && candidate?.documentDate === documentDate);
  });
}

export function screenOcrResult({
  parsed = {},
  rawHash = null,
  milestone = {},
  campaign = {},
  thresholds: configuredThresholds,
  duplicateMatches = [],
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const thresholds = validatedThresholds(configuredThresholds);
  const flags = [];
  const confidence = parsed.fieldConfidence ?? {};
  const requiredValues = {
    vendor: normalized(parsed.vendor) ? parsed.vendor.trim() : null,
    documentDate: validIsoDate(parsed.documentDate) ? parsed.documentDate : null,
    amount: decimalParts(parsed.amount) ? parsed.amount : null,
  };

  for (const field of REQUIRED_FIELDS) {
    const value = requiredValues[field];
    if (value === null || value === undefined || value === "") {
      addFlag(flags, "MISSING_FIELD", field, "MEDIUM", `Bidang ${field} belum terbaca.`);
    } else if (!Number.isSafeInteger(confidence[field]) || confidence[field] < thresholds[field]) {
      addFlag(flags, "LOW_CONFIDENCE_FIELD", field, "MEDIUM", `Periksa kembali hasil OCR untuk ${field}.`);
    }
  }
  if (parsed.invoiceNumber && (!Number.isSafeInteger(confidence.invoiceNumber) || confidence.invoiceNumber < thresholds.invoiceNumber)) {
    addFlag(flags, "LOW_CONFIDENCE_FIELD", "invoiceNumber", "MEDIUM", "Periksa kembali nomor invoice hasil OCR.");
  }

  if (requiredValues.amount) {
    if (!parsed.currency || !milestone.currency) {
      addFlag(flags, "CURRENCY_UNCERTAIN", "currency", "MEDIUM", "Mata uang pada bukti belum dapat dipastikan.");
    } else if (parsed.currency.toUpperCase() !== String(milestone.currency).toUpperCase()) {
      addFlag(flags, "CURRENCY_MISMATCH", "currency", "HIGH", "Mata uang pada bukti berbeda dari mata uang milestone.");
    } else if (compareDecimals(requiredValues.amount, milestone.budgetAmount) > 0) {
      addFlag(flags, "AMOUNT_MISMATCH", "amount", "HIGH", "Jumlah pada bukti melebihi anggaran milestone.");
    }
  }

  if (validIsoDate(parsed.documentDate)) {
    const outsideCampaign = (validIsoDate(campaign.startDate) && parsed.documentDate < campaign.startDate)
      || (validIsoDate(campaign.endDate) && parsed.documentDate > campaign.endDate);
    if ((validIsoDate(today) && parsed.documentDate > today) || outsideCampaign) {
      addFlag(flags, "SUSPICIOUS_DATE", "documentDate", "MEDIUM", "Tanggal pada bukti perlu diperiksa terhadap periode program.");
    }
  }

  if (matchesDuplicate({ parsed, rawHash, duplicateMatches: Array.isArray(duplicateMatches) ? duplicateMatches : [] })) {
    addFlag(flags, "POSSIBLE_DUPLICATE", null, "HIGH", "Bukti mungkin merupakan duplikat dalam campaign ini.");
  }

  return { screeningStatus: flags.length === 0 ? "CLEAR" : "FLAGGED", flags };
}
