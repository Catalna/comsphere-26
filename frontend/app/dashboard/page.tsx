"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Plus,
  FolderKanban,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Calendar,
  Filter,
  MoreHorizontal,
} from "lucide-react";

import AuthenticatedLayout from "../../components/AuthenticatedLayout";
import { CampaignTreeError, loadCampaignTree, type CampaignSummary, type EvidenceSummary, type MilestoneSummary } from "../../lib/campaignTree";
import { formatMinorUnits, sumAmounts } from "../../lib/money";
import { useCurrentUser } from "../../lib/useCurrentUser";

type Campaign = CampaignSummary;
type Milestone = MilestoneSummary;
type Evidence = EvidenceSummary;

export default function DashboardPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [partialError, setPartialError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    setPartialError("");
    try {
      const tree = await loadCampaignTree();
      setCampaigns(tree.campaigns);
      setMilestones(tree.milestones);
      setEvidenceList(tree.evidence);
    } catch (cause) {
      setCampaigns([]);
      setMilestones([]);
      setEvidenceList([]);
      if (cause instanceof CampaignTreeError) {
        setPartialError(`Sebagian data belum dapat dimuat (${cause.failedRequest}). Angka di bawah mungkin belum lengkap. Muat ulang setelah koneksi pulih.`);
      } else {
        setError("Gagal memuat data dashboard.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Aggregate numbers per DesignUI.md Section 9, 10, 11, 12, 13
  const totalBudgetUnits = useMemo(
    () => sumAmounts(campaigns.map((campaign) => campaign.totalBudget)),
    [campaigns],
  );
  const allocatedBudgetUnits = useMemo(
    () => sumAmounts(milestones.map((milestone) => milestone.budgetAmount)),
    [milestones],
  );
  const completedBudgetUnits = useMemo(
    () => sumAmounts(
      milestones.filter((milestone) => milestone.status === "COMPLETED").map((milestone) => milestone.budgetAmount),
    ),
    [milestones],
  );
  const unallocatedBudgetUnits = useMemo(
    () => (totalBudgetUnits > allocatedBudgetUnits ? totalBudgetUnits - allocatedBudgetUnits : BigInt(0)),
    [totalBudgetUnits, allocatedBudgetUnits],
  );

  const activeProgramsCount = campaigns.filter((campaign) => campaign.status === "ACTIVE").length;
  const draftProgramsCount = campaigns.filter((campaign) => campaign.status === "DRAFT").length;
  const approvedMilestonesCount = milestones.filter((milestone) => milestone.status === "COMPLETED").length;
  const completionPct = milestones.length > 0
    ? Math.round((approvedMilestonesCount / milestones.length) * 100)
    : 0;

  const verifiedEvidenceCount = evidenceList.filter((item) => item.verificationStatus === "VERIFIED").length;
  const pendingEvidenceCount = evidenceList.filter((item) => item.verificationStatus === "PENDING").length;
  const revisionEvidenceCount = evidenceList.filter((item) => item.verificationStatus === "NEEDS_REVISION").length;
  const needsReviewCount = pendingEvidenceCount + revisionEvidenceCount;
  const verificationPct = evidenceList.length > 0
    ? Math.round((verifiedEvidenceCount / evidenceList.length) * 100)
    : 0;

  const currency = campaigns[0]?.currency || "IDR";

  return (
    <AuthenticatedLayout
      title="Program Overview"
      subtitle="Track funding accountability and verification progress."
      badgeCount={{ evidence: needsReviewCount }}
      actions={
        <div className="dt-dash-header-actions">
          <div className="dt-dash-btn-group">
            <button type="button" className="action-button action-button--secondary dt-timeframe-btn">
              <Calendar size={14} aria-hidden="true" />
              <span>Tahun ini</span>
            </button>
            <button type="button" className="action-button action-button--secondary dt-filter-icon-btn" aria-label="Filter">
              <Filter size={14} aria-hidden="true" />
              <span>Filter</span>
            </button>
          </div>
          {user?.role === "ORGANIZER" && (
            <Link className="action-button action-button--primary" href="/campaigns/new">
              <Plus size={16} aria-hidden="true" />
              <span>Buat campaign</span>
            </Link>
          )}
        </div>
      }
    >
      {(loading || userLoading) && (
        <div className="workspace-loading" aria-busy="true">
          Memuat ringkasan dashboard…
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

      {!error && partialError && (
        <div className="workspace-error" role="alert">
          <p>{partialError}</p>
          <button className="action-button action-button--secondary" onClick={() => void loadData()}>
            Muat ulang
          </button>
        </div>
      )}

      {!loading && !userLoading && (
        <div className="dt-dashboard-grid">
          {/* Section 10: KPI Cards Row */}
          <section className="dt-kpi-grid" aria-label="KPI Metrics">
            {/* KPI 1: Active Programs (Hero Card / Lime Accent based on reference) */}
            <div className="dt-kpi-card dt-kpi-card--hero">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box dt-kpi-icon-box--dark">
                  <FolderKanban size={18} aria-hidden="true" />
                </div>
                {draftProgramsCount > 0 ? (
                  <span className="dt-kpi-pill-badge dt-kpi-pill-badge--dark">
                    ↗ {draftProgramsCount} draf
                  </span>
                ) : (
                  <span className="dt-kpi-pill-badge dt-kpi-pill-badge--dark">
                    ↗ 100% aktif
                  </span>
                )}
              </div>
              <span className="dt-kpi-label">Program Aktif</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{activeProgramsCount}</strong>
              </div>
              <span className="dt-kpi-sub">Dari total {campaigns.length} program terdaftar</span>
            </div>

            {/* KPI 2: Milestones completed */}
            <div className="dt-kpi-card">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box">
                  <CheckCircle2 size={18} aria-hidden="true" />
                </div>
                <span className="dt-kpi-pill-badge dt-kpi-pill-badge--teal">
                  ↗ {completionPct}%
                </span>
              </div>
              <span className="dt-kpi-label">Milestone selesai</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{approvedMilestonesCount}</strong>
              </div>
              <span className="dt-kpi-sub">Dari total {milestones.length} tahap milestone</span>
            </div>

            {/* KPI 3: Needs Review */}
            <div className="dt-kpi-card">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box">
                  <AlertTriangle size={18} aria-hidden="true" />
                </div>
                {needsReviewCount > 0 ? (
                  <span className="dt-kpi-pill-badge dt-kpi-pill-badge--amber">
                    ↘ {needsReviewCount} item
                  </span>
                ) : (
                  <span className="dt-kpi-pill-badge dt-kpi-pill-badge--teal">
                    ✓ Clear
                  </span>
                )}
              </div>
              <span className="dt-kpi-label">Needs Review</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{needsReviewCount}</strong>
              </div>
              <span className="dt-kpi-sub">Evidence items in review</span>
            </div>

            {/* KPI 4: Evidence needing Organizer action */}
            <div className="dt-kpi-card">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box">
                  <AlertCircle size={18} aria-hidden="true" />
                </div>
                {revisionEvidenceCount > 0 ? (
                  <span className="dt-kpi-pill-badge dt-kpi-pill-badge--amber">
                    ↘ Perlu revisi
                  </span>
                ) : (
                  <span className="dt-kpi-pill-badge dt-kpi-pill-badge--teal">
                    ↗ 0 pending
                  </span>
                )}
              </div>
              <span className="dt-kpi-label">Butuh Tindakan Anda</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{revisionEvidenceCount}</strong>
              </div>
              <span className="dt-kpi-sub">Evidence yang diminta diperbaiki oleh verifier</span>
            </div>
          </section>

          {/* Section 9.1 & Section 12: Total Program Budget & Verification Health */}
          <div className="dt-two-col-grid">
            {/* Section 9.1: Total Program Budget Card */}
            <section className="dt-card dt-budget-overview-card" aria-labelledby="budget-overview-heading">
              <div className="dt-card-header">
                <div>
                  <span className="dt-card-eyebrow">FUNDING ACCOUNTABILITY</span>
                  <h2 id="budget-overview-heading" className="dt-card-title">
                    Total Program Budget
                  </h2>
                </div>
                <Link href="/campaigns" className="dt-card-link">
                  <span>Lihat Program</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>

              <div className="dt-budget-highlight">
                <strong className="dt-big-budget-num">
                  {formatMinorUnits(totalBudgetUnits, currency)}
                </strong>
              </div>

              {/* Budget Distribution Visual (Allocated Teal, Completed Navy, Unallocated Lime) */}
              <div className="dt-budget-breakdown-row">
                <div className="dt-budget-pill dt-budget-pill--allocated">
                  <span className="pill-dot pill-dot--teal" />
                  <div className="pill-info">
                    <span className="pill-title">Dialokasikan</span>
                    <strong>{formatMinorUnits(allocatedBudgetUnits, currency)}</strong>
                  </div>
                </div>

                <div className="dt-budget-pill dt-budget-pill--paid">
                  <span className="pill-dot pill-dot--navy" />
                  <div className="pill-info">
                    <span className="pill-title">Milestone selesai (aktivitas)</span>
                    <strong>{formatMinorUnits(completedBudgetUnits, currency)}</strong>
                  </div>
                </div>

                <div className="dt-budget-pill dt-budget-pill--unallocated">
                  <span className="pill-dot pill-dot--lime" />
                  <div className="pill-info">
                    <span className="pill-title">Belum dialokasikan</span>
                    <strong>{formatMinorUnits(unallocatedBudgetUnits, currency)}</strong>
                  </div>
                </div>
              </div>

              <div className="dt-budget-progress-bar">
                <div
                  className="bar-segment bar-segment--paid"
                  style={{
                    width: `${totalBudgetUnits > BigInt(0) ? Number((completedBudgetUnits * BigInt(100)) / totalBudgetUnits) : 0}%`,
                  }}
                  title="Milestone selesai"
                />
                <div
                  className="bar-segment bar-segment--allocated"
                  style={{
                    width: `${
                      totalBudgetUnits > BigInt(0)
                        ? Number(((allocatedBudgetUnits - completedBudgetUnits) * BigInt(100)) / totalBudgetUnits)
                        : 0
                    }%`,
                  }}
                  title="Dialokasikan, belum selesai"
                />
                <div
                  className="bar-segment bar-segment--unallocated"
                  style={{
                    width: `${totalBudgetUnits > BigInt(0) ? Number((unallocatedBudgetUnits * BigInt(100)) / totalBudgetUnits) : 0}%`,
                  }}
                  title="Belum dialokasikan"
                />
              </div>

              <p className="dt-budget-footnote">
                Milestone <em>selesai</em> berarti aktivitas tahap dinyatakan tuntas oleh Organizer.
                Status ini terpisah dari persetujuan bukti oleh quorum verifier 2-dari-3.
              </p>
            </section>

            {/* Section 12: Verification Health Card - real figures only */}
            <section className="dt-card dt-health-card" aria-labelledby="health-heading">
              <div className="dt-card-header">
                <div>
                  <span className="dt-card-eyebrow">KONSENSUS INTEGRITAS</span>
                  <h2 id="health-heading" className="dt-card-title">
                    Kesehatan Verifikasi
                  </h2>
                </div>
                <span className="dt-health-pct">
                  {evidenceList.length > 0 ? `${verificationPct}%` : "—"}
                </span>
              </div>

              <p className="dt-card-desc">
                Rasio bukti pengeluaran yang disetujui konsensus quorum 2-dari-3 peer verifier
                independen. Angka dihitung dari {evidenceList.length} evidence yang tercatat.
              </p>

              {evidenceList.length === 0 ? (
                <p className="dt-empty-text">
                  Belum ada evidence yang tercatat. Unggah bukti pada campaign yang aktif untuk
                  mulai melihat kesehatan verifikasi.
                </p>
              ) : (
                <>
                  {/* Verdict distribution derived from the real evidence list */}
                  <div className="dt-verification-breakdown">
                    <div className="dt-verdict-row">
                      <span className="legend-dot legend-dot--teal" />
                      <span className="dt-verdict-label">Disetujui quorum</span>
                      <strong>{verifiedEvidenceCount}</strong>
                    </div>
                    <div className="dt-verdict-row">
                      <span className="legend-dot legend-dot--amber" />
                      <span className="dt-verdict-label">Menunggu quorum</span>
                      <strong>{pendingEvidenceCount}</strong>
                    </div>
                    <div className="dt-verdict-row">
                      <span className="legend-dot legend-dot--gray" />
                      <span className="dt-verdict-label">Perlu revisi</span>
                      <strong>{revisionEvidenceCount}</strong>
                    </div>
                  </div>

                  <div className="dt-matrix-legend">
                    <div className="legend-item">
                      <span className="legend-dot legend-dot--teal" />
                      <span>Verified 2-of-3 quorum</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot legend-dot--amber" />
                      <span>Needs review</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot legend-dot--gray" />
                      <span>Pending</span>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>

          {/* Section 11: Milestone Progress Card */}
          <section className="dt-card" aria-labelledby="milestone-progress-heading">
            <div className="dt-card-header">
              <div>
                <span className="dt-card-eyebrow">TAHAP PELAKSANAAN</span>
                <h2 id="milestone-progress-heading" className="dt-card-title">
                  Program Progress
                </h2>
              </div>
              <span className="dt-card-meta-tag">
                {campaigns[0]?.title || "Program Bantuan Sosial"}
              </span>
            </div>

            {milestones.length === 0 ? (
              <p className="dt-empty-text">Belum ada tahapan milestone yang terdaftar di campaign.</p>
            ) : (
              <div className="dt-milestone-progress-list">
                {milestones.map((m) => {
                  const pct = m.status === "COMPLETED" ? 100 : m.status === "IN_PROGRESS" ? 65 : 0;
                  const colorClass =
                    m.status === "COMPLETED"
                      ? "fill--teal"
                      : m.status === "IN_PROGRESS"
                      ? "fill--lime"
                      : "fill--gray";

                  return (
                    <div key={m.id} className="dt-progress-row">
                      <div className="dt-progress-label-row">
                        <span className="dt-milestone-title">{m.title}</span>
                        <div className="dt-progress-stats">
                          <span className="dt-milestone-budget">
                            {formatMinorUnits(sumAmounts([m.budgetAmount]), m.currency)}
                          </span>
                          <strong className="dt-milestone-pct">{pct}%</strong>
                        </div>
                      </div>
                      <div className="dt-progress-track">
                        <div className={`dt-progress-fill ${colorClass}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Section 13: Evidence status, from real data */}
          <section className="dt-audit-activity-card" aria-labelledby="audit-activity-heading">
            <div className="audit-card-top">
              <div className="audit-title-group">
                <span className="audit-eyebrow">STATUS BUKTI</span>
                <h2 id="audit-activity-heading">Evidence terbaru</h2>
              </div>
              <Link href="/evidence" className="audit-view-link">
                <span>Lihat semua bukti</span>
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>

            {evidenceList.length === 0 ? (
              <p className="audit-empty-note">
                Belum ada evidence yang tercatat di program Anda.
              </p>
            ) : (
              <ul className="audit-activity-list">
                {evidenceList.slice(0, 6).map((item) => {
                  const verification = item.verificationStatus;
                  const bulletClass = verification === "VERIFIED"
                    ? "audit-bullet--teal"
                    : verification === "NEEDS_REVISION"
                      ? "audit-bullet--navy"
                      : "audit-bullet--lime";
                  const statusText = verification === "VERIFIED"
                    ? "Disetujui quorum 2-dari-3"
                    : verification === "NEEDS_REVISION"
                      ? "Perlu revisi sesuai instruksi quorum"
                      : verification === "REJECTED"
                        ? "Ditolak oleh quorum"
                        : "Menunggu quorum verifier";
                  return (
                    <li className="audit-activity-item" key={item.id}>
                      <div className={`audit-bullet ${bulletClass}`} aria-hidden="true" />
                      <div className="audit-item-main">
                        <strong>{item.fileName || `Evidence ${item.id.slice(0, 8)}`}</strong>
                        <span>{statusText}</span>
                      </div>
                      <span className={`status-pill status-pill--${
                        verification === "VERIFIED" ? "success" : verification === "NEEDS_REVISION" ? "warning" : "pending"
                      }`}>
                        {verification ?? "BELUM DINILAI"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
