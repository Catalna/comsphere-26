"use client";

import Link from "next/link";
import {
  Building2,
  ShieldCheck,
  Lock,
  ArrowRight,
  Info,
  AlertCircle,
} from "lucide-react";

import AuthenticatedLayout from "../../components/AuthenticatedLayout";
import { useCurrentUser } from "../../lib/useCurrentUser";

function organizationTypeLabel(type: string | undefined) {
  if (type === "NGO") return "LSM / NGO";
  if (type === "COMPANY") return "Perusahaan";
  if (type === "GOVERNMENT") return "Instansi Pemerintah";
  if (type === "COMMUNITY") return "Komunitas / Paguyuban";
  if (type === "OTHER") return "Lainnya";
  return type || "Belum ditetapkan";
}

export default function OrganizationPage() {
  const { user, loading } = useCurrentUser();

  if (loading) {
    return (
      <AuthenticatedLayout title="Profil Organisasi">
        <div className="workspace-loading" aria-busy="true">
          Memuat profil organisasi…
        </div>
      </AuthenticatedLayout>
    );
  }

  const org = user?.organization;
  const orgName = org?.name || "Lembaga Sosial Mitra";
  const orgType = organizationTypeLabel(org?.type);

  return (
    <AuthenticatedLayout
      title="Profil Organisasi"
      subtitle="Kelola identitas lembaga, penanggung jawab program, dan rekening penyaluran dana."
    >
      <div className="organization-page-shell">
        {/* Org Banner Card */}
        <section className="workspace-panel org-header-card" aria-label="Identitas Lembaga">
          <div className="org-header-left">
            <div className="org-avatar-big" aria-hidden="true">
              <Building2 size={36} />
            </div>
            <div className="org-header-details">
              <div className="org-type-badge">
                <span>{orgType}</span>
                {org?.verified ? (
                  <span className="org-verified-tag">
                    <ShieldCheck size={14} aria-hidden="true" />
                    <span>Terverifikasi</span>
                  </span>
                ) : (
                  <span className="org-verified-tag org-verified-tag--pending">
                    <AlertCircle size={14} aria-hidden="true" />
                    <span>Menunggu verifikasi legalitas</span>
                  </span>
                )}
              </div>
              <h2>{orgName}</h2>
              <p>Akun Penyelenggara Resmi DanaTerang Indonesia</p>
            </div>
          </div>
          <div className="org-header-right">
            <span className="org-id-pill">ID: {org?.id || user?.id || "ORG-TERANG-01"}</span>
          </div>
        </section>

        {/* 2-Column Details */}
        <div className="dashboard-grid-layout">
          {/* Left Column: Organization & PIC Details */}
          <div className="dashboard-main-col">
            {/* Lembaga Info */}
            <section className="workspace-panel" aria-labelledby="org-info-heading">
              <div className="workspace-title-row">
                <div>
                  <p className="eyebrow">DATA ENTITAS</p>
                  <h3 id="org-info-heading" className="panel-heading">
                    Informasi Lembaga
                  </h3>
                </div>
              </div>

              <dl className="org-details-dl">
                <div className="org-dl-row">
                  <dt>Nama Lengkap Lembaga</dt>
                  <dd>
                    <strong>{orgName}</strong>
                  </dd>
                </div>
                <div className="org-dl-row">
                  <dt>Kategori Organisasi</dt>
                  <dd>{orgType}</dd>
                </div>
                <div className="org-dl-row">
                  <dt>Status Verifikasi Legalitas</dt>
                  <dd>
                    {org?.verified ? (
                      <span className="status-pill status-pill--success">
                        Terverifikasi oleh Tim Kepatuhan DanaTerang
                      </span>
                    ) : (
                      <span className="status-pill status-pill--warning">
                        Belum diverifikasi oleh Admin DanaTerang
                      </span>
                    )}
                  </dd>
                </div>
                <div className="org-dl-row">
                  <dt>Wilayah Operasional</dt>
                  <dd>Indonesia</dd>
                </div>
              </dl>
            </section>

            {/* PIC Info */}
            <section className="workspace-panel" aria-labelledby="pic-heading">
              <div className="workspace-title-row">
                <div>
                  <p className="eyebrow">PENANGGUNG JAWAB</p>
                  <h3 id="pic-heading" className="panel-heading">
                    Kontak & Pengelola Akun (PIC)
                  </h3>
                </div>
              </div>

              <dl className="org-details-dl">
                <div className="org-dl-row">
                  <dt>Nama Penanggung Jawab</dt>
                  <dd>
                    <strong>{user?.name}</strong>
                  </dd>
                </div>
                <div className="org-dl-row">
                  <dt>Email Terdaftar</dt>
                  <dd>{user?.email}</dd>
                </div>
                <div className="org-dl-row">
                  <dt>Hak Akses Sistem</dt>
                  <dd>
                    <span className="status-pill status-pill--pending">{user?.role}</span>
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          {/* Right Column: Bank Account & Compliance */}
          <div className="dashboard-side-col">
            {/* Bank Disbursement */}
            <section className="workspace-panel side-panel" aria-labelledby="bank-disbursement-heading">
              <div className="side-panel-header">
                <div className="side-panel-icon" aria-hidden="true">
                  <Lock size={18} />
                </div>
                <div>
                  <h3 id="bank-disbursement-heading" className="side-panel-title">
                    Rekening Penyaluran Dana
                  </h3>
                  <p className="side-panel-sub">Rekening pencairan dana milestone</p>
                </div>
              </div>

              <div className="side-panel-info">
                <p>Data rekening penyaluran dikelola dan diaudit oleh Admin DanaTerang.</p>
              </div>

              <div className="dt-notice-card dt-notice-card--compact" role="note">
                <div className="notice-icon" aria-hidden="true">
                  <Info size={18} />
                </div>
                <div className="notice-content">
                  <p>
                    Halaman ini belum terhubung ke penyimpanan data rekening. Perubahan rekening harus
                    diajukan melalui Admin DanaTerang agar tercatat pada audit trail sebelum pencairan
                    dana milestone disetujui.
                  </p>
                </div>
              </div>

              <dl className="org-details-dl">
                <div className="org-dl-row">
                  <dt>Status Data Rekening</dt>
                  <dd>
                    <span className="status-pill status-pill--warning">Belum tersedia</span>
                  </dd>
                </div>
              </dl>
            </section>

            {/* Security Notice */}
            <section className="workspace-panel side-panel" aria-labelledby="sec-notice-heading">
              <div className="side-panel-header">
                <div className="side-panel-icon side-panel-icon--lime" aria-hidden="true">
                  <Lock size={18} />
                </div>
                <div>
                  <h3 id="sec-notice-heading" className="side-panel-title">
                    Keamanan & Anti Fraud
                  </h3>
                </div>
              </div>

              <div className="side-panel-info">
                <p>
                  Perubahan nomor rekening penyaluran akan diaudit oleh Admin DanaTerang sebelum dapat
                  menerima pencairan dana dari milestone yang disetujui.
                </p>
              </div>

              <Link href="/campaigns" className="action-button action-button--secondary btn-full">
                <span>Kembali ke Campaign Saya</span>
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </section>
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
