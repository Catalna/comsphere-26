-- AI OCR enrichment provenance for ocr_runs (spec: docs/specs/2026-10-18-gemini-ocr-enrichment.md).
-- All AI notices live here, never in ai_flags: the screening status machine forbids
-- flags on a CLEAR run, and enrichment must not change deterministic screening decisions.
ALTER TABLE ocr_runs
  ADD COLUMN ai_model TEXT,
  ADD COLUMN ai_enrichment_status TEXT CHECK (ai_enrichment_status IS NULL OR ai_enrichment_status IN ('APPLIED', 'UNAVAILABLE', 'DISABLED')),
  ADD COLUMN ai_enrichment JSONB;
