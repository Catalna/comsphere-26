import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "DanaTerang — Platform Transparansi & Akuntabilitas Dana CSR Berbasis Bukti",
  description: "Ekosistem akuntabilitas pendanaan sosial dan CSR dengan verifikasi multi-lapis: Skrining AI, Konsensus Peer Verifier 2-dari-3, dan Bukti Kriptografis di Ethereum Sepolia.",
  keywords: [
    "DanaTerang",
    "CSR Transparency",
    "Akuntabilitas Dana",
    "Hibah Sosial",
    "Verifikasi Bukti",
    "Blockchain Audit",
    "Ethereum Sepolia",
    "NGO Indonesia"
  ],
  authors: [{ name: "DanaTerang" }],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">Lewati ke konten</a>
        {children}
      </body>
    </html>
  );
}
