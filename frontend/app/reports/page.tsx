"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  Printer,
  Sparkles,
  Wallet,
  FileText,
} from "lucide-react";

import AuthenticatedLayout from "../../components/AuthenticatedLayout";
import { CHAIN } from "../../lib/blockchain";
import { loadCampaignTree, type CampaignSummary, type EvidenceSummary, type MilestoneSummary } from "../../lib/campaignTree";
import { formatMoney } from "../../lib/formatMoney";
import { formatMinorUnits, sumAmounts } from "../../lib/money";
import { useCurrentUser } from "../../lib/useCurrentUser";

type Campaign = CampaignSummary;
type Milestone = MilestoneSummary;
type Evidence = EvidenceSummary;

function campaignStatusLabel(status: string) {
  if (status === "ACTIVE") return "Didanai";
  if (status === "DRAFT") return "Draf";
  if (status === "COMPLETED") return "Selesai";
  if (status === "CANCELLED") return "Dibatalkan";
  return status;
}

export default function ReportsPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const tree = await loadCampaignTree();
      const allEvidence = tree.evidence;
      setCampaigns(tree.campaigns);
      setMilestones(tree.milestones);
      setEvidenceCount(allEvidence.length);
      setVerifiedCount(allEvidence.filter((item) => item.verificationStatus === "VERIFIED").length);
    } catch {
      setError("Gagal memuat laporan transparansi. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalBudgetUnits = sumAmounts(campaigns.map((campaign) => campaign.totalBudget));
  const completedBudgetUnits = sumAmounts(
    milestones.filter((milestone) => milestone.status === "COMPLETED").map((milestone) => milestone.budgetAmount),
  );
  const currency = campaigns[0]?.currency || "IDR";
  const orgName = user?.organization?.name || user?.name || "Organisasi";
  const quorumMet = evidenceCount > 0 && verifiedCount > 0;
  const transparencyPct = evidenceCount > 0
    ? Math.round((verifiedCount / evidenceCount) * 100)
    : 0;

  function handlePrint() {
    window.print();
  }

  return (
    <AuthenticatedLayout
      title="Laporan Transparansi & Akuntabilitas"
      subtitle="Ringkasan integritas penyaluran dana CSR dan kepatuhan audit publik organisasi."
      actions={
        <div className="workspace-actions">
          <button
            type="button"
            className="action-button action-button--secondary"
            onClick={handlePrint}
          >
            <Printer size={16} aria-hidden="true" />
            <span>Cetak Ringkasan</span>
          </button>
        </div>
      }
    >
      {(loading || userLoading) && (
        <div className="workspace-loading" aria-busy="true">
          Memuat data laporan audit…
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

      {!loading && !userLoading && error && (
        <div className="workspace-error" role="alert">
          <p>{error}</p>
          <button className="action-button action-button--secondary" onClick={() => void loadData()}>
            Coba lagi
          </button>
        </div>
      )}

      {!loading && !userLoading && !error && (
        <div className="reports-page-shell">
          {/* Executive Overview Banner */}
          <section className="reports-executive-card" aria-label="Ringkasan Eksekutif">
            <div className="executive-card-left">
              <span className="eyebrow">STATUS AKREDITASI</span>
              <h2>Laporan Akuntabilitas {orgName}</h2>
              <p>
                Dokumen ini merupakan rekapitulasi kepatuhan tata kelola bantuan sosial berstandar
                desentralisasi DanaTerang. Setiap rupiah program ditopang bukti dokumen fisik yang
                diverifikasi oleh konsensus independen.
              </p>
              <div className="executive-badges-row">
                <span className="executive-pill executive-pill--verified">
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>
                    {evidenceCount > 0
                      ? `${verifiedCount} dari ${evidenceCount} bukti disetujui quorum`
                      : "Belum ada bukti yang dinilai quorum"}
                  </span>
                </span>
                <span className="executive-pill">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>
                    {quorumMet ? "Quorum 2-dari-3 tercapai pada bukti" : "Quorum 2-dari-3 belum tercapai"}
                  </span>
                </span>
              </div>
            </div>

            <div className="executive-card-right">
              <div className="transparency-score-box">
                <span className="score-ring-val">
                  {evidenceCount > 0 ? `${transparencyPct}%` : "—"}
                </span>
                <span className="score-ring-label">Indeks Transparansi Bukti</span>
              </div>
            </div>
          </section>

          {/* Key Metrics */}
          <section className="dashboard-stats-grid" aria-label="Ringkasan Finansial">
            <div className="stat-card stat-card--teal">
              <div className="stat-card-header">
                <span className="stat-card-label">Total Komitmen Anggaran</span>
                <div className="stat-card-icon" aria-hidden="true">
                  <Wallet size={20} />
                </div>
              </div>
              <div className="stat-card-body">
                <strong className="stat-card-val">
                  {formatMinorUnits(totalBudgetUnits, currency)}
                </strong>
                <span className="stat-card-note">Dana dialokasikan ke {campaigns.length} program</span>
              </div>
            </div>

            <div className="stat-card stat-card--lime">
              <div className="stat-card-header">
                <span className="stat-card-label">Dana Milestone Selesai</span>
                <div className="stat-card-icon" aria-hidden="true">
                  <CheckCircle2 size={20} />
                </div>
              </div>
              <div className="stat-card-body">
                <strong className="stat-card-val">
                  {formatMinorUnits(completedBudgetUnits, currency)}
                </strong>
                <span className="stat-card-note">Dari tahapan milestone yang tuntas</span>
              </div>
            </div>

            <div className="stat-card stat-card--blue">
              <div className="stat-card-header">
                <span className="stat-card-label">Berkas Bukti Diaudit</span>
                <div className="stat-card-icon" aria-hidden="true">
                  <FileText size={20} />
                </div>
              </div>
              <div className="stat-card-body">
                <strong className="stat-card-val">{evidenceCount} Berkas</strong>
                <span className="stat-card-note">{verifiedCount} dokumen disetujui quorum</span>
              </div>
            </div>

            <div className="stat-card stat-card--purple">
              <div className="stat-card-header">
                <span className="stat-card-label">Konsensus Jaringan</span>
                <div className="stat-card-icon" aria-hidden="true">
                  <ShieldCheck size={20} />
                </div>
              </div>
              <div className="stat-card-body">
                <strong className="stat-card-val">{CHAIN.name}</strong>
                <span className="stat-card-note">Lihat status proof terbaru pada halaman campaign</span>
              </div>
            </div>
          </section>

          {/* Breakdown Table */}
          <section className="workspace-panel" aria-labelledby="campaign-audit-heading">
            <div className="workspace-title-row">
              <div>
                <p className="eyebrow">RINCIAN PER PROGRAM</p>
                <h3 id="campaign-audit-heading" className="panel-heading">
                  Audit Kinerja Campaign
                </h3>
              </div>
            </div>

            <div className="table-scroll">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th scope="col">Nama Program / Campaign</th>
                    <th scope="col">Status Program</th>
                    <th scope="col">Anggaran Dialokasikan</th>
                    <th scope="col">Standar Verifikasi</th>
                    <th scope="col">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((camp) => (
                    <tr key={camp.id}>
                      <td>
                        <strong>{camp.title}</strong>
                        <div className="table-meta">ID: {camp.id}</div>
                      </td>
                      <td>
                        <span className="status-pill status-pill--pending">{campaignStatusLabel(camp.status)}</span>
                      </td>
                      <td>
                        <strong>{formatMoney(camp.totalBudget, camp.currency)}</strong>
                      </td>
                      <td>Quorum Peer Verifier (2/3)</td>
                      <td>
                        <Link
                          href={`/campaigns/${camp.id}`}
                          className="action-button action-button--secondary btn-compact"
                        >
                          Lihat Rincian
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Security & Audit Statement */}
          <section className="workspace-panel milestone-info-banner" aria-labelledby="audit-statement-heading">
            <div className="info-banner-icon" aria-hidden="true">
              <Sparkles size={24} />
            </div>
            <div className="info-banner-text">
              <h3 id="audit-statement-heading">Jaminan Integritas DanaTerang</h3>
              <p>
                Setiap versi dokumen bukti yang diunggah dihitung dengan hashing kriptografis SHA-256,
                sehingga isi berkas tidak dapat diubah tanpa mengubah hash-nya. Hasil verifikasi
                konsensus quorum 2-dari-3 diikat dengan tanda tangan EIP-712 dan dianchor ke jaringan
                Sepolia setelah quorum tercapai. Revisi berkas selalu tercatat sebagai versi baru,
                bukan menimpa versi sebelumnya.
              </p>
            </div>
          </section>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
