import assert from "node:assert/strict";
import test from "node:test";

import { createAiEnricher } from "../../src/ocr/aiEnricher.js";

const BASE_PARSED = {
  vendor: "TOKO MAJU",
  documentDate: "2026-10-25",
  amount: "50000",
  currency: "IDR",
  invoiceNumber: "INV-2026-01",
  detectedLanguage: "id",
  fieldConfidence: { vendor: 95, documentDate: 96, amount: 97, invoiceNumber: 95 },
  extractedText: "TOKO MAJU",
};

function geminiConfig(overrides = {}) {
  return {
    enabled: true,
    apiKey: "test-key",
    model: "gemini-2.5-flash",
    timeoutMs: 5000,
    maxPages: 4,
    retries: 1,
    fieldThreshold: 80,
    maxOutputTokens: 2048,
    cooldownMs: 60000,
    ...overrides,
  };
}

function geminiPayload(overrides = {}) {
  return {
    vendor: "TOKO MAJU SEJATI",
    documentDate: "2026-10-25",
    amount: "85000",
    currency: "IDR",
    invoiceNumber: "INV-2026-01",
    fieldConfidence: { vendor: 92, documentDate: 90, amount: 95, invoiceNumber: 88 },
    notes: [],
    ...overrides,
  };
}

function envelopeOf(fields) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }] });
}

const ARRAY_ENVELOPE = JSON.stringify({ candidates: [{ content: { parts: [{ text: "[]" }] } }] });

function makeFetcher(respond) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const outcome = respond(calls.length) ?? { status: 200, body: envelopeOf(geminiPayload()) };
    return {
      status: outcome.status ?? 200,
      text: async () => {
        if (outcome.throw) throw outcome.throw;
        return typeof outcome.body === "string" ? outcome.body : JSON.stringify(outcome.body);
      },
    };
  };
  return { calls, fetchImpl };
}

function makeClock() {
  const nowMs = { value: 0 };
  const clock = () => new Date(nowMs.value);
  clock.advance = (milliseconds) => { nowMs.value += milliseconds; };
  return clock;
}

const INPUT = () => ({ parsed: structuredCloneSafe(BASE_PARSED), text: "TOKO MAJU", pages: [] });

function structuredCloneSafe(value) {
  return { ...value, fieldConfidence: { ...value.fieldConfidence } };
}

test("a transient server error is retried once and then applied", async () => {
  const { fetchImpl, calls } = makeFetcher((attempt) => (attempt === 1 ? { status: 503, body: "" } : { body: envelopeOf(geminiPayload()) }));
  const sleeps = [];
  const enricher = createAiEnricher({ config: geminiConfig(), fetchImpl, clock: makeClock(), sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } });
  const input = INPUT();
  input.parsed.amount = "50000";
  input.parsed.fieldConfidence.amount = 20;
  const outcome = await enricher.enrich(input);
  assert.equal(outcome.ai.status, "APPLIED");
  assert.equal(outcome.ai.attempts, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(outcome.merged.amount, "85000");
});

test("repeated server failures exhaust the retry budget and fail open", async () => {
  const { fetchImpl } = makeFetcher(() => ({ status: 503, body: "" }));
  const enricher = createAiEnricher({ config: geminiConfig(), fetchImpl, clock: makeClock() });
  const outcome = await enricher.enrich(INPUT());
  assert.equal(outcome.ai.status, "UNAVAILABLE");
  assert.equal(outcome.ai.reason, "SERVER_ERROR");
  assert.equal(outcome.ai.attempts, 2);
  assert.deepEqual(outcome.merged, BASE_PARSED);
  assert.equal(outcome.ai.responseSnippet, null);
});

test("network failures are retried then reported unavailable", async () => {
  const { fetchImpl } = makeFetcher(() => { throw new Error("ECONNRESET"); });
  const enricher = createAiEnricher({ config: geminiConfig(), fetchImpl, clock: makeClock() });
  const outcome = await enricher.enrich(INPUT());
  assert.equal(outcome.ai.reason, "NETWORK");
  assert.equal(outcome.ai.attempts, 2);
});

test("aborted requests are classified as timeouts and retried", async () => {
  const { fetchImpl } = makeFetcher(() => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); });
  const enricher = createAiEnricher({ config: geminiConfig(), fetchImpl, clock: makeClock() });
  const outcome = await enricher.enrich(INPUT());
  assert.equal(outcome.ai.reason, "TIMEOUT");
  assert.equal(outcome.ai.attempts, 2);
});

test("rate limiting skips retries and holds a cooldown before trying again", async () => {
  const clock = makeClock();
  let saturated = false;
  const { fetchImpl, calls } = makeFetcher(() => (saturated ? { body: envelopeOf(geminiPayload()) } : { status: 429, body: "" }));
  const enricher = createAiEnricher({ config: geminiConfig(), fetchImpl, clock });

  const first = await enricher.enrich(INPUT());
  assert.equal(first.ai.status, "UNAVAILABLE");
  assert.equal(first.ai.reason, "RATE_LIMITED");
  assert.equal(first.ai.attempts, 1);
  assert.equal(calls.length, 1);

  const second = await enricher.enrich(INPUT());
  assert.equal(second.ai.status, "UNAVAILABLE");
  assert.equal(second.ai.reason, "RATE_LIMITED");
  assert.equal(second.ai.attempts, 0);
  assert.equal(calls.length, 1);

  clock.advance(60000);
  saturated = true;
  const third = await enricher.enrich(INPUT());
  assert.equal(third.ai.status, "APPLIED");
  assert.equal(third.ai.attempts, 1);
  assert.equal(calls.length, 2);
});

test("an API key problem trips a permanent circuit breaker", async () => {
  const clock = makeClock();
  const { fetchImpl, calls } = makeFetcher(() => ({ status: 403, body: "" }));
  const enricher = createAiEnricher({ config: geminiConfig(), fetchImpl, clock });

  const first = await enricher.enrich(INPUT());
  assert.equal(first.ai.status, "UNAVAILABLE");
  assert.equal(first.ai.reason, "AUTH_FAILED");
  assert.equal(first.ai.attempts, 1);
  assert.equal(calls.length, 1);

  clock.advance(120000);
  const second = await enricher.enrich(INPUT());
  assert.equal(second.ai.status, "UNAVAILABLE");
  assert.equal(second.ai.reason, "AUTH_DISABLED");
  assert.equal(second.ai.attempts, 0);
  assert.equal(calls.length, 1);
});

test("malformed responses exhaust the retry budget and fail open", async () => {
  const { fetchImpl } = makeFetcher(() => ({ body: "bukan-json" }));
  const enricher = createAiEnricher({ config: geminiConfig(), fetchImpl, clock: makeClock() });
  const outcome = await enricher.enrich(INPUT());
  assert.equal(outcome.ai.reason, "MALFORMED_RESPONSE");
  assert.equal(outcome.ai.attempts, 2);
});

test("a rejected bad request is reported once without burning retries or the breaker", async () => {
  const clock = makeClock();
  let broken = false;
  const { fetchImpl, calls } = makeFetcher(() => (broken ? { body: envelopeOf(geminiPayload()) } : { status: 400, body: "" }));
  const enricher = createAiEnricher({ config: geminiConfig(), fetchImpl, clock });

  const first = await enricher.enrich(INPUT());
  assert.equal(first.ai.status, "UNAVAILABLE");
  assert.equal(first.ai.reason, "REQUEST_REJECTED");
  assert.equal(first.ai.attempts, 1);
  assert.equal(calls.length, 1);

  broken = true;
  const second = await enricher.enrich(INPUT());
  assert.equal(second.ai.status, "APPLIED");
  assert.equal(calls.length, 2);
});

test("enrich never throws even for structurally valid but unusable model output", async () => {
  const { fetchImpl } = makeFetcher(() => ({ body: ARRAY_ENVELOPE }));
  const enricher = createAiEnricher({ config: geminiConfig(), fetchImpl, clock: makeClock() });
  const outcome = await enricher.enrich(INPUT());
  assert.deepEqual(outcome.merged, BASE_PARSED);
  assert.equal(outcome.ai.status, "UNAVAILABLE");
  assert.equal(outcome.ai.reason, "MALFORMED_RESPONSE");
  assert.equal(outcome.ai.attempts, 2);
});

test("GEMINI_RETRIES=0 collapses the budget to a single attempt", async () => {
  const { fetchImpl, calls } = makeFetcher(() => ({ status: 503, body: "" }));
  const enricher = createAiEnricher({ config: geminiConfig({ retries: 0 }), fetchImpl, clock: makeClock() });
  const outcome = await enricher.enrich(INPUT());
  assert.equal(outcome.ai.reason, "SERVER_ERROR");
  assert.equal(outcome.ai.attempts, 1);
  assert.equal(calls.length, 1);
});
