const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "ApiError";
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body !== undefined && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network_error");
  }

  if (response.status === 204) {
    await response.text();
    return undefined as T;
  }
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    const code = typeof payload?.error === "string" ? payload.error : "request_failed";
    throw new ApiError(response.status, code);
  }
  return payload as T;
}
