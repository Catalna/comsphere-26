"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Layers,
  CheckCircle2,
  Clock,
  ArrowRight,
  Plus,
  Wallet,
  Sparkles,
} from "lucide-react";

import AuthenticatedLayout from "../../components/AuthenticatedLayout";
import { loadCampaignTree, type CampaignSummary, type MilestoneSummary } from "../../lib/campaignTree";
import { formatMinorUnits, sumAmounts } from "../../lib/money";
import { useCurrentUser } from "../../lib/useCurrentUser";

type Campaign = CampaignSummary;
type Milestone = MilestoneSummary;

export default function MilestonesPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const tree = await loadCampaignTree();
      setCampaigns(tree.campaigns);
      setMilestones(tree.milestones);
    } catch {
      setError("Gagal memuat tahapan milestone. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const campaignMap = useMemo(() => {
    const map = new Map<string, Campaign>();
    campaigns.forEach((c) => map.set(c.id, c));
    return map;
  }, [campaigns]);

  const filteredMilestones = useMemo(() => {
    if (filterStatus === "ALL") return milestones;
    return milestones.filter((m) => m.status === filterStatus);
  }, [milestones, filterStatus]);

  const plannedCount = milestones.filter((m) => m.status === "PLANNED").length;
  const inProgressCount = milestones.filter((m) => m.status === "IN_PROGRESS").length;
  const completedCount = milestones.filter((m) => m.status === "COMPLETED").length;
  const totalBudgetUnits = useMemo(() => sumAmounts(milestones.map((m) => m.budgetAmount)), [milestones]);
  const currency = milestones[0]?.currency || "IDR";

  return (
    <AuthenticatedLayout
      title="Tahapan & Milestone"
      subtitle="Pantau progres realisasi dana dan tahapan kegiatan seluruh program Anda."
      actions={
        user?.role === "ORGANIZER" ? (
          <Link className="action-button action-button--primary" href="/campaigns">
            <Plus size={16} aria-hidden="true" />
            <span>Kelola Campaign</span>
          </Link>
        ) : undefined
      }
    >
      {(loading || userLoading) && (
        <div className="workspace-loading" aria-busy="true">
          Memuat daftar milestone…
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
        <div className="milestones-page-shell">
          {/* Section: STACK Retro-Modern KPI Grid */}
          <section className="dt-kpi-grid" aria-label="Statistik Milestone">
            {/* KPI 1: Hero Card / Lime Accent */}
            <div className="dt-kpi-card dt-kpi-card--hero">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box dt-kpi-icon-box--dark">
                  <Wallet size={18} aria-hidden="true" />
                </div>
                <span className="dt-kpi-pill-badge dt-kpi-pill-badge--dark">
                  ↗ 100% Terpetakan
                </span>
              </div>
              <span className="dt-kpi-label">Total Alokasi Tahapan</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{formatMinorUnits(totalBudgetUnits, currency)}</strong>
              </div>
              <span className="dt-kpi-sub">Total akumulasi seluruh tahapan aktif</span>
            </div>

            {/* KPI 2: Sedang Berjalan */}
            <div className="dt-kpi-card">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box">
                  <Clock size={18} aria-hidden="true" />
                </div>
                <span className="dt-kpi-pill-badge">
                  {inProgressCount} Aktif
                </span>
              </div>
              <span className="dt-kpi-label">Sedang Berjalan</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{inProgressCount}</strong>
              </div>
              <span className="dt-kpi-sub">Membutuhkan pengunggahan bukti belanja</span>
            </div>

            {/* KPI 3: Tuntas Selesai */}
            <div className="dt-kpi-card">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box">
                  <CheckCircle2 size={18} aria-hidden="true" />
                </div>
                <span className="dt-kpi-pill-badge">
                  {completedCount} Selesai
                </span>
              </div>
              <span className="dt-kpi-label">Tuntas Selesai</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{completedCount}</strong>
              </div>
              <span className="dt-kpi-sub">Aktivitas tahapan tuntas diverifikasi</span>
            </div>

            {/* KPI 4: Direncanakan */}
            <div className="dt-kpi-card">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box">
                  <Layers size={18} aria-hidden="true" />
                </div>
                <span className="dt-kpi-pill-badge">
                  {plannedCount} Antrean
                </span>
              </div>
              <span className="dt-kpi-label">Direncanakan</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{plannedCount}</strong>
              </div>
              <span className="dt-kpi-sub">Tahap berikutnya setelah tahap aktif</span>
            </div>
          </section>

          {/* Filter Bar */}
          <div className="campaigns-toolbar">
            <div className="toolbar-filters">
              <button
                type="button"
                className={`filter-pill ${filterStatus === "ALL" ? "filter-pill--active" : ""}`}
                onClick={() => setFilterStatus("ALL")}
              >
                Semua Tahap ({milestones.length})
              </button>
              <button
                type="button"
                className={`filter-pill ${filterStatus === "IN_PROGRESS" ? "filter-pill--active" : ""}`}
                onClick={() => setFilterStatus("IN_PROGRESS")}
              >
                Sedang Berjalan ({inProgressCount})
              </button>
              <button
                type="button"
                className={`filter-pill ${filterStatus === "PLANNED" ? "filter-pill--active" : ""}`}
                onClick={() => setFilterStatus("PLANNED")}
              >
                Direncanakan ({plannedCount})
              </button>
              <button
                type="button"
                className={`filter-pill ${filterStatus === "COMPLETED" ? "filter-pill--active" : ""}`}
                onClick={() => setFilterStatus("COMPLETED")}
              >
                Selesai ({completedCount})
              </button>
            </div>
          </div>

          {/* Milestones List */}
          {filteredMilestones.length === 0 ? (
            <div className="workspace-empty">
              <div className="workspace-empty-icon" aria-hidden="true">
                <Layers size={40} />
              </div>
              <h3>Belum ada tahapan milestone</h3>
              <p>
                Milestone didefinisikan di dalam halaman masing-masing campaign. Buka campaign Anda
                untuk menambahkan tahapan baru.
              </p>
              <Link href="/campaigns" className="action-button action-button--primary">
                Buka Campaign Saya
              </Link>
            </div>
          ) : (
            <div className="milestones-card-grid">
              {filteredMilestones.map((m) => {
                const camp = campaignMap.get(m.campaignId);
                const isCompleted = m.status === "COMPLETED";
                const isInProgress = m.status === "IN_PROGRESS";
                const tone = isCompleted ? "done" : isInProgress ? "running" : "pending";

                return (
                  <div key={m.id} className={`milestone-full-card milestone-full-card--${tone}`}>
                    <div className="milestone-card-top">
                      <div className="milestone-card-badge-row">
                        <span className={`status-pill-modern status-pill-modern--${tone}`}>
                          {isCompleted ? "Selesai" : isInProgress ? "Sedang Berjalan" : "Direncanakan"}
                        </span>
                        {camp && (
                          <span className="milestone-camp-tag">
                            Program: <strong>{camp.title}</strong>
                          </span>
                        )}
                      </div>
                      <span className="milestone-card-budget">
                        {formatMinorUnits(sumAmounts([m.budgetAmount]), m.currency)}
                      </span>
                    </div>

                    <h3 className="milestone-card-title">{m.title}</h3>
                    <p className="milestone-card-desc">
                      {m.description || "Tahapan pelaksanaan dan realisasi anggaran program."}
                    </p>

                    <div className="milestone-card-actions">
                      <Link
                        href={`/campaigns/${m.campaignId}`}
                        className="action-button action-button--secondary btn-compact"
                      >
                        <span>Kelola Bukti & Status</span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Best Practices Banner */}
          <section className="workspace-panel milestone-info-banner" aria-labelledby="milestone-tips-heading">
            <div className="info-banner-icon" aria-hidden="true">
              <Sparkles size={24} />
            </div>
            <div className="info-banner-text">
              <h3 id="milestone-tips-heading">Mengapa Penyaluran Berbasis Milestone?</h3>
              <p>
                Platform DanaTerang menerapkan pencairan bertahap untuk memastikan setiap rupiah
                dipertanggungjawabkan dengan bukti pengeluaran yang sah sebelum tahap selanjutnya
                didanai. Ini memberikan ketenangan bagi donatur dan reputasi tinggi bagi lembaga Anda.
              </p>
            </div>
          </section>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
