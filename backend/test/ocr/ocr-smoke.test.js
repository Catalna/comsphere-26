import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticReceiptPng, createOcrSmokeReport, isOcrSmokeReportAcceptable } from "../../src/ocr/smokeFixture.js";
import { createDocumentRasterizer } from "../../src/ocr/documentRasterizer.js";

test("synthetic receipt image renders locally and has no real program data", async () => {
  const png = createSyntheticReceiptPng();
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const pages = [];
  for await (const page of createDocumentRasterizer().renderEvidencePages({ bytes: png, contentType: "image/png" })) {
    pages.push(page);
  }
  assert.equal(pages.length, 1);
  assert.equal(pages[0].width, 1600);
  assert.equal(pages[0].height, 1150);
});

test("smoke report exposes field presence/confidence only, never extracted values or text", () => {
  const report = createOcrSmokeReport({
    vendor: "Synthetic Vendor Secret",
    documentDate: "2026-10-01",
    amount: "50000",
    currency: "IDR",
    invoiceNumber: "PRIVATE-INVOICE",
    detectedLanguage: "en",
    extractedText: "FULL PRIVATE RECEIPT TEXT",
    fieldConfidence: { vendor: 85, documentDate: 90, amount: 95, invoiceNumber: 80 },
  });
  const serialized = JSON.stringify(report);
  assert.deepEqual(report.fields.vendor, { present: true, confidence: 85 });
  assert.deepEqual(report.fields.amount, { present: true, confidence: 95 });
  assert.equal(report.detectedLanguage, "en");
  assert.equal(serialized.includes("Synthetic Vendor Secret"), false);
  assert.equal(serialized.includes("PRIVATE-INVOICE"), false);
  assert.equal(serialized.includes("FULL PRIVATE RECEIPT TEXT"), false);
});

test("OCR smoke acceptance requires every expected field to meet its configured threshold", () => {
  const thresholds = { vendor: 70, documentDate: 80, amount: 90, invoiceNumber: 70 };
  const acceptable = createOcrSmokeReport({
    vendor: "Synthetic Vendor",
    documentDate: "2026-10-31",
    amount: "50000",
    invoiceNumber: "DEMO-2026-01",
    detectedLanguage: "id",
    fieldConfidence: { vendor: 95, documentDate: 90, amount: 94, invoiceNumber: 78 },
  });
  assert.equal(isOcrSmokeReportAcceptable(acceptable, thresholds), true);

  const lowAmount = structuredClone(acceptable);
  lowAmount.fields.amount.confidence = 89;
  assert.equal(isOcrSmokeReportAcceptable(lowAmount, thresholds), false);

  const missingDate = structuredClone(acceptable);
  missingDate.fields.documentDate.present = false;
  assert.equal(isOcrSmokeReportAcceptable(missingDate, thresholds), false);
});
