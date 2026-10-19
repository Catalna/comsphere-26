import { access } from "node:fs/promises";
import { join } from "node:path";

function engineError(code) {
  return Object.assign(new Error(code), { code });
}

async function createDefaultWorker({ languages, languageDataPath }) {
  const { createWorker, OEM } = await import("tesseract.js");
  return createWorker(languages, OEM.LSTM_ONLY, {
    langPath: languageDataPath,
    cacheMethod: "none",
    gzip: false,
    logger: () => {},
  });
}

function wordRows(data) {
  if (Array.isArray(data?.words)) return data.words;
  const words = [];
  for (const block of data?.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) words.push(...(line.words ?? []));
    }
  }
  return words;
}

export function createTesseractEngine({ languageDataPath, createWorker = createDefaultWorker } = {}) {
  const localLanguageDataPath = typeof languageDataPath === "string" && languageDataPath.trim().length > 0
    ? languageDataPath
    : null;
  let worker = null;

  return Object.freeze({
    async initialize() {
      if (worker) return;
      if (!localLanguageDataPath) throw engineError("OCR_LANGUAGE_DATA_MISSING");
      try {
        await Promise.all([
          access(join(localLanguageDataPath, "ind.traineddata")),
          access(join(localLanguageDataPath, "eng.traineddata")),
        ]);
      } catch {
        throw engineError("OCR_LANGUAGE_DATA_MISSING");
      }
      try {
        worker = await createWorker({ languages: "ind+eng", languageDataPath: localLanguageDataPath, download: false });
      } catch {
        throw engineError("OCR_ENGINE_UNAVAILABLE");
      }
      if (!worker || typeof worker.recognize !== "function" || typeof worker.terminate !== "function") {
        worker = null;
        throw engineError("OCR_ENGINE_UNAVAILABLE");
      }
    },

    async recognize(bytes) {
      if (!worker) throw engineError("OCR_ENGINE_NOT_INITIALIZED");
      try {
        const { data } = await worker.recognize(bytes, {}, { blocks: true });
        return {
          text: typeof data?.text === "string" ? data.text : "",
          words: wordRows(data).flatMap((word) => {
            if (typeof word?.text !== "string" || !Number.isFinite(word.confidence)) return [];
            return [{ text: word.text, confidence: Math.max(0, Math.min(100, Math.round(word.confidence))) }];
          }),
        };
      } catch {
        throw engineError("OCR_RECOGNITION_FAILED");
      }
    },

    async close() {
      if (!worker) return;
      const current = worker;
      worker = null;
      await current.terminate();
    },
  });
}
