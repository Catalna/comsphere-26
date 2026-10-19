# DanaTerang — AI and OCR Service

## 1. Purpose

The AI/OCR layer is a **decision-support system** for Indonesian- and English-language evidence.

It must not be treated as the final authority.

> AI gives flags, not verdicts.

## 2. Main Responsibilities

### OCR Extraction

Extract from receipts / invoices:

- vendor,
- date,
- total amount,
- invoice number,
- text content.

Record language and confidence per extracted field (`vendor`, `documentDate`, `amount`, `invoiceNumber`), normalized to integer values from 0 to 100. Do not rely on one overall confidence score for reviewer decisions.

### Consistency Checks

Examples:

- declared amount vs receipt amount,
- missing vendor,
- missing date,
- duplicate invoice number,
- duplicate evidence hash,
- suspicious date,
- amount above milestone budget,
- repeated receipt image.

### Screening Result

Recommended outputs:

- `CLEAR`
- `FLAGGED`
- `PROCESSING`

The system should also return reasons. `CLEAR` means only that the configured screening rules did not raise a flag; it is not a finding that the document or reported expense is true or valid.

Thresholds are field-specific. The `amount` threshold is stricter than the `vendor` threshold. A required OCR field below its own threshold creates a `LOW_CONFIDENCE_FIELD` flag, keeps screening from becoming `CLEAR`, and requires human review. Numeric thresholds are calibrated on representative Indonesian and English documents before the pilot; they are not fixed by this document.

Example:

```json
{
  "screeningStatus": "FLAGGED",
  "flags": [
    {
      "type": "AMOUNT_MISMATCH",
      "severity": "HIGH",
      "message": "Receipt amount exceeds milestone budget."
    }
  ]
}
```

## 3. Human Review

AI must never directly:

- label someone as fraudulent,
- approve a milestone,
- release funds,
- reject a program.

Final verification belongs to a permissioned panel of three independent Verifiers. Two matching EIP-712 signatures from distinct assigned Verifier wallets are required to finalize a decision. Admin is an operations role and cannot vote or override the quorum.

The quorum outcome applies to the submitted evidence version only. It is a review outcome, not a statutory audit, proof of real-world activity, or automatic authorization to release funds. A review with no quorum remains pending; it is never resolved by an Admin override.

## 4. Suggested Pipeline

```text
File Upload
→ Raw Hash
→ OCR
→ Field Normalization
→ Rule Checks
→ Duplicate Checks
→ Risk Flags
→ Human Review
```

## 5. MVP Technology

Current MVP option:

- Tesseract.js

Potential future options:

- PaddleOCR
- cloud OCR service
- LLM-assisted document extraction
- dedicated document AI

For the hackathon, rule-based anomaly checks are preferred over complex ML.

Phase 1 rules are lightweight advisory checks. Indonesian (`ind`) and English (`eng`) OCR are in scope. Field threshold values, reviewer guidance for uncertain fields, and production-grade screening quality require calibration before a real-world pilot.

## 6. Example Rules

### Amount Rule

If:

```text
receipt_total > milestone_budget
```

Then:

```text
FLAG: AMOUNT_MISMATCH
```

### Field Confidence Rule

For each required OCR field, compare its confidence to that field's configured threshold. The amount threshold is stricter than the vendor threshold. If a required value is below threshold, return `LOW_CONFIDENCE_FIELD`, set screening to `FLAGGED`, and require human review; do not return `CLEAR`. Numeric thresholds are calibrated from representative Indonesian and English documents before pilot use.

### Duplicate Rule

If two evidence records share:

- same raw hash, or
- same invoice number + vendor + date

Then:

```text
FLAG: POSSIBLE_DUPLICATE
```

### Missing Field Rule

If:

- amount missing,
- date missing,
- vendor missing

Then:

```text
FLAG: MISSING_FIELD
```

## 7. AI Service Interface

Suggested response:

```json
{
  "ocrResult": {
    "vendor": "PT Example",
    "documentDate": "2026-10-01",
    "amount": 30000000,
    "invoiceNumber": "INV-2026-001",
    "language": "id",
    "fieldConfidence": {
      "vendor": 94,
      "documentDate": 89,
      "amount": 98,
      "invoiceNumber": 91
    }
  },
  "screeningStatus": "CLEAR",
  "flags": []
}
```
