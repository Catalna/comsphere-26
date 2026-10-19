import { createHash } from "node:crypto";

const GEMINI_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const CURRENCY_CODES = new Set(["IDR", "USD", "EUR", "GBP", "SGD", "AUD", "CAD", "MYR", "JPY"]);
const FIELD_KEYS = Object.freeze(["vendor", "documentDate", "amount", "currency", "invoiceNumber"]);
const CONFIDENCE_FIELDS = Object.freeze(["vendor", "documentDate", "amount", "invoiceNumber"]);
const MAX_TEXT_CHARS = 40_000;
const SNIPPET_LIMIT = 16_000;
const RETRY_BACKOFF_MS = 2_000;

function errorWithCode(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function normalizeVendor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 240 ? trimmed : null;
}

function normalizeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function normalizeAmount(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 32 || !/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  return value;
}

function normalizeCurrency(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toLocaleUpperCase("en-US");
  if (code.length !== 3 || !CURRENCY_CODES.has(code)) return null;
  return code;
}

function normalizeInvoice(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 80 ? trimmed : null;
}

const NORMALIZERS = Object.freeze({
  vendor: normalizeVendor,
  documentDate: normalizeDate,
  amount: normalizeAmount,
  currency: normalizeCurrency,
  invoiceNumber: normalizeInvoice,
});

function confidenceValue(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100 ? value : 0;
}

function valuesEquivalent(field, left, right) {
  if (field === "amount" || field === "documentDate" || field === "currency") return left === right;
  const lower = (value) => String(value).toLocaleLowerCase("id-ID");
  return lower(left) === lower(right);
}

// Deterministic merge rules (spec section 2.3):
//   1) valid Tesseract + missing Gemini          -> Tesseract
//   2) missing Tesseract + valid Gemini          -> Gemini
//   3) both valid and equal                      -> Tesseract (confirmed reading)
//   4) disagree + strong Gemini + weak Tesseract -> Gemini correction
//   5) otherwise                                 -> Tesseract + diverged notice
function mergeField({ field, tesseractValue, tesseractConfidence, geminiValue, geminiConfidence, fieldThreshold }) {
  const normalizer = NORMALIZERS[field];
  const tesseract = normalizer(tesseractValue);
  const gemini = normalizer(geminiValue);
  const tConf = tesseract === null ? 0 : confidenceValue(tesseractConfidence);
  const gConf = gemini === null ? 0 : confidenceValue(geminiConfidence);

  if (tesseract && !gemini) return { value: tesseract, confidence: tConf, source: "tesseract", diverged: false, geminiValue };
  if (!tesseract && gemini) return { value: gemini, confidence: gConf, source: "gemini", diverged: false, geminiValue };
  if (!tesseract && !gemini) return { value: null, confidence: 0, source: "none", diverged: false, geminiValue: null };
  if (valuesEquivalent(field, tesseract, gemini)) {
    return { value: tesseract, confidence: tConf, source: "tesseract", diverged: false, geminiValue };
  }
  if (gConf >= fieldThreshold && tConf < fieldThreshold) {
    return { value: gemini, confidence: gConf, source: "gemini", diverged: true, geminiValue };
  }
  return { value: tesseract, confidence: tConf, source: "tesseract", diverged: true, geminiValue };
}

function buildInstructionText(parsed, text) {
  const draft = {
    vendor: parsed?.vendor ?? null,
    documentDate: parsed?.documentDate ?? null,
    amount: parsed?.amount ?? null,
    currency: parsed?.currency ?? null,
    invoiceNumber: parsed?.invoiceNumber ?? null,
    fieldConfidence: parsed?.fieldConfidence ?? null,
  };
  return [
    "Anda membantu memperbaiki hasil OCR pembukuan. Perbaiki typo dan isi field yang hilang dari gambar dan teks berikut.",
    "Gunakan HANYA informasi yang benar-benar terlihat. Jangan mengarang. Pilih null bila nilai tidak terlihat.",
    "Balas JSON dalam satu baris: {\"vendor\": string|null, \"documentDate\": \"YYYY-MM-DD\"|null, \"amount\": \"<angka murni, boleh desimal>\", \"currency\": \"kode ISO-4217 3 huruf\"|null, \"invoiceNumber\": string|null, \"fieldConfidence\": {\"vendor\": 0-100, \"documentDate\": 0-100, \"amount\": 0-100, \"invoiceNumber\": 0-100}, \"notes\": string[]}.",
    "Teks OCR:",
    text.slice(0, MAX_TEXT_CHARS),
    `Draf parsing regex (boleh salah): ${JSON.stringify(draft)}`,
  ].join("\n");
}

function extractCandidateText(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) throw errorWithCode("MALFORMED_RESPONSE");
  const text = parts.map((part) => part?.text).find((value) => typeof value === "string");
  if (typeof text !== "string") throw errorWithCode("MALFORMED_RESPONSE");
  return text;
}

function parsePayload(candidateText) {
  let value;
  try {
    value = JSON.parse(candidateText);
  } catch {
    throw errorWithCode("MALFORMED_RESPONSE");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw errorWithCode("MALFORMED_RESPONSE");
  return value;
}

export function createAiEnricher({
  config,
  fetchImpl = fetch,
  clock = () => new Date(),
  sleep = () => Promise.resolve(),
} = {}) {
  if (!config || typeof config !== "object") throw new TypeError("Gemini configuration is required");

  let authBroken = false;
  let cooldownUntil = 0;

  async function callGeminiOnce({ instructionText, pageParts }) {
    let response;
    try {
      response = await fetchImpl(`${GEMINI_URL_BASE}/${config.model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey ?? "" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [...pageParts, { text: instructionText }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: config.maxOutputTokens },
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      if (/timeout|abort/i.test(error?.name ?? "")) throw errorWithCode("TIMEOUT", error);
      throw errorWithCode("NETWORK", error);
    }

    if (response.status === 429) throw errorWithCode("RATE_LIMITED");
    if (response.status === 401 || response.status === 403) throw errorWithCode("AUTH_FAILED");
    if (response.status === 400) throw errorWithCode("REQUEST_REJECTED");
    if (response.status < 200 || response.status >= 300) throw errorWithCode("SERVER_ERROR");

    let rawBody;
    try {
      rawBody = await response.text();
    } catch (error) {
      throw errorWithCode("NETWORK", error);
    }
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw errorWithCode("MALFORMED_RESPONSE");
    }
    return extractCandidateText(body);
  }

  function disabledOutcome(parsed) {
    return {
      merged: parsed,
      ai: {
        status: "DISABLED", reason: "GEMINI_DISABLED", model: null, promptHash: null,
        pagesSent: 0, durationMs: 0, attempts: 0, responseSnippet: null, fields: null,
      },
    };
  }

  function unavailableOutcome({ parsed, reason, attempts, pagesSent, durationMs }) {
    return {
      merged: parsed ?? null,
      ai: {
        status: "UNAVAILABLE", reason, model: config.model, promptHash: null,
        pagesSent, durationMs, attempts, responseSnippet: null, fields: null,
      },
    };
  }

  async function enrich({ parsed, text, pages } = {}) {
    if (!config.enabled || !config.apiKey) return disabledOutcome(parsed);
    if (authBroken) return unavailableOutcome({ parsed, reason: "AUTH_DISABLED", attempts: 0, pagesSent: 0, durationMs: 0 });

    const usablePages = (Array.isArray(pages) ? pages : []).filter(Buffer.isBuffer).slice(0, config.maxPages);
    if (clock().getTime() < cooldownUntil) {
      return unavailableOutcome({ parsed, reason: "RATE_LIMITED", attempts: 0, pagesSent: usablePages.length, durationMs: 0 });
    }

    const pageParts = usablePages.map((bytes) => ({ inline_data: { mime_type: "image/png", data: bytes.toString("base64") } }));
    const instructionText = buildInstructionText(parsed, typeof text === "string" ? text : "");
    const promptHash = createHash("sha256").update(instructionText).digest("hex");
    const startedAt = clock().getTime();
    const attemptBudget = 1 + Math.max(0, config.retries ?? 0);
    let attempts = 0;
    let lastReason = "UNKNOWN";

    try {
      while (attempts < attemptBudget) {
        attempts += 1;
        try {
          const candidateText = await callGeminiOnce({ instructionText, pageParts });
          const durationMs = clock().getTime() - startedAt;
          const payload = parsePayload(candidateText);
          const modelConfidence = payload.fieldConfidence && typeof payload.fieldConfidence === "object" && !Array.isArray(payload.fieldConfidence)
            ? payload.fieldConfidence
            : {};
          const source = parsed ?? {};

          const merged = {
            detectedLanguage: source.detectedLanguage ?? null,
            fieldConfidence: { vendor: 0, documentDate: 0, amount: 0, invoiceNumber: 0 },
            extractedText: typeof source.extractedText === "string" ? source.extractedText : undefined,
          };
          const fields = {};
          for (const field of FIELD_KEYS) {
            const decision = mergeField({
              field,
              tesseractValue: source[field],
              tesseractConfidence: (source.fieldConfidence ?? {})[field],
              geminiValue: payload[field],
              geminiConfidence: modelConfidence[field],
              fieldThreshold: config.fieldThreshold,
            });
            merged[field] = decision.value;
            if (CONFIDENCE_FIELDS.includes(field)) merged.fieldConfidence[field] = decision.confidence;
            fields[field] = {
              source: decision.source,
              diverged: decision.diverged,
              geminiValue: decision.geminiValue,
              tesseractConfidence: (source.fieldConfidence ?? {})[field] ?? null,
              aiConfidence: confidenceValue(modelConfidence[field]),
            };
          }

          return {
            merged,
            ai: {
              status: "APPLIED", reason: null, model: config.model, promptHash,
              pagesSent: usablePages.length, durationMs, attempts,
              responseSnippet: candidateText.slice(0, SNIPPET_LIMIT), fields,
            },
          };
        } catch (error) {
          lastReason = error?.code ?? "UNKNOWN";
          if (lastReason === "AUTH_FAILED") { authBroken = true; break; }
          if (lastReason === "RATE_LIMITED") {
            cooldownUntil = clock().getTime() + config.cooldownMs;
            break;
          }
          if (lastReason === "REQUEST_REJECTED") break;
          if (attempts < attemptBudget) await sleep(RETRY_BACKOFF_MS);
        }
      }
      return unavailableOutcome({
        parsed,
        reason: lastReason,
        attempts,
        pagesSent: usablePages.length,
        durationMs: clock().getTime() - startedAt,
      });
    } catch (error) {
      return unavailableOutcome({
        parsed,
        reason: error?.code ?? "UNKNOWN",
        attempts,
        pagesSent: usablePages.length,
        durationMs: clock().getTime() - startedAt,
      });
    }
  }

  return Object.freeze({ enrich });
}
