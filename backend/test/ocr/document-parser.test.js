import assert from "node:assert/strict";
import test from "node:test";

import { parseOcrDocument } from "../../src/ocr/documentParser.js";

const indonesianText = [
  "LAPAK MAKMUR",
  "Tanggal: 25/10/2026",
  "Invoice No: INV-8821",
  "Total: Rp 1.250.000,50",
].join("\n");

const indonesianWords = [
  { text: "LAPAK", confidence: 90 }, { text: "MAKMUR", confidence: 80 },
  { text: "Tanggal:", confidence: 91 }, { text: "25/10/2026", confidence: 88 },
  { text: "Invoice", confidence: 90 }, { text: "No:", confidence: 90 }, { text: "INV-8821", confidence: 82 },
  { text: "Total:", confidence: 90 }, { text: "Rp", confidence: 99 }, { text: "1.250.000,50", confidence: 95 },
];

test("parses Indonesian receipt fields, exact decimal amount, and per-field confidence", () => {
  const parsed = parseOcrDocument({ text: indonesianText, words: indonesianWords });

  assert.equal(parsed.vendor, "LAPAK MAKMUR");
  assert.equal(parsed.documentDate, "2026-10-25");
  assert.equal(parsed.amount, "1250000.5");
  assert.equal(parsed.currency, "IDR");
  assert.equal(parsed.invoiceNumber, "INV-8821");
  assert.equal(parsed.detectedLanguage, "id");
  assert.deepEqual(parsed.fieldConfidence, { vendor: 85, documentDate: 88, amount: 95, invoiceNumber: 82 });
  assert.equal(parsed.extractedText, indonesianText);
});

test("parses English dates, invoice labels, and decimal amounts without floating-point conversion", () => {
  const text = [
    "ACME SUPPLY",
    "Invoice Date: 2026-10-25",
    "Invoice No: INV-2026-001",
    "Amount Due: USD 1,245.50",
  ].join("\n");
  const words = [
    { text: "ACME", confidence: 91 }, { text: "SUPPLY", confidence: 87 },
    { text: "2026-10-25", confidence: 92 }, { text: "INV-2026-001", confidence: 89 },
    { text: "1,245.50", confidence: 98 },
  ];
  const parsed = parseOcrDocument({ text, words });

  assert.equal(parsed.vendor, "ACME SUPPLY");
  assert.equal(parsed.documentDate, "2026-10-25");
  assert.equal(parsed.amount, "1245.5");
  assert.equal(parsed.currency, "USD");
  assert.equal(parsed.invoiceNumber, "INV-2026-001");
  assert.equal(parsed.detectedLanguage, "en");
  assert.equal(parsed.fieldConfidence.amount, 98);
});

test("returns mixed/unknown language and does not guess ambiguous dates or currency", () => {
  const mixed = parseOcrDocument({
    text: "TOTAL INVOICE DATE AMOUNT PURCHASE PAYMENT\nJUMLAH PEMBELIAN BAHAN TANGGAL NOTA",
    words: [],
  });
  assert.equal(mixed.detectedLanguage, "mixed");

  const ambiguous = parseOcrDocument({ text: "03/04/2026\n1,234", words: [] });
  assert.equal(ambiguous.documentDate, null);
  assert.equal(ambiguous.amount, "1234");
  assert.equal(ambiguous.currency, null);
  assert.equal(ambiguous.detectedLanguage, "unknown");
  assert.deepEqual(ambiguous.fieldConfidence, { vendor: 0, documentDate: 0, amount: 0, invoiceNumber: 0 });
});

test("optional invoice number stays null when absent and Indonesian month names normalize", () => {
  const parsed = parseOcrDocument({
    text: "KOPERASI MAJU\nTanggal: 15 Okt 2026\nJumlah: 50000 IDR",
    words: [],
  });
  assert.equal(parsed.vendor, "KOPERASI MAJU");
  assert.equal(parsed.documentDate, "2026-10-15");
  assert.equal(parsed.amount, "50000");
  assert.equal(parsed.currency, "IDR");
  assert.equal(parsed.invoiceNumber, null);
  assert.equal(parsed.fieldConfidence.invoiceNumber, 0);
});
