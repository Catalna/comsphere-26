"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, Loader2 } from "lucide-react";

import { requestJson, ApiError } from "../lib/api";
import { loadCampaignTree, type CampaignTree } from "../lib/campaignTree";
import type { UserSummary } from "../lib/useCurrentUser";

type AlertLink = { label: string; href: string; hint?: string };
type AlertsData = { headline: string; count: number; links: AlertLink[] };

type ReviewMetadataShape = { status: string };
type ReviewQueueShape = { reviewRoundStatus: string };
type EvidenceShape = { verificationStatus?: string | null };

const CACHE_TTL_MS = 60 * 1000;

let cachedByRole = new Map<string, { at: number; data: AlertsData }>();

function activeReviewRounds(reviews: ReviewMetadataShape[]) {
  return reviews.filter((r) => r.status === "OPEN" || r.status === "WAITING_FOR_CHAIN").length;
}

async function loadAdminAlerts(): Promise<AlertsData> {
  const response = await requestJson<{ reviews: ReviewMetadataShape[] }>("/api/admin/reviews");
  const reviews = response.reviews ?? [];
  const count = activeReviewRounds(reviews);
  return {
    headline: count > 0
      ? `${count} round peer review masih berjalan — pantau sebelum quorum terkunci.`
      : "Tidak ada round peer review yang butuh tindakan sekarang.",
    count,
    links: [
      { label: "Operasi review", href: "/admin/reviews", hint: count > 0 ? `${count} aktif` : undefined },
      { label: "Pengguna & role", href: "/admin/users" },
      { label: "Publikasi audit", href: "/admin/campaigns" },
    ],
  };
}

async function loadVerifierAlerts(): Promise<AlertsData> {
  const response = await requestJson<{ reviews: ReviewQueueShape[] }>("/api/verifier/reviews");
  const reviews = response.reviews ?? [];
  const count = reviews.filter((r) => r.reviewRoundStatus === "OPEN").length;
  return {
    headline: count > 0
      ? `${count} bukti menunggu keputusan Anda sebelum quorum tercapai.`
      : "Tidak ada bukti baru yang menunggu keputusan Anda.",
    count,
    links: [
      { label: "Review saya", href: "/verifier/reviews", hint: count > 0 ? `${count} menunggu` : undefined },
      { label: "Audit Trail", href: "/reports" },
    ],
  };
}

async function loadOrganizerAlerts(): Promise<AlertsData> {
  const tree: CampaignTree = await loadCampaignTree();
  const revisionNeeded = tree.evidence.filter((e: EvidenceShape) => e.verificationStatus === "NEEDS_REVISION").length;
  const drafts = tree.campaigns.filter((c) => c.status === "DRAFT").length;
  const links: AlertLink[] = [
    {
      label: "Bukti & revisi",
      href: "/evidence",
      hint: revisionNeeded > 0 ? `${revisionNeeded} perlu revisi` : undefined,
    },
    {
      label: "Campaign draf",
      href: "/campaigns",
      hint: drafts > 0 ? `${drafts} draf` : undefined,
    },
  ];
  return {
    headline: revisionNeeded > 0
      ? `${revisionNeeded} bukti diminta revisi verifier — unggah versi baru agar review melanjut.`
      : "Semua bukti Anda berada di jalur verifikasi yang berjalan.",
    count: revisionNeeded > 0 ? revisionNeeded : drafts,
    links,
  };
}

async function loadFunderAlerts(): Promise<AlertsData> {
  const tree = await loadCampaignTree();
  const active = tree.campaigns.filter((c) => c.status === "ACTIVE").length;
  return {
    headline: active > 0
      ? `${active} campaign didanai dan sedang berjalan — pantau realisasi dan laporan pembayaran.`
      : "Tidak ada campaign aktif untuk dipantau saat ini.",
    count: active,
    links: [
      { label: "Dashboard program", href: "/dashboard" },
      { label: "Payment reports", href: "/payment-reports" },
      { label: "Semua campaign", href: "/campaigns" },
    ],
  };
}

function loaderForRole(role: string): (() => Promise<AlertsData>) | null {
  switch (role) {
    case "ADMIN": return loadAdminAlerts;
    case "VERIFIER": return loadVerifierAlerts;
    case "ORGANIZER": return loadOrganizerAlerts;
    case "FUNDER": return loadFunderAlerts;
    default: return null;
  }
}

export default function WorkspaceAlerts({ user }: { user: UserSummary }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const loader = loaderForRole(user?.role ?? "");
  const cached = cachedByRole.get(user?.role ?? "");
  const badgeVisible = cached ? cached.data.count > 0 : false;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !loader) return;
    const cacheKey = user.role;
    const cachedEntry = cachedByRole.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.at < CACHE_TTL_MS) {
      setData(cachedEntry.data);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    loader()
      .then((payload) => {
        if (cancelled) return;
        cachedByRole.set(cacheKey, { at: Date.now(), data: payload });
        setData(payload);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.status === 403
            ? "Notifikasi tidak tersedia untuk peran ini."
            : "Notifikasi belum dapat dimuat. Coba buka lagi.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, loader, user.role]);

  if (!loader) return null;

  return (
    <div className="alerts-wrap" ref={wrapRef}>
      <button
        type="button"
        className="top-icon-btn"
        aria-label={`Notifikasi program${data ? ` (${data.count})` : ""}`}
        title="Notifikasi tugas Anda"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={16} aria-hidden="true" />
        {badgeVisible && <span className="top-notification-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="alerts-panel" role="dialog" aria-label="Notifikasi program">
          <p className="alerts-eyebrow">TUGAS TERKINI</p>
          <p className="alerts-headline">{loading ? <><Loader2 size={13} className="search-spinner" aria-hidden="true" /> Memuat tugas Anda…</> : data?.headline ?? (error || "Tidak ada tugas tertunda.")}</p>
          {error && <p className="alerts-error" role="alert">{error}</p>}
          {data && (
            <ul className="alerts-list">
              {data.links.map((link) => (
                <li key={link.href}>
                  <Link className="alerts-item" href={link.href} onClick={() => setOpen(false)}>
                    <span className="alerts-item-label">{link.label}</span>
                    {link.hint && <span className="alerts-item-count">{link.hint}</span>}
                    <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="alerts-hint">Ringkasan tugas aktif di workspace Anda.</p>
        </div>
      )}
    </div>
  );
}
