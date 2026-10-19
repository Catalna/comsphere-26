"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Banknote,
  ShieldAlert,
  AlertCircle,
} from "lucide-react";

import AuthenticatedLayout from "../../components/AuthenticatedLayout";
import { useCurrentUser } from "../../lib/useCurrentUser";

export default function PaymentReportsPage() {
  const { loading: userLoading } = useCurrentUser();
  const [requested, setRequested] = useState(false);

  return (
    <AuthenticatedLayout
      title="Payment Reports"
      subtitle="External Payment Reports — Laporan penyaluran dana yang dilaporkan oleh pihak funder/donor."
    >
      {(userLoading) && (
        <div className="workspace-loading" aria-busy="true">
          Memuat data laporan pembayaran…
        </div>
      )}

      {!userLoading && (
        <div className="payment-reports-shell">
          {/* Disclosure banner — accurate: DanaTerang never verifies external transfers */}
          <div className="dt-notice-card" role="note">
            <div className="notice-icon" aria-hidden="true">
              <ShieldAlert size={20} />
            </div>
            <div className="notice-content">
              <strong>Ketentuan Laporan Pembayaran Eksternal:</strong>
              <p>
                Dana pembayaran dan transfer aktual berlangsung di luar sistem DanaTerang. Halaman ini
                hanya menampilkan laporan yang dicatat oleh pihak pemberi dana (Funder), dan bukan
                verifikasi independen dari DanaTerang.
              </p>
            </div>
          </div>

          <div className="workspace-empty">
            <div className="workspace-empty-icon" aria-hidden="true">
              <Banknote size={40} />
            </div>
            <h3>Belum ada laporan pembayaran</h3>
            <p>
              Laporan pembayaran akan tercatat di sini ketika Funder mencatat penyaluran dana untuk
              milestone program Anda. Pencatatan laporan oleh Funder belum didukung pada lingkup
              aplikasi ini, sehingga halaman ini sengaja dibiarkan kosong daripada menampilkan data
              contoh.
            </p>
            {requested && (
              <p className="field-hint" role="status">
                <AlertCircle size={14} aria-hidden="true" /> Permintaan tercatat untuk sesi ini. Hubungi
                Admin DanaTerang untuk mengaktifkan pencatatan laporan pembayaran.
              </p>
            )}
            <div className="workspace-actions">
              <button
                type="button"
                className="action-button action-button--secondary"
                onClick={() => setRequested(true)}
                disabled={requested}
              >
                {requested ? "Permintaan tercatat" : "Minta Funder membuat laporan"}
              </button>
              <Link href="/campaigns" className="action-button action-button--primary">
                Buka Campaign Saya
              </Link>
            </div>
          </div>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
