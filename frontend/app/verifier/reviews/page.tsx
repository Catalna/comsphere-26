"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Wallet,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  ExternalLink,
} from "lucide-react";

import AuthenticatedLayout from "../../../components/AuthenticatedLayout";
import { ApiError, requestJson } from "../../../lib/api";
import { requestVerifierAddress, signTypedData, walletMessage, type TypedData } from "../../../lib/verifierWallet";

type WalletBinding = { walletAddress: string; rosterVersion: number; status: "ACTIVE" | "SUSPENDED"; verifiedAt: string };
type ReviewQueueItem = {
  reviewRoundId: string;
  evidenceId: string;
  roundNumber: number;
  reviewRoundStatus: string;
  fileName: string;
  evidenceType: string;
  evidenceVersion: number;
  fileSize: number;
  campaignId: string;
  campaignTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  createdAt: string;
};
type WalletChallenge = { challengeId: string; typedData: TypedData };

function shortenedAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export default function VerifierReviewQueuePage() {
  const [wallet, setWallet] = useState<WalletBinding | null>(null);
  const [reviews, setReviews] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [walletError, setWalletError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError("");
    try {
      const [walletResponse, queueResponse] = await Promise.all([
        requestJson<{ wallet: WalletBinding | null }>("/api/verifier/wallet"),
        requestJson<{ reviews: ReviewQueueItem[] }>("/api/verifier/reviews"),
      ]);
      setWallet(walletResponse.wallet);
      setReviews(queueResponse.reviews);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setLoadError("Akun ini tidak memiliki akses Verifier.");
      else setLoadError("Review belum dapat dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function unbindWallet() {
    setDisconnecting(true);
    setWalletError("");
    try {
      await requestJson("/api/verifier/wallet", { method: "DELETE" });
      setWallet(null);
      await load(true);
    } catch {
      setWalletError("Wallet belum dapat dilepas. Coba lagi.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function bindWallet() {
    setConnecting(true);
    setWalletError("");
    try {
      const address = await requestVerifierAddress();
      const challenge = await requestJson<WalletChallenge>("/api/verifier/wallet/challenge", {
        method: "POST",
        body: JSON.stringify({ walletAddress: address }),
      });
      const signature = await signTypedData(address, challenge.typedData);
      await requestJson<{ wallet: WalletBinding }>("/api/verifier/wallet", {
        method: "POST",
        body: JSON.stringify({ challengeId: challenge.challengeId, walletAddress: address, signature }),
      });
      await load(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === "wallet_not_on_roster") {
        setWalletError("Alamat wallet ini belum terdaftar sebagai Verifier aktif. Hubungi pengelola roster organisasi.");
      } else if (error instanceof ApiError && error.code === "verifier_wallet_already_bound") {
        setWalletError("Akun ini sudah terhubung ke wallet lain. Minta bantuan untuk pemulihan wallet.");
      } else {
        setWalletError(walletMessage(error));
      }
    } finally {
      setConnecting(false);
    }
  }

  const walletConnected = wallet?.status === "ACTIVE";
  const walletSuspended = wallet?.status === "SUSPENDED";

  return (
    <AuthenticatedLayout
      title="Review Saya"
      subtitle="Antrian evidence yang ditugaskan untuk ditinjau. Vote Anda bersifat privat."
    >
      <div className="verifier-page-grid">

        {/* Wallet Panel */}
        <section className="dt-card verifier-wallet-card" aria-labelledby="verifier-wallet-heading">
          <div className="dt-card-header">
            <div>
              <span className="dt-card-eyebrow">TANDA TANGAN DIGITAL</span>
              <h2 id="verifier-wallet-heading" className="dt-card-title">Wallet Verifier</h2>
            </div>
            {walletConnected && (
              <span className="status-pill status-pill--success">
                <CheckCircle2 size={12} aria-hidden="true" />
                Terhubung
              </span>
            )}
            {walletSuspended && (
              <span className="status-pill status-pill--warning">
                <AlertTriangle size={12} aria-hidden="true" />
                Ditangguhkan
              </span>
            )}
          </div>

          {walletConnected && (
            <div className="verifier-wallet-info">
              <div className="verifier-wallet-address-row">
                <div className="verifier-wallet-icon">
                  <Wallet size={18} aria-hidden="true" />
                </div>
                <div>
                  <p className="verifier-wallet-addr">{shortenedAddress(wallet.walletAddress)}</p>
                  <p className="verifier-wallet-meta">Roster versi {wallet.rosterVersion}</p>
                </div>
              </div>
              <p className="field-hint">
                Tanda tangan dilakukan di wallet organisasi. DanaTerang hanya meneruskan vote dan membayar gas.
              </p>
              <button
                className="action-button action-button--secondary verifier-disconnect-btn"
                type="button"
                disabled={disconnecting}
                onClick={() => void unbindWallet()}
              >
                {disconnecting ? "Melepaskan…" : "Lepaskan wallet"}
              </button>
            </div>
          )}

          {walletSuspended && (
            <div className="auth-error-box">
              <p>Wallet verifier sedang ditangguhkan. Hubungi pengelola roster sebelum meninjau evidence.</p>
            </div>
          )}

          {!wallet && (
            <div className="verifier-wallet-empty">
              <div className="verifier-wallet-icon verifier-wallet-icon--empty">
                <Wallet size={24} aria-hidden="true" />
              </div>
              <p>Hubungkan wallet milik organisasi verifier. Private key tetap berada di wallet dan tidak dikirim ke DanaTerang.</p>
              <button
                className="action-button action-button--primary"
                type="button"
                disabled={connecting}
                aria-busy={connecting}
                onClick={() => void bindWallet()}
              >
                <ShieldCheck size={16} aria-hidden="true" />
                {connecting ? "Menunggu wallet…" : "Hubungkan wallet verifier"}
              </button>
            </div>
          )}

          {walletError && (
            <div className="auth-error-box" role="alert" aria-live="assertive">
              <p>{walletError}</p>
            </div>
          )}
        </section>

        {/* Review Queue Panel */}
        <section
          className="dt-card verifier-queue-card"
          aria-labelledby="review-queue-heading"
          aria-busy={loading || refreshing}
        >
          <div className="dt-card-header">
            <div>
              <span className="dt-card-eyebrow">ANTRIAN PRIVAT</span>
              <h2 id="review-queue-heading" className="dt-card-title">Evidence yang ditugaskan</h2>
            </div>
            <button
              className="action-button action-button--secondary verifier-refresh-btn"
              type="button"
              disabled={loading || refreshing}
              onClick={() => void load(true)}
            >
              <RefreshCw size={14} className={refreshing ? "spin-icon" : ""} aria-hidden="true" />
              {refreshing ? "Memperbarui…" : "Perbarui"}
            </button>
          </div>

          {loadError && (
            <div className="auth-error-box" role="alert" aria-live="assertive">
              <p>{loadError}</p>
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
              Memuat review yang ditugaskan…
            </div>
          )}

          {!loading && !loadError && reviews.length === 0 && (
            <div className="workspace-empty" role="status">
              <div className="workspace-empty-icon" aria-hidden="true">
                <FileText size={36} />
              </div>
              <h3>{walletConnected ? "Semua review sudah ditangani" : "Hubungkan wallet untuk mulai meninjau"}</h3>
              <p>
                {walletConnected
                  ? "Review baru akan muncul setelah evidence siap dan round terdaftar di jaringan."
                  : "Setelah wallet organisasi terverifikasi, evidence yang ditugaskan akan muncul di sini."}
              </p>
            </div>
          )}

          {!loading && !loadError && reviews.length > 0 && (
            <ul className="verifier-review-list">
              {reviews.map((review) => (
                <li className="verifier-review-item" key={review.reviewRoundId}>
                  <div className="verifier-review-main">
                    <div className="verifier-review-context">
                      <span className="verifier-campaign-label">{review.campaignTitle}</span>
                      <span className="verifier-sep">·</span>
                      <span className="verifier-milestone-label">{review.milestoneTitle}</span>
                    </div>
                    <h3 className="verifier-review-filename">{review.fileName}</h3>
                    <div className="verifier-review-meta-row">
                      <span className="verifier-review-badge">{review.evidenceType}</span>
                      <span className="verifier-review-meta-item">
                        <Clock size={12} aria-hidden="true" />
                        {formatDate(review.createdAt)}
                      </span>
                      <span className="verifier-review-meta-item">
                        {formatFileSize(review.fileSize)}
                      </span>
                      <span className="verifier-review-meta-item">Round {review.roundNumber}</span>
                    </div>
                  </div>
                  <div className="verifier-review-actions">
                    <span className="status-pill status-pill--pending">
                      <Clock size={10} aria-hidden="true" />
                      Menunggu vote
                    </span>
                    <Link
                      className="action-button action-button--primary verifier-review-cta"
                      href={`/verifier/reviews/${review.reviewRoundId}`}
                      aria-label={`Tinjau evidence ${review.fileName}`}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      Tinjau Evidence
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Privacy Note */}
        <p className="verifier-privacy-notice">
          <ShieldCheck size={12} aria-hidden="true" />
          Vote dan catatan reviewer lain tidak ditampilkan. Setiap round memerlukan dua vote yang sejalan.
        </p>
      </div>
    </AuthenticatedLayout>
  );
}