"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

import { ApiError, requestJson } from "../../lib/api";

const ORGANIZATION_TYPES = ["NGO", "COMPANY", "GOVERNMENT", "COMMUNITY", "OTHER"] as const;
// Keep in sync with TERMS_VERSION in backend/src/auth/validation.js.
const TERMS_VERSION = "2026-10-07-funder-terms-v1";

const ORG_TYPE_LABELS: Record<(typeof ORGANIZATION_TYPES)[number], string> = {
  NGO: "LSM / NGO",
  COMPANY: "Perusahaan / Korporasi",
  GOVERNMENT: "Instansi Pemerintah",
  COMMUNITY: "Komunitas",
  OTHER: "Lainnya",
};

function registrationMessage(error: unknown) {
  if (error instanceof ApiError && error.code === "account_unavailable") {
    return "Akun tidak dapat dibuat dengan email ini. Periksa alamat atau hubungi Admin.";
  }
  if (error instanceof ApiError && error.code === "invalid_request") {
    return "Periksa kembali data yang diisi dan persyaratan kata sandi.";
  }
  return "Akun belum dapat dibuat. Periksa koneksi lalu coba lagi; data yang diisi tetap tersimpan.";
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationType, setOrganizationType] = useState<(typeof ORGANIZATION_TYPES)[number]>("COMMUNITY");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setReady(true), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await requestJson("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, organizationName, organizationType, acceptedTermsVersion: TERMS_VERSION }),
      });
      router.replace("/campaigns");
    } catch (cause) {
      setError(registrationMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main" className="auth-page">
      <section className="auth-panel" aria-labelledby="register-title">
        <Link className="auth-brand-logo" href="/" aria-label="DanaTerang, halaman utama">
          <Image
            src="/asset/lockup_horizontal.png"
            alt="DanaTerang"
            width={160}
            height={36}
            priority
          />
        </Link>

        <div className="auth-panel-intro">
          <p className="eyebrow">MULAI DARI ORGANISASI</p>
          <h1 id="register-title" className="auth-title">Buat akun Organizer</h1>
          <p className="auth-intro">Daftarkan organisasi untuk mengelola campaign dan bukti program.</p>
        </div>

        <form className="auth-form" onSubmit={submit} aria-busy={submitting}>
          <div className="form-field">
            <label htmlFor="register-name">Nama lengkap PIC</label>
            <input
              id="register-name"
              name="name"
              autoComplete="name"
              placeholder="Nama Anda"
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={1}
              maxLength={160}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="register-organization">Nama organisasi</label>
            <input
              id="register-organization"
              name="organizationName"
              autoComplete="organization"
              placeholder="PT / Yayasan / LSM..."
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              minLength={2}
              maxLength={180}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="register-organization-type">Jenis organisasi</label>
            <select
              id="register-organization-type"
              name="organizationType"
              value={organizationType}
              onChange={(event) => setOrganizationType(event.target.value as (typeof ORGANIZATION_TYPES)[number])}
            >
              {ORGANIZATION_TYPES.map((type) => (
                <option key={type} value={type}>{ORG_TYPE_LABELS[type]}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="pic@organisasi.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="register-password">Kata sandi</label>
            <div className="password-field-wrap">
              <input
                id="register-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Min. 12 karakter"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={12}
                maxLength={128}
                aria-describedby="register-password-hint"
                required
              />
              <button
                type="button"
                className="password-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
              >
                {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
            <p id="register-password-hint" className="field-hint">Gunakan 12–128 karakter. Kata sandi tidak akan ditampilkan.</p>
          </div>

          {error && (
            <div className="auth-error-box" role="alert" aria-live="assertive">
              <p>{error}</p>
            </div>
          )}

          <div className="form-field form-field--checkbox">
            <input
              id="register-terms"
              name="acceptedTerms"
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              required
            />
            <label htmlFor="register-terms">
              Saya menyetujui Syarat &amp; Ketentuan DanaTerang, termasuk bahwa bukti program diverifikasi panel 3 Verifier dan hasilnya tercatat permanen.
            </label>
          </div>

          <button
            className="action-button action-button--primary auth-cta-btn"
            type="submit"
            disabled={!ready || submitting}
            aria-busy={submitting}
          >
            {submitting ? "Membuat akun…" : ready ? "Buat akun" : "Menyiapkan formulir…"}
          </button>
        </form>

        <p className="auth-switch">Sudah punya akun? <Link href="/login">Masuk</Link></p>
      </section>

      <aside className="auth-aside" aria-labelledby="register-aside-title">
        <div className="auth-aside-logo-row">
          <Image
            src="/asset/logo_icon_lime.png"
            alt=""
            width={40}
            height={40}
            aria-hidden="true"
          />
          <Image
            src="/asset/lockup_full_white.png"
            alt="DanaTerang"
            width={120}
            height={28}
          />
        </div>
        <p className="eyebrow">PRIVASI SEJAK AWAL</p>
        <h2 id="register-aside-title">Bukti asli tidak ditampilkan untuk publik secara default.</h2>
        <ol className="auth-steps">
          <li>
            <span>01</span>
            <div>
              <strong>Role Organizer</strong>
              <p>Registrasi publik hanya membuat akun Organizer untuk mengelola program.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Role Funder &amp; Admin</strong>
              <p>Role Funder dan Admin diberikan oleh Admin DanaTerang setelah verifikasi.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Verifier Independen</strong>
              <p>Verifier direkrut secara terpisah dan masuk roster setelah verifikasi organisasi.</p>
            </div>
          </li>
        </ol>
        <div className="auth-aside-security">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>Dokumen asli tetap privat. Status review dan proof memiliki arti yang berbeda.</span>
        </div>
      </aside>
    </main>
  );
}
