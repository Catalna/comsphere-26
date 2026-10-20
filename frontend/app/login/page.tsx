"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

import { ApiError, requestJson } from "../../lib/api";

function loginMessage(error: unknown) {
  if (error instanceof ApiError && error.code === "invalid_credentials") {
    return "Email atau kata sandi tidak cocok. Periksa kembali lalu coba lagi.";
  }
  if (error instanceof ApiError && error.code === "invalid_request") {
    return "Periksa format email dan kata sandi, lalu coba lagi.";
  }
  return "Tidak dapat masuk. Periksa koneksi lalu coba lagi; data yang diisi tetap tersimpan.";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setReady(true), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await requestJson<{ user: { role: string } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const roleDefaults: Record<string, string> = {
        ADMIN: "/admin/reviews",
        ORGANIZER: "/dashboard",
        FUNDER: "/dashboard",
        VERIFIER: "/verifier/reviews",
      };
      const defaultPath = roleDefaults[response.user.role] ?? "/campaigns";
      const nextPath = requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : defaultPath;
      router.replace(nextPath);
    } catch (cause) {
      setError(loginMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main" className="auth-page">
      <section className="auth-panel" aria-labelledby="login-title">
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
          <p className="eyebrow">RUANG PROGRAM</p>
          <h1 id="login-title" className="auth-title">Masuk ke akun Anda</h1>
          <p className="auth-intro">Lanjutkan tugas sesuai peran Anda di DanaTerang.</p>
        </div>

        <form className="auth-form" onSubmit={submit} aria-busy={submitting}>
          <div className="form-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="nama@organisasi.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="login-password">Kata sandi</label>
            <div className="password-field-wrap">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={12}
                maxLength={128}
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
          </div>

          {error && (
            <div className="auth-error-box" role="alert" aria-live="assertive">
              <p>{error}</p>
            </div>
          )}

          <button
            className="action-button action-button--primary auth-cta-btn"
            type="submit"
            disabled={!ready || submitting}
            aria-busy={submitting}
          >
            {submitting ? "Sedang masuk…" : ready ? "Masuk" : "Menyiapkan formulir…"}
          </button>
        </form>

        <p className="auth-switch">Belum punya akun? <Link href="/register">Buat akun Organizer</Link></p>
      </section>

      <aside className="auth-aside" aria-labelledby="auth-aside-title">
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
        <p className="eyebrow">AKUNTABILITAS PROGRAM</p>
        <h2 id="auth-aside-title">Satu jejak yang jelas untuk setiap tahap.</h2>
        <ol className="auth-steps">
          <li>
            <span>01</span>
            <div>
              <strong>Campaign &amp; Milestone</strong>
              <p>Buat program dan tetapkan tahapan dengan anggaran yang jelas.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Bukti &amp; Screening</strong>
              <p>Upload evidence; AI melakukan screening awal otomatis.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Review 2-dari-3 &amp; Proof</strong>
              <p>Quorum verifier independen memutuskan, hasilnya dianchor on-chain.</p>
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
