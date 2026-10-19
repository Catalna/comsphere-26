import assert from "node:assert/strict";
import test from "node:test";

import { screenOcrResult } from "../../src/ocr/screeningRules.js";

const thresholds = { vendor: 70, documentDate: 80, amount: 90, invoiceNumber: 70 };
const milestone = { budgetAmount: "1250000.50", currency: "IDR" };
const campaign = { startDate: "2026-01-01", endDate: "2026-12-31" };
const parsed = {
  vendor: "LAPAK MAKMUR",
  documentDate: "2026-10-25",
  amount: "1250000.5",
  currency: "IDR",
  invoiceNumber: "INV-8821",
  fieldConfidence: { vendor: 85, documentDate: 88, amount: 95, invoiceNumber: 82 },
};

test("returns CLEAR only when every required field passes thresholds and no rule flags", () => {
  const result = screenOcrResult({ parsed, milestone, campaign, thresholds, duplicateMatches: [], today: "2026-10-26" });
  assert.deepEqual(result, { screeningStatus: "CLEAR", flags: [] });
});

test("missing and low-confidence required fields are flagged instead of silently clearing", () => {
  const result = screenOcrResult({
    parsed: {
      vendor: null,
      documentDate: null,
      amount: "1250000.5",
      currency: "IDR",
      invoiceNumber: null,
      fieldConfidence: { vendor: 0, documentDate: 0, amount: 89, invoiceNumber: 0 },
    },
    milestone,
    campaign,
    thresholds,
    duplicateMatches: [],
    today: "2026-10-26",
  });
  assert.equal(result.screeningStatus, "FLAGGED");
  assert.deepEqual(result.flags.map((flag) => [flag.code, flag.field]), [
    ["MISSING_FIELD", "vendor"],
    ["MISSING_FIELD", "documentDate"],
    ["LOW_CONFIDENCE_FIELD", "amount"],
  ]);
});

test("compares large decimal amounts exactly and detects currency uncertainty/mismatch", () => {
  const overBudget = screenOcrResult({
    parsed: { ...parsed, amount: "1000000000000000.12", currency: "IDR" },
    milestone: { budgetAmount: "1000000000000000.11", currency: "IDR" },
    campaign,
    thresholds,
    duplicateMatches: [],
    today: "2026-10-26",
  });
  assert.ok(overBudget.flags.some((flag) => flag.code === "AMOUNT_MISMATCH"));

  const uncertain = screenOcrResult({ parsed: { ...parsed, currency: null }, milestone, campaign, thresholds, duplicateMatches: [], today: "2026-10-26" });
  assert.ok(uncertain.flags.some((flag) => flag.code === "CURRENCY_UNCERTAIN"));

  const mismatch = screenOcrResult({ parsed: { ...parsed, currency: "USD" }, milestone, campaign, thresholds, duplicateMatches: [], today: "2026-10-26" });
  assert.ok(mismatch.flags.some((flag) => flag.code === "CURRENCY_MISMATCH"));
});

test("flags suspicious dates and duplicate raw hashes or normalized invoice identities", () => {
  const result = screenOcrResult({
    parsed,
    rawHash: "a".repeat(64),
    milestone,
    campaign,
    thresholds,
    today: "2026-10-24",
    duplicateMatches: [
      { rawHash: "a".repeat(64), vendor: "Other", invoiceNumber: "X", documentDate: "2026-01-01" },
      { rawHash: "b".repeat(64), vendor: "lapak makmur", invoiceNumber: "inv-8821", documentDate: "2026-10-25" },
    ],
  });
  assert.equal(result.screeningStatus, "FLAGGED");
  assert.ok(result.flags.some((flag) => flag.code === "SUSPICIOUS_DATE"));
  assert.equal(result.flags.filter((flag) => flag.code === "POSSIBLE_DUPLICATE").length, 1);
});

test("rejects thresholds with an amount threshold no stricter than vendor", () => {
  assert.throws(
    () => screenOcrResult({ parsed, milestone, campaign, thresholds: { ...thresholds, amount: 70 }, duplicateMatches: [], today: "2026-10-26" }),
    { code: "INVALID_SCREENING_THRESHOLDS" },
  );
});

test("malformed normalized required values cannot produce a CLEAR result", () => {
  const result = screenOcrResult({
    parsed: {
      ...parsed,
      vendor: "   ",
      documentDate: "2026-02-30",
      amount: "1e6",
      fieldConfidence: { vendor: 100, documentDate: 100, amount: 100, invoiceNumber: 100 },
    },
    milestone,
    campaign,
    thresholds,
    duplicateMatches: [],
    today: "2026-10-26",
  });
  assert.equal(result.screeningStatus, "FLAGGED");
  assert.deepEqual(result.flags.map((flag) => [flag.code, flag.field]), [
    ["MISSING_FIELD", "vendor"],
    ["MISSING_FIELD", "documentDate"],
    ["MISSING_FIELD", "amount"],
  ]);
});
