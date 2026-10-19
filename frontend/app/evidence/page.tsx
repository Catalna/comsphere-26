"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  Search,
  Sparkles,
  FileCheck,
} from "lucide-react";

import AuthenticatedLayout from "../../components/AuthenticatedLayout";
import { requestJson } from "../../lib/api";
import { loadCampaignTree, type CampaignSummary, type EvidenceSummary, type MilestoneSummary } from "../../lib/campaignTree";
import { useCurrentUser } from "../../lib/useCurrentUser";

type Campaign = CampaignSummary;
type Milestone = MilestoneSummary;

type Evidence = EvidenceSummary;

function formatFileSize(bytes?: number) {
  if (!bytes) return "Ukuran tidak tersedia";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function screeningBadge(status?: Evidence["screeningStatus"]) {
  if (status === "CLEAR") return { label: "Screening Bersih", tone: "success" };
  if (status === "FLAGGED") return { label: "Ada Catatan AI", tone: "warning" };
  if (status === "PROCESSING") return { label: "OCR Memproses", tone: "pending" };
  if (status === "FAILED") return { label: "Gagal Scan", tone: "danger" };
  return { label: "Menunggu Scan", tone: "neutral" };
}

function quorumBadge(status?: Evidence["verificationStatus"]) {
  if (status === "VERIFIED") return { label: "Disetujui Quorum 2-dari-3", tone: "success" };
  if (status === "NEEDS_REVISION") return { label: "Perlu Revisi Dokumen", tone: "warning" };
  if (status === "REJECTED") return { label: "Ditolak Verifier", tone: "danger" };
  if (status === "PENDING") return { label: "Menunggu Review Verifier", tone: "pending" };
  return { label: "Belum Ditinjau", tone: "neutral" };
}

export default function EvidencePage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const tree = await loadCampaignTree();
      setCampaigns(tree.campaigns);
      setMilestones(tree.milestones);
      setEvidenceList(tree.evidence);
    } catch {
      setError("Gagal memuat dokumen bukti. Silakan periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const milestoneMap = useMemo(() => {
    const map = new Map<string, Milestone>();
    milestones.forEach((m) => map.set(m.id, m));
    return map;
  }, [milestones]);

  const campaignMap = useMemo(() => {
    const map = new Map<string, Campaign>();
    campaigns.forEach((c) => map.set(c.id, c));
    return map;
  }, [campaigns]);

  const filteredEvidence = useMemo(() => {
    return evidenceList.filter((e) => {
      const name = (e.fileName || `Evidence ${e.id.slice(0, 8)}`).toLowerCase();
      const matchesSearch = name.includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (filterStatus === "ALL") return true;
      if (filterStatus === "VERIFIED") return e.verificationStatus === "VERIFIED";
      if (filterStatus === "PENDING") return e.verificationStatus === "PENDING";
      if (filterStatus === "REVISION") return e.verificationStatus === "NEEDS_REVISION";
      if (filterStatus === "OCR_FLAG") return e.screeningStatus === "FLAGGED";
      return true;
    });
  }, [evidenceList, searchQuery, filterStatus]);

  const verifiedCount = evidenceList.filter((e) => e.verificationStatus === "VERIFIED").length;
  const pendingCount = evidenceList.filter((e) => e.verificationStatus === "PENDING").length;
  const revisionCount = evidenceList.filter((e) => e.verificationStatus === "NEEDS_REVISION").length;

  return (
    <AuthenticatedLayout
      title="Dokumen & Bukti (Evidence)"
      subtitle="Ruang penyimpanan berkas faktur, kuitansi, dan bukti sah pengeluaran program."
      actions={
        <Link className="action-button action-button--primary" href="/campaigns">
          <FileCheck size={16} aria-hidden="true" />
          <span>Unggah di Campaign</span>
        </Link>
      }
    >
      {(loading || userLoading) && (
        <div className="workspace-loading" aria-busy="true">
          Memuat seluruh dokumen bukti…
        </div>
      )}

      {error && (
        <div className="workspace-error" role="alert">
          <p>{error}</p>
          <button className="action-button action-button--secondary" onClick={() => void loadData()}>
            Coba lagi
          </button>
        </div>
      )}

      {!loading && !userLoading && (
        <div className="evidence-page-shell">
          {/* Quick Metrics */}
          <section className="dashboard-stats-grid" aria-label="Statistik Dokumen Bukti">
            <div className="stat-card stat-card--teal">
              <div className="stat-card-header">
                <span className="stat-card-label">Total Berkas Bukti</span>
                <div className="stat-card-icon" aria-hidden="true">
                  <FileText size={20} />
                </div>
              </div>
              <div className="stat-card-body">
                <strong className="stat-card-val">{evidenceList.length} Dokumen</strong>
                <span className="stat-card-note">Tersimpan dengan enkripsi dan hash SHA-256</span>
              </div>
            </div>

            <div className="stat-card stat-card--lime">
              <div className="stat-card-header">
                <span className="stat-card-label">Disetujui Quorum</span>
                <div className="stat-card-icon" aria-hidden="true">
                  <CheckCircle2 size={20} />
                </div>
              </div>
              <div className="stat-card-body">
                <strong className="stat-card-val">{verifiedCount} Terverifikasi</strong>
                <span className="stat-card-note">Lolos verifikasi peer verifier 2-dari-3</span>
              </div>
            </div>

            <div className="stat-card stat-card--blue">
              <div className="stat-card-header">
                <span className="stat-card-label">Menunggu Quorum</span>
                <div className="stat-card-icon" aria-hidden="true">
                  <Clock size={20} />
                </div>
              </div>
              <div className="stat-card-body">
                <strong className="stat-card-val">{pendingCount} Menunggu</strong>
                <span className="stat-card-note">Sedang dalam antrean review verifier</span>
              </div>
            </div>

            <div className="stat-card stat-card--purple">
              <div className="stat-card-header">
                <span className="stat-card-label">Perlu Revisi</span>
                <div className="stat-card-icon" aria-hidden="true">
                  <AlertTriangle size={20} />
                </div>
              </div>
              <div className="stat-card-body">
                <strong className="stat-card-val">{revisionCount} Dokumen</strong>
                <span className="stat-card-note">Memerlukan koreksi berkas atau kejelasan nota</span>
              </div>
            </div>
          </section>

          {/* Search & Filter Toolbar */}
          <div className="campaigns-toolbar">
            <div className="toolbar-search-box">
              <Search size={16} className="search-icon" aria-hidden="true" />
              <input
                type="search"
                className="search-input"
                placeholder="Cari nama berkas bukti…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Cari berkas bukti"
              />
            </div>

            <div className="toolbar-filters">
              <button
                type="button"
                className={`filter-pill ${filterStatus === "ALL" ? "filter-pill--active" : ""}`}
                onClick={() => setFilterStatus("ALL")}
              >
                Semua ({evidenceList.length})
              </button>
              <button
                type="button"
                className={`filter-pill ${filterStatus === "VERIFIED" ? "filter-pill--active" : ""}`}
                onClick={() => setFilterStatus("VERIFIED")}
              >
                Disetujui ({verifiedCount})
              </button>
              <button
                type="button"
                className={`filter-pill ${filterStatus === "PENDING" ? "filter-pill--active" : ""}`}
                onClick={() => setFilterStatus("PENDING")}
              >
                Menunggu ({pendingCount})
              </button>
              <button
                type="button"
                className={`filter-pill ${filterStatus === "REVISION" ? "filter-pill--active" : ""}`}
                onClick={() => setFilterStatus("REVISION")}
              >
                Perlu Revisi ({revisionCount})
              </button>
            </div>
          </div>

          {/* Evidence List */}
          {filteredEvidence.length === 0 ? (
            <div className="workspace-empty">
              <div className="workspace-empty-icon" aria-hidden="true">
                <FileText size={40} />
              </div>
              <h3>Belum ada berkas bukti yang sesuai</h3>
              <p>
                Bukti pengeluaran diunggah di dalam halaman detail campaign saat milestone berstatus
                aktif (IN_PROGRESS).
              </p>
              <Link href="/campaigns" className="action-button action-button--primary">
                Buka Campaign Saya
              </Link>
            </div>
          ) : (
            <div className="evidence-grid-cards">
              {filteredEvidence.map((item) => {
                const milestone = milestoneMap.get(item.milestoneId);
                const campaign = milestone ? campaignMap.get(milestone.campaignId) : null;
                const scrBadge = screeningBadge(item.screeningStatus);
                const qrmBadge = quorumBadge(item.verificationStatus);

                return (
                  <div key={item.id} className="evidence-vault-card">
                    <div className="evidence-vault-header">
                      <div className="vault-file-icon" aria-hidden="true">
                        <FileText size={22} />
                      </div>
                      <div className="vault-file-details">
                        <h4 className="vault-file-name" title={item.fileName}>
                          {item.fileName || `Evidence #${item.id.slice(0, 8)}`}
                        </h4>
                        <span className="vault-file-meta">
                          {item.evidenceType || "RECEIPT"} · versi {item.version || 1} ·{" "}
                          {formatFileSize(item.fileSize)}
                        </span>
                      </div>
                    </div>

                    <div className="evidence-status-badges">
                      <div className="badge-row">
                        <span className="badge-legend">Review Quorum:</span>
                        <span className={`status-pill-modern status-pill-modern--${qrmBadge.tone}`}>
                          {qrmBadge.label}
                        </span>
                      </div>
                      <div className="badge-row">
                        <span className="badge-legend">Screening AI:</span>
                        <span className={`status-pill-modern status-pill-modern--${scrBadge.tone}`}>
                          {scrBadge.label}
                        </span>
                      </div>
                    </div>

                    {item.revisionInstructions && (
                      <div className="vault-revision-alert">
                        <strong>Catatan Verifier:</strong>
                        <p>{item.revisionInstructions}</p>
                      </div>
                    )}

                    <div className="vault-card-footer">
                      <div className="vault-campaign-info">
                        {campaign && (
                          <span className="vault-campaign-title">
                            Program: <strong>{campaign.title}</strong>
                          </span>
                        )}
                        {milestone && (
                          <span className="vault-milestone-title">Tahap: {milestone.title}</span>
                        )}
                      </div>

                      {campaign && (
                        <Link
                          href={`/campaigns/${campaign.id}`}
                          className="action-button action-button--secondary btn-compact"
                        >
                          <span>Kelola di Campaign</span>
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Guide Card */}
          <section className="workspace-panel milestone-info-banner" aria-labelledby="guide-evidence-heading">
            <div className="info-banner-icon" aria-hidden="true">
              <Sparkles size={24} />
            </div>
            <div className="info-banner-text">
              <h3 id="guide-evidence-heading">Standar Bukti Sah DanaTerang</h3>
              <p>
                Gunakan kuitansi bertanda tangan, stempel toko, atau faktur pajak resmi. Pastikan nominal
                terbaca tajam agar pemindaian OCR AI otomatis memberikan skor validitas tinggi dan
                mempercepat quorum verifier menyetujui pencairan dana berikutnya.
              </p>
            </div>
          </section>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
