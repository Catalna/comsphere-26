import "dotenv/config";

import { readOcrConfig } from "../src/ocr/config.js";
import { createDocumentRasterizer } from "../src/ocr/documentRasterizer.js";
import { createTesseractEngine } from "../src/ocr/tesseractEngine.js";
import { parseOcrDocument } from "../src/ocr/documentParser.js";
import { createOcrSmokeReport, createSyntheticReceiptPng, isOcrSmokeReportAcceptable } from "../src/ocr/smokeFixture.js";

async function main() {
  const config = readOcrConfig();
  const engine = createTesseractEngine({ languageDataPath: config.languageDataPath });
  const renderer = createDocumentRasterizer();
  try {
    await engine.initialize();
    const pageTexts = [];
    const words = [];
    for await (const page of renderer.renderEvidencePages({
      bytes: createSyntheticReceiptPng(),
      contentType: "image/png",
      maxPages: config.maxPdfPages,
      maxPixels: config.maxImagePixels,
      dpi: config.renderDpi,
    })) {
      const result = await engine.recognize(page.bytes);
      if (result.text) pageTexts.push(result.text);
      words.push(...result.words);
    }
    const parsed = parseOcrDocument({ text: pageTexts.join("\n"), words });
    const report = createOcrSmokeReport(parsed);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!isOcrSmokeReportAcceptable(report, config.thresholds)) {
      process.stderr.write("Local OCR smoke failed: expected fields did not meet the configured confidence thresholds.\n");
      process.exitCode = 1;
    }
  } catch (error) {
    const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "OCR_SMOKE_FAILED";
    process.stderr.write(`Local OCR smoke failed: ${code}. Check OCR_LANGUAGE_DATA_PATH and the local ind/eng traineddata files.\n`);
    process.exitCode = 1;
  } finally {
    await engine.close();
  }
}

main().catch(() => {
  process.stderr.write("Local OCR smoke failed: OCR_SMOKE_FAILED. Check local OCR setup.\n");
  process.exitCode = 1;
});
