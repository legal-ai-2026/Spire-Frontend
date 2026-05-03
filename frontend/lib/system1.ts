import { API_BASE } from "./api";
import { getToken } from "./auth";
import type {
  System1ApprovalResponse,
  System1AuditEvent,
  System1CalibrationReceipt,
  System1CalibrationSignal,
  System1DashboardRunSummary,
  System1GraphSubgraph,
  System1HealthReport,
  System1IngestEnvelope,
  System1MissionStateSummary,
  System1OutboxEvent,
  System1ProxyResponse,
  System1ReadyReport,
  System1RecommendationDecision,
  System1RecommendationRecord,
  System1RunRecord,
  System1SoldierCalibrationProfile,
  System1TeamCalibrationProfile,
  System1TrainingTrajectory,
  System1UpdateLedgerEntry,
} from "@/types/system1";

const SYSTEM1_PROXY_PREFIX = "/api/v1/system1";

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function traceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function system1Fetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<System1ProxyResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Trace-Id": traceId(),
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body instanceof FormData) delete headers["Content-Type"];

  const res = await fetch(`${API_BASE}${SYSTEM1_PROXY_PREFIX}${normalizePath(path)}`, {
    ...options,
    headers,
    cache: "no-store",
  });
  const responseTraceId = res.headers.get("X-Trace-Id");

  if (!res.ok) {
    let detail = res.statusText || `System 1 request failed ${res.status}`;
    try {
      const err = await res.json();
      detail = err.detail ?? JSON.stringify(err);
    } catch {}
    throw new Error(detail);
  }

  if (res.status === 204) return { data: undefined as T, traceId: responseTraceId };
  const data = (await res.json()) as T;
  return { data, traceId: responseTraceId };
}

export const system1Api = {
  proxyConfig: () =>
    system1Fetch<{
      base_url_configured: boolean;
      api_key_configured: boolean;
      proxy_path: string;
      timeout_seconds: number;
    }>("/proxy-config"),

  health: () => system1Fetch<System1HealthReport>("/v1/healthz"),
  ready: () => system1Fetch<System1ReadyReport>("/v1/readyz"),

  ingest: (body: System1IngestEnvelope) =>
    system1Fetch<System1RunRecord>("/v1/ingest", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getRun: (runId: string) => system1Fetch<System1RunRecord>(`/v1/runs/${runId}`),
  getRunAudit: (runId: string) => system1Fetch<System1AuditEvent[]>(`/v1/runs/${runId}/audit`),
  getDashboard: (runId: string) =>
    system1Fetch<System1DashboardRunSummary>(`/v1/dashboard/runs/${runId}`),

  getMissionState: (missionId: string, limit = 100) =>
    system1Fetch<System1MissionStateSummary>(withQuery(`/v1/missions/${missionId}/state`, { limit })),
  getTeamCalibration: (missionId: string, limit = 100) =>
    system1Fetch<System1TeamCalibrationProfile>(
      withQuery(`/v1/missions/${missionId}/team-calibration-profile`, { limit }),
    ),

  getRecentRecommendations: (query: { mission_id?: string; status?: string; limit?: number } = {}) =>
    system1Fetch<System1RecommendationRecord[]>(
      withQuery("/v1/recommendations/recent", {
        mission_id: query.mission_id,
        status: query.status,
        limit: query.limit ?? 25,
      }),
    ),
  getRecommendation: (recommendationId: string) =>
    system1Fetch<System1RecommendationRecord>(`/v1/recommendations/${recommendationId}`),
  decide: (recommendationId: string, body: System1RecommendationDecision) =>
    system1Fetch<System1ApprovalResponse>(`/v1/recommendations/${recommendationId}/decision`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  feedback: (recommendationId: string, body: System1CalibrationSignal) =>
    system1Fetch<System1CalibrationReceipt>(`/v1/recommendations/${recommendationId}/feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getSoldierCalibration: (soldierId: string, limit = 100) =>
    system1Fetch<System1SoldierCalibrationProfile>(
      withQuery(`/v1/soldiers/${soldierId}/calibration-profile`, { limit }),
    ),
  getTrainingTrajectory: (soldierId: string, limit = 100) =>
    system1Fetch<System1TrainingTrajectory>(
      withQuery(`/v1/soldier/${soldierId}/training-trajectory`, { limit }),
    ),

  getGraphSubgraph: (query: { run_id?: string; mission_id?: string; soldier_id?: string; limit?: number }) =>
    system1Fetch<System1GraphSubgraph>(
      withQuery("/v1/graph/subgraph", {
        run_id: query.run_id,
        mission_id: query.mission_id,
        soldier_id: query.soldier_id,
        limit: query.limit ?? 100,
      }),
    ),

  getUpdateLedger: (query: { entity_type?: string; entity_id?: string; limit?: number } = {}) =>
    system1Fetch<System1UpdateLedgerEntry[]>(
      withQuery("/v1/update-ledger", {
        entity_type: query.entity_type,
        entity_id: query.entity_id,
        limit: query.limit ?? 100,
      }),
    ),

  getOutbox: (limit = 100) => system1Fetch<System1OutboxEvent[]>(withQuery("/v1/outbox", { limit })),
};
