import { getCsrfToken } from "./csrf";

/** Mirrors the source app's src/lib/api-client.ts: a thin fetch wrapper that always prefixes the
 *  API base URL, throws a typed ApiError with the server's message, and — since this is a
 *  cross-origin SPA talking to a separate Django backend rather than same-origin Next.js API
 *  routes — sends cookies via `credentials: "include"` and echoes the CSRF cookie back as a
 *  header on every mutating request. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8012/api";
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  // FormData bodies (document upload) must NOT get an explicit Content-Type — the browser sets
  // its own multipart boundary, and overriding it here would break server-side parsing.
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (MUTATING_METHODS.has(method)) headers["X-CSRFToken"] = getCsrfToken();

  const res = await fetch(`${BASE_URL}${path}`, { ...options, method, headers, credentials: "include" });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    const message = body.detail ?? Object.values(body)[0] ?? "Request failed.";
    throw new ApiError(Array.isArray(message) ? message[0] : String(message), res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  // Onboarding document upload — deliberately bypasses request()'s JSON Content-Type header so
  // the browser can set its own multipart boundary; everything else (CSRF header, credentials,
  // error handling) is identical.
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<T>(path, { method: "POST", body: form, headers: {} });
  },
};

/** The SPA must prime the CSRF cookie once before any mutating request — call on app load. */
export function primeCsrfCookie(): Promise<void> {
  return request("/auth/csrf/");
}
