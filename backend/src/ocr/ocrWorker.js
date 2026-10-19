import { randomUUID } from "node:crypto";
import { hashRawEvidence } from "@dana-terang/proof";

import { parseOcrDocument } from "./documentParser.js";
import { screenOcrResult } from "./screeningRules.js";

const MAX_OCR_TEXT_CHARS = 1_000_000;
const SAFE_PROCESSING_CODES = new Set([
  "OCR_LANGUAGE_DATA_MISSING", "OCR_ENGINE_UNAVAILABLE", "OCR_RECOGNITION_FAILED",
  "INVALID_PDF", "ENCRYPTED_PDF", "INVALID_IMAGE", "IMAGE_PIXEL_LIMIT_EXCEEDED",
  "PDF_PAGE_LIMIT_EXCEEDED", "INVALID_PDF_PAGE", "UNSUPPORTED_DOCUMENT_TYPE",
  "INVALID_OCR_CONFIGURATION", "FILE_TOO_LARGE", "OCR_EMPTY_DOCUMENT", "STORED_OBJECT_UNAVAILABLE",
  "STORED_OBJECT_HASH_MISMATCH",
]);

function workerError(code) {
  return Object.assign(new Error(code), { code });
}

function safeFailureCode(error) {
  return SAFE_PROCESSING_CODES.has(error?.code) ? error.code : "OCR_PROCESSING_FAILED";
}

async function readPrivateObject(storage, key, { maxBytes, expectedSize }) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > maxBytes) {
    throw workerError("FILE_TOO_LARGE");
  }
  let source;
  try {
    source = await storage.readObject(key);
  } catch {
    throw workerError("STORED_OBJECT_UNAVAILABLE");
  }
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    const bytes = Buffer.from(source);
    if (bytes.length > maxBytes) throw workerError("FILE_TOO_LARGE");
    return bytes;
  }
  if (typeof source?.transformToByteArray === "function") {
    const bytes = Buffer.from(await source.transformToByteArray());
    if (bytes.length > maxBytes) throw workerError("FILE_TOO_LARGE");
    return bytes;
  }
  if (!source || typeof source[Symbol.asyncIterator] !== "function") throw workerError("STORED_OBJECT_UNAVAILABLE");
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of source) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > maxBytes) throw workerError("FILE_TOO_LARGE");
      chunks.push(bytes);
    }
  } catch (error) {
    if (error?.code === "FILE_TOO_LARGE") throw error;
    throw workerError("STORED_OBJECT_UNAVAILABLE");
  }
  if (length === 0) throw workerError("STORED_OBJECT_UNAVAILABLE");
  return Buffer.concat(chunks, length);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createOcrWorker({
  repository,
  storage,
  renderer,
  engine,
  enricher = null,
  aiMaxPages = 4,
  thresholds,
  pollIntervalMs = 1000,
  leaseMs = 300000,
  maxAttempts = 3,
  maxPdfPages = 10,
  renderDpi = 150,
  maxImagePixels = 25000000,
  maxEvidenceBytes = 10 * 1024 * 1024,
  workerId = randomUUID(),
  clock = () => new Date(),
  sleep = wait,
  onError = () => {},
} = {}) {
  if (!repository || !storage || !renderer || !engine) throw new TypeError("OCR worker dependencies are required");
  if (enricher && typeof enricher.enrich !== "function") throw new TypeError("enricher must expose an enrich function");
  let stopping = false;
  let loopPromise = null;
  let engineClosed = false;

  async function runOnce() {
    const claimedAt = clock();
    const job = await repository.claimNextJob({ leaseOwner: workerId, leaseMs, maxAttempts, now: claimedAt });
    if (!job) return false;

    let heartbeatError = null;
    let heartbeatPromise = null;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatPromise) return;
      heartbeatPromise = repository.renewLease({ jobId: job.jobId, leaseOwner: workerId, leaseMs, now: clock() })
        .then((renewed) => { if (!renewed) heartbeatError = workerError("OCR_JOB_LEASE_LOST"); })
        .catch(() => { heartbeatError = workerError("OCR_LEASE_RENEWAL_FAILED"); })
        .finally(() => { heartbeatPromise = null; });
    }, Math.max(10, Math.floor(leaseMs / 3)));
    heartbeatTimer.unref?.();

    try {
      let result;
      try {
        await engine.initialize();
        const original = await readPrivateObject(storage, job.storageKey, { maxBytes: maxEvidenceBytes, expectedSize: job.fileSize });
        if (hashRawEvidence(original) !== job.rawHash) throw workerError("STORED_OBJECT_HASH_MISMATCH");
        const pagesText = [];
        const words = [];
        const aiPages = [];
        for await (const page of renderer.renderEvidencePages({
          bytes: original,
          contentType: job.contentType,
          maxPages: maxPdfPages,
          maxPixels: maxImagePixels,
          dpi: renderDpi,
        })) {
          if (enricher && aiPages.length < aiMaxPages) aiPages.push(page.bytes);
          const recognition = await engine.recognize(page.bytes);
          if (recognition.text) pagesText.push(recognition.text);
          if (Array.isArray(recognition.words)) words.push(...recognition.words);
        }
        const text = pagesText.join("\n");
        if (text.length > MAX_OCR_TEXT_CHARS) throw workerError("OCR_TEXT_LIMIT_EXCEEDED");
        if (!text.trim() && words.length === 0) throw workerError("OCR_EMPTY_DOCUMENT");
        let parsed = parseOcrDocument({ text, words });
        let ai = null;
        if (enricher) {
          try {
            const enrichment = await enricher.enrich({ parsed, text, pages: aiPages });
            if (enrichment && enrichment.merged) parsed = enrichment.merged;
            if (enrichment && enrichment.ai) ai = enrichment.ai;
          } catch {
            ai = {
              status: "UNAVAILABLE", reason: "ENRICHER_FAILURE", model: null, promptHash: null,
              pagesSent: 0, durationMs: 0, attempts: 0, responseSnippet: null, fields: null,
            };
          }
        }
        const duplicateMatches = await repository.findDuplicateCandidates({ campaignId: job.campaignId, evidenceId: job.evidenceId });
        const screening = screenOcrResult({
          parsed,
          rawHash: job.rawHash,
          milestone: { budgetAmount: job.milestoneBudget, currency: job.milestoneCurrency },
          campaign: { startDate: job.campaignStartDate, endDate: job.campaignEndDate },
          thresholds,
          duplicateMatches,
          today: clock().toISOString().slice(0, 10),
        });
        result = { parsed, ...screening };
        if (ai) result.ai = ai;
      } catch (error) {
        if (heartbeatError?.code === "OCR_JOB_LEASE_LOST" || error?.code === "OCR_JOB_LEASE_LOST") return true;
        await repository.failRun({
          jobId: job.jobId,
          runId: job.runId,
          leaseOwner: workerId,
          failureCode: safeFailureCode(error),
          now: clock(),
        });
        return true;
      }

      if (heartbeatError) throw heartbeatError;
      await repository.completeRun({ jobId: job.jobId, runId: job.runId, leaseOwner: workerId, result, now: clock() });
      return true;
    } finally {
      clearInterval(heartbeatTimer);
      if (heartbeatPromise) await heartbeatPromise;
    }
  }

  async function workLoop() {
    stopping = false;
    while (!stopping) {
      try {
        const processed = await runOnce();
        if (!processed && !stopping) await sleep(pollIntervalMs);
      } catch (error) {
        try { onError({ workerId, code: safeFailureCode(error) }); } catch { /* Logging must not stop the worker. */ }
        if (!stopping) await sleep(pollIntervalMs);
      }
    }
  }

  return Object.freeze({
    runOnce,
    start() {
      if (loopPromise) return loopPromise;
      stopping = false;
      loopPromise = workLoop().finally(() => { loopPromise = null; });
      return loopPromise;
    },
    async stop() {
      stopping = true;
      if (loopPromise) await loopPromise;
      if (!engineClosed) {
        engineClosed = true;
        await engine.close?.();
      }
    },
  });
}
