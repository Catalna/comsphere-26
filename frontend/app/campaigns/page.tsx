"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderKanban,
  Plus,
  Search,
  ArrowRight,
} from "lucide-react";

import AuthenticatedLayout from "../../components/AuthenticatedLayout";
import { requestJson } from "../../lib/api";
import { loadCampaignTree, type CampaignSummary, type MilestoneSummary } from "../../lib/campaignTree";
import { formatMinorUnits, sumAmounts } from "../../lib/money";
import { useCurrentUser } from "../../lib/useCurrentUser";

type CampaignSummaryLocal = CampaignSummary;
type Milestone = MilestoneSummary;

function campaignStatusLabel(status: string) {
  if (status === "ACTIVE") return "Didanai";
  if (status === "DRAFT") return "Draf";
  if (status === "COMPLETED") return "Selesai";
  if (status === "CANCELLED") return "Dibatalkan";
  return status;
}

export default function CampaignListPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [milestonesByCampaign, setMilestonesByCampaign] = useState<Record<string, Milestone[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<"ALL" | "ACTIVE" | "DRAFT" | "COMPLETED">("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const tree = await loadCampaignTree();
      const list = tree.campaigns;
      setCampaigns(list);

      const mMap: Record<string, Milestone[]> = {};
      list.forEach((campaign) => {
        mMap[campaign.id] = tree.milestones.filter((milestone) => milestone.campaignId === campaign.id);
      });
      setMilestonesByCampaign(mMap);
    } catch {
      setError("Campaign belum dapat dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((camp) => {
      const matchesSearch =
        camp.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (camp.description && camp.description.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesStatus =
        selectedFilter === "ALL" ? true : camp.status === selectedFilter;
      return matchesSearch && matchesStatus;
    });
  }, [campaigns, searchTerm, selectedFilter]);

  const activeCount = campaigns.filter((c) => c.status === "ACTIVE").length;
  const draftCount = campaigns.filter((c) => c.status === "DRAFT").length;

  return (
    <AuthenticatedLayout
      title="Campaign saya"
      subtitle="Kelola program bantuan sosial, pantau realisasi dana, dan publikasikan bukti penyaluran."
      actions={
        user?.role === "ORGANIZER" ? (
          <Link className="action-button action-button--primary" href="/campaigns/new">
            <Plus size={16} aria-hidden="true" />
            <span>Buat campaign</span>
          </Link>
        ) : undefined
      }
    >
      {(loading || userLoading) && (
        <div className="workspace-loading" aria-busy="true">
          Memuat campaign…
        </div>
      )}

      <div className={error ? "workspace-error" : "visually-hidden"} role="alert" aria-live="assertive">
        <p>{error}</p>
        {error && (
          <button className="action-button action-button--secondary" onClick={() => void load()}>
            Coba lagi
          </button>
        )}
      </div>

      {!loading && !userLoading && !error && campaigns.length === 0 && (
        <section className="workspace-empty" aria-labelledby="empty-campaigns-title">
          <div className="workspace-empty-icon" aria-hidden="true">
            <FolderKanban size={40} />
          </div>
          <h2 id="empty-campaigns-title">Belum ada campaign</h2>
          {user?.role === "ORGANIZER" ? (
            <>
              <p>Buat draft campaign untuk organisasi dan tambahkan milestone pertama.</p>
              <Link className="action-button action-button--primary" href="/campaigns/new">
                <Plus size={16} aria-hidden="true" />
                <span>Buat campaign</span>
              </Link>
            </>
          ) : (
            <p>Belum ada campaign yang ditautkan ke akun ini.</p>
          )}
        </section>
      )}

      {!loading && !userLoading && !error && campaigns.length > 0 && (
        <>
          {/* Search & Filter Toolbar */}
          <div className="dt-programs-toolbar">
            <div className="dt-search-box">
              <Search size={16} className="dt-search-icon" aria-hidden="true" />
              <input
                type="search"
                className="dt-search-input"
                placeholder="Cari program atau keterangan…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Cari program"
              />
            </div>

            <div className="dt-filter-pills">
              <button
                type="button"
                className={`dt-pill-btn ${selectedFilter === "ALL" ? "dt-pill-btn--active" : ""}`}
                onClick={() => setSelectedFilter("ALL")}
              >
                All ({campaigns.length})
              </button>
              <button
                type="button"
                className={`dt-pill-btn ${selectedFilter === "ACTIVE" ? "dt-pill-btn--active" : ""}`}
                onClick={() => setSelectedFilter("ACTIVE")}
              >
                Active ({activeCount})
              </button>
              <button
                type="button"
                className={`dt-pill-btn ${selectedFilter === "DRAFT" ? "dt-pill-btn--active" : ""}`}
                onClick={() => setSelectedFilter("DRAFT")}
              >
                Draft ({draftCount})
              </button>
            </div>
          </div>

          <div className="workspace-title-row">
            <p className="section-note">Menampilkan {filteredCampaigns.length} dari {campaigns.length} campaign</p>
          </div>

          {filteredCampaigns.length === 0 ? (
            <div className="workspace-empty">
              <p>Tidak ada campaign yang cocok dengan pencarian.</p>
            </div>
          ) : (
            /* Program Cards Grid matching DesignUI.md Section 14 */
            <ul className="workspace-list dt-program-cards-grid">
              {filteredCampaigns.map((campaign) => {
                const mList = milestonesByCampaign[campaign.id] || [];
                const doneM = mList.filter((m) => m.status === "COMPLETED").length;
                const pct = mList.length > 0 ? Math.round((doneM / mList.length) * 100) : 0;
                const isActive = campaign.status === "ACTIVE";

                return (
                  <li className="workspace-panel workspace-list-item dt-program-card" key={campaign.id}>
                    <div className="dt-program-card-header">
                      <div>
                        <h2>
                          <Link href={`/campaigns/${campaign.id}`} className="dt-program-title">
                            {campaign.title}
                          </Link>
                        </h2>
                        <span className="dt-program-category">CSR Program Sosial</span>
                      </div>
                      <span className={`status-pill status-pill--pending dt-status-chip ${isActive ? "dt-status-chip--active" : ""}`}>
                        {campaignStatusLabel(campaign.status)}
                      </span>
                    </div>

                    <p className="dt-program-desc">
                      {campaign.description || "Belum ada deskripsi."}
                    </p>

                    <div className="dt-program-meta-line">
                      <span>Mitra Penyelenggara: {user?.organization?.name || user?.name || "Organisasi"}</span>
                    </div>

                    <div className="campaign-summary dt-program-budget-box">
                      <span className="dt-budget-caption">Program Budget</span>
                      <strong className="dt-budget-amount">
                        {formatMinorUnits(sumAmounts([campaign.totalBudget]), campaign.currency)}
                      </strong>
                    </div>

                    {/* Progress Bar (Section 14) */}
                    <div className="dt-program-progress-section">
                      <div className="dt-progress-header">
                        <span>Progress</span>
                        <strong>{pct}%</strong>
                      </div>
                      <div className="dt-progress-track">
                        <div
                          className="dt-progress-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="dt-milestone-count-text">
                        {doneM} / {mList.length} Milestones Completed
                      </span>
                    </div>

                    <div className="dt-program-card-footer">
                      <Link href={`/campaigns/${campaign.id}`} className="dt-view-link">
                        <span>View Program</span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </AuthenticatedLayout>
  );
}
