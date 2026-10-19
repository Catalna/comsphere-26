"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import AuthenticatedLayout from "../../../components/AuthenticatedLayout";
import { ApiError, requestJson } from "../../../lib/api";
import { useCurrentUser } from "../../../lib/useCurrentUser";

type FunderOption = {
  id: string;
  name: string;
  organization: { name: string; type: string } | null;
};

function messageFor(error: unknown) {
  if (error instanceof ApiError && error.code === "invalid_request") return "Periksa kembali anggaran, tanggal, dan pilihan Funder.";
  if (error instanceof ApiError && error.code === "funder_not_available") return "Funder ini tidak lagi tersedia. Muat ulang daftar lalu pilih kembali.";
  return "Campaign belum dapat disimpan. Data yang diisi tetap tersedia; coba lagi.";
}

export default function NewCampaignPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const router = useRouter();
  const [funders, setFunders] = useState<FunderOption[]>([]);
  const [loadingFunders, setLoadingFunders] = useState(true);
  const [funderError, setFunderError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [totalBudget, setTotalBudget] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [funderId, setFunderId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadFunders = useCallback(async () => {
    setLoadingFunders(true);
    setFunderError("");
    try {
      const response = await requestJson<{ funders: FunderOption[] }>("/api/funders");
      setFunders(response.funders);
      setFunderId((current) => current || response.funders[0]?.id || "");
    } catch {
      setFunderError("Daftar Funder belum dapat dimuat.");
    } finally {
      setLoadingFunders(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === "ORGANIZER") void loadFunders();
  }, [loadFunders, user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await requestJson<{ campaign: { id: string } }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title, description, totalBudget, currency, funderId, fundingMode: "EXTERNAL_TRACKING",
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        }),
      });
      router.push(`/campaigns/${response.campaign.id}`);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthenticatedLayout title="Buat campaign">
      {userLoading ? <div className="workspace-loading" aria-busy="true">Memeriksa sesi…</div> : user?.role !== "ORGANIZER" ? (
        <section className="workspace-error" role="alert">Campaign draft dibuat oleh akun Organizer.</section>
      ) : loadingFunders ? (
        <div className="workspace-loading" aria-busy="true">Memuat daftar Funder…</div>
      ) : funderError ? (
        <div className="workspace-error"><p role="alert" aria-live="assertive">{funderError}</p><button className="action-button action-button--secondary" onClick={() => void loadFunders()}>Coba lagi</button></div>
      ) : funders.length === 0 ? (
        <section className="workspace-empty" aria-labelledby="no-funder-title">
          <h2 id="no-funder-title">Belum ada Funder</h2>
          <p>Minta Admin menetapkan role Funder sebelum membuat campaign.</p>
        </section>
      ) : (
        <form className="workspace-panel form-grid" onSubmit={submit} aria-busy={submitting}>
          <div className="form-field form-field--full">
            <label htmlFor="campaign-title">Judul campaign</label>
            <input id="campaign-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={160} required />
          </div>
          <div className="form-field form-field--full">
            <label htmlFor="campaign-description">Deskripsi</label>
            <textarea id="campaign-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} />
          </div>
          <div className="form-field">
            <label htmlFor="campaign-budget">Anggaran total</label>
            <input id="campaign-budget" inputMode="decimal" value={totalBudget} onChange={(event) => setTotalBudget(event.target.value)} aria-describedby="campaign-budget-hint" required />
            <p className="field-hint" id="campaign-budget-hint">Angka desimal tanpa pemisah ribuan, maksimal dua angka desimal.</p>
          </div>
          <div className="form-field">
            <label htmlFor="campaign-currency">Mata uang</label>
            <select id="campaign-currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
              <option value="IDR">IDR — Rupiah</option>
              <option value="USD">USD — US Dollar</option>
              <option value="SGD">SGD — Singapore Dollar</option>
            </select>
          </div>
          <div className="form-field form-field--full">
            <label htmlFor="campaign-funder">Funder</label>
            <select id="campaign-funder" value={funderId} onChange={(event) => setFunderId(event.target.value)} required>
              {funders.map((funder) => <option key={funder.id} value={funder.id}>{funder.name}{funder.organization ? ` — ${funder.organization.name}` : ""}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="campaign-start-date">Tanggal mulai (opsional)</label>
            <input id="campaign-start-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="campaign-end-date">Tanggal selesai (opsional)</label>
            <input id="campaign-end-date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <p className="form-message form-field--full" role="alert" aria-live="assertive">{error}</p>
          <div className="workspace-actions form-field--full">
            <button className="action-button action-button--primary" type="submit" disabled={submitting || !funderId} aria-busy={submitting}>
              {submitting ? "Menyimpan draft…" : "Simpan draft"}
            </button>
            <Link className="action-button action-button--secondary" href="/campaigns">Batal</Link>
          </div>
        </form>
      )}
    </AuthenticatedLayout>
  );
}
