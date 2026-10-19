import assert from "node:assert/strict";
import test from "node:test";

import { readOcrConfig } from "../../src/ocr/config.js";

test("OCR config exposes bounded defaults and field-specific demo thresholds", () => {
  const config = readOcrConfig({});
  assert.equal(config.pollIntervalMs, 1000);
  assert.equal(config.leaseMs, 300000);
  assert.equal(config.maxAttempts, 3);
  assert.equal(config.maxPdfPages, 10);
  assert.equal(config.renderDpi, 150);
  assert.equal(config.maxImagePixels, 25000000);
  assert.deepEqual(config.thresholds, { vendor: 70, documentDate: 80, amount: 90, invoiceNumber: 70 });
  assert.equal(config.languageDataPath, null);
});

test("OCR config accepts explicit local path, bounds, and thresholds", () => {
  const config = readOcrConfig({
    OCR_LANGUAGE_DATA_PATH: "C:\\ocr\\traineddata",
    OCR_POLL_INTERVAL_MS: "250",
    OCR_JOB_LEASE_MS: "60000",
    OCR_MAX_ATTEMPTS: "5",
    OCR_MAX_PDF_PAGES: "4",
    OCR_RENDER_DPI: "200",
    OCR_MAX_IMAGE_PIXELS: "12000000",
    OCR_VENDOR_CONFIDENCE_THRESHOLD: "60",
    OCR_DOCUMENT_DATE_CONFIDENCE_THRESHOLD: "75",
    OCR_AMOUNT_CONFIDENCE_THRESHOLD: "85",
    OCR_INVOICE_CONFIDENCE_THRESHOLD: "65",
  });
  assert.equal(config.languageDataPath, "C:\\ocr\\traineddata");
  assert.equal(config.maxAttempts, 5);
  assert.deepEqual(config.thresholds, { vendor: 60, documentDate: 75, amount: 85, invoiceNumber: 65 });
});

test("OCR config rejects invalid bounds and an amount threshold no stricter than vendor", () => {
  for (const env of [
    { OCR_POLL_INTERVAL_MS: "0" },
    { OCR_MAX_PDF_PAGES: "11" },
    { OCR_RENDER_DPI: "not-a-number" },
    { OCR_MAX_IMAGE_PIXELS: "0" },
    { OCR_VENDOR_CONFIDENCE_THRESHOLD: "101" },
    { OCR_AMOUNT_CONFIDENCE_THRESHOLD: "70" },
  ]) {
    assert.throws(() => readOcrConfig(env), { code: "INVALID_OCR_CONFIGURATION" });
  }
});

test("OCR config exposes a Gemini enrichment block disabled by default", () => {
  const config = readOcrConfig({});
  assert.deepEqual(config.gemini, {
    enabled: false,
    apiKey: null,
    model: "gemini-2.5-flash",
    timeoutMs: 30000,
    maxPages: 4,
    retries: 1,
    fieldThreshold: 80,
    maxOutputTokens: 2048,
    cooldownMs: 60000,
  });
  assert.equal(Object.isFrozen(config.gemini), true);
});

test("OCR config accepts an explicit Gemini setup with a normalized API key", () => {
  const config = readOcrConfig({
    GEMINI_ENABLED: "true",
    GEMINI_API_KEY: "  ai-studio-key  ",
    GEMINI_MODEL: " models/gemini-2.5-flash ",
    GEMINI_TIMEOUT_MS: "5000",
    GEMINI_MAX_PAGES: "1",
    GEMINI_RETRIES: "0",
    GEMINI_FIELD_THRESHOLD: "90",
    GEMINI_MAX_OUTPUT_TOKENS: "4096",
    GEMINI_COOLDOWN_MS: "0",
  });
  assert.deepEqual(config.gemini, {
    enabled: true,
    apiKey: "ai-studio-key",
    model: "models/gemini-2.5-flash",
    timeoutMs: 5000,
    maxPages: 1,
    retries: 0,
    fieldThreshold: 90,
    maxOutputTokens: 4096,
    cooldownMs: 0,
  });
});

test("OCR config requires an API key when Gemini is enabled", () => {
  assert.throws(() => readOcrConfig({ GEMINI_ENABLED: "true" }), { code: "INVALID_OCR_CONFIGURATION" });
});

test("OCR config accepts an API key while Gemini stays disabled", () => {
  const config = readOcrConfig({ GEMINI_API_KEY: "stored-key" });
  assert.equal(config.gemini.enabled, false);
  assert.equal(config.gemini.apiKey, "stored-key");
});

test("OCR config rejects invalid Gemini values", () => {
  for (const env of [
    { GEMINI_ENABLED: "yes" },
    { GEMINI_MODEL: "" },
    { GEMINI_MODEL: "gemini 2.5 flash" },
    { GEMINI_TIMEOUT_MS: "499" },
    { GEMINI_TIMEOUT_MS: "120001" },
    { GEMINI_MAX_PAGES: "0" },
    { GEMINI_MAX_PAGES: "11" },
    { GEMINI_RETRIES: "4" },
    { GEMINI_FIELD_THRESHOLD: "101" },
    { GEMINI_MAX_OUTPUT_TOKENS: "255" },
    { GEMINI_MAX_OUTPUT_TOKENS: "8193" },
    { GEMINI_COOLDOWN_MS: "600001" },
  ]) {
    assert.throws(() => readOcrConfig(env), { code: "INVALID_OCR_CONFIGURATION" });
  }
});
