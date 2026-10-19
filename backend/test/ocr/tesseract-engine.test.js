import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createTesseractEngine } from "../../src/ocr/tesseractEngine.js";

test("local engine requires Indonesian and English traineddata before starting a worker", async () => {
  const languageDataPath = await mkdtemp(join(tmpdir(), "dana-terang-ocr-data-"));
  let workerCreated = false;
  const engine = createTesseractEngine({ languageDataPath, createWorker: async () => { workerCreated = true; } });
  try {
    await assert.rejects(engine.initialize(), { code: "OCR_LANGUAGE_DATA_MISSING" });
    assert.equal(workerCreated, false);
  } finally {
    await rm(languageDataPath, { recursive: true, force: true });
  }
});

test("engine construction succeeds without local data and reports the missing setup at initialization", async () => {
  let workerCreated = false;
  const engine = createTesseractEngine({ createWorker: async () => { workerCreated = true; } });
  await assert.rejects(engine.initialize(), { code: "OCR_LANGUAGE_DATA_MISSING" });
  assert.equal(workerCreated, false);
});

test("engine uses local ind+eng data, returns word confidence, and terminates its worker", async () => {
  const languageDataPath = await mkdtemp(join(tmpdir(), "dana-terang-ocr-data-"));
  const calls = [];
  const worker = {
    async recognize(bytes) {
      calls.push(bytes.toString());
      return { data: { text: "Total Rp 125.000", blocks: [{ paragraphs: [{ lines: [{ words: [{ text: "Total", confidence: 93 }, { text: "125.000", confidence: 88 }] }] }] }] } };
    },
    async terminate() { calls.push("terminated"); },
  };
  let workerOptions;
  const engine = createTesseractEngine({
    languageDataPath,
    async createWorker(options) { workerOptions = options; return worker; },
  });
  try {
    await writeFile(join(languageDataPath, "ind.traineddata"), "local test data");
    await writeFile(join(languageDataPath, "eng.traineddata"), "local test data");
    await engine.initialize();
    const result = await engine.recognize(Buffer.from("page one"));
    assert.deepEqual(workerOptions, { languages: "ind+eng", languageDataPath, download: false });
    assert.equal(result.text, "Total Rp 125.000");
    assert.deepEqual(result.words, [{ text: "Total", confidence: 93 }, { text: "125.000", confidence: 88 }]);
    await engine.close();
    assert.deepEqual(calls, ["page one", "terminated"]);
  } finally {
    await rm(languageDataPath, { recursive: true, force: true });
  }
});
