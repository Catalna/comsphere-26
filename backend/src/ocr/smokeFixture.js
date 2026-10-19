import { createCanvas } from "@napi-rs/canvas";

export function createSyntheticReceiptPng() {
  const width = 1600;
  const height = 1150;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111827";
  context.font = "bold 72px sans-serif";
  context.fillText("TOKO CONTOH", 100, 160);
  context.font = "58px sans-serif";
  context.fillText("TANGGAL: 31 OKTOBER 2026", 100, 360);
  context.font = "54px sans-serif";
  context.fillText("Invoice No: DEMO-2026-01", 100, 560);
  context.font = "bold 90px sans-serif";
  context.fillText("TOTAL PEMBAYARAN: IDR 50000", 100, 820);
  return canvas.toBuffer("image/png");
}

export function createOcrSmokeReport(parsed) {
  const fields = {};
  for (const field of ["vendor", "documentDate", "amount", "invoiceNumber"]) {
    const value = parsed?.[field];
    const confidence = parsed?.fieldConfidence?.[field];
    fields[field] = {
      present: typeof value === "string" && value.trim().length > 0,
      confidence: Number.isSafeInteger(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
    };
  }
  return {
    detectedLanguage: ["id", "en", "mixed", "unknown"].includes(parsed?.detectedLanguage) ? parsed.detectedLanguage : "unknown",
    fields,
  };
}

export function isOcrSmokeReportAcceptable(report, thresholds) {
  if (!report || !report.fields || !thresholds) return false;
  for (const field of ["vendor", "documentDate", "amount", "invoiceNumber"]) {
    const result = report.fields[field];
    const threshold = thresholds[field];
    if (!result?.present || !Number.isSafeInteger(result.confidence)
        || !Number.isSafeInteger(threshold) || result.confidence < threshold) {
      return false;
    }
  }
  return true;
}
