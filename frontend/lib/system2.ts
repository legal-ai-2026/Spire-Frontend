import { API_BASE } from "./api";
import { getToken } from "./auth";

const SYSTEM2_PROXY_PREFIX = "/api/v1/system2";

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function traceId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function withQuery(path: string, query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export async function system2Fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Trace-Id": traceId(),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${SYSTEM2_PROXY_PREFIX}${normalizePath(path)}`, {
    ...options,
    headers,
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body?.detail ?? `System 2 request failed ${response.status}`);
  }

  return body as T;
}

export const system2Api = {
  proxyConfig: () =>
    system2Fetch<{
      base_url_configured: boolean;
      api_key_configured: boolean;
      admin_api_key_configured: boolean;
      proxy_path: string;
      timeout_seconds: number;
    }>("/proxy-config"),
  health: () => system2Fetch<Record<string, unknown>>("/v1/healthz"),
  listMissionAdaptations: <T>(missionId: string, limit = 50) =>
    system2Fetch<T[]>(withQuery(`/v1/missions/${missionId}/adaptations`, { limit })),
  getAdaptation: <T>(adaptationId: string) => system2Fetch<T>(`/v1/adaptations/${adaptationId}`),
  createAdaptation: <T>(body: unknown) =>
    system2Fetch<T>("/v1/adaptations", { method: "POST", body: JSON.stringify(body) }),
  approveAdaptation: <T>(adaptationId: string, body: unknown) =>
    system2Fetch<T>(`/v1/adaptations/${adaptationId}/approval`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createDeploymentRecommendation: <T>(body: unknown) =>
    system2Fetch<T>("/v1/deployment-recommendations", { method: "POST", body: JSON.stringify(body) }),
  listMissionDeployments: <T>(missionId: string, limit = 50) =>
    system2Fetch<T[]>(withQuery(`/v1/missions/${missionId}/deployment-recommendations`, { limit })),
};
