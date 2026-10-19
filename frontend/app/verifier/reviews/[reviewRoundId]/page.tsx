"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import AuthenticatedLayout from "../../../../components/AuthenticatedLayout";
import { ApiError, requestJson } from "../../../../lib/api";
import { signTypedData, walletMessage, type TypedData } from "../../../../lib/verifierWallet";

type Decision = "VERIFIED" | "NEEDS_REVISION" | "REJECTED";
type WalletBinding = { walletAddress: string; rosterVersion: number; status: "ACTIVE" | "SUSPENDED" };
type EvidenceFlag = { code: string; field: string | null; severity: "LOW" | "MEDIUM" | "HIGH"; message: string };
type OcrRun = {
  runNumber: number;
  screeningStatus: string;
  vendor: string | null;
  documentDate: string | null;
  amount: string | null;
  currency: string | null;
  invoiceNumber: string | null;
  detectedLanguage: string;
  fieldConfidence: Record<string, number>;
  extractedText: string;
  failureCode: string | null;
  flags: EvidenceFlag[];
};
type ReviewDetail = {
  reviewRoundId: string;
  evidenceId: string;
  roundNumber: number;
  reviewRoundStatus: "OPEN" | "QUORUM_REACHED" | "NO_QUORUM";
  decision: Decision | null;
  fileName: string;
  evidenceType: string;
  evidenceVersion: number;
  fileSize: number;
  campaignId: string;
  campaignTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  ownVote: { decision: Decision; internalNotes: string; organizerInstructions: string | null; createdAt: string } | null;
};
type ReviewResponse = { review: ReviewDetail; ocr: { evidenceId: string; runs: OcrRun[] } };
type VotePreparation = { typedData: TypedData; instructionSalt: string | null };
type VoteResponse = { status: string; verificationStatus?: string; decision?: Decision | null; transactionHash?: string | null };

const DECISIONS: { value: Decision; label: string; help: string }[] = [
  { value: "VERIFIED", label: "Verified", help: "Bukti cukup untuk mendukung milestone." },
  { value: "NEEDS_REVISION", label: "Needs revision", help: "Minta Organizer melengkapi bukti dengan instruksi yang jelas." },
  { value: "REJECTED", label: "Rejected", help: "Bukti tidak mendukung milestone yang dilaporkan." },
];

function statusLabel(status: ReviewDetail["reviewRoundStatus"], decision: Decision | null) {
  if (status === "NO_QUORUM") return "Quorum belum tercapai — verifikasi tetap pending";
  if (status === "QUORUM_REACHED") return `Quorum tercapai — ${decision ?? "keputusan tersedia"}`;
  return "Menunggu vote Anda dan Verifier lain";
}

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export default function VerifierReviewDetailPage() {
  const { reviewRoundId } = useParams<{ reviewRoundId: string }>();
  const [detail, setDetail] = useState<ReviewResponse | null>(null);
  const [wallet, setWallet] = useState<WalletBinding | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<Decision | "">("");
  const [noConflictAttested, setNoConflictAttested] = useState(false);
  const [confirmedFinality, setConfirmedFinality] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [organizerInstructions, setOrganizerInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [reviewResponse, walletResponse] = await Promise.all([
        requestJson<ReviewResponse>(`/api/verifier/reviews/${reviewRoundId}`),
        requestJson<{ wallet: WalletBinding | null }>("/api/verifier/wallet"),
      ]);
      setDetail(reviewResponse);
      setWallet(walletResponse.wallet);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setError("Review ini tidak tersedia untuk akun Anda atau sudah tidak dapat dibuka.");
      else setError("Detail review belum dapat dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [reviewRoundId]);

  useEffect(() => { void load(); }, [load]);

  async function submitVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    setNotice("");
    if (!detail || !wallet || wallet.status !== "ACTIVE" || !decision) {
      setActionError("Hubungkan wallet aktif dan pilih keputusan sebelum menandatangani.");
      return;
    }
    if (!noConflictAttested) {
      setActionError("Konfirmasi bahwa tidak ada konflik kepentingan sebelum vote.");
      return;
    }
    if (!confirmedFinality) {
      setActionError("Konfirmasi bahwa vote yang ditandatangani tidak dapat diubah.");
      return;
    }
    if (decision === "NEEDS_REVISION" && !organizerInstructions.trim()) {
      setActionError("Tuliskan instruksi yang dapat ditindaklanjuti oleh Organizer.");
      return;
    }

    setBusy(true);
    try {
      const prepared = await requestJson<VotePreparation>(`/api/verifier/reviews/${reviewRoundId}/votes/prepare`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          ...(decision === "NEEDS_REVISION" ? { organizerInstructions: organizerInstructions.trim() } : {}),
          noConflictAttested: true,
        }),
      });
      if (!window.ethereum) throw Object.assign(new Error("wallet_not_available"), { code: "wallet_not_available" });
      const selected = await window.ethereum?.request({ method: "eth_requestAccounts" });
      const currentAddress = Array.isArray(selected) ? selected[0] : null;
      if (typeof currentAddress !== "string" || currentAddress.toLowerCase() !== wallet.walletAddress.toLowerCase()) {
        throw Object.assign(new Error("wallet_account_changed"), { code: "wallet_account_changed" });
      }
      const signature = await signTypedData(wallet.walletAddress, prepared.typedData);
      const result = await requestJson<VoteResponse>(`/api/verifier/reviews/${reviewRoundId}/votes`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          ...(decision === "NEEDS_REVISION" ? {
            organizerInstructions: organizerInstructions.trim(),
            instructionSalt: prepared.instructionSalt,
          } : {}),
          internalNotes,
          noConflictAttested: true,
          signature,
        }),
      });
      setNotice(result.status === "PENDING"
        ? "Vote tersimpan dan dikirim. Status tetap pending sampai receipt jaringan dikonfirmasi."
        : result.status === "NO_QUORUM"
          ? "Semua vote berbeda. Quorum tidak tercapai dan verifikasi tetap pending."
          : `Quorum dikonfirmasi: ${result.verificationStatus ?? result.status}.`);
      setDecision("");
      setInternalNotes("");
      setOrganizerInstructions("");
      setNoConflictAttested(false);
      setConfirmedFinality(false);
      await load(true);
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.code === "review_not_open") setActionError("Round sudah ditutup. Muat ulang status review.");
        else if (cause.code === "vote_already_submitted") setActionError("Vote untuk round ini sudah dikirim dan tidak dapat diubah.");
        else if (cause.code === "invalid_vote_signature") setActionError("Tanda tangan tidak cocok dengan keputusan dan evidence versi ini. Periksa wallet lalu coba lagi.");
        else setActionError("Vote belum dapat dikirim. Periksa koneksi dan status round lalu coba lagi.");
      } else {
        setActionError(walletMessage(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  const review = detail?.review;
  const canVote = review?.reviewRoundStatus === "OPEN" && !review.ownVote;

  return (
    <AuthenticatedLayout title="Detail review">
      <p className="review-breadcrumb"><Link href="/verifier/reviews">Kembali ke antrian review</Link></p>
      {loading ? <div className="workspace-loading" aria-busy="true">Memuat evidence privat dan OCR…</div> : error ? (
        <div className="workspace-error" role="alert"><p>{error}</p><button className="action-button action-button--secondary" type="button" onClick={() => void load()}>Coba lagi</button><Link href="/verifier/reviews">Kembali ke antrian</Link></div>
      ) : detail ? (
        <>
          <section className="workspace-panel verifier-evidence-summary" aria-labelledby="review-evidence-title">
            <div className="workspace-title-row">
              <div><p className="eyebrow">{review?.campaignTitle} · {review?.milestoneTitle}</p><h2 id="review-evidence-title">{review?.fileName}</h2></div>
              <span className={`status-pill ${review?.reviewRoundStatus === "OPEN" ? "status-pill--pending" : review?.reviewRoundStatus === "QUORUM_REACHED" ? "status-pill--success" : "status-pill--warning"}`}>
                {statusLabel(review!.reviewRoundStatus, review!.decision)}
              </span>
            </div>
            <p>{review?.evidenceType} · evidence versi {review?.evidenceVersion} · round {review?.roundNumber} · {sizeLabel(review!.fileSize)}</p>
            <a className="action-button action-button--secondary" href={`/api/evidence/${review?.evidenceId}/file`}>Unduh evidence asli {review?.fileName}</a>
            <ol className="quorum-seats" aria-label="Quorum membutuhkan dua vote yang sama dari tiga Verifier">
              <li className={review?.ownVote ? "quorum-seat quorum-seat--complete" : "quorum-seat quorum-seat--current"}>
                <span aria-hidden="true">{review?.ownVote ? "✓" : "1"}</span><span>{review?.ownVote ? "Vote Anda tersimpan" : "Anda"}</span>
              </li>
              <li className="quorum-seat quorum-seat--private"><span aria-hidden="true">2</span><span>Verifier lain</span></li>
              <li className="quorum-seat quorum-seat--private"><span aria-hidden="true">3</span><span>Verifier lain</span></li>
            </ol>
            <p className="field-hint">Identitas dan vote Verifier lain tetap privat sampai hasil quorum dikonfirmasi.</p>
          </section>

          <p className={notice ? "workspace-success" : "visually-hidden"} role="status" aria-live="polite">{notice}</p>
          {refreshing && <p className="section-note" role="status" aria-live="polite">Memperbarui hasil jaringan…</p>}

          <section className="workspace-panel" aria-labelledby="ocr-review-heading">
            <div className="workspace-title-row"><div><p className="eyebrow">SCREENING PENDUKUNG</p><h2 id="ocr-review-heading">Hasil OCR dan flags</h2></div></div>
            {detail.ocr.runs.length === 0 ? <p>Hasil OCR belum tersedia.</p> : (
              <ol className="ocr-run-list">
                {detail.ocr.runs.map((run) => (
                  <li className="ocr-run-item" key={run.runNumber}>
                    <div className="evidence-heading"><h3>OCR versi {run.runNumber}</h3><span className="status-pill status-pill--neutral">{run.screeningStatus}</span></div>
                    {run.failureCode && <p className="field-hint">Pemrosesan gagal: {run.failureCode}</p>}
                    <dl className="technical-details ocr-fields">
                      <dt>Vendor</dt><dd>{run.vendor ?? "Belum terbaca"} · confidence {run.fieldConfidence.vendor ?? 0}/100</dd>
                      <dt>Tanggal</dt><dd>{run.documentDate ?? "Belum terbaca"} · confidence {run.fieldConfidence.documentDate ?? 0}/100</dd>
                      <dt>Jumlah</dt><dd>{run.amount ? `${run.amount} ${run.currency ?? ""}`.trim() : "Belum terbaca"} · confidence {run.fieldConfidence.amount ?? 0}/100</dd>
                      <dt>Nomor invoice</dt><dd>{run.invoiceNumber ?? "Tidak terdeteksi"} · confidence {run.fieldConfidence.invoiceNumber ?? 0}/100</dd>
                      <dt>Bahasa</dt><dd>{run.detectedLanguage}</dd>
                    </dl>
                    {run.flags.length > 0 && <ul className="evidence-flags" aria-label={`Flag OCR versi ${run.runNumber}`}>{run.flags.map((flag, index) => <li key={`${flag.code}-${index}`}><span className="status-pill status-pill--warning">{flag.severity}</span><span>{flag.message}</span></li>)}</ul>}
                    <details className="technical-details"><summary>Teks OCR lengkap versi {run.runNumber}</summary><pre className="ocr-text">{run.extractedText || "Tidak ada teks yang berhasil dibaca."}</pre></details>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {review?.ownVote && (
            <section className="workspace-panel" aria-labelledby="own-vote-heading">
              <p className="eyebrow">CATATAN PRIVAT ANDA</p><h2 id="own-vote-heading">Vote tersimpan: {review.ownVote.decision}</h2>
              {review.ownVote.internalNotes && <p>{review.ownVote.internalNotes}</p>}
              <p className="field-hint">Vote dan catatan ini tidak dapat diubah setelah dikirim.</p>
            </section>
          )}

          {review?.reviewRoundStatus === "NO_QUORUM" && <div className="workspace-error" role="status"><p>Tiga vote berbeda. Evidence tetap pending; Admin tidak dapat mengubah hasil ini.</p></div>}
          {review?.reviewRoundStatus === "QUORUM_REACHED" && <div className="workspace-success" role="status"><p>Hasil quorum terkonfirmasi: {review.decision}.</p></div>}

          {canVote && (
            <section className="workspace-panel" aria-labelledby="cast-vote-heading">
              <p className="eyebrow">KEPUTUSAN ANDA</p><h2 id="cast-vote-heading">Tinjau evidence versi ini</h2>
              <form className="form-grid verifier-vote-form" onSubmit={submitVote} aria-busy={busy}>
                <fieldset className="decision-options form-field--full">
                  <legend>Keputusan</legend>
                  {DECISIONS.map((option) => (
                    <label className="decision-option" key={option.value}>
                      <input type="radio" name="decision" value={option.value} checked={decision === option.value} onChange={() => setDecision(option.value)} />
                      <span><strong>{option.label}</strong><small>{option.help}</small></span>
                    </label>
                  ))}
                </fieldset>
                {decision === "NEEDS_REVISION" && <div className="form-field form-field--full"><label htmlFor="organizer-instructions">Instruksi untuk Organizer</label><textarea id="organizer-instructions" rows={4} value={organizerInstructions} onChange={(event) => setOrganizerInstructions(event.target.value)} maxLength={4000} required aria-describedby="instructions-hint" /><p id="instructions-hint" className="field-hint">Instruksi menjadi bagian dari hasil quorum. Catatan internal Anda tetap terpisah.</p></div>}
                <div className="form-field form-field--full"><label htmlFor="internal-notes">Catatan internal reviewer</label><textarea id="internal-notes" rows={3} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} maxLength={4000} aria-describedby="notes-hint" /><p id="notes-hint" className="field-hint">Hanya Anda yang dapat melihat catatan ini.</p></div>
                <label className="verifier-attestation form-field--full"><input type="checkbox" checked={noConflictAttested} onChange={(event) => setNoConflictAttested(event.target.checked)} /> Saya tidak memiliki konflik kepentingan terhadap Organizer atau Funder pada evidence ini.</label>
                <label className="verifier-attestation form-field--full"><input type="checkbox" checked={confirmedFinality} onChange={(event) => setConfirmedFinality(event.target.checked)} /> Saya memahami vote yang ditandatangani tidak dapat diubah.</label>
                <p className={actionError ? "workspace-error form-field--full" : "visually-hidden form-field--full"} role="alert" aria-live="assertive">{actionError}</p>
                <div className="workspace-actions form-field--full"><button className="action-button action-button--primary" type="submit" disabled={busy} aria-busy={busy}>{busy ? "Menunggu tanda tangan dan receipt…" : decision ? `Tanda tangani dan kirim ${decision}` : "Pilih keputusan"}</button></div>
              </form>
            </section>
          )}
        </>
      ) : null}
    </AuthenticatedLayout>
  );
}
