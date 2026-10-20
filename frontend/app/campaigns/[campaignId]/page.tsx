"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import AuthenticatedLayout from "../../../components/AuthenticatedLayout";
import { requestJson } from "../../../lib/api";
import { formatMoney } from "../../../lib/formatMoney";
import { sumAmounts, formatMinorUnits } from "../../../lib/money";
import { useCurrentUser } from "../../../lib/useCurrentUser";
import { CHAIN, explorerTxUrl, proofStatusLabel, type Proof } from "../../../lib/blockchain";

type Campaign = {
  id: string;
  organizationId: string;
  funderId: string;
  title: string;
  description: string;
  totalBudget: string;
  currency: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED";
};

function campaignStatusLabel(status: Campaign["status"]) {
  if (status === "ACTIVE") return "Didanai";
  if (status === "DRAFT") return "Draf";
  if (status === "COMPLETED") return "Selesai";
  if (status === "CANCELLED") return "Dibatalkan";
  return status;
}

type Milestone = {
  id: string;
  title: string;
  description: string;
  budgetAmount: string;
  currency: string;
  orderIndex: number;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
};

type Evidence = {
  id: string;
  milestoneId: string;
  evidenceId?: string;
  evidenceType?: string;
  fileName?: string;
  contentType?: string;
  fileSize?: number;
  rawHash?: string;
  version?: number;
  previousEvidenceId?: string | null;
  status: string;
  evidenceStatus: "UPLOADED" | "PROCESSING" | "READY_FOR_REVIEW" | "PROCESSING_FAILED" | "SUPERSEDED";
  screeningStatus?: "PROCESSING" | "CLEAR" | "FLAGGED" | "FAILED" | null;
  flags?: EvidenceFlag[];
  verificationStatus?: "PENDING" | "VERIFIED" | "NEEDS_REVISION" | "REJECTED" | null;
  revisionInstructions?: string;
};

type EvidenceFlag = { code: string; field: string | null; severity: "LOW" | "MEDIUM" | "HIGH"; message: string };

async function fetchProofForEvidence(evidenceId: string): Promise<Proof | null> {
  try {
    const response = await requestJson<{ proof: Proof }>(`/api/evidence/${evidenceId}/proof`);
    return response.proof ?? null;
  } catch {
    return null;
  }
}

function evidenceStatusLabel(status: Evidence["evidenceStatus"]) {
  if (status === "PROCESSING") return "Memproses OCR";
  if (status === "READY_FOR_REVIEW") return "Siap ditinjau";
  if (status === "PROCESSING_FAILED") return "Pemrosesan gagal";
  if (status === "SUPERSEDED") return "Versi lama";
  return "Menunggu pemrosesan";
}

function screeningLabel(status: Evidence["screeningStatus"]) {
  if (status === "PROCESSING") return "Screening berjalan";
  if (status === "CLEAR") return "Tidak ada flag otomatis";
  if (status === "FLAGGED") return "Ada flag otomatis";
  if (status === "FAILED") return "Screening gagal";
  return "Belum ada hasil screening";
}

function screeningTone(status: Evidence["screeningStatus"]) {
  if (status === "FLAGGED" || status === "FAILED") return "warning";
  if (status === "PROCESSING") return "pending";
  return "neutral";
}

function verificationLabel(status: Evidence["verificationStatus"]) {
  if (status === "VERIFIED") return "Disetujui oleh quorum 2-dari-3";
  if (status === "NEEDS_REVISION") return "Perlu revisi oleh quorum";
  if (status === "REJECTED") return "Ditolak oleh quorum";
  if (status === "PENDING") return "Menunggu quorum verifier";
  return "Belum ditinjau";
}

function verificationTone(status: Evidence["verificationStatus"]) {
  if (status === "VERIFIED") return "success";
  if (status === "NEEDS_REVISION" || status === "REJECTED") return "warning";
  if (status === "PENDING") return "pending";
  return "neutral";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export default function CampaignDetailPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const { campaignId } = useParams<{ campaignId: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [evidenceByMilestone, setEvidenceByMilestone] = useState<Record<string, Evidence[]>>({});
  const [proofByEvidence, setProofByEvidence] = useState<Record<string, Proof | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [selectedMilestoneId, setSelectedMilestoneId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [evidenceType, setEvidenceType] = useState("RECEIPT");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [revisionFiles, setRevisionFiles] = useState<Record<string, File | null>>({});
  const [revisionErrors, setRevisionErrors] = useState<Record<string, string>>({});
  const [revisionUploadingId, setRevisionUploadingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const polling = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) {
      setRefreshing(true);
      setRefreshError("");
    } else {
      setLoading(true);
      setError("");
    }
    try {
      const [campaignResponse, milestoneResponse] = await Promise.all([
        requestJson<{ campaign: Campaign }>(`/api/campaigns/${campaignId}`),
        requestJson<{ milestones: Milestone[] }>(`/api/campaigns/${campaignId}/milestones`),
      ]);
      const evidenceResponses = await Promise.all(milestoneResponse.milestones.map((milestone) =>
        requestJson<{ evidence: Evidence[] }>(`/api/milestones/${milestone.id}/evidence`),
      ));
      setCampaign(campaignResponse.campaign);
      setMilestones(milestoneResponse.milestones);
      setEvidenceByMilestone(Object.fromEntries(milestoneResponse.milestones.map((milestone, index) => [milestone.id, evidenceResponses[index].evidence])));

      const allEvidence = milestoneResponse.milestones.flatMap(
        (milestone) => evidenceResponses[milestoneResponse.milestones.indexOf(milestone)]?.evidence ?? [],
      );
      const proofEntries = await Promise.all(
        allEvidence
          .filter((item) => item.verificationStatus === "VERIFIED")
          .map(async (item) => [item.id, await fetchProofForEvidence(item.id)] as const),
      );
      setProofByEvidence(Object.fromEntries(proofEntries));
    } catch {
      if (quiet) setRefreshError("Status belum diperbarui. Periksa koneksi atau perbarui lagi.");
      else setError("Campaign tidak ditemukan atau tidak dapat dimuat. Periksa akses lalu coba lagi.");
    } finally {
      if (quiet) setRefreshing(false);
      else setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const firstInProgress = milestones.find((milestone) => milestone.status === "IN_PROGRESS");
    setSelectedMilestoneId((current) => current && milestones.some((milestone) => milestone.id === current && milestone.status === "IN_PROGRESS")
      ? current
      : firstInProgress?.id ?? "");
  }, [milestones]);

  async function runAction(action: () => Promise<unknown>) {
    setActionError("");
    setPending(true);
    try {
      await action();
      await load(true);
    } catch {
      setActionError("Perubahan belum tersimpan. Muat ulang status lalu coba lagi.");
    } finally {
      setPending(false);
    }
  }

  async function addMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    setPending(true);
    try {
      await requestJson(`/api/campaigns/${campaignId}/milestones`, {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          budgetAmount,
          currency: campaign?.currency ?? "IDR",
          orderIndex: milestones.length,
        }),
      });
      setTitle("");
      setDescription("");
      setBudgetAmount("");
      await load(true);
    } catch {
      setActionError("Milestone belum dapat disimpan. Periksa anggaran dan data yang diisi.");
    } finally {
      setPending(false);
    }
  }

  async function uploadEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError("");
    if (!selectedFile || !selectedMilestoneId) {
      setUploadError("Pilih milestone dan file bukti sebelum mengunggah.");
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setUploadError("Ukuran file maksimal 10 MiB.");
      return;
    }

    const form = new FormData();
    form.append("file", selectedFile);
    form.append("evidenceType", evidenceType);
    setUploading(true);
    try {
      await requestJson<{ evidence: Evidence }>(`/api/milestones/${selectedMilestoneId}/evidence`, {
        method: "POST",
        body: form,
      });
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await load(true);
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "file_too_large") {
        setUploadError("Ukuran file maksimal 10 MiB.");
      } else if (cause instanceof Error && "code" in cause && cause.code === "invalid_upload") {
        setUploadError("File harus berupa PDF, JPG, atau PNG yang dapat dibaca.");
      } else {
        setUploadError("Bukti belum dapat diunggah. Periksa koneksi lalu coba lagi; file tetap dipilih.");
      }
    } finally {
      setUploading(false);
    }
  }

  async function uploadRevision(evidenceId: string) {
    const file = revisionFiles[evidenceId];
    setRevisionErrors((current) => ({ ...current, [evidenceId]: "" }));
    if (!file) {
      setRevisionErrors((current) => ({ ...current, [evidenceId]: "Pilih file revisi sebelum mengirim." }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setRevisionErrors((current) => ({ ...current, [evidenceId]: "Ukuran file maksimal 10 MiB." }));
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setRevisionUploadingId(evidenceId);
    try {
      await requestJson<{ evidence: Evidence }>(`/api/evidence/${evidenceId}/revisions`, { method: "POST", body: form });
      setRevisionFiles((current) => ({ ...current, [evidenceId]: null }));
      await load(true);
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "file_too_large") {
        setRevisionErrors((current) => ({ ...current, [evidenceId]: "Ukuran file maksimal 10 MiB." }));
      } else if (cause instanceof Error && "code" in cause && cause.code === "revision_not_allowed") {
        setRevisionErrors((current) => ({ ...current, [evidenceId]: "Revisi tidak lagi tersedia untuk evidence ini. Perbarui status." }));
      } else {
        setRevisionErrors((current) => ({ ...current, [evidenceId]: "File revisi belum dapat dikirim. File tetap dipilih agar dapat dicoba lagi." }));
      }
    } finally {
      setRevisionUploadingId(null);
    }
  }

  const canActivate = campaign && (user?.role === "ADMIN" || (user?.role === "FUNDER" && user.id === campaign.funderId));
  const canEditMilestones = campaign && user?.role === "ORGANIZER" && user.organizationId === campaign.organizationId;
  const canViewOrganizerEvidence = user?.role === "ORGANIZER";
  const allocatedBudget = sumAmounts(milestones.map((milestone) => milestone.budgetAmount));
  const uploadableMilestones = milestones.filter((milestone) => milestone.status === "IN_PROGRESS");
  const evidence = milestones.flatMap((milestone) => evidenceByMilestone[milestone.id] ?? []);
  const hasActiveOcr = evidence.some((item) => item.evidenceStatus === "PROCESSING" || item.screeningStatus === "PROCESSING");

  const allProofs = evidence
    .map((item) => proofByEvidence[item.id])
    .filter((proof): proof is Proof => proof !== null && proof !== undefined);
  const anchoredProofs = allProofs.filter((proof) => proof.status === "ANCHORED");
  const inFlightProofCount = allProofs.filter((proof) => proof.status === "PENDING" || proof.status === "ANCHORING").length;
  const hasFailedProof = allProofs.some((proof) => proof.status === "FAILED");
  const proofCount = allProofs.length;
  const hasInFlightProof = inFlightProofCount > 0;
  const latestAnchoredProof = anchoredProofs
    .sort((a, b) => (b.anchoredAt ?? b.createdAt).localeCompare(a.anchoredAt ?? a.createdAt))[0] ?? null;
  const hasAnchoredProof = latestAnchoredProof !== null;
  const proofBadgeText = hasAnchoredProof
    ? `Proof Anchored (${anchoredProofs.length})`
    : inFlightProofCount > 0
      ? "Pending anchoring"
      : hasFailedProof
        ? "Anchor gagal"
        : "Belum di-anchor";

  useEffect(() => {
    if (!hasActiveOcr && !hasInFlightProof) return;
    const timer = window.setInterval(() => {
      if (polling.current || document.visibilityState === "hidden") return;
      polling.current = true;
      void load(true).finally(() => { polling.current = false; });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasActiveOcr, hasInFlightProof, refreshError, load]);

  return (
    <AuthenticatedLayout title={campaign?.title ?? "Detail campaign"}>
      {(loading || userLoading) ? <div className="workspace-loading" aria-busy="true">Memuat detail campaign…</div> : error ? (
        <div className="workspace-error" role="alert"><p>{error}</p><button className="action-button action-button--secondary" onClick={() => void load()}>Coba lagi</button><Link href="/campaigns">Kembali ke campaign</Link></div>
      ) : campaign ? (
        <>
          {/* Section 15: Detail Tab Navigation */}
          <nav className="dt-detail-tabs-bar" aria-label="Navigasi bagian detail program">
            <a href="#campaign-summary-heading" className="dt-detail-tab dt-detail-tab--active">
              Overview
            </a>
            <a href="#milestones-heading" className="dt-detail-tab">
              Milestones
            </a>
            <a href="#evidence-heading" className="dt-detail-tab">
              Evidence
            </a>
            <Link href="/payment-reports" className="dt-detail-tab">
              Payment Reports
            </Link>
            <Link href="/reports" className="dt-detail-tab">
              Audit Trail
            </Link>
          </nav>

          <section className="workspace-panel campaign-overview" aria-labelledby="campaign-summary-heading">
            <div><p className="eyebrow">RINGKASAN</p><h2 id="campaign-summary-heading">Ringkasan campaign</h2><p>{campaign.description || "Belum ada deskripsi."}</p></div>
            <dl className="campaign-facts">
              <div><dt>Status campaign</dt><dd><span className="status-pill status-pill--pending">{campaignStatusLabel(campaign.status)}</span></dd></div>
              <div><dt>Anggaran</dt><dd>{formatMoney(campaign.totalBudget, campaign.currency)}</dd></div>
              <div><dt>Dialokasikan ke milestone</dt><dd>{formatMinorUnits(allocatedBudget, campaign.currency)}</dd></div>
            </dl>
            {canActivate && campaign.status === "DRAFT" && (
              <div className="workspace-actions">
                <button className="action-button action-button--primary" disabled={pending || milestones.length === 0} onClick={() => void runAction(() => requestJson(`/api/campaigns/${campaignId}/activate`, { method: "POST" }))}>
                  {pending ? "Memproses pendanaan…" : "Danai campaign"}
                </button>
                {milestones.length === 0 && <p className="field-hint">Tambahkan minimal satu milestone sebelum campaign didanai.</p>}
              </div>
            )}
          </section>

          <p className={actionError ? "workspace-error" : "visually-hidden"} role="alert" aria-live="assertive">{actionError}</p>

          <section className="workspace-panel" aria-labelledby="milestones-heading">
            <div className="workspace-title-row"><div><p className="eyebrow">TAHAP PROGRAM</p><h2 id="milestones-heading">Milestone</h2></div><p className="section-note">{milestones.length} milestone</p></div>
            {milestones.length === 0 ? <div className="workspace-empty"><h3>Belum ada milestone</h3><p>Tambahkan tahap pertama agar funder dapat mengaktifkan campaign.</p></div> : (
              <ol className="workspace-list milestone-workflow-list">
                {milestones.map((milestone) => (
                  <li className="workspace-list-item" key={milestone.id}>
                    <div><h3>{milestone.title}</h3><p>{milestone.description || "Belum ada deskripsi."}</p><p>{formatMoney(milestone.budgetAmount, milestone.currency)}</p></div>
                    <div className="milestone-actions"><span className="status-pill status-pill--pending">{milestone.status}</span>
                      {canEditMilestones && campaign.status === "ACTIVE" && milestone.status === "PLANNED" && <button className="action-button action-button--secondary" disabled={pending} onClick={() => void runAction(() => requestJson(`/api/milestones/${milestone.id}`, { method: "PATCH", body: JSON.stringify({ status: "IN_PROGRESS" }) }))}>Mulai milestone {milestone.title}</button>}
                      {canEditMilestones && campaign.status === "ACTIVE" && milestone.status === "IN_PROGRESS" && <button className="action-button action-button--secondary" disabled={pending} onClick={() => void runAction(() => requestJson(`/api/milestones/${milestone.id}`, { method: "PATCH", body: JSON.stringify({ status: "COMPLETED" }) }))}>Selesaikan milestone {milestone.title}</button>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="workspace-panel" aria-labelledby="evidence-heading">
            <div className="workspace-title-row"><div><p className="eyebrow">DOKUMEN PROGRAM</p><h2 id="evidence-heading">Evidence privat</h2></div><p className="section-note">{evidence.length} file</p></div>
            {refreshing && <p className="section-note" role="status" aria-live="polite">Memperbarui daftar evidence…</p>}
            {refreshError && <div className="workspace-error" role="alert"><p>{refreshError}</p><button className="action-button action-button--secondary" onClick={() => void load(true)}>Perbarui status</button></div>}
            {evidence.length === 0 ? <div className="workspace-empty"><h3>Belum ada evidence</h3><p>File asli hanya dapat diakses pihak yang berwenang.</p></div> : (
              <ul className="workspace-list">
                {evidence.map((item) => {
                  const evidenceTone = item.evidenceStatus === "PROCESSING" ? "pending" : item.evidenceStatus === "PROCESSING_FAILED" ? "warning" : "neutral";
                  const flags = item.flags ?? [];
                  const revisionFile = revisionFiles[item.id] ?? null;
                  const isAdminSummary = user?.role === "ADMIN";
                  return (
                    <li className="workspace-list-item evidence-list-item" key={item.id}>
                      <div>
                        <div className="evidence-heading"><h3>{canViewOrganizerEvidence ? item.fileName : isAdminSummary ? `Evidence ${item.id.slice(0, 8)}` : "Status evidence"}</h3><span className={`status-pill status-pill--${evidenceTone}`}>{evidenceStatusLabel(item.evidenceStatus)}</span></div>
                        {canViewOrganizerEvidence && <p>{item.evidenceType} · versi {item.version} · {item.fileSize ? formatFileSize(item.fileSize) : "ukuran tidak tersedia"}</p>}
                        <p className="evidence-screening-summary" role="status" aria-live="polite">
                          <span>Status review: <span className={`status-pill status-pill--${verificationTone(item.verificationStatus)}`}>{verificationLabel(item.verificationStatus)}</span></span>
                        </p>
                        {canViewOrganizerEvidence && item.screeningStatus !== undefined && <p className="evidence-screening-summary" role="status" aria-live="polite">
                          <span className={`status-pill status-pill--${screeningTone(item.screeningStatus)}`}>{screeningLabel(item.screeningStatus)}</span>
                          {item.screeningStatus === "CLEAR" && <span>Screening otomatis bukan keputusan verifikasi.</span>}
                        </p>}
                        {canViewOrganizerEvidence && flags.length > 0 && (
                          <ul className="evidence-flags" aria-label={`Flag screening untuk ${item.fileName ?? "evidence"}`}>
                            {flags.map((flag, index) => <li key={`${flag.code}-${flag.field ?? "general"}-${index}`}><span className="status-pill status-pill--warning">{flag.severity}</span><span>{flag.message}</span></li>)}
                          </ul>
                        )}
                        {canViewOrganizerEvidence && <details className="technical-details">
                          <summary>Rincian teknis</summary>
                          <dl><dt>Status evidence</dt><dd>{evidenceStatusLabel(item.evidenceStatus)}</dd><dt>Status screening</dt><dd>{screeningLabel(item.screeningStatus)}</dd>{item.rawHash && <><dt>Hash SHA-256</dt><dd><code>{item.rawHash}</code></dd></>}</dl>
                        </details>}
                        {canViewOrganizerEvidence && item.revisionInstructions && (
                          <section className="revision-instructions" aria-labelledby={`revision-instructions-${item.id}`}>
                            <p className="eyebrow">INSTRUKSI QUORUM</p>
                            <h4 id={`revision-instructions-${item.id}`}>Revisi evidence ini</h4>
                            <p>{item.revisionInstructions}</p>
                            <div className="form-field">
                              <label htmlFor={`revision-file-${item.id}`}>File pengganti</label>
                              <input id={`revision-file-${item.id}`} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setRevisionFiles((current) => ({ ...current, [item.id]: event.target.files?.[0] ?? null }))} />
                              <p className="field-hint">Jenis bukti mengikuti versi sebelumnya. Batas ukuran 10 MiB.</p>
                            </div>
                            {revisionFile && <p className="field-hint">File dipilih: {revisionFile.name} · {formatFileSize(revisionFile.size)}</p>}
                            <p className={revisionErrors[item.id] ? "workspace-error" : "visually-hidden"} role="alert" aria-live="assertive">{revisionErrors[item.id] ?? ""}</p>
                            <button className="action-button action-button--primary" type="button" disabled={revisionUploadingId === item.id || !revisionFile} aria-busy={revisionUploadingId === item.id} onClick={() => void uploadRevision(item.id)}>
                              {revisionUploadingId === item.id ? "Mengunggah revisi…" : "Kirim versi revisi"}
                            </button>
                          </section>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {canEditMilestones && campaign.status === "ACTIVE" && (
              uploadableMilestones.length === 0 ? <p className="field-hint">Mulai milestone sebelum mengunggah evidence.</p> : (
                <form className="form-grid evidence-upload-form" onSubmit={uploadEvidence} aria-busy={uploading}>
                  {uploadableMilestones.length > 1 && <div className="form-field form-field--full"><label htmlFor="evidence-milestone">Milestone untuk bukti</label><select id="evidence-milestone" value={selectedMilestoneId} onChange={(event) => setSelectedMilestoneId(event.target.value)}>{uploadableMilestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}</select></div>}
                  <div className="form-field"><label htmlFor="evidence-type">Jenis bukti</label><select id="evidence-type" value={evidenceType} onChange={(event) => setEvidenceType(event.target.value)}><option value="RECEIPT">Receipt</option><option value="INVOICE">Invoice</option><option value="PHOTO">Foto</option><option value="REPORT">Laporan</option><option value="CONTRACT">Kontrak</option><option value="OTHER">Lainnya</option></select></div>
                  <div className="form-field"><label htmlFor="evidence-file">Pilih file bukti</label><input ref={fileInput} id="evidence-file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></div>
                  {selectedFile && <p className="field-hint form-field--full">{selectedFile.name} · {formatFileSize(selectedFile.size)} · batas 10 MiB</p>}
                  <p className={uploadError ? "workspace-error form-field--full" : "visually-hidden"} role="alert" aria-live="assertive">{uploadError}</p>
                  <div className="workspace-actions form-field--full"><button className="action-button action-button--primary" type="submit" disabled={uploading || !selectedFile || !selectedMilestoneId} aria-busy={uploading}>{uploading ? "Mengunggah…" : "Unggah bukti"}</button></div>
                </form>
              )
            )}
          </section>

          {canEditMilestones && campaign.status === "DRAFT" && (
            <section className="workspace-panel" aria-labelledby="add-milestone-heading">
              <h2 id="add-milestone-heading">Tambah milestone</h2>
              <form className="form-grid" onSubmit={addMilestone} aria-busy={pending}>
                <div className="form-field form-field--full"><label htmlFor="milestone-title">Judul milestone</label><input id="milestone-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={160} required /></div>
                <div className="form-field form-field--full"><label htmlFor="milestone-description">Deskripsi milestone</label><textarea id="milestone-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} /></div>
                <div className="form-field"><label htmlFor="milestone-budget">Anggaran milestone</label><input id="milestone-budget" inputMode="decimal" value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} required /></div>
                <div className="form-field"><span className="field-label" id="milestone-currency-label">Mata uang</span><output aria-labelledby="milestone-currency-label">{campaign.currency}</output></div>
                <div className="workspace-actions form-field--full"><button className="action-button action-button--primary" type="submit" disabled={pending}>{pending ? "Menyimpan…" : "Tambah milestone"}</button></div>
              </form>
            </section>
          )}

          {/* Section 21: Blockchain Proof UI - real on-chain status only */}
          <section className="dt-blockchain-proof-card" aria-labelledby="blockchain-proof-heading">
            <div className="dt-proof-header">
              <div>
                <span className="dt-card-eyebrow">TRANSPARANSI KONSENSUS</span>
                <h2 id="blockchain-proof-heading" style={{ margin: 0, fontSize: "1.25rem", color: "#FFFFFF" }}>
                  Blockchain Proof
                </h2>
              </div>
              <span className={`dt-proof-badge ${hasAnchoredProof ? "" : "dt-proof-badge--idle"}`}>
                {proofBadgeText}
              </span>
            </div>

            <div className="dt-proof-grid">
              <div className="dt-proof-item">
                <span className="dt-proof-label">Tercatat di Jaringan</span>
                <span className="dt-proof-val">
                  {latestAnchoredProof ? CHAIN.name : "Belum ada proof tercatat"}
                </span>
              </div>
              <div className="dt-proof-item">
                <span className="dt-proof-label">Konsensus Verifier</span>
                <span className="dt-proof-val">2-of-3 Peer Quorum</span>
              </div>
              <div className="dt-proof-item">
                <span className="dt-proof-label">Status Penyaluran</span>
                <span className="dt-proof-val">
                  {campaign.status === "ACTIVE" ? "Didanai & Aktif" : campaignStatusLabel(campaign.status)}
                </span>
              </div>
            </div>

            {latestAnchoredProof ? (
              <>
                <p className="field-hint" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {proofStatusLabel(latestAnchoredProof.status)}
                  {anchoredProofs.length > 1 ? ` — ${anchoredProofs.length} evidence tercatat.` : ""}
                </p>
                <dl className="dt-proof-details">
                <div>
                  <dt>Package hash</dt>
                  <dd><code>{latestAnchoredProof.packageHash}</code></dd>
                </div>
                <div>
                  <dt>Tx</dt>
                  <dd>
                    {latestAnchoredProof.transactionHash ? (
                      <a
                        className="dt-proof-link-inline"
                        href={explorerTxUrl(latestAnchoredProof.transactionHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {latestAnchoredProof.transactionHash.slice(0, 10)}…{latestAnchoredProof.transactionHash.slice(-8)}
                      </a>
                    ) : "Tidak tersedia"}
                  </dd>
                </div>
                <div>
                  <dt>Blok</dt>
                  <dd>{latestAnchoredProof.blockNumber ?? "Tidak tersedia"}</dd>
                </div>
                <div>
                  <dt>Dicatat pada</dt>
                  <dd>
                    {latestAnchoredProof.anchoredAt
                      ? new Date(latestAnchoredProof.anchoredAt).toLocaleString("id-ID")
                      : "Tidak tersedia"}
                  </dd>
                </div>
              </dl>
              </>
            ) : (
              <p className="field-hint" style={{ color: "rgba(255,255,255,0.75)" }}>
                {proofCount === 0
                  ? "Proof blockchain dibuat otomatis setelah quorum 2-dari-3 verifier tercapai untuk sebuah evidence."
                  : `${proofCount} proof dalam proses pencatatan. Perbarui halaman untuk melihat status terbaru.`}
              </p>
            )}

            <Link href="/reports" className="dt-proof-link">
              <span>Buka laporan transparansi →</span>
            </Link>
          </section>
        </>
      ) : null}
    </AuthenticatedLayout>
  );
}
