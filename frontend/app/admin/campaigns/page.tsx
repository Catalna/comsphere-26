"use client";

import { useCallback, useEffect, useState } from "react";

import AuthenticatedLayout from "../../../components/AuthenticatedLayout";
import { ApiError, requestJson } from "../../../lib/api";
import { formatMoney } from "../../../lib/formatMoney";

type CampaignPublication = {
  campaignId: string;
  title: string;
  status: string;
  totalBudget: string;
  currency: string;
  published: boolean;
  publishedAt: string | null;
};

function publicationTime(value: string | null) {
  if (!value) return "Belum dipublikasikan";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function AdminCampaignPublicationPage() {
  const [campaigns, setCampaigns] = useState<CampaignPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCampaignId, setSavingCampaignId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await requestJson<{ campaigns: CampaignPublication[] }>("/api/admin/campaigns");
      setCampaigns(response.campaigns);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 403
        ? "Halaman ini hanya tersedia untuk Admin."
        : "Daftar campaign belum dapat dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setPublication(campaign: CampaignPublication) {
    setSavingCampaignId(campaign.campaignId);
    setError("");
    setMessage("");
    try {
      const response = await requestJson<{ campaign: CampaignPublication }>(
        `/api/admin/campaigns/${campaign.campaignId}/publication`,
        { method: "PATCH", body: JSON.stringify({ published: !campaign.published }) },
      );
      setCampaigns((current) => current.map((item) => item.campaignId === campaign.campaignId ? response.campaign : item));
      setMessage(response.campaign.published
        ? `${campaign.title} sekarang tampil di audit publik.`
        : `${campaign.title} tidak lagi tampil di audit publik.`);
    } catch {
      setError("Status publikasi belum dapat diubah. Periksa koneksi lalu coba lagi.");
    } finally {
      setSavingCampaignId("");
    }
  }

  return (
    <AuthenticatedLayout title="Publikasi audit publik">
      <section className="workspace-panel" aria-labelledby="publication-heading">
        <div className="workspace-title-row">
          <div>
            <p className="eyebrow">KONTROL PRIVASI</p>
            <h2 id="publication-heading" className="panel-heading">Pilih campaign yang boleh dilihat publik</h2>
          </div>
        </div>
        <p className="section-note">Campaign bersifat privat secara default. Audit publik hanya menampilkan judul, anggaran, status milestone, ringkasan quorum, dan status proof—tidak pernah file, nama file, OCR, catatan, atau referensi pembayaran.</p>
        <p className={message ? "workspace-success" : "visually-hidden"} role="status" aria-live="polite">{message}</p>
        <p className={error ? "workspace-error" : "visually-hidden"} role="alert" aria-live="assertive">{error}</p>
        {loading ? (
          <div className="workspace-loading" aria-busy="true">Memuat campaign…</div>
        ) : error ? (
          <button className="action-button action-button--secondary" type="button" onClick={() => void load()}>Coba lagi</button>
        ) : campaigns.length === 0 ? (
          <div className="workspace-empty"><h3>Belum ada campaign</h3><p>Campaign yang dibuat akan muncul di sini dan bersifat privat sampai Admin memublikasikannya.</p></div>
        ) : (
          <div className="table-scroll">
            <table className="workspace-table">
              <caption>Campaign dan status publikasi audit</caption>
              <thead><tr><th scope="col">Campaign</th><th scope="col">Anggaran</th><th scope="col">Status</th><th scope="col">Publikasi</th><th scope="col">Aksi</th></tr></thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.campaignId}>
                    <th scope="row">{campaign.title}<span className="table-meta">{campaign.status} · {publicationTime(campaign.publishedAt)}</span></th>
                    <td>{formatMoney(campaign.totalBudget, campaign.currency)}</td>
                    <td><span className={`status-pill ${campaign.published ? "status-pill--success" : "status-pill--neutral"}`}>{campaign.published ? "Tampil publik" : "Privat"}</span></td>
                    <td>{campaign.published ? "Dipublikasikan Admin" : "Belum dipublikasikan"}</td>
                    <td>
                      <button
                        className="action-button action-button--secondary"
                        type="button"
                        disabled={savingCampaignId === campaign.campaignId}
                        aria-busy={savingCampaignId === campaign.campaignId}
                        onClick={() => void setPublication(campaign)}
                      >
                        {savingCampaignId === campaign.campaignId
                          ? "Menyimpan…"
                          : campaign.published
                            ? `Tarik publikasi ${campaign.title}`
                            : `Publikasikan ${campaign.title}`}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AuthenticatedLayout>
  );
}
