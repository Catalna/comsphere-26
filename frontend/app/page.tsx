"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Cpu,
  Database,
  FileCheck2,
  FileText,
  Info,
  Layers,
  Lock,
  LockKeyhole,
  Menu,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { explorerTxUrl, proofStatusLabel } from "../lib/blockchain";
import { formatMoney } from "../lib/formatMoney";
import { requestJson } from "../lib/api";

type StatusTone = "success" | "warning" | "reported" | "pending" | "neutral";

function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

/** Allowlisted public-audit projection of one Admin-published campaign. */
type PublicVerificationSummary = {
  total: number;
  verified: number;
  needsRevision: number;
  rejected: number;
  pending: number;
};

type PublicMilestone = {
  milestoneId: string;
  title: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  budgetAmount: string;
  verification: PublicVerificationSummary;
};

type PublicProof = {
  proofId: string;
  status: "PENDING" | "ANCHORING" | "ANCHORED" | "FAILED";
  transactionHash: string | null;
};

type PublicCampaign = {
  campaignId: string;
  title: string;
  status: string;
  totalBudget: string;
  currency: string;
  verifiedEvidenceCount: number;
  evidenceTotal: number;
  milestones: PublicMilestone[];
  proofs: PublicProof[];
};

function milestoneActivityLabel(status: PublicMilestone["status"]) {
  if (status === "COMPLETED") return "Tahap selesai (aktivitas)";
  if (status === "IN_PROGRESS") return "Tahap berjalan";
  if (status === "CANCELLED") return "Tahap dibatalkan";
  return "Tahap direncanakan";
}

function milestoneActivityTone(status: PublicMilestone["status"]): StatusTone {
  if (status === "COMPLETED") return "success";
  if (status === "IN_PROGRESS") return "pending";
  if (status === "CANCELLED") return "warning";
  return "neutral";
}

function verificationLabelFor(summary: PublicVerificationSummary) {
  if (summary.rejected > 0) return "Ditolak oleh quorum";
  if (summary.needsRevision > 0) return "Perlu revisi oleh quorum";
  if (summary.verified > 0) return "Disetujui oleh quorum 2-dari-3";
  if (summary.pending > 0) return "Menunggu quorum verifier";
  if (summary.total === 0) return "Belum ada evidence";
  return "Menunggu quorum verifier";
}

function verificationToneFor(summary: PublicVerificationSummary): StatusTone {
  if (summary.rejected > 0 || summary.needsRevision > 0) return "warning";
  if (summary.verified > 0) return "success";
  if (summary.total === 0) return "neutral";
  return "pending";
}

function proofStatusTone(status: PublicProof["status"]): StatusTone {
  if (status === "ANCHORED") return "success";
  if (status === "ANCHORING") return "pending";
  if (status === "FAILED") return "warning";
  return "pending";
}

const workflowSteps = [
  {
    step: "01",
    title: "Perencanaan & Rencana Anggaran (RAB)",
    role: "Organizer / Pelaksana",
    description: "Organizer mendaftarkan program sosial, menetapkan target milestone yang terukur, dan mengalokasikan anggaran transparan untuk tiap fase pengerjaan.",
    highlight: "Struktur milestone mengunci batasan pencairan per tahap",
    icon: Layers,
  },
  {
    step: "02",
    title: "Unggah Bukti Fisik Lapangan",
    role: "Organizer / Pelaksana",
    description: "Setelah pekerjaan selesai, pelaksana mengunggah nota pembelian, invoice vendor, dan foto progres. Dokumen di-hash SHA-256 untuk memastikan keaslian.",
    highlight: "Canonical hash menjamin dokumen tidak dapat ditukar",
    icon: FileText,
  },
  {
    step: "03",
    title: "Skrining AI & Kuorum Verifier (2-of-3)",
    role: "AI OCR + 3 Verifier Independen",
    description: "Engine OCR AI memeriksa teks dan anomali nilai kwitansi secara instan. Selanjutnya, 3 verifier independen terakreditasi menelaah dan memberikan suara konsensus kriptografis.",
    highlight: "AI memberi flag anomali; keputusan mutlak di tangan konsensus manusia",
    icon: Scale,
  },
  {
    step: "04",
    title: "Pelaporan Pencairan oleh Funder",
    role: "CSR Funder / Donor",
    description: "Funder memverifikasi hasil tinjauan kuorum yang disetujui, lalu mencairkan dana termin berikutnya dan mencatat laporan pembayaran secara transparan.",
    highlight: "Pencairan bertahap melindungi dana dari risiko moral hazard",
    icon: Wallet,
  },
  {
    step: "05",
    title: "Pencatatan Proof di Ethereum Sepolia",
    role: "Smart Contract On-Chain",
    description: "Paket verifikasi yang disahkan di-anchor ke smart contract di Ethereum Sepolia Testnet, menciptakan jejak integritas abadi yang dapat diaudit publik kapan saja.",
    highlight: "Audit trail kekal tanpa mempublikasikan data privat",
    icon: ShieldCheck,
  },
];

const featureList = [
  {
    icon: Cpu,
    tag: "Otomasi & Integritas",
    title: "Multi-Stage AI & OCR Screening",
    description: "Ekstraksi data kwitansi dan invoice secara otomatis dengan analisis confidence score per field. AI mendeteksi ketidaksesuaian nominal, tanggal kadaluarsa, atau indikasi duplikasi seketika.",
  },
  {
    icon: Users,
    tag: "Konsensus Tanpa Bias",
    title: "2-of-3 Peer Verifier Quorum",
    description: "Menghapus titik kegagalan tunggal (single point of failure). Verifikasi memerlukan konsensus mayoritas dari 3 verifier independen terpisah yang menandatangani verifikasi secara kriptografis.",
  },
  {
    icon: CircleDollarSign,
    tag: "Tata Kelola Funder",
    title: "Milestone-Based Disbursement",
    description: "Dana hibah atau CSR disalurkan secara bertahap sesuai progres nyata di lapangan. Funder memiliki kepastian penuh sebelum merilis dana untuk tahap pekerjaan berikutnya.",
  },
  {
    icon: Lock,
    tag: "Kerahasiaan Data",
    title: "Privacy-Preserving Audit Proofs",
    description: "Dokumen asli dan rincian sensitif disimpan aman dan terenkripsi. Publik hanya mengakses status verifikasi yang disetujui, ringkasan terredaksi, dan cryptographic receipt.",
  },
  {
    icon: Database,
    tag: "Audit Trail Abadi",
    title: "Ethereum Sepolia On-Chain Proof",
    description: "Canonical hash dari setiap bundel milestone yang disetujui di-anchor ke smart contract Ethereum Sepolia. Menghasilkan bukti matematis permanen yang tidak dapat diubah atau dimanipulasi.",
  },
  {
    icon: Sparkles,
    tag: "Ekosistem Kolaboratif",
    title: "Multi-Role Tailored Workspace",
    description: "Portal kerja khusus dengan hak akses berbeda untuk Funder CSR korporat, NGO Pelaksana, Verifier Independen, dan Auditor Publik untuk alur kerja yang rapi dan efisien.",
  },
];

const faqs = [
  {
    question: "Apakah dokumen sensitif seperti kwitansi atau data vendor akan terekspos ke publik?",
    answer: "Tidak. DanaTerang menerapkan prinsip Privacy-Preserving Proofs. Dokumen asli, OCR lengkap, dan referensi pembayaran privat hanya dapat diakses oleh pihak berwenang (Pelaksana, Funder, dan Verifier yang ditugaskan). Publik hanya melihat ringkasan status yang disetujui dan bukti kriptografis on-chain.",
  },
  {
    question: "Bagaimana mekanisme 2-of-3 Peer Verifier Quorum bekerja?",
    answer: "Setiap bukti milestone yang diajukan akan ditugaskan kepada 3 verifier independen terakreditasi. Keputusan (Verify / Request Revision / Reject) membutuhkan minimal 2 suara yang sejalan. Admin atau pihak internal tidak dapat membatalkan atau mengubah hasil pemungutan suara verifier.",
  },
  {
    question: "Mengapa menggunakan Ethereum Sepolia dan bukan database konvensional biasa?",
    answer: "Database konvensional dapat diubah, dihapus, atau dimanipulasi oleh administrator sistem. Dengan meng-anchor ringkasan hash (canonical hash) ke smart contract blockchain Ethereum Sepolia, catatan verifikasi menjadi abadi, tahan sensor, dan dapat diverifikasi secara independen oleh pihak ketiga tanpa bergantung pada server DanaTerang.",
  },
  {
    question: "Apakah DanaTerang memegang atau mentransfer dana langsung?",
    answer: "Tidak. DanaTerang adalah platform verifikasi integritas, tata kelola, dan audit trail. Transaksi pembayaran tetap dilakukan secara langsung dari rekening Funder ke Pelaksana (bank transfer / escrow eksternal). DanaTerang mencatat laporan pembayaran yang disinkronkan dengan pemenuhan milestone.",
  },
  {
    question: "Bagaimana cara organisasi sosial atau perusahaan CSR mulai menggunakan DanaTerang?",
    answer: "Anda dapat mendaftar akun Organizer untuk membuat program sosial baru, atau masuk ke portal Funder CSR untuk memonitor portofolio program yang Anda danai. Kami juga menyediakan panduan aktivasi cepat serta integrasi API.",
  },
];

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [activeAudience, setActiveAudience] = useState<"funder" | "ngo" | "verifier">("funder");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);
  const [publishedCampaigns, setPublishedCampaigns] = useState<PublicCampaign[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPublishedCampaigns() {
      try {
        const response = await requestJson<{ campaigns: PublicCampaign[] }>("/api/public/campaigns");
        if (!cancelled) setPublishedCampaigns(response.campaigns ?? []);
      } catch {
        if (!cancelled) setAuditError(true);
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    }
    void loadPublishedCampaigns();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="site-shell landing-theme">
      {/* Header / Navbar */}
      <header className="site-header site-header--glass sticky-header">
        <div className="header-inner">
          <Link className="brand brand--landing" href="/" aria-label="DanaTerang, beranda utama">
            <div className="brand-logo-wrapper">
              <Image
                src="/asset/lockup_horizontal.png"
                alt="DanaTerang Logo"
                width={154}
                height={36}
                priority
                className="brand-logo-img"
              />
            </div>
          </Link>

          <nav className="primary-nav desktop-only" aria-label="Navigasi utama">
            <a href="#fitur" className="nav-link">Fitur Unggulan</a>
            <a href="#cara-kerja" className="nav-link">Cara Kerja</a>
            <a href="#solusi" className="nav-link">Solusi</a>
            <a href="#overview" className="nav-link">Demo Audit</a>
            <a href="#integritas" className="nav-link">Lapis Integritas</a>
            <a href="#faq" className="nav-link">FAQ</a>
          </nav>

          <div className="header-actions">
            <a className="header-link desktop-only" href="#overview">
              Audit publik <ArrowUpRight aria-hidden="true" size={15} />
            </a>
            <nav className="account-nav" aria-label="Akun">
              <Link href="/login" className="btn-auth btn-auth--ghost">Masuk</Link>
              <Link href="/register" className="btn-auth btn-auth--primary account-nav__primary">Buat akun</Link>
            </nav>
            <button
              type="button"
              className="mobile-menu-btn mobile-only"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-label="Buka menu navigasi"
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile Nav Drawer */}
        {mobileMenuOpen && (
          <div className="mobile-nav-drawer mobile-only" role="region" aria-label="Menu navigasi mobile">
            <div className="mobile-nav-links">
              <a href="#fitur" onClick={() => setMobileMenuOpen(false)}>Fitur Unggulan</a>
              <a href="#cara-kerja" onClick={() => setMobileMenuOpen(false)}>Cara Kerja</a>
              <a href="#solusi" onClick={() => setMobileMenuOpen(false)}>Solusi Pemangku Kepentingan</a>
              <a href="#overview" onClick={() => setMobileMenuOpen(false)}>Live Demo Audit</a>
              <a href="#integritas" onClick={() => setMobileMenuOpen(false)}>Lapis Integritas</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
              <div className="mobile-auth-actions">
                <Link href="/login" className="btn-auth btn-auth--ghost w-full" onClick={() => setMobileMenuOpen(false)}>Masuk Akun</Link>
                <Link href="/register" className="btn-auth btn-auth--primary w-full" onClick={() => setMobileMenuOpen(false)}>Daftar Sekarang</Link>
              </div>
            </div>
          </div>
        )}
      </header>

      <main id="main" className="landing-main">
        {/* Hero Section */}
        <section className="hero-landing-section" aria-labelledby="hero-heading">
          <div className="hero-landing-container">
            <div className="hero-badge">
              <span className="badge-sparkle"><Sparkles size={14} /></span>
              <span>Inovasi Akuntabilitas Program CSR & Hibah Berbasis Bukti</span>
            </div>

            <p id="hero-heading" className="hero-landing-title">
              Transparansi Nyata, Bukti Terverifikasi, <span className="text-gradient">Akuntabilitas Tanpa Keraguan.</span>
            </p>

            <p className="hero-landing-subtitle">
              Platform modern yang memadukan <strong>AI OCR Screening</strong>, konsensus <strong>2-dari-3 Peer Verifier independen</strong>, dan <strong>Cryptographic Proof di Ethereum Sepolia</strong> untuk menjamin setiap rupiah pendanaan sosial tersampaikan dengan bukti nyata.
            </p>

            <div className="hero-cta-group">
              <a href="#overview" className="btn-landing btn-landing--primary">
                <span>Jelajahi Demo Audit Publik</span>
                <ArrowRight size={18} />
              </a>
              <Link href="/register" className="btn-landing btn-landing--secondary">
                <span>Daftar Organisasi Pelaksana</span>
              </Link>
            </div>

            {/* Interactive Hero Preview Card */}
            <div className="hero-mockup-wrapper">
              <div className="hero-mockup-card">
                <div className="mockup-topbar">
                  <div className="mockup-dots">
                    <span className="dot dot--red" />
                    <span className="dot dot--yellow" />
                    <span className="dot dot--green" />
                  </div>
                  <div className="mockup-url-bar">
                    <Lock size={12} />
                    <span>danaterang.org/audit/renovasi-sd-harapan</span>
                  </div>
                  <div className="mockup-status-tag">
                    <span className="live-indicator" /> Live Audit Engine
                  </div>
                </div>

                <div className="mockup-body">
                  <div className="mockup-grid">
                    <div className="mockup-info-pane">
                      <div className="mockup-badge-row">
                        <span className="badge-tag">CSR PENDIDIKAN</span>
                        <span className="badge-tag badge-tag--teal">2-OF-3 QUORUM VERIFIED</span>
                      </div>
                      <h3 className="mockup-program-name">Renovasi SD Harapan</h3>
                      <p className="mockup-meta">
                        <Building2 size={15} /> NGO Peduli Negeri &bull; Didanai oleh PT ABC Foundation
                      </p>

                      <div className="mockup-metrics-grid">
                        <div className="metric-box">
                          <span className="metric-label">Total Anggaran</span>
                          <span className="metric-value">Rp100.000.000</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Progres Milestone</span>
                          <span className="metric-value text-teal">2 / 3 Selesai</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Lapis Integritas</span>
                          <span className="metric-value text-lime">Sepolia Proof</span>
                        </div>
                      </div>
                    </div>

                    <div className="mockup-stream-pane">
                      <div className="stream-header">
                        <span className="stream-title">Alur Verifikasi Bukti Terkini</span>
                        <span className="stream-sync"><Zap size={13} /> Real-time Quorum</span>
                      </div>
                      <div className="stream-list">
                        <div className="stream-item stream-item--done">
                          <CheckCircle2 size={16} className="text-teal" />
                          <div className="stream-item-info">
                            <strong>AI OCR Screening: CLEAR</strong>
                            <small>Kwitansi & invoice dicocokkan dengan RAB</small>
                          </div>
                        </div>
                        <div className="stream-item stream-item--done">
                          <BadgeCheck size={16} className="text-teal" />
                          <div className="stream-item-info">
                            <strong>Peer Quorum: 2/3 Approved</strong>
                            <small>2 Verifier independen menandatangani review</small>
                          </div>
                        </div>
                        <div className="stream-item stream-item--done">
                          <FileCheck2 size={16} className="text-teal" />
                          <div className="stream-item-info">
                            <strong>Laporan Pembayaran Funder: Tercatat</strong>
                            <small>Termin 1 Rp30.000.000 telah disalurkan</small>
                          </div>
                        </div>
                        <div className="stream-item stream-item--active">
                          <ShieldCheck size={16} className="text-lime" />
                          <div className="stream-item-info">
                            <strong>On-Chain Proof: Anchoring Ready</strong>
                            <small>Canonical hash siap di-anchor ke Sepolia</small>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Bar */}
            <div className="trust-stats-bar">
              <div className="trust-stat-item">
                <span className="stat-number">100%</span>
                <span className="stat-title">Jejak Audit Matematis</span>
                <span className="stat-desc">Data tidak dapat dimanipulasi secara sepihak</span>
              </div>
              <div className="trust-stat-item">
                <span className="stat-number">2-of-3</span>
                <span className="stat-title">Konsensus Peer Quorum</span>
                <span className="stat-desc">Keputusan verifikasi independen & objektif</span>
              </div>
              <div className="trust-stat-item">
                <span className="stat-number">0%</span>
                <span className="stat-title">Kebocoran Data Privat</span>
                <span className="stat-desc">Privasi dokumen sensitif terlindungi penuh</span>
              </div>
              <div className="trust-stat-item">
                <span className="stat-number">Multi-Role</span>
                <span className="stat-title">Ruang Kerja Kolaboratif</span>
                <span className="stat-desc">Funder, NGO pelaksana, & Verifier dalam 1 portal</span>
              </div>
            </div>
          </div>
        </section>

        {/* Problem vs Solution Section */}
        <section className="problem-solution-section" aria-labelledby="problem-heading">
          <div className="landing-container">
            <div className="section-header-center">
              <p className="eyebrow">TANTANGAN & REVOLUSI</p>
              <h2 id="problem-heading" className="section-title">Mengapa Pendanaan Sosial Butuh Standar Baru?</h2>
              <p className="section-subtitle">
                Model pelaporan CSR konvensional rentan terhadap keterlambatan, manipulasi dokumen, dan minimnya transparansi bagi para donatur.
              </p>
            </div>

            <div className="compare-grid">
              <div className="compare-card compare-card--legacy">
                <div className="compare-header">
                  <div className="compare-icon-wrap compare-icon-wrap--legacy">
                    <ShieldAlert size={22} />
                  </div>
                  <div>
                    <h3 className="compare-title">Cara Tradisional</h3>
                    <p className="compare-subtitle">Laporan Statis & Rentan Manipulasi</p>
                  </div>
                </div>
                <ul className="compare-list">
                  <li>
                    <X size={17} className="text-red" />
                    <span>Laporan pertanggungjawaban berupa berkas PDF tebal yang diserahkan di akhir program setelah dana habis.</span>
                  </li>
                  <li>
                    <X size={17} className="text-red" />
                    <span>Verifikasi sepihak oleh internal tanpa mekanisme checks and balances independen.</span>
                  </li>
                  <li>
                    <X size={17} className="text-red" />
                    <span>Rentan terhadap duplikasi kwitansi, mark-up nominal, dan pemalsuan dokumen fisik.</span>
                  </li>
                  <li>
                    <X size={17} className="text-red" />
                    <span>Publik dan donatur tidak memiliki cara untuk memverifikasi kebenaran klaim dampak secara mandiri.</span>
                  </li>
                </ul>
              </div>

              <div className="compare-card compare-card--modern">
                <div className="compare-badge">STANDAR DANATERANG</div>
                <div className="compare-header">
                  <div className="compare-icon-wrap compare-icon-wrap--modern">
                    <ShieldCheck size={22} />
                  </div>
                  <div>
                    <h3 className="compare-title">Ekosistem DanaTerang</h3>
                    <p className="compare-subtitle">Verifikasi Multi-Lapis & Bukti Kriptografis</p>
                  </div>
                </div>
                <ul className="compare-list">
                  <li>
                    <CheckCircle2 size={17} className="text-teal" />
                    <span><strong>Pencairan Bertahap:</strong> Dana hanya dicairkan per milestone setelah bukti nyata diverifikasi.</span>
                  </li>
                  <li>
                    <CheckCircle2 size={17} className="text-teal" />
                    <span><strong>Kuorum 2-dari-3:</strong> Penilaian dilakukan oleh 3 verifier independen terakreditasi secara objektif.</span>
                  </li>
                  <li>
                    <CheckCircle2 size={17} className="text-teal" />
                    <span><strong>AI OCR Screening:</strong> Skrining otomatis deteksi anomali invoice dan kecocokan nominal anggaran real-time.</span>
                  </li>
                  <li>
                    <CheckCircle2 size={17} className="text-teal" />
                    <span><strong>Ethereum Sepolia Anchoring:</strong> Bukti integritas diabadikan di blockchain publik tanpa membocorkan privasi.</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Fitur Unggulan (Core Features) */}
        <section id="fitur" className="features-section" aria-labelledby="features-heading">
          <div className="landing-container">
            <div className="section-header-center">
              <p className="eyebrow">FITUR UNGGULAN</p>
              <h2 id="features-heading" className="section-title">Teknologi Mutakhir untuk Akuntabilitas Penuh</h2>
              <p className="section-subtitle">
                Dirancang khusus untuk memenuhi standar tata kelola sosial korporat (ESG) dan lembaga non-profit modern.
              </p>
            </div>

            <div className="features-grid">
              {featureList.map((feature, idx) => {
                const IconComponent = feature.icon;
                return (
                  <article className="feature-card" key={idx}>
                    <div className="feature-card-header">
                      <div className="feature-icon-box">
                        <IconComponent size={24} />
                      </div>
                      <span className="feature-tag">{feature.tag}</span>
                    </div>
                    <h3 className="feature-card-title">{feature.title}</h3>
                    <p className="feature-card-desc">{feature.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Cara Kerja (Workflow Pipeline) */}
        <section id="cara-kerja" className="workflow-section" aria-labelledby="workflow-heading">
          <div className="landing-container">
            <div className="section-header-center">
              <p className="eyebrow">ALUR KERJA TERPADU</p>
              <h2 id="workflow-heading" className="section-title">Bagaimana DanaTerang Bekerja?</h2>
              <p className="section-subtitle">
                5 tahapan terstruktur dari perancangan anggaran hingga pencatatan proof permanen.
              </p>
            </div>

            <div className="workflow-layout">
              {/* Step Navigation Tabs */}
              <div className="workflow-nav-list" role="tablist" aria-label="Tahapan alur kerja">
                {workflowSteps.map((ws, index) => {
                  const Icon = ws.icon;
                  const isActive = activeStep === index;
                  return (
                    <button
                      key={ws.step}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`step-panel-${ws.step}`}
                      id={`step-tab-${ws.step}`}
                      className={`workflow-tab-btn ${isActive ? "workflow-tab-btn--active" : ""}`}
                      onClick={() => setActiveStep(index)}
                    >
                      <div className="tab-step-num">{ws.step}</div>
                      <div className="tab-step-content">
                        <span className="tab-step-title">{ws.title}</span>
                        <span className="tab-step-role">{ws.role}</span>
                      </div>
                      <Icon size={18} className="tab-icon" />
                    </button>
                  );
                })}
              </div>

              {/* Step Detail Card */}
              <div
                className="workflow-detail-card"
                role="tabpanel"
                id={`step-panel-${workflowSteps[activeStep].step}`}
                aria-labelledby={`step-tab-${workflowSteps[activeStep].step}`}
              >
                <div className="detail-card-badge">
                  <span>Langkah {workflowSteps[activeStep].step} dari 05</span>
                  <span className="role-pill">{workflowSteps[activeStep].role}</span>
                </div>
                <h3 className="detail-card-title">{workflowSteps[activeStep].title}</h3>
                <p className="detail-card-desc">{workflowSteps[activeStep].description}</p>

                <div className="detail-highlight-box">
                  <div className="highlight-icon">
                    <CheckCircle2 size={20} />
                  </div>
                  <div>
                    <strong>Keunggulan Lapis ini:</strong>
                    <p>{workflowSteps[activeStep].highlight}</p>
                  </div>
                </div>

                <div className="detail-step-footer">
                  <div className="step-dots">
                    {workflowSteps.map((_, i) => (
                      <span
                        key={i}
                        className={`step-indicator-dot ${i === activeStep ? "step-indicator-dot--active" : ""}`}
                        onClick={() => setActiveStep(i)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="next-step-btn"
                    onClick={() => setActiveStep((prev) => (prev + 1) % workflowSteps.length)}
                  >
                    <span>Tahap Selanjutnya</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Solusi Pemangku Kepentingan (Use Cases) */}
        <section id="solusi" className="solutions-section" aria-labelledby="solutions-heading">
          <div className="landing-container">
            <div className="section-header-center">
              <p className="eyebrow">SOLUSI TEPAT SASARAN</p>
              <h2 id="solutions-heading" className="section-title">Dibuat untuk Semua Pihak dalam Ekosistem</h2>
              <p className="section-subtitle">
                Menyatukan Funder korporat, pelaksana lapangan, dan verifier dalam satu ruang kolaborasi terpercaya.
              </p>
            </div>

            <div className="solutions-tabs">
              <button
                type="button"
                className={`solution-tab-btn ${activeAudience === "funder" ? "active" : ""}`}
                onClick={() => setActiveAudience("funder")}
              >
                <Building2 size={18} />
                <span>Untuk Funder & CSR Korporat</span>
              </button>
              <button
                type="button"
                className={`solution-tab-btn ${activeAudience === "ngo" ? "active" : ""}`}
                onClick={() => setActiveAudience("ngo")}
              >
                <Users size={18} />
                <span>Untuk NGO & Lembaga Pelaksana</span>
              </button>
              <button
                type="button"
                className={`solution-tab-btn ${activeAudience === "verifier" ? "active" : ""}`}
                onClick={() => setActiveAudience("verifier")}
              >
                <BadgeCheck size={18} />
                <span>Untuk Verifier & Auditor</span>
              </button>
            </div>

            <div className="solution-content-card">
              {activeAudience === "funder" && (
                <div className="solution-grid">
                  <div className="solution-text">
                    <span className="audience-tag">FUNDER / CORPORATE CSR</span>
                    <h3>Pantau Dampak Nyata & Amankan Alokasi Anggaran Anda</h3>
                    <p>
                      Pastikan dana CSR perusahaan Anda tepat sasaran tanpa khawatir risiko fraud atau laporan fiktif. DanaTerang memberikan dashboard monitoring real-time berbasis bukti nyata.
                    </p>
                    <ul className="solution-benefit-list">
                      <li><CheckCircle2 size={18} className="text-teal" /> <span>Pencairan termin dana terkunci hingga milestone lolos verifikasi kuorum</span></li>
                      <li><CheckCircle2 size={18} className="text-teal" /> <span>Laporan kepatuhan ESG dan CSR siap audit dengan jejak cryptographic proof</span></li>
                      <li><CheckCircle2 size={18} className="text-teal" /> <span>Eliminasi review manual dokumen kwitansi yang menyita waktu staf perusahaan</span></li>
                    </ul>
                    <Link href="/register" className="btn-landing btn-landing--primary mt-4">
                      <span>Mulai Kelola Portofolio</span>
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                  <div className="solution-visual">
                    <div className="visual-card-navy">
                      <div className="visual-card-header">
                        <Building2 size={18} />
                        <span>Ringkasan Portofolio CSR Funder</span>
                      </div>
                      <div className="visual-stat-big">
                        <small>Total Alokasi Program Aktif</small>
                        <strong>Rp1.250.000.000</strong>
                      </div>
                      <div className="visual-progress-list">
                        <div>
                          <div className="flex-between"><span>Renovasi SD Harapan</span><strong className="text-teal">70% Selesai</strong></div>
                          <div className="visual-bar"><div className="visual-fill" style={{ width: "70%" }} /></div>
                        </div>
                        <div>
                          <div className="flex-between"><span>Pemberdayaan UMKM Pesisir</span><strong className="text-lime">45% Selesai</strong></div>
                          <div className="visual-bar"><div className="visual-fill visual-fill--lime" style={{ width: "45%" }} /></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeAudience === "ngo" && (
                <div className="solution-grid">
                  <div className="solution-text">
                    <span className="audience-tag">ORGANIZER / NGO / KOMUNITAS</span>
                    <h3>Bangun Reputasi Tertinggi & Percepat Pencairan Dana</h3>
                    <p>
                      Lembaga pelaksana yang akuntabel berhak mendapatkan kepercayaan lebih besar. DanaTerang memudahkan Anda membuktikan kinerja nyata di lapangan kepada para donor.
                    </p>
                    <ul className="solution-benefit-list">
                      <li><CheckCircle2 size={18} className="text-teal" /> <span>Alur pengunggahan bukti fisik terstruktur dengan panduan verifikasi jelas</span></li>
                      <li><CheckCircle2 size={18} className="text-teal" /> <span>Proses persetujuan termin dana lebih cepat tanpa birokrasi berbelit</span></li>
                      <li><CheckCircle2 size={18} className="text-teal" /> <span>Portofolio integritas digital yang dapat dipamerkan ke calon donor internasional</span></li>
                    </ul>
                    <Link href="/register" className="btn-landing btn-landing--primary mt-4">
                      <span>Daftarkan Organisasi</span>
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                  <div className="solution-visual">
                    <div className="visual-card-navy">
                      <div className="visual-card-header">
                        <FileCheck2 size={18} />
                        <span>Organizer Evidence Portal</span>
                      </div>
                      <div className="visual-stat-big">
                        <small>Status Pengajuan Terkini</small>
                        <strong className="text-teal">Milestone #1 Disetujui</strong>
                      </div>
                      <div className="visual-check-steps">
                        <div className="visual-step-item done"><CheckCircle2 size={16} /> <span>OCR Skrining: Sesuai RAB</span></div>
                        <div className="visual-step-item done"><CheckCircle2 size={16} /> <span>Kuorum Verifier: 2/3 Suara Setuju</span></div>
                        <div className="visual-step-item active"><Wallet size={16} /> <span>Status: Siap Pencairan Tahap 2</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeAudience === "verifier" && (
                <div className="solution-grid">
                  <div className="solution-text">
                    <span className="audience-tag">VERIFIER / AUDITOR INDEPENDEN</span>
                    <h3>Ruang Penilaian Objektif Tanpa Tekanan Eksternal</h3>
                    <p>
                      Sebagai verifier profesional, Anda memiliki ruang kerja aman untuk mengevaluasi dokumen bukti dengan bantuan deteksi anomali AI dan penandatanganan suara kriptografis.
                    </p>
                    <ul className="solution-benefit-list">
                      <li><CheckCircle2 size={18} className="text-teal" /> <span>AI otomatis mengekstrak nominal, vendor, dan tanggal untuk efisiensi review</span></li>
                      <li><CheckCircle2 size={18} className="text-teal" /> <span>Mekanisme suara kolektif 2-dari-3 melindungi integritas setiap individu verifier</span></li>
                      <li><CheckCircle2 size={18} className="text-teal" /> <span>Jejak keputusan tercatat transparan dan tidak dapat diintervensi oleh pihak mana pun</span></li>
                    </ul>
                    <Link href="/login" className="btn-landing btn-landing--primary mt-4">
                      <span>Portal Verifikasi</span>
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                  <div className="solution-visual">
                    <div className="visual-card-navy">
                      <div className="visual-card-header">
                        <BadgeCheck size={18} />
                        <span>Antrean Review Verifier</span>
                      </div>
                      <div className="visual-stat-big">
                        <small>Kuorum Pemungutan Suara</small>
                        <strong>Kursi #2 dari 3 Verifier</strong>
                      </div>
                      <div className="visual-vote-box">
                        <span className="badge-tag badge-tag--teal">Suara Anda: APPROVE</span>
                        <p className="text-xs text-muted-navy mt-2">Ditandatangani secara kriptografis & terdaftar dalam kuorum peer.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Public Audit View â€” data from Admin-published campaigns only */}
        <section id="overview" className="public-audit-section" aria-labelledby="public-audit-heading">
          <div className="landing-container">
            <div className="section-header-center">
              <p className="eyebrow">AUDIT PUBLIK</p>
              <h2 id="public-audit-heading" className="section-title">Audit Program Publik</h2>
              <p className="section-subtitle">
                Bagaimana masyarakat dan donatur melihat jejak transparansi program secara langsung.
              </p>
            </div>

            {auditLoading && (
              <p className="section-note" role="status" aria-live="polite">Memuat ringkasan audit publikâ€¦</p>
            )}

            {!auditLoading && auditError && (
              <div className="demo-notice" role="alert">
                <Info aria-hidden="true" size={18} />
                <p>Ringkasan audit publik belum dapat dimuat. Periksa koneksi lalu muat ulang halaman.</p>
              </div>
            )}

            {!auditLoading && !auditError && publishedCampaigns.length === 0 && (
              <div className="demo-notice" role="note">
                <Info aria-hidden="true" size={18} />
                <p>Belum ada program yang dipublikasikan untuk audit publik. Admin memublikasikan program setelah data dan buktinya siap.</p>
              </div>
            )}

            {publishedCampaigns.map((campaign) => (
              <div key={campaign.campaignId}>
                <div className="hero-panel" aria-labelledby={`campaign-title-${campaign.campaignId}`}>
                  <div className="hero-copy">
                    <p className="eyebrow">PROGRAM <span aria-hidden="true">/</span> AUDIT PUBLIK</p>
                    <h1 id={`campaign-title-${campaign.campaignId}`}>{campaign.title}</h1>
                    <p className="hero-description">Ringkasan status program yang dipublikasikan Admin. Dokumen asli, nama file, teks OCR, catatan verifier, dan referensi pembayaran tidak ditampilkan.</p>
                    <div className="partner-line">
                      <span><Building2 aria-hidden="true" size={16} /> Anggaran {formatMoney(campaign.totalBudget, campaign.currency)}</span>
                      <span>Status program: {campaign.status}</span>
                    </div>
                  </div>
                  <div className="progress-panel">
                    <div className="progress-heading">
                      <span>Evidence disetujui quorum</span>
                      <strong>{campaign.verifiedEvidenceCount} dari {campaign.evidenceTotal}</strong>
                    </div>
                    <progress aria-label="Evidence disetujui quorum" max={Math.max(campaign.evidenceTotal, 1)} value={campaign.verifiedEvidenceCount} />
                    <p>Quorum 2-dari-3 verifier independen.</p>
                  </div>
                </div>

                <div className="summary-section" aria-labelledby={`summary-title-${campaign.campaignId}`}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">RINGKASAN</p>
                      <h2 id={`summary-title-${campaign.campaignId}`}>Tahap dan hasil quorum</h2>
                    </div>
                    <span className="updated-label">Ringkasan yang di-allowlist untuk publik</span>
                  </div>
                  <ol className="milestone-list">
                    {campaign.milestones.map((milestone) => (
                      <li className="milestone-card" key={milestone.milestoneId}>
                        <div className="milestone-number" aria-hidden="true">{milestone.title.slice(0, 2).toUpperCase()}</div>
                        <div className="milestone-content">
                          <div className="milestone-heading">
                            <div>
                              <h3>{milestone.title}</h3>
                              <p>Anggaran {formatMoney(milestone.budgetAmount, campaign.currency)}</p>
                            </div>
                            <strong>{milestone.status}</strong>
                          </div>
                          <dl className="state-grid">
                            <div>
                              <dt>Status tahap</dt>
                              <dd><StatusPill tone={milestoneActivityTone(milestone.status)}>{milestoneActivityLabel(milestone.status)}</StatusPill></dd>
                            </div>
                            <div>
                              <dt>Verifikasi quorum</dt>
                              <dd><StatusPill tone={verificationToneFor(milestone.verification)}>{verificationLabelFor(milestone.verification)}</StatusPill></dd>
                            </div>
                            <div>
                              <dt>Evidence</dt>
                              <dd><StatusPill tone="neutral">{milestone.verification.total} berkas</StatusPill></dd>
                            </div>
                          </dl>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                <div id={`proof-${campaign.campaignId}`} className="proof-panel" aria-labelledby={`proof-title-${campaign.campaignId}`}>
                  <div className="proof-icon"><ShieldCheck aria-hidden="true" size={24} /></div>
                  <div>
                    <p className="eyebrow">LAPIS INTEGRITAS</p>
                    <h2 id={`proof-title-${campaign.campaignId}`}>Bukti keberhasilan quorum di jaringan publik</h2>
                    {campaign.proofs.length === 0 ? (
                      <p>Belum ada proof yang dianchor untuk program ini.</p>
                    ) : (
                      <p>
                        {campaign.proofs.map((proof) => (
                          <span key={proof.proofId} className="proof-summary">
                            <StatusPill tone={proofStatusTone(proof.status)}>{proofStatusLabel(proof.status)}</StatusPill>
                            {proof.transactionHash && (
                              <> <a className="proof-link" href={explorerTxUrl(proof.transactionHash)} rel="noreferrer noopener" target="_blank">Lihat transaksi di Sepolia Etherscan</a></>
                            )}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  <div className="proof-status">
                    <span>Ethereum Sepolia Testnet</span>
                  </div>
                </div>
              </div>
            ))}
            <div id="evidence" className="privacy-note" aria-labelledby="privacy-title">
              <LockKeyhole aria-hidden="true" size={20} />
              <div>
                <h2 id="privacy-title">Bukti asli tetap privat</h2>
                <p>Publik melihat ringkasan yang disetujui dan status proof. Dokumen asli, OCR lengkap, dan referensi pembayaran hanya untuk pihak berwenang.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Lapis Integritas & Arsitektur Keamanan */}
        <section id="integritas" className="integrity-architecture-section" aria-labelledby="integrity-heading">
          <div className="landing-container">
            <div className="section-header-center">
              <p className="eyebrow">LAPIS KEAMANAN KRIPTOGRAFIS</p>
              <h2 id="integrity-heading" className="section-title">Arsitektur Integritas Tanpa Kompromi</h2>
              <p className="section-subtitle">
                Bagaimana DanaTerang melindungi kerahasiaan dokumen sekaligus menjamin keabsahan bukti secara publik.
              </p>
            </div>

            <div className="architecture-grid">
              <div className="arch-card">
                <div className="arch-icon-box"><Lock size={22} /></div>
                <h3>1. Off-Chain Private Storage</h3>
                <p>
                  Kwitansi vendor, rekening bank, dan dokumen sensitif disimpan di media penyimpanan terenkripsi yang aman. Akses hanya diberikan kepada Verifier terverifikasi.
                </p>
                <div className="arch-badge">SHA-256 Canonical Hashing</div>
              </div>

              <div className="arch-card">
                <div className="arch-icon-box"><Scale size={22} /></div>
                <h3>2. Multi-Signature Quorum</h3>
                <p>
                  Keputusan persetujuan dibentuk melalui konsensus 2-dari-3 verifier terakreditasi. Setiap verifier menandatangani attestasi dengan kunci kriptografis institusi.
                </p>
                <div className="arch-badge">2-of-3 Peer Consensus</div>
              </div>

              <div className="arch-card">
                <div className="arch-icon-box"><Database size={22} /></div>
                <h3>3. Ethereum Sepolia Anchoring</h3>
                <p>
                  Akar Merkle dan bukti kuorum di-anchor ke smart contract di Ethereum Sepolia. Siapa pun dapat memvalidasi keaslian laporan tanpa pihak ketiga.
                </p>
                <div className="arch-badge">Immutable Smart Contract</div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="faq-section" aria-labelledby="faq-heading">
          <div className="landing-container">
            <div className="section-header-center">
              <p className="eyebrow">PERTANYAAN UMUM</p>
              <h2 id="faq-heading" className="section-title">Pertanyaan yang Sering Diajukan</h2>
              <p className="section-subtitle">
                Semua jawaban tentang tata kelola, privasi, dan alur kerja verifikasi di DanaTerang.
              </p>
            </div>

            <div className="faq-accordion">
              {faqs.map((faq, index) => {
                const isOpen = expandedFaq === index;
                return (
                  <div className={`faq-item ${isOpen ? "faq-item--open" : ""}`} key={index}>
                    <button
                      type="button"
                      className="faq-question-btn"
                      onClick={() => setExpandedFaq(isOpen ? null : index)}
                      aria-expanded={isOpen}
                      aria-controls={`faq-answer-${index}`}
                    >
                      <span className="faq-q-text">{faq.question}</span>
                      <ChevronDown size={20} className={`faq-chevron ${isOpen ? "faq-chevron--rotated" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="faq-answer-panel" id={`faq-answer-${index}`} role="region">
                        <p>{faq.answer}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA Banner Section */}
        <section className="cta-banner-section">
          <div className="landing-container">
            <div className="cta-banner-card">
              <div className="cta-content">
                <span className="cta-eyebrow">MULAI SEKARANG</span>
                <h2 className="cta-title">Siap Tingkatkan Standar Transparansi Program Anda?</h2>
                <p className="cta-desc">
                  Wujudkan program sosial dan CSR yang bersih, akuntabel, dan tepercaya dengan verifikasi berbasis bukti nyata.
                </p>
                <div className="cta-actions">
                  <Link href="/register" className="btn-landing btn-landing--lime">
                    <span>Registrasi Akun Baru</span>
                    <ArrowRight size={18} />
                  </Link>
                  <Link href="/login" className="btn-landing btn-landing--outline-white">
                    <span>Akses Dashboard</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="site-footer landing-footer">
        <div className="footer-top">
          <div className="landing-container footer-grid">
            <div className="footer-brand-col">
              <div className="footer-brand-logo">
                <Image
                  src="/asset/lockup_horizontal_white.png"
                  alt="DanaTerang"
                  width={160}
                  height={38}
                  className="footer-logo-img"
                />
              </div>
              <p className="footer-tagline">
                Platform transparansi dan akuntabilitas dana program CSR & hibah dengan verifikasi multi-lapis dan bukti kriptografis on-chain.
              </p>
              <div className="footer-badge-trust">
                <ShieldCheck size={16} className="text-teal" />
                <span>AI memberi flag; reviewer manusia mengambil keputusan.</span>
              </div>
            </div>

            <div className="footer-nav-col">
              <p className="footer-nav-heading">Navigasi</p>
              <ul>
                <li><a href="#fitur">Fitur Unggulan</a></li>
                <li><a href="#cara-kerja">Cara Kerja</a></li>
                <li><a href="#solusi">Solusi Pemangku Kepentingan</a></li>
                <li><a href="#overview">Demo Audit Publik</a></li>
                <li><a href="#integritas">Lapis Integritas</a></li>
              </ul>
            </div>

            <div className="footer-nav-col">
              <p className="footer-nav-heading">Akses Portal</p>
              <ul>
                <li><Link href="/login">Log In Pengguna</Link></li>
                <li><Link href="/register">Registrasi Organizer</Link></li>
                <li><Link href="/login">Ruang Verifier</Link></li>
                <li><Link href="/login">Ruang Admin</Link></li>
              </ul>
            </div>

            <div className="footer-nav-col">
              <p className="footer-nav-heading">Teknologi & Keamanan</p>
              <ul>
                <li><span>AI OCR Screening</span></li>
                <li><span>2-of-3 Peer Quorum</span></li>
                <li><span>Ethereum Sepolia Anchoring</span></li>
                <li><span>Privacy-Preserving SHA-256</span></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="landing-container footer-bottom-inner">
            <p>&copy; {new Date().getFullYear()} DanaTerang. Hak Cipta Dilindungi.</p>
            <div className="footer-bottom-links">
              <span>DanaTerang - Trust, Verification, & Accountability.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
