# Design — Enrichment OCR dengan Gemini (Google AI Studio)

- Status: approved (desain disetujui user pada 2026-10-18; belum diimplementasikan)
- Terkait: `docs/specs/2026-10-05-ocr-screening-design.md`, `docs/specs/2026-10-06-peer-review-design.md`, `docs/specs/2026-10-15-system-completion-design.md`
- Fitur demo Web3 Sepolia terkait: round review Compsphere 2026 (lihat `docs/plans/2026-10-07-blockchain-sepolia-golive.md`)

## 1. Latar belakang & keputusan

Pipeline OCR saat ini (Tesseract LSTM + `documentParser` regex + `screeningRules` deterministik) gagal
membaca dokumen nyata yang tidak menulis field secara kaku: contoh nyata `SOP_Member.pdf` —
`documentDate` null, `currency` tidak terbaca, `amount` tertangkap salah oleh regex (`"2027"`).
Skor/keputusan screening tetap benar secara prosedur, tapi field input-nya jelek.

Keputusan user (2026-10-18):

1. **Selalu koreksi** — setiap dokumen dilewati Gemini, bukan hanya saat field hilang.
2. **Kirim gambar + teks** — halaman hasil render dikirim ke API Google bersama teks Tesseract.
3. **Skor 100% deterministik** — rumus `screeningRules` (threshold + flag + status) TIDAK berubah;
   LLM hanya menyapu/melengkapi **field**. LLM tidak pernah memutuskan lolos/tidaknya bukti.
4. Implementasi dimulai **setelah** demo vote Sepolia selesai (round tetap menunggu kuorum).

## 2. Arsitektur

```
claimNextJob → readPrivateObject → hash check
  → renderer.renderEvidencePages()  (PNG per halaman, sudah ada)
  → tesseract.recognize (sudah ada)                 [teks mentah = ground truth]
  → parseOcrDocument (sudah ada)
  → ✨ BARU: enrichOcrResult (aiEnricher)  — koreksi field via Gemini, merge deterministik
  → findDuplicateCandidates + screenOcrResult  (rumus TIDAK diubah)
  → completeRun  (field merged + provenance AI disimpan)
  → createRound (otomatis, seperti sekarang)
```

### 2.1 Modul baru `backend/src/ocr/aiEnricher.js`

`createAiEnricher({ fetchImpl = fetch, clock, config })` mengembalikan
`enrich({ parsed, text, pages })` yang mengembalikan:

```ts
{
  merged: {          // bentuk sama dengan keluaran parseOcrDocument
    vendor, documentDate, amount, currency, invoiceNumber,
    detectedLanguage,           // tetap dari parser (franc), TIDAK diganti
    fieldConfidence,            // confidence final dari field yang dipakai
    extractedText,              // TETAP teks mentah Tesseract, tidak pernah diubah
  },
  ai: {              // provenance, selalu ada (walau status unavailable)
    status,                   // "APPLIED" | "UNAVAILABLE" | "DISABLED"
    reason,                   // null saat APPLIED; kode kegagalan (§4a) selain itu
    model, promptHash, pagesSent, durationMs, attempts,
    responseSnippet,          // respons mentah dipotong ≤ 16 KB
    fields: {                 // per field: sumber & keputusan merge
      vendor: { source: "tesseract"|"gemini"|"none", diverged, geminiValue,
                tesseractConfidence, aiConfidence },
      ...documentDate / amount / currency / invoiceNumber sama
    },
  },
}
```

> **Amandemen implementasi (2026-10-19):** `infoFlags` (pemberitahuan AI seperti
> `AI_FIELD_DIVERGENCE` / `AI_ENRICHMENT_UNAVAILABLE`) **dihapus** dari bentuk keluaran.
> Divergensi kini ditandai per field sebagai `ai.fields.<field>.diverged = true` dan
> ketidaktersediaan sebagai `ai.status = "UNAVAILABLE"` + `reason` (§4a). Lihat §11.
Worker param baru `enricher = null` (dependency injection supaya terus teruji unit tanpa jaringan).
Ketika `GEMINI_ENABLED=false` atau `enricher` tidak diset → status `DISABLED`, `merged === parsed`,
perilaku pipeline **identik dengan hari ini** (default). Kunci API tidak pernah masuk log.

### 2.2 Penyisipan di `ocrWorker.js` (`runOnce`)

- Loop render mempertahankan maksimum `GEMINI_MAX_PAGES` buffer halaman pertama untuk dikirim ke AI
  (RGBA/PNG apa adanya dari renderer, DPI 150 — payload ≤ ~2,5 MB/halaman; tidak ada downscale di v1).
- Setelah `const parsed = parseOcrDocument({ text, words })` dan **sebelum**
  `findDuplicateCandidates`/`screenOcrResult` → panggil `enricher.enrich(...)`; duplikasi dan screening
  dievaluasi atas field yang sudah diperbaiki (dua-duanya memakai vendor/mitra & tanggal, jadi merge
  lebih dulu juga meningkatkan akurasi deteksi duplikat).
- **Amandemen implementasi (2026-10-19):** pemberitahuan AI **TIDAK** dimasukkan ke `screening.flags`
  (tautan lama yang menyebut `infoFlags` teks di atas sudah kedaluwarsa). Screening tetap murni
  aturan — `screening_status = CLEAR` selalu 0 flag. Seluruh provenance AI (`result.ai`) disimpan ke
  kolom `ocr_runs.ai_enrichment` JSONB + `ai_model` + `ai_enrichment_status` (§6); divergensi field
  halaman verifier membacanya dari JSONB, bukan dari tabel flag. Jika `enricher.enrich` sendiri melempar,
  worker membentuk `ai = { status: "UNAVAILABLE", reason: "ENRICHER_FAILURE", … }` (fail-open).

### 2.3 Aturan merge field (deterministik, tanpa heuristik LLM)

Per field: `(tesseractValue, tConf)` vs `(geminiValue, gConf)`:

| # | Kondisi | Hasil |
|---|---|---|
| 1 | Tesseract ada & valid, Gemini null/invalid | pakai Tesseract, `source=tesseract` |
| 2 | Tesseract null/kosong, Gemini valid | pakai Gemini, `source=gemini` (ini kasus utama: field hilang) |
| 3 | Keduada sama (normalisasi sama) | pakai Tesseract (dianggap konfirmasi) |
| 4 | Berbeda: `gConf >= GEMINI_FIELD_THRESHOLD` && `tConf < threshold field` | pakai Gemini, `source=gemini` (kasus typo/regex salah cap) |
| 5 | Berbeda lainnya | pakai Tesseract + `infoFlag AI_FIELD_DIVERGENCE` (MEDIUM, field) — bisa terlihat verifier |

Normalisasi sebelum membandingkan (wajib, memakai aturan yang sudah kuat di kode):

- `documentDate` → ISO `YYYY-MM-DD` (validasi kalender, pola `validIsoDate` di `screeningRules`)
- `amount` → string desimal `^\d+(?:\.\d{1,6})?$`, ≤ 32 karakter (pola `decimalParts`)
- `currency` → uppercase, harus anggota `CURRENCY_CODES` (`["IDR","USD","EUR","GBP","SGD","AUD","CAD","MYR","JPY"]`)
- `vendor`, `invoiceNumber` → trim; `invoiceNumber` pola `[A-Z0-9][A-Z0-9/. _-]{1,39}`
- Nilai yang tidak lolos normalisasi dianggap **invalid** (diperlakukan seperti null) — tidak ada
  jalur agar output LLM yang kotor memasuki screening.

`fieldConfidence` final = confidence field yang dipakai (dari words Tesseract bila `source=tesseract`;
dari `gConf` bila `source=gemini`) — Node perhitungan screening memakai angka yang sama seperti
hari ini, hanya nilainya lebih bagus.

## 3. Kontrak API Gemini (REST, tanpa dependency baru)

- `POST https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent`,
  header `x-goog-api-key: <GEMINI_API_KEY>`; `fetch` bawaan Node 20 (+ `AbortController` timeout).
- Body: `contents[0].parts` = [ `inline_data` (mime `image/png`) per halaman maksimal
  `GEMINI_MAX_PAGES` ] + `text` instruksi, teks Tesseract (caps ≤ 40.000 chars) dan JSON parse awal.
- `generationConfig`: `temperature: 0`, `responseMimeType: "application/json"`,
  `maxOutputTokens: 2048`.
- Model default: `gemini-2.5-flash` (cek ulang model free tier terbaru saat implementasi).
- Prompt menuntut: `null` bila field tidak terlihat di gambar/teks — **"jangan menebak/mengarang"**;
  format keluaran `{ vendor, documentDate, amount, currency, invoiceNumber,
  fieldConfidence: {...}, notes: [...] }`; confidence integer 0–100.
- Validasi respons terhadap skema di atas; respons tanpa field wajib atau JSON rusak
  = `AI_ENRICHMENT_UNAVAILABLE` (bukan error fatal).

## 4. Kegagalan, kuota, dan keamanan (fail-open)

Setiap kegagalan menghasilkan `ai.status = "UNAVAILABLE"` + `reason` (kode string ≤ 64 char,
divalidasi `ocrRepository.validateAiEnrichment`) dan pipeline lanjut dengan hasil Tesseract:

| Situasi | `reason` | Perlakuan |
|---|---|---|
| `GEMINI_ENABLED=false` / key kosong | `GEMINI_DISABLED` | status `DISABLED`; tidak memanggil API (perilaku = pipeline hari ini) |
| AbortController `{GEMINI_TIMEOUT_MS}` lewat | `TIMEOUT` | retry (§4a); habis budget → `UNAVAILABLE` |
| error jaringan / fetch throw | `NETWORK` | retry (§4a); habis budget → `UNAVAILABLE` |
| HTTP 429 | `RATE_LIMITED` | cooldown per-proses `GEMINI_COOLDOWN_MS` (default 60 s); selama cooldown request berikut langsung `UNAVAILABLE`/`RATE_LIMITED` tanpa call |
| HTTP 401/403 | `AUTH_FAILED` | circuit-breaker: `authBroken=true` untuk lifetime proses; call berikutnya langsung `DISABLED`-reason `AUTH_DISABLED`; log error konfigurasi |
| HTTP 400 | `REQUEST_REJECTED` | tanpa retry (payload permanent terjawab); `UNAVAILABLE` |
| HTTP ≥ 300 lain (5xx dsb.) | `SERVER_ERROR` | retry (§4a); habis budget → `UNAVAILABLE` |
| Respons JSON rusak / skema tidak valid | `MALFORMED_RESPONSE` | budget coba ulang sama seperti di atas; habis → `UNAVAILABLE` |
| `enricher.enrich` melempar di luar dugaan | `ENRICHER_FAILURE` | worker menangkap try/catch; `UNAVAILABLE`, pipeline jalan |
| Unknown | `UNKNOWN` | fallback untuk mekanika tak terduga — tetap fail-open |

**Tidak ada jalur yang membuat evidence gagal hanya karena Gemini bermasalah.** Hasil OCR Tesseract
tetap tersimpan dan round tetap terbentuk — prinsip fail-open tetap menjadi jantung supaya
keputusan deterministik screening tidak tersentuh.

### 4a. Mekanika retry/cooldown/breaker (`aiEnricher.js`)

- Budget percobaan per run = `1 + max(0, GEMINI_RETRIES)` (default 2 call).
- Backoff antar percobaan = `RETRY_BACKOFF_MS` (konstanta modul, 2 s, tanpa jitter pada v1).
- `RATE_LIMITED` → set `cooldownUntil = now + GEMINI_COOLDOWN_MS`, hentikan loop attempt saat itu
  juga; request berikutnya (run/evidence lain) yang datang saat cooldown **tidak** memanggil API.
- `AUTH_FAILED` → set `authBroken = true` permanent-proses; call berikutnya melaporkan
  `reason = "AUTH_DISABLED"` tanpa jaringan. Reset hanya via restart proses (ganti key = restart).
- `REQUEST_REJECTED` → tidak di-retry (input memang salah).
- `TIMEOUT`/`NETWORK`/`SERVER_ERROR` dan `MALFORMED_RESPONSE` → diretry selama masih ada budget.
- Semua state breaker/cooldown adalah **in-memory per proses**; tidak ada persistensi DB.

## 5. Data & privacy

- Yang dikirim ke Google: N halaman PNG pertama + teks OCR + parse awal. Tidak ada kredensial,
  tidak ada PII user platform, tidak ada data on-chain.
- **Free tier AI Studio**: konten dapat dipakai Google untuk perbaikan produk → hanya untuk demo +
  materi latihan; untuk produksi nyata gunakan **tier berbayar** (data tidak digunakan training) atau
  model lokal — dicat sebagai tindak lanjut.
- Kunci API di `backend/.env` (gitignored, pola sama dengan `BLOCKCHAIN_RPC_URL`).
- Teks evidence `extracted_text` TIDAK PERNAH diganti keluaran LLM — hanya tersimpan sebagai
  `ai.responseSnippet` (≤ 16 KB) di provenance.

## 6. Skema DB — migration `010_ai_enrichment.sql`

Tabel `ocr_runs` (pemilik tabel adalah migration 004) bertambah tiga kolom nullable:

```sql
ALTER TABLE ocr_runs
  ADD COLUMN ai_model            TEXT,
  ADD COLUMN ai_enrichment_status TEXT,     -- APPLIED | UNAVAILABLE | DISABLED
  ADD COLUMN ai_enrichment       JSONB;     -- provenance penuh (§2.1)
```

- `completeRun` (ocrRepository) menulis ketiga kolom (parameter `$12`–`$14`: `ai_model`,
  `ai_enrichment_status`, `ai_enrichment`); bentuk JSONB divalidasi `validateAiEnrichment`
  (status ∈ {APPLIED, UNAVAILABLE, DISABLED}, `reason` string ≤ 64 char, `model` ≤ 128 char atau null).
- **Amandemen implementasi (2026-10-19):** pemberitahuan AI **TIDAK** masuk tabel `ai_flags`.
  Tabel `ai_flags` tetap diisi DELETE+INSERT untuk flag aturan screening (pola lama, dari
  `result.flags`), karena infrastruktur `screening CLEAR` mensyaratkan 0 flag sedangkan
  pemberitahuan AI boleh hadir pada evidence CLEAR. Max `ocr_runs` + `ai_enrichment` JSONB-lah
  sumber kebenaran untuk pemberitahuan AI (divergensi per field, status, dan reason codes).
- Kolom nullable → run lama tertampil tanpa perlu backfill; tidak ada perubahan di tabel lain,
  tidak ada perubahan kontrak API publik, tidak ada perubahan hash/komitmen on-chain
  (`rawHash` file dan `evidence_commitment` tidak tersentuh — OCR murni data sisi server).

## 7. Konfigurasi (dibaca di `backend/src/ocr/config.js`, pola integer() yang ada)

| Env | Default | Keterangan |
|---|---|---|
| `GEMINI_ENABLED` | `false` | fitur mati total sampai diaktifkan manual |
| `GEMINI_API_KEY` | — | kunci Google AI Studio (backend/.env) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | pin model eksplisit (perubahan = keputusan tertulis) |
| `GEMINI_TIMEOUT_MS` | `30000` | timeout per request |
| `GEMINI_MAX_PAGES` | `4` | halaman terdepan dikirim; sisanya hanya teks |
| `GEMINI_RETRIES` | `1` | retry untuk timeout/5xx |
| `GEMINI_FIELD_THRESHOLD` | `80` | ambang penerimaan nilai Gemini saat bergantian (§2.3 #4) |
| `GEMINI_MAX_OUTPUT_TOKENS` | `2048` | jaga biaya token respons |
| `GEMINI_COOLDOWN_MS` | `60000` | cooldown setelah HTTP 429 |

## 8. Pengujian

1. **Unit — merge matrix** (`backend/test/ocr/ai-enricher-merge.test.js`): semua 5 baris tabel §2.3 +
   normalisasi menyelamatkan nilai kotor (tanggal non-ISO, amount berformat, currency di luar enum).
2. **Unit — kegagalan fail-open** (`backend/test/ocr/ai-enricher-failures.test.js`):
   timeout, 429, 403 (circuit breaker), JSON rusak → `merged === parsed`, flag tersedia, tidak throw.
3. **Integrasi worker** (`backend/test/ocr/ocr-worker-enrichment.test.js`): stub renderer+engine+enricher —
   field terdiperbaiki mengikuti alur ke dedupe & screening; info flags tidak mengubah
   `screening_status`; gaya mengikuti test worker yang sudah pernah ditulis.
4. **Regresi penuh**: backend suite (baseline 169 lulus) + `npm test` root.
5. **Smoke produksi**: aktifkan → upload ulang `SOP_Member.pdf`-like → bandingkan
   `documentDate`/`currency`/`amount` pre/post + `ai_enrichment_status=APPLIED` + determinisme
   sisi rating tidak berubah (angka skor sama pada field yang sama).

## 9. Rencana rollout (urutan manual)

1. Migration 010 dijalankan (server boot atau `npm run db:migrate` pola yang ada).
2. Isi `GEMINI_API_KEY` di `backend/.env`; set `GEMINI_ENABLED=true`.
3. Restart API server (worker OCR hidup di server yang sama).
4. Upload dokumen uji (campaign Compsphere 2026; panel roster 3 wallet sudah terbind).
5. Verifikasi DB (kolom ai_*) + UI flags, lalu biarkan round terbentuk seperti biasa.

## 10. Di luar ruang lingkup (tindak lanjut potensial)

- UI badge provenance (sumber field: Tesseract/Gemini) di halaman verifier — membawa kolom `ai_*`
  ke endpoint detail; kecil tapi sampel demo terpisah.
- Consent per-campaign (organizer/funder menyetel pengiriman data eksternal) — wajib kalau
  platform akan dijalankan dengan data nyata.
- LLM vision sebagai jalur pembacaan penuh bila teks Tesseract kosong (scan nol karakter) —
  ISA ackahan; tidak mengubah keputusan screening, hanya memberi teks mentah pilihan kedua.
- Multi-model router (fallback model kedua) & pelacakan biaya kuota bulanan.

## 11. Amandemen implementasi (2026-10-19)

Rekapitulasi perbedaan spesifikasi awal vs kode final (semua telah teruji di test suite):

1. **Disposisi pemberitahuan AI** — keputusan merge & kegagalan AI disimpan di
   `ocr_runs.ai_enrichment` (JSONB) + `ai_model` + `ai_enrichment_status` (§2.1, §2.2, §6).
   Tidak ada flag AI di `screening.flags` maupun tabel `ai_flags` — screening CLEAR tetap 0 flag.
   Divergensi field dijadikan marker `ai.fields.<field>.diverged = true`.
2. **Reason codes** (§4): `GEMINI_DISABLED`, `TIMEOUT`, `NETWORK`, `SERVER_ERROR`,
   `RATE_LIMITED`, `AUTH_FAILED` (breaker → `AUTH_DISABLED`), `REQUEST_REJECTED`,
   `MALFORMED_RESPONSE`, `ENRICHER_FAILURE`, `UNKNOWN`.
3. **Mekanika ketangguhan** (§4a): budget `1 + GEMINI_RETRIES`, backoff 2 s, cooldown 60 s
   setelah 429, circuit breaker lifetime proses setelah 401/403 — semuanya in-memory, fail-open.
4. **Pengujian** — hasil final backend 208/208 lulus (baseline di §8 dibangun dari 169),
   `npm test` root exit 0 (termasuk E2E browser frontend hijau: overflow `html` diperbaiki via
   `overflow-x: clip` di `frontend/app/globals.css` — di luar lingkup spesifik ini, dicatat
   agar konteks tanggal cocok).
