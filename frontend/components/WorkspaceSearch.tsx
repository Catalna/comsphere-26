"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, FolderKanban, ListChecks, Loader2, Search, X } from "lucide-react";

import { loadCampaignTree, type CampaignTree } from "../lib/campaignTree";
import type { UserSummary } from "../lib/useCurrentUser";

type SearchResultItem = {
  kind: "campaign" | "milestone" | "evidence";
  label: string;
  secondary: string;
  href: string;
};

const RESULT_LIMIT = 6;
const TREE_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache sesi ringan supaya mengetik tidak memicu ulang seluruh pohon campaign.
let sessionTree: CampaignTree | null = null;
let sessionTreeAt = 0;

async function getCampaignTree(): Promise<CampaignTree | null> {
  if (sessionTree && Date.now() - sessionTreeAt < TREE_CACHE_TTL_MS) return sessionTree;
  try {
    const tree = await loadCampaignTree();
    sessionTree = tree;
    sessionTreeAt = Date.now();
    return tree;
  } catch {
    // Data lama tetap dipakai bila ada supaya pencarian tidak kosong karena gangguan jaringan.
    if (sessionTree) return sessionTree;
    return null;
  }
}

function matches(value: string | undefined, query: string) {
  return typeof value === "string" && value.toLowerCase().includes(query);
}

function buildResults(tree: CampaignTree, query: string): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const normalized = query.trim().toLowerCase();
  if (!normalized) return results;

  for (const campaign of tree.campaigns) {
    if (matches(campaign.title, normalized) || matches(campaign.description, normalized)) {
      results.push({
        kind: "campaign",
        label: campaign.title,
        secondary: `Campaign · ${(campaign.status === "ACTIVE" ? "Didanai" : campaign.status === "DRAFT" ? "Draf" : campaign.status === "COMPLETED" ? "Selesai" : campaign.status === "CANCELLED" ? "Dibatalkan" : campaign.status)}`,
        href: `/campaigns/${campaign.id}`,
      });
    }
  }
  for (const milestone of tree.milestones) {
    if (matches(milestone.title, normalized) || matches(milestone.description, normalized)) {
      results.push({
        kind: "milestone",
        label: milestone.title,
        secondary: `Milestone · ${milestone.status === "IN_PROGRESS" ? "Berjalan" : milestone.status === "COMPLETED" ? "Selesai" : milestone.status === "PLANNED" ? "Direncanakan" : "Dibatalkan"}`,
        href: `/campaigns/${milestone.campaignId}`,
      });
    }
  }
  for (const evidence of tree.evidence) {
    if (matches(evidence.fileName, normalized)) {
      results.push({
        kind: "evidence",
        label: evidence.fileName ?? "Berkas bukti",
        secondary: `Bukti · versi ${evidence.version ?? 1}`,
        href: "/evidence",
      });
    }
  }
  return results.slice(0, RESULT_LIMIT);
}

const KIND_ICONS = {
  campaign: FolderKanban,
  milestone: ListChecks,
  evidence: FileSearch,
} as const;

export default function WorkspaceSearch({ user }: { user: UserSummary }) {
  const router = useRouter();
  const resultsId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchable =
    user?.role === "ORGANIZER" || user?.role === "FUNDER" || user?.role === "ADMIN";

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
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const tree = await getCampaignTree();
      if (cancelled) return;
      setResults(tree ? buildResults(tree, query) : null);
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const noResults = useMemo(
    () => results !== null && query.trim().length > 0 && results.length === 0 && !loading,
    [results, query, loading],
  );

  if (!searchable) return null;

  function commitResult(item: SearchResultItem | undefined) {
    if (!item) return;
    setOpen(false);
    setQuery("");
    setResults(null);
    router.push(item.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitResult(results?.[0]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="top-search-bar" role="search" ref={wrapRef}>
      <Search size={15} className="top-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="top-search-input"
        placeholder="Cari campaign, milestone, bukti…"
        aria-label="Cari global"
        aria-expanded={open}
        aria-controls={resultsId}
        role="combobox"
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (loading || results !== null || !query.trim()) && (
        <div className="search-results" id={resultsId} role="listbox" aria-label="Hasil pencarian">
          {!query.trim() ? (
            <p className="search-results-empty">Ketik untuk mencari campaign, milestone, atau berkas bukti.</p>
          ) : loading ? (
            <p className="search-results-empty" aria-busy="true"><Loader2 size={14} className="search-spinner" aria-hidden="true" /> Mencari…</p>
          ) : noResults ? (
            <p className="search-results-empty">
              Tidak ada hasil untuk “{query.trim()}”.
              <button type="button" className="search-results-clear" onClick={() => { setQuery(""); setResults(null); inputRef.current?.focus(); }}>
                Bersihkan <X size={12} aria-hidden="true" />
              </button>
            </p>
          ) : (
            results?.map((item) => {
              const Icon = KIND_ICONS[item.kind];
              return (
                <button
                  key={`${item.kind}:${item.href}:${item.label}`}
                  type="button"
                  className="search-result-item"
                  role="option"
                  aria-selected="false"
                  onClick={() => commitResult(item)}
                >
                  <Icon size={14} className="search-kind-icon" aria-hidden="true" />
                  <span className="search-result-text">
                    <span className="search-result-title">{item.label}</span>
                    <span className="search-result-sub">{item.secondary}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
