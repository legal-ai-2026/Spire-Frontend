"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Database,
  FileText,
  GitBranch,
  Image,
  Layers,
  Loader2,
  Mic,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  Users,
  XCircle,
} from "lucide-react";
import { system1Api } from "@/lib/system1";
import type {
  CalibrationCueTag,
  CalibrationOutcome,
  System1AuditEvent,
  System1CalibrationReceipt,
  System1DashboardRunSummary,
  System1GraphSubgraph,
  System1HealthReport,
  System1MissionStateSummary,
  System1OutboxEvent,
  System1ReadyReport,
  System1RecommendationRecord,
  System1ReviewRequirement,
  System1RunRecord,
  System1RunStatus,
  System1ScenarioRecommendation,
  System1SoldierCalibrationProfile,
  System1SoldierSummary,
  System1TeamCalibrationProfile,
  System1TrainingTrajectory,
  System1UpdateLedgerEntry,
} from "@/types/system1";

const PHASES = ["Benning", "Mountain", "Florida"] as const;
const TERMINAL_OR_REVIEWABLE = new Set<System1RunStatus>(["pending_approval", "completed", "failed"]);
const POLLING_MS = 1500;

const OUTCOMES: CalibrationOutcome[] = ["improved", "no_change", "worsened", "unsafe_abort", "unclear"];
const CUE_TAGS: CalibrationCueTag[] = [
  "communication_timing",
  "security_posture",
  "fire_control_timing",
  "fatigue_stress",
  "terrain_interaction",
  "team_coordination",
  "leadership_delegation",
  "source_uncertainty",
];

type TabKey = "review" | "soldiers" | "mission" | "calibration" | "audit";

const TABS: { key: TabKey; label: string; icon: typeof ClipboardCheck }[] = [
  { key: "review", label: "Review Queue", icon: ClipboardCheck },
  { key: "soldiers", label: "Soldiers", icon: Users },
  { key: "mission", label: "Mission", icon: GitBranch },
  { key: "calibration", label: "Calibration", icon: SlidersHorizontal },
  { key: "audit", label: "Audit", icon: Database },
];

const STATUS_META: Record<System1RunStatus, { label: string; className: string }> = {
  accepted: { label: "Accepted", className: "border-[#30363d] bg-[#21262d] text-[#8b949e]" },
  processing: { label: "Processing", className: "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#f59e0b]" },
  pending_approval: { label: "Pending Approval", className: "border-[#58a6ff]/30 bg-[#58a6ff]/10 text-[#58a6ff]" },
  completed: { label: "Completed", className: "border-[#3fb950]/30 bg-[#3fb950]/10 text-[#3fb950]" },
  failed: { label: "Failed", className: "border-[#f85149]/30 bg-[#f85149]/10 text-[#f85149]" },
};

const REC_STATUS_CLASS: Record<System1RecommendationRecord["status"], string> = {
  pending: "border-[#58a6ff]/30 bg-[#58a6ff]/10 text-[#58a6ff]",
  approved: "border-[#3fb950]/30 bg-[#3fb950]/10 text-[#3fb950]",
  rejected: "border-[#8b949e]/30 bg-[#21262d] text-[#8b949e]",
  blocked: "border-[#f85149]/30 bg-[#f85149]/10 text-[#f85149]",
};

function newClientId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function shortId(value?: string | null, chars = 10) {
  if (!value) return "n/a";
  if (value.length <= chars + 2) return value;
  return `${value.slice(0, chars)}...`;
}

function asPercent(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "n/a";
  const scaled = value <= 1 ? value * 100 : value;
  return `${Math.round(scaled)}%`;
}

function normalizeScore(value?: number | null) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

function formatCountMap(counts?: Record<string, number>) {
  if (!counts || Object.keys(counts).length === 0) return "none";
  return Object.entries(counts)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" / ");
}

function evidenceCount(rec?: System1ScenarioRecommendation | null) {
  return (rec?.evidence_refs?.length ?? 0) + (rec?.model_context_refs?.length ?? 0);
}

function requirementId(req: System1ReviewRequirement) {
  return req.id ?? req.requirement_id ?? req.label ?? req.description ?? "review_required";
}

function reviewRequirements(rec?: System1ScenarioRecommendation | null) {
  if (!rec) return [];
  const fromRoot = rec.review_requirements ?? [];
  const fromQuality = rec.decision_quality?.review_requirements ?? [];
  const seen = new Set<string>();
  return [...fromRoot, ...fromQuality].filter(req => {
    const id = requirementId(req);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function requiredReviewRequirements(rec?: System1ScenarioRecommendation | null) {
  return reviewRequirements(rec).filter(req => req.required_for_approval !== false);
}

function recommendationTitle(rec: System1ScenarioRecommendation) {
  return rec.proposed_modification ?? rec.learning_objective ?? rec.rationale;
}

function recommendationSoldier(rec: System1ScenarioRecommendation) {
  return rec.target_soldier_id ?? rec.target_ids?.[0] ?? "team";
}

function StatusPill({ status }: { status: System1RunStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

function MetricCell({
  label,
  value,
  accent = "text-white",
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="min-h-20 rounded-md border border-[#30363d] bg-[#161b22] p-3">
      <div className="text-xs text-[#8b949e]">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}

function PanelTitle({ icon: Icon, title, action }: { icon: typeof Bot; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon size={15} className="text-[#58a6ff]" />
      <h2 className="text-sm font-bold text-white">{title}</h2>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

function RecommendationCard({
  item,
  selected,
  onSelect,
}: {
  item: System1RecommendationRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const rec = item.recommendation;
  const reqs = requiredReviewRequirements(rec);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border bg-[#161b22] p-3 text-left transition-colors hover:border-[#58a6ff]/60 ${
        selected ? "border-[#58a6ff]" : item.status === "blocked" ? "border-[#f85149]/25" : "border-[#30363d]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Chip className={REC_STATUS_CLASS[item.status]}>{item.status}</Chip>
            <Chip className="border-[#30363d] bg-[#0d1117] text-[#58a6ff]">{recommendationSoldier(rec)}</Chip>
            {rec.task_code ? <Chip className="border-[#30363d] bg-[#0d1117] text-[#8b949e]">{rec.task_code}</Chip> : null}
            {rec.risk_level ? (
              <Chip
                className={
                  rec.risk_level === "high"
                    ? "border-[#f85149]/30 bg-[#f85149]/10 text-[#f85149]"
                    : "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#f59e0b]"
                }
              >
                {rec.risk_level} risk
              </Chip>
            ) : null}
          </div>
          <p className="line-clamp-2 text-sm font-semibold text-white">{recommendationTitle(rec)}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#8b949e] md:grid-cols-4">
            <span>Evidence {evidenceCount(rec)}</span>
            <span>Doctrine {rec.doctrine_refs?.length ?? 0}</span>
            <span>Safety {rec.safety_checks?.length ?? 0}</span>
            <span>Score {rec.score_breakdown?.total?.toFixed?.(2) ?? "n/a"}</span>
          </div>
          {rec.development_edge ? <p className="mt-2 text-xs text-[#58a6ff]">{rec.development_edge}</p> : null}
          {item.status === "blocked" && item.policy.reasons.length > 0 ? (
            <p className="mt-2 text-xs text-[#f85149]">{item.policy.reasons.join("; ")}</p>
          ) : null}
          {reqs.length > 0 ? (
            <p className="mt-2 text-xs text-[#f59e0b]">{reqs.length} required review item{reqs.length === 1 ? "" : "s"}</p>
          ) : null}
        </div>
        <ChevronRight size={16} className="mt-1 shrink-0 text-[#8b949e]" />
      </div>
    </button>
  );
}

function SoldierRow({
  soldier,
  selected,
  onSelect,
}: {
  soldier: System1SoldierSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full grid-cols-[minmax(7rem,1fr)_repeat(5,minmax(3rem,4rem))] items-center gap-2 border-b border-[#21262d] px-2 py-2 text-left text-xs hover:bg-[#21262d] ${
        selected ? "bg-[#21262d]" : ""
      }`}
    >
      <span className="truncate font-semibold text-white">{soldier.soldier_id}</span>
      <span className="text-[#3fb950]">{soldier.go_count}</span>
      <span className="text-[#f85149]">{soldier.nogo_count}</span>
      <span className="text-[#f59e0b]">{soldier.uncertain_count}</span>
      <span className="text-[#58a6ff]">{asPercent(soldier.go_rate)}</span>
      <span className="text-white">{asPercent(soldier.readiness_score)}</span>
    </button>
  );
}

export default function RangerTrainingPage() {
  const [instructorId, setInstructorId] = useState("ri-1");
  const [platoonId, setPlatoonId] = useState("plt-1");
  const [missionId, setMissionId] = useState("mission-mountain-01");
  const [phase, setPhase] = useState<(typeof PHASES)[number]>("Mountain");
  const [lat, setLat] = useState("35.0");
  const [lon, setLon] = useState("-83.0");
  const [grid, setGrid] = useState("17S");
  const [freeText, setFreeText] = useState("Jones blew Phase Line Bird. Smith asleep at 0300. Garcia textbook ambush rehearsal.");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);

  const [health, setHealth] = useState<System1HealthReport | null>(null);
  const [ready, setReady] = useState<System1ReadyReport | null>(null);
  const [proxyConfig, setProxyConfig] = useState<{ api_key_configured?: boolean; proxy_path?: string } | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<System1RunRecord | null>(null);
  const [dashboard, setDashboard] = useState<System1DashboardRunSummary | null>(null);
  const [missionState, setMissionState] = useState<System1MissionStateSummary | null>(null);
  const [teamCalibration, setTeamCalibration] = useState<System1TeamCalibrationProfile | null>(null);
  const [audit, setAudit] = useState<System1AuditEvent[]>([]);
  const [recentRecommendations, setRecentRecommendations] = useState<System1RecommendationRecord[]>([]);
  const [graph, setGraph] = useState<System1GraphSubgraph | null>(null);
  const [updateLedger, setUpdateLedger] = useState<System1UpdateLedgerEntry[]>([]);
  const [outbox, setOutbox] = useState<System1OutboxEvent[]>([]);
  const [traceId, setTraceId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("review");
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<System1RecommendationRecord | null>(null);
  const [selectedSoldierId, setSelectedSoldierId] = useState<string | null>(null);
  const [soldierCalibration, setSoldierCalibration] = useState<System1SoldierCalibrationProfile | null>(null);
  const [trainingTrajectory, setTrainingTrajectory] = useState<System1TrainingTrajectory | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [deciding, setDeciding] = useState(false);
  const [decisionRationale, setDecisionRationale] = useState("");
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editedModification, setEditedModification] = useState("");

  const [feedbackSignalId, setFeedbackSignalId] = useState(newClientId("cal"));
  const [feedbackOutcome, setFeedbackOutcome] = useState<CalibrationOutcome>("improved");
  const [feedbackCueTags, setFeedbackCueTags] = useState<CalibrationCueTag[]>([]);
  const [feedbackSignal, setFeedbackSignal] = useState("");
  const [feedbackConfidence, setFeedbackConfidence] = useState(0.8);
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackReceipt, setFeedbackReceipt] = useState<System1CalibrationReceipt | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  const loadHealth = useCallback(async () => {
    const [proxyResult, healthResult, readyResult] = await Promise.allSettled([
      system1Api.proxyConfig(),
      system1Api.health(),
      system1Api.ready(),
    ]);

    if (proxyResult.status === "fulfilled") setProxyConfig(proxyResult.value.data);
    if (healthResult.status === "fulfilled") setHealth(healthResult.value.data);
    if (healthResult.status === "fulfilled") setTraceId(healthResult.value.traceId ?? null);
    if (readyResult.status === "fulfilled") setReady(readyResult.value.data);
  }, []);

  const loadRunBundle = useCallback(
    async (currentRun: System1RunRecord) => {
      setLoadingBundle(true);
      try {
        let dashboardData: System1DashboardRunSummary | null = null;
        try {
          const dashboardResult = await system1Api.getDashboard(currentRun.run_id);
          dashboardData = dashboardResult.data;
          setDashboard(dashboardData);
          if (dashboardResult.traceId) setTraceId(dashboardResult.traceId);
        } catch {
          setDashboard(null);
        }

        const resolvedMissionId = dashboardData?.mission_id ?? currentRun.ingest?.mission_id ?? missionId;
        const requests = await Promise.allSettled([
          system1Api.getRunAudit(currentRun.run_id),
          system1Api.getMissionState(resolvedMissionId),
          system1Api.getTeamCalibration(resolvedMissionId),
          system1Api.getRecentRecommendations({ mission_id: resolvedMissionId, limit: 100 }),
          system1Api.getGraphSubgraph({ mission_id: resolvedMissionId, limit: 100 }),
          system1Api.getUpdateLedger({ limit: 100 }),
          system1Api.getOutbox(100),
        ]);

        setAudit(requests[0].status === "fulfilled" ? requests[0].value.data : []);
        setMissionState(requests[1].status === "fulfilled" ? requests[1].value.data : null);
        setTeamCalibration(requests[2].status === "fulfilled" ? requests[2].value.data : null);
        setRecentRecommendations(requests[3].status === "fulfilled" ? requests[3].value.data : []);
        setGraph(requests[4].status === "fulfilled" ? requests[4].value.data : null);
        setUpdateLedger(requests[5].status === "fulfilled" ? requests[5].value.data : []);
        setOutbox(requests[6].status === "fulfilled" ? requests[6].value.data : []);
      } finally {
        setLoadingBundle(false);
      }
    },
    [missionId],
  );

  const fetchRun = useCallback(
    async (id: string) => {
      try {
        const result = await system1Api.getRun(id);
        setRun(result.data);
        setTraceId(result.traceId ?? result.data.trace_id ?? null);

        if (TERMINAL_OR_REVIEWABLE.has(result.data.status)) {
          stopPolling();
          await loadRunBundle(result.data);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to fetch System 1 run");
        stopPolling();
      }
    },
    [loadRunBundle, stopPolling],
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      setPolling(true);
      fetchRun(id);
      pollRef.current = setInterval(() => fetchRun(id), POLLING_MS);
    },
    [fetchRun, stopPolling],
  );

  useEffect(() => {
    loadHealth();
    return () => stopPolling();
  }, [loadHealth, stopPolling]);

  const allRecommendations = useMemo(() => {
    const byId = new Map<string, System1RecommendationRecord>();
    for (const item of run?.recommendations ?? []) byId.set(item.recommendation.recommendation_id, item);
    for (const item of recentRecommendations) byId.set(item.recommendation.recommendation_id, item);
    return [...byId.values()];
  }, [recentRecommendations, run?.recommendations]);

  const pendingRecommendations = allRecommendations.filter(item => item.status === "pending");
  const blockedRecommendations = allRecommendations.filter(item => item.status === "blocked");
  const decidedRecommendations = allRecommendations.filter(item => item.status === "approved" || item.status === "rejected");

  useEffect(() => {
    if (!run) return;
    if (run.status === "pending_approval" && pendingRecommendations[0] && !selectedRecommendationId) {
      setSelectedRecommendationId(pendingRecommendations[0].recommendation.recommendation_id);
      setActiveTab("review");
    }
  }, [pendingRecommendations, run, selectedRecommendationId]);

  useEffect(() => {
    let active = true;
    const seed = allRecommendations.find(item => item.recommendation.recommendation_id === selectedRecommendationId) ?? null;
    setSelectedRecommendation(seed);

    if (!selectedRecommendationId) return;
    setAcknowledged([]);
    setDecisionRationale("");
    setEditMode(false);
    setEditedModification(seed?.recommendation.proposed_modification ?? "");
    setFeedbackReceipt(null);

    system1Api
      .getRecommendation(selectedRecommendationId)
      .then(result => {
        if (!active) return;
        setSelectedRecommendation(result.data);
        setEditedModification(result.data.recommendation.proposed_modification ?? "");
        const cues = result.data.recommendation.calibration_support?.cue_tags_to_watch ?? [];
        setFeedbackCueTags(cues.length > 0 ? cues.slice(0, 2) : []);
        setFeedbackSignalId(newClientId("cal"));
      })
      .catch(() => {
        if (active) setSelectedRecommendation(seed);
      });

    return () => {
      active = false;
    };
  }, [allRecommendations, selectedRecommendationId]);

  useEffect(() => {
    let active = true;
    if (!selectedSoldierId) {
      setSoldierCalibration(null);
      setTrainingTrajectory(null);
      return;
    }

    Promise.allSettled([
      system1Api.getSoldierCalibration(selectedSoldierId),
      system1Api.getTrainingTrajectory(selectedSoldierId),
    ]).then(results => {
      if (!active) return;
      setSoldierCalibration(results[0].status === "fulfilled" ? results[0].value.data : null);
      setTrainingTrajectory(results[1].status === "fulfilled" ? results[1].value.data : null);
    });

    return () => {
      active = false;
    };
  }, [selectedSoldierId]);

  const selectedRecord = selectedRecommendation;
  const selectedRec = selectedRecord?.recommendation ?? null;
  const selectedRequirements = requiredReviewRequirements(selectedRec);
  const missingAcknowledgements = selectedRequirements
    .map(requirementId)
    .filter(id => !acknowledged.includes(id));
  const needsRationale = selectedRequirements.length > 0 || editMode;
  const canApprove =
    selectedRecord?.status === "pending" &&
    selectedRecord.policy.allowed &&
    missingAcknowledgements.length === 0 &&
    (!needsRationale || decisionRationale.trim().length > 0);
  const canReject = selectedRecord?.status === "pending";
  const canRecordFeedback = selectedRecord?.status === "approved" && !!selectedRec && !!run;

  const sortedSoldiers = useMemo(() => {
    return [...(dashboard?.soldiers ?? [])].sort((a, b) => {
      const reviewA = (a.blocked_recommendation_count ?? 0) + (a.active_recommendation_count ?? 0);
      const reviewB = (b.blocked_recommendation_count ?? 0) + (b.active_recommendation_count ?? 0);
      return reviewB - reviewA || (b.nogo_count ?? 0) - (a.nogo_count ?? 0);
    });
  }, [dashboard?.soldiers]);

  async function handleSubmit() {
    if (!instructorId.trim() || !platoonId.trim() || !missionId.trim()) {
      setError("Instructor, platoon, and mission IDs are required.");
      return;
    }
    if (!freeText.trim() && !audioFile && imageFiles.length === 0) {
      setError("Attach at least one evidence source before submitting.");
      return;
    }

    const parsedLat = Number.parseFloat(lat);
    const parsedLon = Number.parseFloat(lon);
    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLon) || !grid.trim()) {
      setError("A valid latitude, longitude, and MGRS grid are required.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const audio_b64 = audioFile ? await toBase64(audioFile) : null;
      const image_b64 = await Promise.all(imageFiles.map(toBase64));
      const result = await system1Api.ingest({
        envelope_id: newClientId("env"),
        instructor_id: instructorId.trim(),
        platoon_id: platoonId.trim(),
        mission_id: missionId.trim(),
        phase,
        timestamp_utc: new Date().toISOString(),
        frontend_build: "c2d2-fe",
        geo: { lat: parsedLat, lon: parsedLon, grid_mgrs: grid.trim() },
        free_text: freeText.trim() || null,
        audio_b64,
        image_b64,
      });

      setRunId(result.data.run_id);
      setRun(result.data);
      setTraceId(result.traceId ?? result.data.trace_id ?? null);
      setDashboard(null);
      setMissionState(null);
      setTeamCalibration(null);
      setAudit([]);
      setRecentRecommendations([]);
      setGraph(null);
      setUpdateLedger([]);
      setOutbox([]);
      setSelectedRecommendationId(null);
      setSelectedSoldierId(null);
      setAudioFile(null);
      setImageFiles([]);
      setFreeText("");
      startPolling(result.data.run_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "System 1 ingest failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshAll() {
    if (!runId && !run?.run_id) {
      await loadHealth();
      return;
    }
    const id = runId ?? run!.run_id;
    setRefreshing(true);
    try {
      await loadHealth();
      await fetchRun(id);
    } finally {
      setRefreshing(false);
    }
  }

  async function submitDecision(decision: "approve" | "reject") {
    if (!selectedRecord || !selectedRec) return;
    if (decision === "approve" && !canApprove) {
      setError("Complete the required review acknowledgements and rationale before approving.");
      return;
    }

    setError(null);
    setDeciding(true);
    try {
      const edited =
        decision === "approve" && editMode
          ? {
              ...selectedRec,
              proposed_modification: editedModification.trim() || selectedRec.proposed_modification,
              created_by: "instructor",
            }
          : undefined;

      await system1Api.decide(selectedRec.recommendation_id, {
        decision,
        decision_rationale: decision === "approve" ? decisionRationale.trim() || undefined : decisionRationale.trim() || undefined,
        acknowledged_review_requirements:
          decision === "approve" && acknowledged.length > 0 ? acknowledged : undefined,
        edited_recommendation: edited,
      });

      if (run?.run_id) await fetchRun(run.run_id);
      setDecisionRationale("");
      setAcknowledged([]);
      setEditMode(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Decision request failed");
    } finally {
      setDeciding(false);
    }
  }

  function toggleAcknowledgement(id: string) {
    setAcknowledged(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  }

  function toggleCueTag(tag: CalibrationCueTag) {
    setFeedbackCueTags(prev => (prev.includes(tag) ? prev.filter(item => item !== tag) : [...prev, tag]));
  }

  async function submitFeedback() {
    if (!canRecordFeedback || !selectedRec || !run) return;
    if (feedbackCueTags.length === 0 || feedbackSignal.trim().length === 0) {
      setError("Feedback requires at least one cue tag and an observed learning signal.");
      return;
    }

    setError(null);
    setFeedbackSubmitting(true);
    try {
      const result = await system1Api.feedback(selectedRec.recommendation_id, {
        signal_id: feedbackSignalId,
        recommendation_id: selectedRec.recommendation_id,
        run_id: run.run_id,
        instructor_id: instructorId.trim(),
        outcome: feedbackOutcome,
        cue_tags: feedbackCueTags,
        observed_learning_signal: feedbackSignal.trim(),
        target_soldier_id: selectedRec.target_soldier_id,
        task_code: selectedRec.task_code,
        development_edge: selectedRec.development_edge,
        intervention_id: selectedRec.intervention_id,
        confidence: feedbackConfidence,
        notes: feedbackNotes.trim() || undefined,
        evidence_refs: [{ ref: `run:${run.run_id}#${selectedRec.recommendation_id}`, role: "source_recommendation" }],
        occurred_at_utc: new Date().toISOString(),
      });

      setFeedbackReceipt(result.data);
      setFeedbackSignal("");
      setFeedbackNotes("");
      setFeedbackSignalId(newClientId("cal"));
      await fetchRun(run.run_id);
      const soldierKey = selectedRec.target_soldier_id ?? selectedRec.target_ids?.[0];
      if (soldierKey) setSelectedSoldierId(soldierKey);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Feedback request failed");
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  const runStatus = run?.status;
  const healthOk = health?.ok === true;
  const readyOk = ready?.ok === true || ready?.ready === true || ready?.critical_dependencies_ready === true;
  const missionKey = dashboard?.mission_id ?? run?.ingest?.mission_id ?? missionId;

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9]">
      <header className="border-b border-[#30363d] bg-[#0d1117] px-5 py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex items-center gap-3">
            <Bot size={24} className="text-[#58a6ff]" />
            <div>
              <h1 className="text-xl font-bold text-white">Ranger AI</h1>
              <p className="text-xs text-[#8b949e]">
                System 1 adversarial training support via {proxyConfig?.proxy_path ?? "/api/v1/system1"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
            {runStatus ? <StatusPill status={runStatus} /> : null}
            <Chip className={healthOk ? "border-[#3fb950]/30 bg-[#3fb950]/10 text-[#3fb950]" : "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#f59e0b]"}>
              health {healthOk ? "ok" : "unknown"}
            </Chip>
            <Chip className={readyOk ? "border-[#3fb950]/30 bg-[#3fb950]/10 text-[#3fb950]" : "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#f59e0b]"}>
              ready {readyOk ? "ok" : "check"}
            </Chip>
            <Chip className="border-[#30363d] bg-[#161b22] text-[#8b949e]">
              API key {proxyConfig?.api_key_configured ? "server-side" : "not set"}
            </Chip>
            {traceId ? <Chip className="border-[#30363d] bg-[#161b22] text-[#8b949e]">trace {shortId(traceId, 12)}</Chip> : null}
            <button
              type="button"
              onClick={refreshAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#58a6ff]"
            >
              {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="border-b border-[#f85149]/30 bg-[#f85149]/10 px-5 py-3 text-sm text-[#f85149]">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} />
            {error}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[20rem_minmax(0,1fr)_25rem]">
        <aside className="border-b border-[#30363d] bg-[#161b22] p-4 xl:min-h-[calc(100vh-73px)] xl:border-b-0 xl:border-r">
          <PanelTitle icon={FileText} title="Evidence Ingest" />
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-[#8b949e]">
                Instructor ID
                <input
                  value={instructorId}
                  onChange={event => setInstructorId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                />
              </label>
              <label className="block text-xs text-[#8b949e]">
                Platoon ID
                <input
                  value={platoonId}
                  onChange={event => setPlatoonId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                />
              </label>
            </div>

            <label className="block text-xs text-[#8b949e]">
              Mission ID
              <input
                value={missionId}
                onChange={event => setMissionId(event.target.value)}
                className="mt-1 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-[#8b949e]">
                Phase
                <select
                  value={phase}
                  onChange={event => setPhase(event.target.value as (typeof PHASES)[number])}
                  className="mt-1 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                >
                  {PHASES.map(item => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-[#8b949e]">
                MGRS Grid
                <input
                  value={grid}
                  onChange={event => setGrid(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-[#8b949e]">
                Latitude
                <input
                  value={lat}
                  onChange={event => setLat(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                />
              </label>
              <label className="block text-xs text-[#8b949e]">
                Longitude
                <input
                  value={lon}
                  onChange={event => setLon(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                />
              </label>
            </div>

            <label className="block text-xs text-[#8b949e]">
              Free Text Notes
              <textarea
                value={freeText}
                onChange={event => setFreeText(event.target.value)}
                rows={5}
                className="mt-1 w-full resize-none rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex min-h-16 cursor-pointer items-center gap-2 rounded-md border border-dashed border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-[#8b949e] hover:border-[#58a6ff]">
                <Mic size={14} />
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={event => setAudioFile(event.target.files?.[0] ?? null)}
                />
                <span className="min-w-0 truncate">{audioFile ? audioFile.name : "Audio"}</span>
              </label>
              <label className="flex min-h-16 cursor-pointer items-center gap-2 rounded-md border border-dashed border-[#30363d] bg-[#0d1117] px-2 py-2 text-xs text-[#8b949e] hover:border-[#58a6ff]">
                <Image size={14} />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={event => setImageFiles(Array.from(event.target.files ?? []))}
                />
                <span>{imageFiles.length > 0 ? `${imageFiles.length} image(s)` : "Images"}</span>
              </label>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#58a6ff] px-3 py-2 text-sm font-bold text-[#0d1117] transition-colors hover:bg-[#79c0ff] disabled:opacity-50"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Target size={15} />}
              Submit Ingest
            </button>
          </div>

          <div className="mt-5 border-t border-[#30363d] pt-4">
            <PanelTitle icon={Clock} title="Run State" />
            {run ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-[#8b949e]">Run</span>
                  <span className="font-mono text-[#58a6ff]">{shortId(run.run_id, 14)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#8b949e]">Mission</span>
                  <span className="truncate text-white">{missionKey}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#8b949e]">Observations</span>
                  <span className="text-white">{run.observations?.length ?? 0}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#8b949e]">Recommendations</span>
                  <span className="text-white">{run.recommendations?.length ?? 0}</span>
                </div>
                {polling ? (
                  <div className="flex items-center gap-2 rounded-md border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-2 py-2 text-[#f59e0b]">
                    <Loader2 size={13} className="animate-spin" />
                    Polling every {POLLING_MS / 1000}s
                  </div>
                ) : null}
                {run.errors?.length ? (
                  <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/10 p-2 text-[#f85149]">
                    {run.errors.map((item, index) => (
                      <div key={`${item}-${index}`}>{item}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-[#8b949e]">Submit evidence to create a System 1 run.</p>
            )}
          </div>
        </aside>

        <main className="min-w-0 p-4 xl:p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCell
              label="Platoon readiness"
              value={asPercent(dashboard?.platoon_readiness_score)}
              accent="text-[#3fb950]"
            />
            <MetricCell label="Observations" value={dashboard?.total_observations ?? run?.observations?.length ?? 0} />
            <MetricCell label="Pending review" value={dashboard?.pending_recommendations ?? pendingRecommendations.length} accent="text-[#58a6ff]" />
            <MetricCell label="Policy blocked" value={dashboard?.blocked_recommendations ?? blockedRecommendations.length} accent="text-[#f85149]" />
          </div>

          {dashboard?.platoon_readiness_score != null ? (
            <div className="mt-3 h-2 rounded-full bg-[#21262d]">
              <div
                className="h-2 rounded-full bg-[#3fb950]"
                style={{ width: `${normalizeScore(dashboard.platoon_readiness_score)}%` }}
              />
            </div>
          ) : null}

          <div className="mt-5 flex gap-2 overflow-x-auto border-b border-[#30363d] pb-2">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${
                  activeTab === key
                    ? "bg-[#21262d] text-white"
                    : "text-[#8b949e] hover:bg-[#161b22] hover:text-white"
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
            {loadingBundle ? (
              <div className="ml-auto flex items-center gap-2 px-2 text-xs text-[#8b949e]">
                <Loader2 size={13} className="animate-spin" />
                Loading projections
              </div>
            ) : null}
          </div>

          {activeTab === "review" ? (
            <div className="mt-4 space-y-5">
              {!run ? (
                <div className="rounded-md border border-[#30363d] bg-[#161b22] p-8 text-center">
                  <Bot size={38} className="mx-auto mb-3 text-[#30363d]" />
                  <p className="text-sm text-[#8b949e]">Submit an ingest to populate observations and recommendation review.</p>
                </div>
              ) : null}

              {pendingRecommendations.length > 0 ? (
                <section>
                  <PanelTitle icon={ClipboardCheck} title={`Pending Recommendations (${pendingRecommendations.length})`} />
                  <div className="grid gap-3 2xl:grid-cols-2">
                    {pendingRecommendations.map(item => (
                      <RecommendationCard
                        key={item.recommendation.recommendation_id}
                        item={item}
                        selected={selectedRecommendationId === item.recommendation.recommendation_id}
                        onSelect={() => {
                          setSelectedRecommendationId(item.recommendation.recommendation_id);
                          setSelectedSoldierId(recommendationSoldier(item.recommendation));
                        }}
                      />
                    ))}
                  </div>
                </section>
              ) : run ? (
                <div className="rounded-md border border-[#30363d] bg-[#161b22] p-4 text-sm text-[#8b949e]">
                  No pending recommendation is waiting for instructor decision.
                </div>
              ) : null}

              {blockedRecommendations.length > 0 ? (
                <section>
                  <PanelTitle icon={ShieldAlert} title={`Blocked Recommendations (${blockedRecommendations.length})`} />
                  <div className="grid gap-3 2xl:grid-cols-2">
                    {blockedRecommendations.map(item => (
                      <RecommendationCard
                        key={item.recommendation.recommendation_id}
                        item={item}
                        selected={selectedRecommendationId === item.recommendation.recommendation_id}
                        onSelect={() => setSelectedRecommendationId(item.recommendation.recommendation_id)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {decidedRecommendations.length > 0 ? (
                <section>
                  <PanelTitle icon={CheckCircle} title={`Decided Recommendations (${decidedRecommendations.length})`} />
                  <div className="grid gap-3 2xl:grid-cols-2">
                    {decidedRecommendations.map(item => (
                      <RecommendationCard
                        key={item.recommendation.recommendation_id}
                        item={item}
                        selected={selectedRecommendationId === item.recommendation.recommendation_id}
                        onSelect={() => setSelectedRecommendationId(item.recommendation.recommendation_id)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {(run?.observations?.length ?? 0) > 0 ? (
                <section className="rounded-md border border-[#30363d] bg-[#161b22] p-3">
                  <PanelTitle icon={Layers} title={`Observation Board (${run!.observations!.length})`} />
                  <div className="max-h-72 overflow-y-auto">
                    {run!.observations!.map(item => (
                      <div key={item.observation_id} className="grid gap-2 border-b border-[#21262d] py-2 text-xs md:grid-cols-[5rem_7rem_7rem_minmax(0,1fr)_5rem]">
                        <Chip
                          className={
                            item.rating === "GO"
                              ? "border-[#3fb950]/30 bg-[#3fb950]/10 text-[#3fb950]"
                              : item.rating === "NOGO"
                                ? "border-[#f85149]/30 bg-[#f85149]/10 text-[#f85149]"
                                : "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#f59e0b]"
                          }
                        >
                          {item.rating}
                        </Chip>
                        <button
                          type="button"
                          onClick={() => item.soldier_id && setSelectedSoldierId(item.soldier_id)}
                          className="truncate text-left font-semibold text-[#58a6ff]"
                        >
                          {item.soldier_id ?? "unknown"}
                        </button>
                        <span className="truncate text-[#8b949e]">{item.task_code ?? "task n/a"}</span>
                        <span className="text-[#c9d1d9]">{item.note ?? "No note text"}</span>
                        <span className="text-[#6e7681]">{item.source ?? "source"}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {activeTab === "soldiers" ? (
            <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
              <section className="rounded-md border border-[#30363d] bg-[#161b22]">
                <div className="grid grid-cols-[minmax(7rem,1fr)_repeat(5,minmax(3rem,4rem))] gap-2 border-b border-[#30363d] px-2 py-2 text-xs font-semibold text-[#8b949e]">
                  <span>Soldier</span>
                  <span>GO</span>
                  <span>NOGO</span>
                  <span>UNC</span>
                  <span>GO rate</span>
                  <span>Ready</span>
                </div>
                {sortedSoldiers.length > 0 ? (
                  sortedSoldiers.map(soldier => (
                    <SoldierRow
                      key={soldier.soldier_id}
                      soldier={soldier}
                      selected={selectedSoldierId === soldier.soldier_id}
                      onSelect={() => setSelectedSoldierId(soldier.soldier_id)}
                    />
                  ))
                ) : (
                  <p className="p-4 text-sm text-[#8b949e]">No soldier projection is available yet.</p>
                )}
              </section>

              <section className="rounded-md border border-[#30363d] bg-[#161b22] p-3">
                <PanelTitle icon={BarChart3} title="Selected Soldier" />
                {selectedSoldierId ? (
                  <div className="space-y-3 text-xs">
                    <div className="text-lg font-bold text-white">{selectedSoldierId}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <MetricCell label="Readiness" value={asPercent(trainingTrajectory?.readiness_score)} />
                      <MetricCell label="GO rate" value={asPercent(trainingTrajectory?.go_rate)} />
                    </div>
                    <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-3">
                      <div className="font-semibold text-white">Calibration trend</div>
                      <div className="mt-1 text-[#8b949e]">
                        {soldierCalibration?.outcome_trend ?? trainingTrajectory?.calibration_profile?.outcome_trend ?? "insufficient_data"}
                      </div>
                      <div className="mt-1 text-[#8b949e]">{formatCountMap(soldierCalibration?.outcome_counts)}</div>
                    </div>
                    <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-3">
                      <div className="font-semibold text-white">Trajectory</div>
                      <div className="mt-1 text-[#8b949e]">
                        {trainingTrajectory?.run_count ?? 0} runs / {trainingTrajectory?.observation_count ?? 0} observations /{" "}
                        {trainingTrajectory?.approved_recommendation_count ?? 0} approved
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[#8b949e]">Select a soldier to load calibration and trajectory projections.</p>
                )}
              </section>
            </div>
          ) : null}

          {activeTab === "mission" ? (
            <div className="mt-4 grid gap-4 2xl:grid-cols-2">
              <section className="rounded-md border border-[#30363d] bg-[#161b22] p-3">
                <PanelTitle icon={GitBranch} title="Mission State" />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-[#8b949e]">Mission</span>
                    <span className="truncate text-white">{missionState?.mission_id ?? missionKey}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8b949e]">Platoon</span>
                    <span className="text-white">{missionState?.platoon_id ?? dashboard?.platoon_id ?? platoonId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8b949e]">Runs</span>
                    <span className="text-white">{missionState?.run_count ?? "n/a"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8b949e]">Latest run</span>
                    <span className="font-mono text-[#58a6ff]">{shortId(missionState?.latest_run_id ?? run?.run_id, 12)}</span>
                  </div>
                  <div>
                    <div className="text-[#8b949e]">Observed soldiers</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(missionState?.observed_soldier_ids ?? []).slice(0, 24).map(item => (
                        <Chip key={item} className="border-[#30363d] bg-[#0d1117] text-[#58a6ff]">
                          {item}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-md border border-[#30363d] bg-[#161b22] p-3">
                <PanelTitle icon={Database} title="Integration State" />
                <div className="grid grid-cols-2 gap-2">
                  <MetricCell label="Graph nodes" value={graph?.nodes?.length ?? 0} />
                  <MetricCell label="Graph edges" value={graph?.edges?.length ?? 0} />
                  <MetricCell label="Ledger entries" value={updateLedger.length} />
                  <MetricCell label="Pending outbox" value={outbox.length} accent={outbox.length > 0 ? "text-[#f59e0b]" : "text-white"} />
                </div>
                <p className="mt-3 text-xs text-[#8b949e]">
                  Graph rendering is optional for approval. Typed recommendation data remains the control surface.
                </p>
              </section>

              <section className="rounded-md border border-[#30363d] bg-[#161b22] p-3 2xl:col-span-2">
                <PanelTitle icon={ClipboardCheck} title="Mission Recommendations" />
                <div className="grid gap-2 lg:grid-cols-2">
                  {recentRecommendations.slice(0, 8).map(item => (
                    <RecommendationCard
                      key={item.recommendation.recommendation_id}
                      item={item}
                      selected={selectedRecommendationId === item.recommendation.recommendation_id}
                      onSelect={() => {
                        setActiveTab("review");
                        setSelectedRecommendationId(item.recommendation.recommendation_id);
                      }}
                    />
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === "calibration" ? (
            <div className="mt-4 grid gap-4 2xl:grid-cols-2">
              <section className="rounded-md border border-[#30363d] bg-[#161b22] p-3">
                <PanelTitle icon={SlidersHorizontal} title="Team Calibration" />
                <div className="grid grid-cols-2 gap-2">
                  <MetricCell label="Signals" value={teamCalibration?.signal_count ?? 0} />
                  <MetricCell label="Trend" value={teamCalibration?.outcome_trend ?? "insufficient"} />
                </div>
                <div className="mt-3 rounded-md border border-[#30363d] bg-[#0d1117] p-3 text-xs">
                  <div className="font-semibold text-white">Outcomes</div>
                  <div className="mt-1 text-[#8b949e]">{formatCountMap(teamCalibration?.outcome_counts)}</div>
                </div>
              </section>

              <section className="rounded-md border border-[#30363d] bg-[#161b22] p-3">
                <PanelTitle icon={Target} title="Cue Profiles" />
                <div className="space-y-2">
                  {(teamCalibration?.cue_profiles ?? []).slice(0, 8).map((profile, index) => (
                    <div key={`${profile.cue_tag}-${index}`} className="rounded-md border border-[#30363d] bg-[#0d1117] p-3 text-xs">
                      <div className="font-semibold text-white">{profile.cue_tag ?? "cue"}</div>
                      <div className="mt-1 text-[#8b949e]">
                        {profile.signal_count ?? 0} signals / {profile.outcome_trend ?? "insufficient_data"}
                      </div>
                    </div>
                  ))}
                  {(teamCalibration?.cue_profiles?.length ?? 0) === 0 ? (
                    <p className="text-sm text-[#8b949e]">No calibration signals yet. Capture feedback after approved recommendations.</p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-md border border-[#30363d] bg-[#161b22] p-3 2xl:col-span-2">
                <PanelTitle icon={CheckCircle} title="Approved Items Missing Feedback" />
                <div className="grid gap-2 lg:grid-cols-2">
                  {decidedRecommendations
                    .filter(item => item.status === "approved")
                    .slice(0, 8)
                    .map(item => (
                      <RecommendationCard
                        key={item.recommendation.recommendation_id}
                        item={item}
                        selected={selectedRecommendationId === item.recommendation.recommendation_id}
                        onSelect={() => setSelectedRecommendationId(item.recommendation.recommendation_id)}
                      />
                    ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === "audit" ? (
            <div className="mt-4 rounded-md border border-[#30363d] bg-[#161b22]">
              <div className="border-b border-[#30363d] p-3">
                <PanelTitle icon={Database} title={`Audit Events (${audit.length})`} />
              </div>
              <div className="max-h-[36rem] overflow-y-auto">
                {audit.length > 0 ? (
                  audit.map((item, index) => (
                    <div key={item.event_id ?? `${item.event_type}-${index}`} className="grid gap-2 border-b border-[#21262d] p-3 text-xs md:grid-cols-[12rem_10rem_minmax(0,1fr)]">
                      <span className="text-[#8b949e]">{item.created_at_utc ?? item.created_at ?? "time n/a"}</span>
                      <span className="font-semibold text-white">{item.event_type ?? item.action ?? "event"}</span>
                      <span className="truncate text-[#8b949e]">
                        {item.recommendation_id ? `recommendation ${shortId(item.recommendation_id, 14)}` : JSON.stringify(item.details ?? {}).slice(0, 140)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="p-4 text-sm text-[#8b949e]">No audit events loaded.</p>
                )}
              </div>
            </div>
          ) : null}
        </main>

        <aside className="border-t border-[#30363d] bg-[#161b22] p-4 xl:min-h-[calc(100vh-73px)] xl:border-l xl:border-t-0">
          <PanelTitle icon={ClipboardCheck} title="Inspector" />

          {selectedRec && selectedRecord ? (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <Chip className={REC_STATUS_CLASS[selectedRecord.status]}>{selectedRecord.status}</Chip>
                  <Chip className="border-[#30363d] bg-[#0d1117] text-[#58a6ff]">{recommendationSoldier(selectedRec)}</Chip>
                  {selectedRec.task_code ? <Chip className="border-[#30363d] bg-[#0d1117] text-[#8b949e]">{selectedRec.task_code}</Chip> : null}
                </div>
                <h3 className="text-base font-bold text-white">{recommendationTitle(selectedRec)}</h3>
                <p className="mt-2 text-sm text-[#8b949e]">{selectedRec.rationale}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MetricCell label="Evidence refs" value={evidenceCount(selectedRec)} />
                <MetricCell label="Doctrine refs" value={selectedRec.doctrine_refs?.length ?? 0} />
                <MetricCell label="Fairness" value={asPercent(selectedRecord.policy.fairness_score ?? selectedRec.fairness_score)} />
                <MetricCell label="Total score" value={selectedRec.score_breakdown?.total?.toFixed?.(2) ?? "n/a"} />
              </div>

              {selectedRecord.policy.reasons.length > 0 ? (
                <div className="rounded-md border border-[#f85149]/30 bg-[#f85149]/10 p-3 text-xs text-[#f85149]">
                  <div className="mb-1 font-semibold text-white">Policy reasons</div>
                  {selectedRecord.policy.reasons.map(reason => (
                    <div key={reason} className="flex gap-1.5">
                      <XCircle size={12} className="mt-0.5 shrink-0" />
                      <span>{reason}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-3 text-xs">
                <div className="font-semibold text-white">Decision quality</div>
                <div className="mt-1 text-[#8b949e]">
                  {selectedRec.decision_quality?.rating ?? "not rated"} / reliance risk{" "}
                  {String(selectedRec.decision_quality?.reliance_risk ?? "n/a")}
                </div>
                {selectedRec.value_of_information != null ? (
                  <div className="mt-1 text-[#8b949e]">Value of information: {String(selectedRec.value_of_information)}</div>
                ) : null}
              </div>

              {selectedRec.safety_checks?.length || selectedRec.risk_controls?.length ? (
                <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-3 text-xs">
                  <div className="font-semibold text-white">Safety and controls</div>
                  {[...(selectedRec.safety_checks ?? []), ...(selectedRec.risk_controls ?? [])].map(item => (
                    <div key={item} className="mt-1 flex gap-1.5 text-[#f59e0b]">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedRec.calibration_support ? (
                <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-3 text-xs">
                  <div className="font-semibold text-white">Calibration cues</div>
                  <div className="mt-1 text-[#8b949e]">{selectedRec.calibration_support.calibration_goal ?? "Watch the listed cues during execution."}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(selectedRec.calibration_support.cue_tags_to_watch ?? []).map(tag => (
                      <Chip key={tag} className="border-[#30363d] bg-[#161b22] text-[#58a6ff]">
                        {tag}
                      </Chip>
                    ))}
                  </div>
                  <div className="mt-2 text-[#8b949e]">
                    Trend {selectedRec.calibration_support.outcome_trend ?? "insufficient_data"} / prior signals{" "}
                    {selectedRec.calibration_support.prior_signal_count ?? 0}
                  </div>
                </div>
              ) : null}

              {selectedRequirements.length > 0 && selectedRecord.status === "pending" ? (
                <div className="rounded-md border border-[#f59e0b]/30 bg-[#f59e0b]/10 p-3 text-xs">
                  <div className="mb-2 font-semibold text-white">Required review</div>
                  {selectedRequirements.map(req => {
                    const id = requirementId(req);
                    return (
                      <label key={id} className="mb-2 flex cursor-pointer items-start gap-2 text-[#f59e0b]">
                        <input
                          type="checkbox"
                          checked={acknowledged.includes(id)}
                          onChange={() => toggleAcknowledgement(id)}
                          className="mt-0.5"
                        />
                        <span>{req.label ?? req.description ?? id}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}

              {selectedRecord.status === "pending" ? (
                <div className="space-y-3 rounded-md border border-[#30363d] bg-[#0d1117] p-3">
                  <label className="flex items-center gap-2 text-xs text-[#8b949e]">
                    <input type="checkbox" checked={editMode} onChange={event => setEditMode(event.target.checked)} />
                    Edit before approving
                  </label>
                  {editMode ? (
                    <textarea
                      value={editedModification}
                      onChange={event => setEditedModification(event.target.value)}
                      rows={4}
                      className="w-full resize-none rounded-md border border-[#30363d] bg-[#161b22] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                    />
                  ) : null}
                  <textarea
                    value={decisionRationale}
                    onChange={event => setDecisionRationale(event.target.value)}
                    rows={3}
                    placeholder={needsRationale ? "Rationale required before approval" : "Decision rationale (optional)"}
                    className="w-full resize-none rounded-md border border-[#30363d] bg-[#161b22] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => submitDecision("approve")}
                      disabled={!canApprove || deciding}
                      className="flex items-center justify-center gap-1.5 rounded-md border border-[#3fb950]/30 bg-[#3fb950]/10 px-3 py-2 text-xs font-bold text-[#3fb950] hover:bg-[#3fb950]/20 disabled:opacity-40"
                    >
                      {deciding ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => submitDecision("reject")}
                      disabled={!canReject || deciding}
                      className="flex items-center justify-center gap-1.5 rounded-md border border-[#f85149]/30 bg-[#f85149]/10 px-3 py-2 text-xs font-bold text-[#f85149] hover:bg-[#f85149]/20 disabled:opacity-40"
                    >
                      <XCircle size={13} />
                      Reject
                    </button>
                  </div>
                  {!selectedRecord.policy.allowed ? (
                    <p className="text-xs text-[#f85149]">Blocked recommendations cannot be approved.</p>
                  ) : null}
                </div>
              ) : null}

              {selectedRecord.status === "approved" ? (
                <div className="space-y-3 rounded-md border border-[#30363d] bg-[#0d1117] p-3">
                  <div className="font-semibold text-white">Post-inject feedback</div>
                  <label className="block text-xs text-[#8b949e]">
                    Outcome
                    <select
                      value={feedbackOutcome}
                      onChange={event => setFeedbackOutcome(event.target.value as CalibrationOutcome)}
                      className="mt-1 w-full rounded-md border border-[#30363d] bg-[#161b22] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                    >
                      {OUTCOMES.map(item => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <div className="mb-1 text-xs text-[#8b949e]">Cue tags</div>
                    <div className="flex flex-wrap gap-1">
                      {CUE_TAGS.map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleCueTag(tag)}
                          className={`rounded-md border px-2 py-1 text-[11px] ${
                            feedbackCueTags.includes(tag)
                              ? "border-[#58a6ff]/40 bg-[#58a6ff]/10 text-[#58a6ff]"
                              : "border-[#30363d] bg-[#161b22] text-[#8b949e]"
                          }`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={feedbackSignal}
                    onChange={event => setFeedbackSignal(event.target.value)}
                    rows={3}
                    placeholder="Observed learning signal"
                    className="w-full resize-none rounded-md border border-[#30363d] bg-[#161b22] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                  />
                  <label className="block text-xs text-[#8b949e]">
                    Confidence {feedbackConfidence.toFixed(2)}
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={feedbackConfidence}
                      onChange={event => setFeedbackConfidence(Number(event.target.value))}
                      className="mt-1 w-full"
                    />
                  </label>
                  <textarea
                    value={feedbackNotes}
                    onChange={event => setFeedbackNotes(event.target.value)}
                    rows={2}
                    placeholder="Notes (optional)"
                    className="w-full resize-none rounded-md border border-[#30363d] bg-[#161b22] px-2 py-2 text-xs text-white outline-none focus:border-[#58a6ff]"
                  />
                  <button
                    type="button"
                    onClick={submitFeedback}
                    disabled={!canRecordFeedback || feedbackSubmitting}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#58a6ff]/30 bg-[#58a6ff]/10 px-3 py-2 text-xs font-bold text-[#58a6ff] hover:bg-[#58a6ff]/20 disabled:opacity-40"
                  >
                    {feedbackSubmitting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                    Record Feedback
                  </button>
                  {feedbackReceipt ? (
                    <p className="text-xs text-[#3fb950]">
                      Feedback {feedbackReceipt.status} as {shortId(feedbackReceipt.signal_id, 12)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-6 text-center text-sm text-[#8b949e]">
              Select a recommendation to inspect policy, evidence, decision quality, and feedback controls.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
