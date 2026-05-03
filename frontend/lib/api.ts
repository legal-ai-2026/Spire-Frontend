import { getToken } from "./auth";
import { enqueue } from "./offlineQueue";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export class OfflineError extends Error {
  constructor() {
    super("You are offline. This action has been queued and will sync when connected.");
    this.name = "OfflineError";
  }
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";

  if (!isOnline()) {
    if (!isMutation) {
      throw new Error("No internet connection. Refresh when connectivity is restored.");
    }

    // Queue mutation for replay when back online
    if (options.body instanceof FormData) {
      const form = options.body;
      const formFields: { key: string; value: string }[] = [];
      const formFiles: { key: string; blob: Blob; filename: string; mimeType: string }[] = [];
      form.forEach((value, key) => {
        if (value instanceof File) {
          formFiles.push({ key, blob: value, filename: value.name, mimeType: value.type });
        } else {
          formFields.push({ key, value });
        }
      });
      await enqueue({ timestamp: Date.now(), method, path, jsonBody: null, formFields, formFiles, isFormData: true, retries: 0 });
    } else {
      await enqueue({
        timestamp: Date.now(),
        method,
        path,
        jsonBody: options.body ? String(options.body) : null,
        formFields: null,
        formFiles: null,
        isFormData: false,
        retries: 0,
      });
    }

    throw new OfflineError();
  }

  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // Remove Content-Type for multipart so browser sets boundary automatically
  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = await res.json();
      detail = err.detail ?? JSON.stringify(err);
    } catch {}
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string) => apiFetch<T>(path),
  post:   <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) =>
    apiFetch<T>(path, { method: "POST", body: form }),
};
