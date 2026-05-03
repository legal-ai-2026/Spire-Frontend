import { API_BASE } from "./api";
import { getToken } from "./auth";

const SYSTEM3_PROXY_PREFIX = "/api/v1/system3";

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

export async function system3Fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Trace-Id": traceId(),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${SYSTEM3_PROXY_PREFIX}${normalizePath(path)}`, {
    ...options,
    headers,
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body?.detail ?? `System 3 request failed ${response.status}`);
  }

  return body as T;
}

export const system3Api = {
  proxyConfig: () =>
    system3Fetch<{
      base_url_configured: boolean;
      api_key_configured: boolean;
      proxy_path: string;
      timeout_seconds: number;
    }>("/proxy-config"),
  health: () => system3Fetch<Record<string, unknown>>("/v1/healthz"),
  infrastructureHealth: <T>() => system3Fetch<T[]>("/v1/healthz/infrastructure"),
  foundryStatus: <T>() => system3Fetch<T>("/v1/foundry/status"),
  listMissions: <T>() => system3Fetch<T[]>("/v1/missions"),
  getMissionDashboard: <T>(missionId: string, limit = 100) =>
    system3Fetch<T>(withQuery(`/v1/missions/${missionId}/dashboard`, { limit })),
  getMissionContext: <T>(missionId: string) => system3Fetch<T>(`/v1/mission-context/${missionId}`),
  getMissionState: <T>(missionId: string) => system3Fetch<T>(`/v1/mission-state/${missionId}`),
  ingestEvidence: <T>(body: unknown) =>
    system3Fetch<T>("/v1/evidence/ingest", { method: "POST", body: JSON.stringify(body) }),
  approveScenarioInject: <T>(recommendationId: string, body: unknown) =>
    system3Fetch<T>(`/v1/scenario-injects/${recommendationId}/approval`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  proposeCoas: <T>(body: unknown) =>
    system3Fetch<T>("/v1/coa/propose", { method: "POST", body: JSON.stringify(body) }),
  approveCoa: <T>(runId: string, body: unknown) =>
    system3Fetch<T>(`/v1/coa/proposals/${runId}/approval`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  captureLesson: <T>(body: unknown) =>
    system3Fetch<T>("/v1/lessons-learned/capture", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listUpdateEvents: <T>(params: { objectType?: string; objectId?: string; limit?: number } = {}) =>
    system3Fetch<T[]>(withQuery("/v1/update-events", params)),
};
