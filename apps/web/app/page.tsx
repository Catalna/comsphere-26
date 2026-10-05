import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CircleDollarSign,
  FileCheck2,
  Info,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

type StatusTone = "success" | "warning" | "reported" | "pending" | "neutral";

type MilestoneDemo = {
  number: string;
  title: string;
  description: string;
  budget: string;
  screening: string;
  screeningTone: StatusTone;
  review: string;
  reviewTone: StatusTone;
  payment: string;
  paymentTone: StatusTone;
  proof: string;
  proofTone: StatusTone;
};

const milestones: MilestoneDemo[] = [
  {
    number: "01",
    title: "Pembelian material",
    description: "Material utama untuk renovasi ruang kelas.",
    budget: "Rp30.000.000",
    screening: "No configured flags detected",
    screeningTone: "success",
    review: "VERIFIED by human verifier",
    reviewTone: "success",
    payment: "PAYMENT_REPORTED by funder",
    paymentTone: "reported",
    proof: "PENDING on Ethereum Sepolia",
    proofTone: "pending",
  },
  {
    number: "02",
    title: "Renovasi struktur",
    description: "Perbaikan atap dan struktur ruang belajar.",
    budget: "Rp40.000.000",
    screening: "LOW_CONFIDENCE_FIELD — amount",
    screeningTone: "warning",
    review: "PENDING human review",
    reviewTone: "pending",
    payment: "NOT_READY",
    paymentTone: "neutral",
    proof: "PENDING on Ethereum Sepolia",
    proofTone: "pending",
  },
  {
    number: "03",
    title: "Penyelesaian dan serah terima",
    description: "Dokumentasi hasil akhir dan serah terima.",
    budget: "Rp30.000.000",
    screening: "Belum ada evidence",
    screeningTone: "neutral",
    review: "Belum ditinjau",
    reviewTone: "neutral",
    payment: "NOT_READY",
    paymentTone: "neutral",
    proof: "Belum dibuat",
    proofTone: "neutral",
  },
];

function Status({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

export default function HomePage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#overview" aria-label="DanaTerang, ke ringkasan program">
            <span className="brand-mark" aria-hidden="true">D</span>
            <span>DanaTerang</span>
          </a>
          <nav className="primary-nav" aria-label="Navigasi utama">
            <a href="#overview" aria-current="location">Program</a>
            <a href="#milestones">Milestone</a>
            <a href="#evidence">Bukti</a>
          </nav>
          <a className="header-link" href="#proof">Status proof <ArrowUpRight aria-hidden="true" size={16} /></a>
        </div>
      </header>

      <main id="main" className="page-shell">
        <div className="demo-notice" role="note">
          <Info aria-hidden="true" size={18} />
          <p><strong>Contoh data demo.</strong> Ini bukan kampanye live dan belum ada transaksi proof Sepolia yang dibuat.</p>
        </div>

        <section id="overview" className="hero-panel" aria-labelledby="campaign-title">
          <div className="hero-copy">
            <p className="eyebrow">PROGRAM CSR <span aria-hidden="true">/</span> PENDIDIKAN</p>
            <h1 id="campaign-title">Renovasi SD Harapan</h1>
            <p className="hero-description">Jejak bukti penggunaan dana untuk renovasi ruang belajar.</p>
            <div className="partner-line">
              <span><Building2 aria-hidden="true" size={16} /> NGO Peduli Negeri</span>
              <span>Didanai oleh PT ABC Foundation</span>
            </div>
          </div>
          <div className="progress-panel">
            <div className="progress-heading"><span>Progres program</span><strong>2 dari 3 milestone</strong></div>
            <progress aria-label="Progres milestone" max="3" value="2" />
            <p>Bukti dan review ditampilkan per tahap.</p>
          </div>
        </section>

        <section className="summary-section" aria-labelledby="summary-title">
          <div className="section-heading">
            <div><p className="eyebrow">RINGKASAN</p><h2 id="summary-title">Dana dan aktivitas</h2></div>
            <span className="updated-label">Contoh tampilan publik</span>
          </div>
          <dl className="summary-grid">
            <div className="summary-card"><dt><CircleDollarSign aria-hidden="true" size={18} /> Anggaran program</dt><dd>Rp100.000.000</dd><dd className="summary-note">Alokasi yang direncanakan</dd></div>
            <div className="summary-card"><dt><BadgeCheck aria-hidden="true" size={18} /> Review evidence</dt><dd>1 milestone</dd><dd className="summary-note">Disetujui reviewer untuk versi yang ditinjau</dd></div>
            <div className="summary-card"><dt><FileCheck2 aria-hidden="true" size={18} /> Laporan pembayaran</dt><dd>1 laporan</dd><dd className="summary-note">Dilaporkan funder, belum dikonfirmasi independen</dd></div>
          </dl>
        </section>

        <section id="milestones" className="milestone-section" aria-labelledby="milestone-title">
          <div className="section-heading">
            <div><p className="eyebrow">JEJAK PROGRAM</p><h2 id="milestone-title">Milestone dan review</h2></div>
            <p className="section-note">Status tiap state machine ditampilkan terpisah.</p>
          </div>
          <ol className="milestone-list">
            {milestones.map((milestone) => (
              <li className="milestone-card" key={milestone.number}>
                <div className="milestone-number" aria-hidden="true">{milestone.number}</div>
                <div className="milestone-content">
                  <div className="milestone-heading"><div><h3>{milestone.title}</h3><p>{milestone.description}</p></div><strong>{milestone.budget}</strong></div>
                  <dl className="state-grid">
                    <div><dt>AI screening</dt><dd><Status tone={milestone.screeningTone}>{milestone.screening}</Status></dd></div>
                    <div><dt>Human verification</dt><dd><Status tone={milestone.reviewTone}>{milestone.review}</Status></dd></div>
                    <div><dt>Pembayaran</dt><dd><Status tone={milestone.paymentTone}>{milestone.payment}</Status></dd></div>
                    <div><dt>Blockchain proof</dt><dd><Status tone={milestone.proofTone}>{milestone.proof}</Status></dd></div>
                  </dl>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="proof" className="proof-panel" aria-labelledby="proof-title">
          <div className="proof-icon"><ShieldCheck aria-hidden="true" size={24} /></div>
          <div><p className="eyebrow">LAPIS INTEGRITAS</p><h2 id="proof-title">Proof Sepolia belum tersedia</h2><p>Proof hanya ditandai <code>ANCHORED</code> setelah receipt transaksi berhasil dan memiliki block number.</p></div>
          <div className="proof-status"><Status tone="pending">PENDING</Status><span>Ethereum Sepolia Testnet</span></div>
        </section>

        <section id="evidence" className="privacy-note" aria-labelledby="privacy-title">
          <LockKeyhole aria-hidden="true" size={20} />
          <div><h2 id="privacy-title">Bukti asli tetap privat</h2><p>Publik melihat ringkasan yang disetujui dan status proof. Dokumen asli, OCR lengkap, dan referensi pembayaran hanya untuk pihak berwenang.</p></div>
        </section>
      </main>

      <footer className="site-footer"><div className="footer-inner"><span>DanaTerang</span><span>AI memberi flag; reviewer manusia mengambil keputusan.</span></div></footer>
    </div>
  );
}
