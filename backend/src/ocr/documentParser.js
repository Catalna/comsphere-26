import { franc } from "franc-min";

const MONTHS = new Map([
  ["jan", 1], ["january", 1], ["januari", 1], ["feb", 2], ["february", 2], ["februari", 2],
  ["mar", 3], ["march", 3], ["maret", 3], ["apr", 4], ["april", 4], ["mei", 5], ["may", 5],
  ["jun", 6], ["june", 6], ["juni", 6], ["jul", 7], ["july", 7], ["juli", 7],
  ["aug", 8], ["august", 8], ["agu", 8], ["agustus", 8], ["sep", 9], ["september", 9],
  ["oct", 10], ["october", 10], ["okt", 10], ["oktober", 10], ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12], ["des", 12], ["desember", 12],
]);
const CURRENCY_CODES = ["IDR", "USD", "EUR", "GBP", "SGD", "AUD", "CAD", "MYR", "JPY"];
const CURRENCY_WORD = new RegExp(`\\b(?:${CURRENCY_CODES.join("|")})\\b|\\b(?:RP|RUPIAH)\\b\\.?|[€£]`, "i");
const MONEY_LABEL = /\b(?:grand\s+total|total|amount\s+due|amount|jumlah|total\s+bayar|total\s+pembayaran|total\s+belanja)\b/i;
const DATE_LABEL = /\b(?:date|tanggal)\b/i;
const INVOICE_LABEL = /\b(?:invoice|faktur|inv\.?|nomor\s+faktur)\b/i;

function normalizedToken(value) {
  return String(value ?? "").toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]/gu, "");
}

function confidenceFor(words, value, mode = "token") {
  const target = mode === "digits" ? String(value).replace(/\D/g, "") : normalizedToken(value);
  if (!target) return 0;
  const matched = (Array.isArray(words) ? words : []).filter((word) => {
    if (typeof word?.text !== "string" || !Number.isFinite(word.confidence)) return false;
    const token = mode === "digits" ? word.text.replace(/\D/g, "") : normalizedToken(word.text);
    return token && (mode === "digits" ? target.includes(token) : target.includes(token) || token.includes(target));
  });
  if (matched.length === 0) return 0;
  return Math.round(matched.reduce((sum, word) => sum + Math.max(0, Math.min(100, word.confidence)), 0) / matched.length);
}

function isValidDate(year, month, day) {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isoDate(year, month, day) {
  if (!isValidDate(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function findDate(text) {
  const monthWords = [...MONTHS.keys()].sort((left, right) => right.length - left.length).join("|");
  const namedDate = new RegExp(`\\b(\\d{1,2})\\s+(${monthWords})\\s+(\\d{4})\\b|\\b(${monthWords})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i");
  for (const line of text.split(/\r?\n/)) {
    const iso = line.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (iso) return { value: isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3])), matchedText: iso[0] };
    const numeric = line.match(/\b(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})\b/);
    if (numeric) {
      const first = Number(numeric[1]);
      const second = Number(numeric[2]);
      if (first > 12) return { value: isoDate(Number(numeric[3]), second, first), matchedText: numeric[0] };
      if (second > 12) return { value: isoDate(Number(numeric[3]), first, second), matchedText: numeric[0] };
      return { value: null, matchedText: numeric[0] };
    }
    const named = line.match(namedDate);
    if (named) {
      const day = Number(named[1] ?? named[5]);
      const month = MONTHS.get((named[2] ?? named[4]).toLowerCase());
      const year = Number(named[3] ?? named[6]);
      return { value: isoDate(year, month, day), matchedText: named[0] };
    }
  }
  return { value: null, matchedText: "" };
}

function languageCode(value) {
  if (value === "ind") return "id";
  if (value === "eng") return "en";
  return "unknown";
}

function detectLanguage(text) {
  const informativeLines = text.split(/\r?\n/)
    .map((line) => line.replace(/\b(?:invoice|receipt|total|date|amount|number|no|tax|subtotal|faktur|nota|struk|jumlah|tanggal|rp|idr|usd)\b/gi, " ").trim())
    .filter((line) => line.length >= 10 && (line.match(/\p{L}{3,}/gu) ?? []).length >= 2);
  const lineLanguages = new Set(informativeLines.map((line) => franc(line, { only: ["eng", "ind"], minLength: 10 })).filter((code) => code === "eng" || code === "ind"));
  if (lineLanguages.size > 1) return "mixed";
  return languageCode(franc(text, { only: ["eng", "ind"], minLength: 20 }));
}

function canonicalAmount(raw) {
  let token = raw.replace(/[\s ]/g, "");
  if (!/^\d[\d.,]*$/.test(token) || token.length > 32) return null;
  const separators = [...token.matchAll(/[.,]/g)].map((match) => ({ value: match[0], index: match.index }));
  if (separators.length === 0) return token.replace(/^0+(?=\d)/, "");

  const last = separators.at(-1);
  const fractionalDigits = token.length - last.index - 1;
  let decimalSeparator = null;
  let groupingSeparators = new Set();
  if (new Set(separators.map(({ value }) => value)).size > 1) {
    if (fractionalDigits >= 1 && fractionalDigits <= 2) {
      decimalSeparator = last.value;
      groupingSeparators = new Set(separators.filter(({ index }) => index < last.index).map(({ value }) => value));
    } else if (fractionalDigits === 3) {
      groupingSeparators = new Set(separators.map(({ value }) => value));
    } else return null;
  } else if (separators.length > 1) {
    if (fractionalDigits >= 1 && fractionalDigits <= 2) decimalSeparator = last.value;
    else if (fractionalDigits === 3) groupingSeparators.add(last.value);
    else return null;
  } else if (fractionalDigits <= 2) decimalSeparator = last.value;
  else if (fractionalDigits === 3) groupingSeparators.add(last.value);
  else return null;

  const parts = decimalSeparator ? token.split(decimalSeparator) : [token];
  if (parts.length > 2) return null;
  let integerPart = parts[0];
  for (const separator of groupingSeparators) {
    const groups = integerPart.split(separator);
    if (groups[0].length < 1 || groups[0].length > 3 || groups.slice(1).some((group) => group.length !== 3)) return null;
    integerPart = groups.join("");
  }
  if (!/^\d+$/.test(integerPart)) return null;
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
  const fraction = (parts[1] ?? "").replace(/\D/g, "").replace(/0+$/, "");
  return fraction ? `${normalizedInteger}.${fraction}` : normalizedInteger;
}

function currencyFromLine(line) {
  const found = new Set();
  for (const code of CURRENCY_CODES) if (new RegExp(`\\b${code}\\b`, "i").test(line)) found.add(code);
  if (/\b(?:RP|RUPIAH)\b\.?/i.test(line)) found.add("IDR");
  if (/€/u.test(line)) found.add("EUR");
  if (/£/u.test(line)) found.add("GBP");
  return found.size === 1 ? [...found][0] : null;
}

const NUMBER_PATTERN = /(?:\d{1,3}(?:[., ]\d{3})+|\d+)(?:[.,]\d{1,2})?/g;

function findAmount(lines) {
  const totalLines = lines.filter((line) => MONEY_LABEL.test(line));
  const notDate = (line) => !findDate(line).matchedText;
  const currencyLines = lines.filter((line) => CURRENCY_WORD.test(line) && notDate(line) && !DATE_LABEL.test(line) && !INVOICE_LABEL.test(line));
  const fallbackLines = lines.filter((line) => notDate(line) && !DATE_LABEL.test(line) && !INVOICE_LABEL.test(line) && !/\b(?:phone|tel|qty|quantity)\b/i.test(line));
  for (const line of [...new Set([...totalLines, ...currencyLines, ...fallbackLines])]) {
    const matches = [...line.matchAll(NUMBER_PATTERN)];
    for (const match of matches.reverse()) {
      const value = canonicalAmount(match[0].replace(/[ ]/g, ""));
      if (value !== null) return { value, matchedText: match[0], currency: currencyFromLine(line) };
    }
  }
  return { value: null, matchedText: "", currency: null };
}

function findVendor(lines) {
  const heading = /^(?:tax\s+)?(?:invoice|receipt|faktur|nota|struk|date|tanggal|time|waktu|total|jumlah|amount|grand\s+total|subtotal)\b/i;
  return lines.find((line) => /\p{L}/u.test(line) && !heading.test(line)) ?? null;
}

function findInvoiceNumber(text) {
  const patterns = [
    /\b(?:invoice|faktur)\s*(?:no\.?|number|nomor|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/._-]{1,39})/i,
    /\b(?:inv\.?|nomor\s+faktur)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/._-]{1,39})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { value: match[1].replace(/[.,;:]$/, ""), matchedText: match[1] };
  }
  return { value: null, matchedText: "" };
}

export function parseOcrDocument({ text, words = [] } = {}) {
  const extractedText = typeof text === "string" ? text : "";
  const lines = extractedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const vendor = findVendor(lines);
  const date = findDate(extractedText);
  const amount = findAmount(lines);
  const invoice = findInvoiceNumber(extractedText);
  const currency = amount.currency ?? currencyFromLine(extractedText);

  return {
    vendor,
    documentDate: date.value,
    amount: amount.value,
    currency,
    invoiceNumber: invoice.value,
    detectedLanguage: detectLanguage(extractedText),
    fieldConfidence: {
      vendor: vendor ? confidenceFor(words, vendor) : 0,
      documentDate: date.value ? confidenceFor(words, date.matchedText, "digits") : 0,
      amount: amount.value ? confidenceFor(words, amount.matchedText, "digits") : 0,
      invoiceNumber: invoice.value ? confidenceFor(words, invoice.matchedText) : 0,
    },
    extractedText,
  };
}
