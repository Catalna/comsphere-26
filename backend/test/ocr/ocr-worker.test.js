import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createOcrWorker } from "../../src/ocr/ocrWorker.js";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const JOB = {
  jobId: "job-1",
  runId: "run-1",
  runNumber: 1,
  evidenceId: "evidence-1",
  storageKey: "00000000-0000-4000-8000-000000000001",
  rawHash: createHash("sha256").update("private bytes").digest("hex"),
  fileSize: Buffer.byteLength("private bytes"),
  milestoneBudget: "100000.00",
  milestoneCurrency: "IDR",
  campaignStartDate: "2026-01-01",
  campaignEndDate: "2026-12-31",
};

function workerDependencies(overrides = {}) {
  const calls = { claims: [], renewals: [], completions: [], failures: [], reads: [], recognized: [], closed: 0 };
  const repository = {
    async claimNextJob(input) { calls.claims.push(input); return JOB; },
    async renewLease(input) { calls.renewals.push(input); return true; },
    async findDuplicateCandidates() { return []; },
    async completeRun(input) { calls.completions.push(input); },
    async failRun(input) { calls.failures.push(input); },
    ...overrides.repository,
  };
  const storage = {
    async readObject(key) { calls.reads.push(key); return Buffer.from("private bytes"); },
    ...overrides.storage,
  };
  const renderer = {
    async *renderEvidencePages() { yield { pageNumber: 1, bytes: Buffer.from("rendered page"), width: 100, height: 100 }; },
    ...overrides.renderer,
  };
  const engine = {
    async initialize() {},
    async recognize(bytes) {
      calls.recognized.push(bytes.toString());
      return {
        text: "TOKO MAJU\nTanggal: 25 Okt 2026\nInvoice No: INV-2026-01\nTotal: Rp 50.000",
        words: [
          { text: "TOKO", confidence: 95 }, { text: "MAJU", confidence: 95 },
          { text: "25", confidence: 95 }, { text: "Okt", confidence: 95 }, { text: "2026", confidence: 95 },
          { text: "INV-2026-01", confidence: 95 }, { text: "50.000", confidence: 95 },
        ],
      };
    },
    async close() { calls.closed += 1; },
    ...overrides.engine,
  };
  return { calls, repository, storage, renderer, engine };
}

test("worker reads private bytes, processes pages, and persists a terminal screening result", async () => {
  const dependencies = workerDependencies();
  const worker = createOcrWorker({ ...dependencies, workerId: "worker-1", clock: () => NOW });
  try {
    assert.equal(await worker.runOnce(), true);
    assert.deepEqual(dependencies.calls.reads, [JOB.storageKey]);
    assert.deepEqual(dependencies.calls.recognized, ["rendered page"]);
    assert.equal(dependencies.calls.completions.length, 1);
    assert.equal(dependencies.calls.completions[0].result.screeningStatus, "CLEAR");
    assert.equal(dependencies.calls.completions[0].result.parsed.amount, "50000");
    assert.equal(dependencies.calls.completions[0].result.parsed.extractedText.includes("TOKO MAJU"), true);
    assert.equal(dependencies.calls.failures.length, 0);
  } finally {
    await worker.stop();
  }
  assert.equal(dependencies.calls.closed, 1);
});

test("worker preserves advisory screening flags instead of clearing an over-budget receipt", async () => {
  const dependencies = workerDependencies({
    engine: {
      async recognize() {
        return {
          text: "TOKO MAJU\nInvoice Date: 01 Oct 2026\nInvoice No: INV-OVER\nTotal: Rp 150.000",
          words: [
            { text: "TOKO", confidence: 95 }, { text: "MAJU", confidence: 95 },
            { text: "01", confidence: 95 }, { text: "Oct", confidence: 95 }, { text: "2026", confidence: 95 },
            { text: "INV-OVER", confidence: 95 }, { text: "150.000", confidence: 95 },
          ],
        };
      },
    },
  });
  const worker = createOcrWorker({ ...dependencies, workerId: "worker-1", clock: () => NOW });
  try {
    await worker.runOnce();
    assert.equal(dependencies.calls.completions[0].result.screeningStatus, "FLAGGED");
    assert.ok(dependencies.calls.completions[0].result.flags.some((flag) => flag.code === "AMOUNT_MISMATCH"));
  } finally {
    await worker.stop();
  }
});

test("worker persists a safe retryable failure without forwarding document text", async () => {
  const dependencies = workerDependencies({
    engine: { async initialize() { throw Object.assign(new Error("private detail"), { code: "OCR_LANGUAGE_DATA_MISSING" }); } },
  });
  const worker = createOcrWorker({ ...dependencies, workerId: "worker-1", clock: () => NOW });
  try {
    assert.equal(await worker.runOnce(), true);
    assert.deepEqual(dependencies.calls.failures, [{ jobId: "job-1", runId: "run-1", leaseOwner: "worker-1", failureCode: "OCR_LANGUAGE_DATA_MISSING", now: NOW }]);
    assert.equal(dependencies.calls.completions.length, 0);
  } finally {
    await worker.stop();
  }
});

test("worker rechecks the stored bytes against the original SHA-256 before OCR", async () => {
  const dependencies = workerDependencies({ storage: { async readObject() { return Buffer.from("tampered byte"); } } });
  const worker = createOcrWorker({ ...dependencies, workerId: "worker-1", clock: () => NOW });
  try {
    await worker.runOnce();
    assert.equal(dependencies.calls.completions.length, 0);
    assert.equal(dependencies.calls.failures[0].failureCode, "STORED_OBJECT_HASH_MISMATCH");
    assert.equal(dependencies.calls.recognized.length, 0);
  } finally {
    await worker.stop();
  }
});

test("worker renews leases while a long OCR page is processing", async () => {
  const dependencies = workerDependencies({
    engine: {
      async recognize() {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { text: "TOKO MAJU", words: [{ text: "TOKO", confidence: 95 }, { text: "MAJU", confidence: 95 }] };
      },
    },
  });
  const worker = createOcrWorker({ ...dependencies, workerId: "worker-1", leaseMs: 30, clock: () => NOW });
  try {
    await worker.runOnce();
    assert.ok(dependencies.calls.renewals.length >= 1);
    assert.ok(dependencies.calls.renewals.every((renewal) => renewal.jobId === "job-1" && renewal.leaseOwner === "worker-1"));
  } finally {
    await worker.stop();
  }
});

test("worker loop stops polling and terminates the OCR engine gracefully", async () => {
  const dependencies = workerDependencies({ repository: { async claimNextJob() { dependencies.calls.claims.push({}); return null; } } });
  const worker = createOcrWorker({ ...dependencies, workerId: "worker-1", pollIntervalMs: 5, clock: () => NOW });
  const loop = worker.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await worker.stop();
  await loop;
  const claimCount = dependencies.calls.claims.length;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(claimCount >= 1);
  assert.equal(dependencies.calls.claims.length, claimCount);
  assert.equal(dependencies.calls.closed, 1);
});
