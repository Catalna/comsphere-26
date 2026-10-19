import { resolve } from "node:path";

function invalidConfiguration() {
  return Object.assign(new Error("Invalid OCR configuration"), { code: "INVALID_OCR_CONFIGURATION" });
}

function integer(env, name, fallback, { minimum, maximum }) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw !== "string" && typeof raw !== "number") throw invalidConfiguration();
  const text = String(raw);
  if (!/^\d+$/.test(text)) throw invalidConfiguration();
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw invalidConfiguration();
  return value;
}

export function readOcrConfig(env = process.env) {
  const languageData = typeof env.OCR_LANGUAGE_DATA_PATH === "string" ? env.OCR_LANGUAGE_DATA_PATH.trim() : "";
  const thresholds = {
    vendor: integer(env, "OCR_VENDOR_CONFIDENCE_THRESHOLD", 70, { minimum: 0, maximum: 100 }),
    documentDate: integer(env, "OCR_DOCUMENT_DATE_CONFIDENCE_THRESHOLD", 80, { minimum: 0, maximum: 100 }),
    amount: integer(env, "OCR_AMOUNT_CONFIDENCE_THRESHOLD", 90, { minimum: 0, maximum: 100 }),
    invoiceNumber: integer(env, "OCR_INVOICE_CONFIDENCE_THRESHOLD", 70, { minimum: 0, maximum: 100 }),
  };
  if (thresholds.amount <= thresholds.vendor) throw invalidConfiguration();

  const geminiEnabled = boolean(env, "GEMINI_ENABLED", false);
  const geminiKey = typeof env.GEMINI_API_KEY === "string" && env.GEMINI_API_KEY.trim().length > 0
    ? env.GEMINI_API_KEY.trim()
    : null;
  if (geminiEnabled && !geminiKey) throw invalidConfiguration();

  return Object.freeze({
    languageDataPath: languageData ? resolve(languageData) : null,
    pollIntervalMs: integer(env, "OCR_POLL_INTERVAL_MS", 1000, { minimum: 100, maximum: 60000 }),
    leaseMs: integer(env, "OCR_JOB_LEASE_MS", 300000, { minimum: 1000, maximum: 3600000 }),
    maxAttempts: integer(env, "OCR_MAX_ATTEMPTS", 3, { minimum: 1, maximum: 10 }),
    maxPdfPages: integer(env, "OCR_MAX_PDF_PAGES", 10, { minimum: 1, maximum: 10 }),
    renderDpi: integer(env, "OCR_RENDER_DPI", 150, { minimum: 72, maximum: 300 }),
    maxImagePixels: integer(env, "OCR_MAX_IMAGE_PIXELS", 25000000, { minimum: 1, maximum: 25000000 }),
    thresholds: Object.freeze(thresholds),
    gemini: Object.freeze({
      enabled: geminiEnabled,
      apiKey: geminiKey,
      model: geminiModel(env),
      timeoutMs: integer(env, "GEMINI_TIMEOUT_MS", 30000, { minimum: 500, maximum: 120000 }),
      maxPages: integer(env, "GEMINI_MAX_PAGES", 4, { minimum: 1, maximum: 10 }),
      retries: integer(env, "GEMINI_RETRIES", 1, { minimum: 0, maximum: 3 }),
      fieldThreshold: integer(env, "GEMINI_FIELD_THRESHOLD", 80, { minimum: 0, maximum: 100 }),
      maxOutputTokens: integer(env, "GEMINI_MAX_OUTPUT_TOKENS", 2048, { minimum: 256, maximum: 8192 }),
      cooldownMs: integer(env, "GEMINI_COOLDOWN_MS", 60000, { minimum: 0, maximum: 600000 }),
    }),
  });
}

function boolean(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw invalidConfiguration();
}

function geminiModel(env) {
  const raw = typeof env.GEMINI_MODEL === "string" ? env.GEMINI_MODEL.trim() : "gemini-2.5-flash";
  if (raw.length < 3 || raw.length > 128 || !/^[A-Za-z0-9._/:-]+$/.test(raw)) throw invalidConfiguration();
  return raw;
}
