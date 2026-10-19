"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Shield,
  Activity,
} from "lucide-react";

import AuthenticatedLayout from "../../../components/AuthenticatedLayout";
import { ApiError, requestJson } from "../../../lib/api";

type ReviewMetadata = {
  reviewRoundId: string;
  evidenceId: string;
  roundNumber: number;
  status: "WAITING_FOR_CHAIN" | "OPEN" | "QUORUM_REACHED" | "NO_QUORUM" | "CHAIN_FAILED";
  voteCount: number;
  assignedVerifierCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

function timestamp(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusConfig(status: ReviewMetadata["status"]) {
  switch (status) {
    case "QUORUM_REACHED":
      return { label: "Quorum tercapai", pillClass: "status-pill--success", icon: CheckCircle2 };
    case "OPEN":
      return { label: "Menunggu vote", pillClass: "status-pill--pending", icon: Clock };
    case "WAITING_FOR_CHAIN":
      return { label: "Menunggu jaringan", pillClass: "status-pill--pending", icon: Clock };
    case "NO_QUORUM":
      return { label: "Tidak ada quorum", pillClass: "status-pill--warning", icon: AlertTriangle };
    case "CHAIN_FAILED":
      return { label: "Gagal on-chain", pillClass: "status-pill--warning", icon: XCircle };
    default:
      return { label: status, pillClass: "status-pill--pending", icon: Clock };
  }
}

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<ReviewMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await requestJson<{ reviews: ReviewMetadata[] }>("/api/admin/reviews");
      setReviews(response.reviews);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 403
        ? "Operasi review hanya tersedia untuk Admin."
        : "Status operasi belum dapat dimuat. Coba lagi.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Computed stats
  const quorumReached = reviews.filter((r) => r.status === "QUORUM_REACHED").length;
  const openRounds = reviews.filter((r) => r.status === "OPEN" || r.status === "WAITING_FOR_CHAIN").length;
  const failedRounds = reviews.filter((r) => r.status === "NO_QUORUM" || r.status === "CHAIN_FAILED").length;

  return (
    <AuthenticatedLayout
      title="Operasi Review"
      subtitle="Pantau status round peer review. Keputusan, file, dan catatan tidak ditampilkan di halaman ini."
    >
      <div className="admin-reviews-page">

        {/* Retro-Modern STACK KPI Grid */}
        {!loading && !error && reviews.length > 0 && (
          <section className="dt-kpi-grid" aria-label="Statistik Operasi Review" style={{ marginBottom: "24px" }}>
            <div className="dt-kpi-card dt-kpi-card--hero">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box dt-kpi-icon-box--dark">
                  <CheckCircle2 size={18} aria-hidden="true" />
                </div>
                <span className="dt-kpi-pill-badge dt-kpi-pill-badge--dark">
                  ↗ Quorum Siap
                </span>
              </div>
              <span className="dt-kpi-label">Quorum Tercapai</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{quorumReached}</strong>
              </div>
              <span className="dt-kpi-sub">Round verifikasi tuntas on-chain</span>
            </div>

            <div className="dt-kpi-card">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box">
                  <Clock size={18} aria-hidden="true" />
                </div>
                <span className="dt-kpi-pill-badge">
                  {openRounds} Antrean
                </span>
              </div>
              <span className="dt-kpi-label">Menunggu Vote</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{openRounds}</strong>
              </div>
              <span className="dt-kpi-sub">Verifier sedang meninjau evidence</span>
            </div>

            <div className="dt-kpi-card">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box">
                  <AlertTriangle size={18} aria-hidden="true" />
                </div>
                <span className="dt-kpi-pill-badge">
                  {failedRounds} Perhatian
                </span>
              </div>
              <span className="dt-kpi-label">Perlu Perhatian</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{failedRounds}</strong>
              </div>
              <span className="dt-kpi-sub">Tanpa quorum atau kendala jaringan</span>
            </div>

            <div className="dt-kpi-card">
              <div className="dt-kpi-header-row">
                <div className="dt-kpi-icon-box">
                  <Activity size={18} aria-hidden="true" />
                </div>
                <span className="dt-kpi-pill-badge">
                  Total
                </span>
              </div>
              <span className="dt-kpi-label">Total Round</span>
              <div className="dt-kpi-value-row">
                <strong className="dt-kpi-value">{reviews.length}</strong>
              </div>
              <span className="dt-kpi-sub">Akumulasi seluruh round sistem</span>
            </div>
          </section>
        )}

        {/* Main Table Card */}
        <section
          className="dt-card admin-review-card"
          aria-labelledby="admin-review-heading"
          aria-busy={loading || refreshing}
        >
          <div className="dt-card-header">
            <div>
              <span className="dt-card-eyebrow">OPERASI</span>
              <h2 id="admin-review-heading" className="dt-card-title">Status Round Peer Review</h2>
            </div>
            <div className="admin-header-actions">
              <div className="admin-boundary-badge">
                <Shield size={12} aria-hidden="true" />
                <span>Read-only · Metadata operasional saja</span>
              </div>
              <button
                className="action-button action-button--secondary"
                type="button"
                disabled={loading || refreshing}
                onClick={() => void load(true)}
              >
                <RefreshCw size={14} className={refreshing ? "spin-icon" : ""} aria-hidden="true" />
                {refreshing ? "Memperbarui…" : "Perbarui"}
              </button>
            </div>
          </div>

          <p className="admin-review-notice">
            Admin dapat memantau antrean dan jumlah vote. Keputusan, penugasan reviewer, file, OCR, dan catatan tidak tersedia di halaman ini.
          </p>

          {error && (
            <div className="auth-error-box" role="alert" aria-live="assertive">
              <p>{error}</p>
              <button
                className="action-button action-button--secondary"
                type="button"
                style={{ marginTop: "8px" }}
                onClick={() => void load()}
              >
                Coba lagi
              </button>
            </div>
          )}

          {loading && (
            <div className="workspace-loading" aria-busy="true">
              Memuat status review…
            </div>
          )}

          {!loading && !error && reviews.length === 0 && (
            <div className="workspace-empty" role="status">
              <div className="workspace-empty-icon" aria-hidden="true">
                <Activity size={36} />
              </div>
              <h3>Belum ada review</h3>
              <p>Round baru muncul setelah OCR siap dan terdaftar di jaringan.</p>
            </div>
          )}

          {!loading && !error && reviews.length > 0 && (
            <div className="admin-table-wrap" role="region" aria-label="Tabel status round review, geser horizontal untuk melihat semua kolom" tabIndex={0}>
              <table className="admin-review-table">
                <caption className="visually-hidden">Round review · metadata operasional saja</caption>
                <thead>
                  <tr>
                    <th scope="col">Round</th>
                    <th scope="col">ID Evidence</th>
                    <th scope="col">Status</th>
                    <th scope="col">Vote</th>
                    <th scope="col">Verifier</th>
                    <th scope="col">Dibuat</th>
                    <th scope="col">Selesai</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => {
                    const cfg = statusConfig(review.status);
                    const Icon = cfg.icon;
                    return (
                      <tr key={review.reviewRoundId}>
                        <th scope="row" className="admin-table-round-cell">
                          <code className="admin-code-id">{review.reviewRoundId.slice(0, 8)}…</code>
                          <span className="admin-round-badge">#{review.roundNumber}</span>
                        </th>
                        <td>
                          <code className="admin-code-id">{review.evidenceId.slice(0, 8)}…</code>
                        </td>
                        <td>
                          <span className={`status-pill ${cfg.pillClass} admin-status-pill`}>
                            <Icon size={11} aria-hidden="true" />
                            {cfg.label}
                          </span>
                        </td>
                        <td>
                          <div className="admin-vote-display">
                            <div className="admin-vote-pips">
                              {[0, 1, 2].map((i) => (
                                <span
                                  key={i}
                                  className={`admin-vote-pip ${i < review.voteCount ? "admin-vote-pip--filled" : ""}`}
                                  aria-hidden="true"
                                />
                              ))}
                            </div>
                            <span className="admin-vote-text">{review.voteCount}/3</span>
                          </div>
                        </td>
                        <td className="admin-table-secondary">{review.assignedVerifierCount}/3</td>
                        <td className="admin-table-secondary">{timestamp(review.createdAt)}</td>
                        <td className="admin-table-secondary">{timestamp(review.completedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AuthenticatedLayout>
  );
}


