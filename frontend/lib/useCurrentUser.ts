"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { ApiError, requestJson } from "./api";

export type UserSummary = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ORGANIZER" | "FUNDER" | "VERIFIER" | "BENEFICIARY";
  organizationId: string | null;
  organization: { id: string; name: string; type: string; verified: boolean } | null;
};

export function useCurrentUser() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await requestJson<{ user: UserSummary }>("/api/auth/me");
      setUser(response.user);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
        router.replace(`/login${next}`);
        return;
      }
      setError("Sesi belum dapat diperiksa. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { user, loading, error, reload };
}
